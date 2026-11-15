import { z } from 'zod';
import { editorGraphFromDocument } from '../graph-document/model/toEditor';
import { useGraphTabsStore, type EditorSnapshot, type GraphTab } from '../graph-tabs/store/graphTabsStore';
import { detectDocumentPersistenceCapabilities } from './document-persistence-capabilities';
import { createUntitledDocumentIdentity } from './document-persistence-service';
import { deserializeDocumentText, serializeEditorSnapshot } from './document-serialization';

const savedIdentity = z.object({
  displayName: z.string().min(1),
  isUntitled: z.boolean(),
  isDirty: z.boolean(),
  sourceKind: z.enum(['untitled', 'file_handle', 'imported_file', 'downloaded_export', 'remote_document']),
  lastPersistedContentHash: z.string().nullable(),
  fileFingerprint: z.string().optional(),
  fileHandle: z.unknown().optional(),
  nativeFileToken: z.string().optional(),
});

export type WorkspaceCheckpoint = {
  version: 1;
  activeTabIndex: number;
  tabs: Array<{ content: string; document: z.infer<typeof savedIdentity> }>;
};
export type WorkspaceStorage = {
  read: () => Promise<unknown>;
  write: (workspace: WorkspaceCheckpoint) => Promise<void>;
  writeSync?: (workspace: WorkspaceCheckpoint) => void;
};
type WorkspaceTabs = { tabs: GraphTab[]; activeTabId: string | null };

// Keep the database open so a final pagehide checkpoint can start its transaction
// immediately. Handles are structured-cloned; reopening never requests permission.
export function createBrowserWorkspaceStorage(win: Window): WorkspaceStorage {
  let database: IDBDatabase | undefined;
  const connect = () => new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false;
    const request = win.indexedDB.open('gr4-studio-workspace', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('workspace');
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error('Workspace storage is blocked by another window.')); };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      database = request.result;
      database.onversionchange = () => { database?.close(); database = undefined; };
      resolve(database);
    };
  });
  const transaction = (db: IDBDatabase, workspace?: WorkspaceCheckpoint) => new Promise<unknown>((resolve, reject) => {
    const tx = db.transaction('workspace', workspace ? 'readwrite' : 'readonly');
    const store = tx.objectStore('workspace');
    const request = workspace ? store.put(workspace, 'current') : store.get('current');
    tx.oncomplete = () => resolve(workspace ?? request.result ?? null);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
  return {
    read: async () => transaction(database ?? await connect()),
    write: async (workspace) => {
      await transaction(database ?? await connect(), workspace);
    },
  };
}

function checkpoint({ tabs, activeTabId }: WorkspaceTabs): WorkspaceCheckpoint {
  return {
    version: 1,
    activeTabIndex: Math.max(0, tabs.findIndex((tab) => tab.id === activeTabId)),
    tabs: tabs.map((tab) => ({
      content: serializeEditorSnapshot(tab.snapshot).content,
      document: savedIdentity.parse(tab.document),
    })),
  };
}

export function createWorkspaceRecovery(win: Window, storage: WorkspaceStorage, onWarning: (warning: string | null) => void) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest: WorkspaceTabs | undefined;
  let readFailed = false;
  let restoreWarning: string | null = null;
  const writeFailed = () => onWarning('Open tabs could not be backed up. Save your documents before closing Studio.');
  const flush = (state = latest, final = false) => {
    clearTimeout(timer);
    if (readFailed || !state?.tabs.length) return;
    try {
      const workspace = checkpoint(state);
      if (final && storage.writeSync) {
        storage.writeSync(workspace);
        onWarning(restoreWarning);
      } else {
        void storage.write(workspace).then(() => onWarning(restoreWarning), writeFailed);
      }
    } catch { writeFailed(); }
  };
  return {
    async restore() {
      try {
        const raw = await storage.read();
        if (raw == null) return;
        const header = z.object({ version: z.literal(1), activeTabIndex: z.number().int().nonnegative(), tabs: z.array(z.unknown()) }).parse(raw);
        const tabs: Array<{ snapshot: EditorSnapshot; document: GraphTab['document'] }> = [];
        let activeTabIndex = 0;
        for (const [index, entry] of header.tabs.entries()) {
          try {
            const saved = z.object({ content: z.string(), document: savedIdentity }).parse(entry);
            const serialized = deserializeDocumentText(saved.content);
            const fileHandle = saved.document.fileHandle as FileSystemFileHandle | undefined;
            const handle = typeof fileHandle?.getFile === 'function' ? fileHandle : null;
            const nativeFileToken = win.gr4StudioShell?.capabilities?.nativeFiles ? saved.document.nativeFileToken : undefined;
            const { fileHandle: _handle, ...identity } = saved.document;
            tabs.push({
              snapshot: editorGraphFromDocument(serialized.document),
              document: {
                ...createUntitledDocumentIdentity(detectDocumentPersistenceCapabilities(win)),
                ...identity,
                nativeFileToken,
                fileHandle: handle,
                filePathHint: saved.document.isUntitled ? null : saved.document.displayName,
                hasWritableBacking: Boolean(nativeFileToken || handle),
                lastPersistedContentHash: identity.lastPersistedContentHash ?? (identity.isDirty ? 'unsaved' : serialized.contentHash),
              },
            });
            if (index === header.activeTabIndex) activeTabIndex = tabs.length - 1;
          } catch {
            restoreWarning = 'Some tabs could not be restored from recovery storage. Other tabs are still available.';
          }
        }
        onWarning(restoreWarning);
        return { tabs, activeTabIndex };
      } catch {
        // Preserve an unreadable/unsupported checkpoint instead of overwriting it.
        readFailed = true;
        onWarning('Open tabs could not be restored. Save your documents before closing; tab recovery is unavailable.');
      }
    },
    schedule(state: WorkspaceTabs) {
      latest = state;
      clearTimeout(timer);
      timer = setTimeout(() => flush(), 250);
    },
    flush,
  };
}

let recovery: ReturnType<typeof createWorkspaceRecovery> | undefined;

// Called before mounting the editor, never from the display application route.
export async function initializeWorkspaceRecovery(win: Window) {
  const native = win.gr4StudioShell?.capabilities?.nativeFiles ? win.gr4StudioShell.documents : undefined;
  const storage: WorkspaceStorage = native ? {
    read: () => native.loadWorkspace(),
    write: (workspace) => native.saveWorkspace(workspace),
    writeSync: (workspace) => native.saveWorkspaceSync(workspace),
  } : createBrowserWorkspaceStorage(win);
  recovery = createWorkspaceRecovery(win, storage, (recoveryWarning) => useGraphTabsStore.setState({ recoveryWarning }));
  const restored = await recovery.restore();
  if (restored) useGraphTabsStore.getState().restoreTabs(restored.tabs, restored.activeTabIndex);
  useGraphTabsStore.subscribe((state, previous) => {
    if (state.tabs !== previous.tabs || state.activeTabId !== previous.activeTabId) recovery?.schedule(state);
  });
}

export function flushWorkspaceRecovery(activeEditor?: { tabId: string; snapshot: EditorSnapshot }) {
  const state = useGraphTabsStore.getState();
  const tabs = state.tabs.map((tab) => {
    if (tab.id !== activeEditor?.tabId) return tab;
    const snapshot = { ...activeEditor.snapshot, metadata: { ...activeEditor.snapshot.metadata, name: tab.document.displayName } };
    const isDirty = serializeEditorSnapshot(snapshot).contentHash !== tab.document.lastPersistedContentHash;
    return { ...tab, snapshot, document: { ...tab.document, isDirty } };
  });
  recovery?.flush({ tabs, activeTabId: state.activeTabId }, true);
}
