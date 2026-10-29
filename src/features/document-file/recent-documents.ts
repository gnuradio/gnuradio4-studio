import type { DocumentIdentityState } from './document-persistence-service';

export type RecentDocument = {
  id: string;
  name: string;
  location?: string;
  lastOpenedAt: string;
  requiresSelection?: boolean;
  fileHandle?: FileSystemFileHandle;
  fingerprint?: string;
};

export type RecentDocumentsStorage = {
  read: () => Promise<RecentDocument[]>;
  write: (entries: RecentDocument[]) => Promise<void>;
};

// Handles are structured-cloned by IndexedDB; file contents are never copied into history.
export function createRecentDocumentsStorage(win: Window): RecentDocumentsStorage {
  const connect = () => new Promise<IDBDatabase>((resolve, reject) => {
    let blocked = false;
    const request = win.indexedDB.open('gr4-studio-recent-documents', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('history');
    request.onerror = () => reject(request.error);
    request.onblocked = () => { blocked = true; reject(new Error('Recent files storage is blocked by another tab.')); };
    request.onsuccess = () => {
      if (blocked) { request.result.close(); return; }
      request.result.onversionchange = () => request.result.close();
      resolve(request.result);
    };
  });
  const transaction = async (entries?: RecentDocument[]): Promise<RecentDocument[]> => {
    const db = await connect();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('history', entries ? 'readwrite' : 'readonly');
      const store = tx.objectStore('history');
      let request: IDBRequest;
      try {
        request = entries ? store.put(entries, 'entries') : store.get('entries');
      } catch (error) {
        db.close();
        reject(error);
        return;
      }
      tx.oncomplete = () => { db.close(); resolve(entries ?? request.result ?? []); };
      tx.onabort = tx.onerror = () => { db.close(); reject(tx.error); };
    });
  };
  return { read: () => transaction(), write: async (entries) => { await transaction(entries); } };
}

export function createRecentDocuments(
  win: Window,
  storage: RecentDocumentsStorage = createRecentDocumentsStorage(win),
) {
  const native = win.gr4StudioShell?.capabilities?.nativeFiles ? win.gr4StudioShell.documents : undefined;
  let memory: RecentDocument[] = [];
  let sessionOnly = false;
  let warning: string | null = null;
  let pending: Promise<unknown> = Promise.resolve();
  const serial = <T,>(operation: () => Promise<T>): Promise<T> => {
    // Coordinate read/modify/write across browser tabs as well as within this page.
    const result = pending.then(() => !native && win.navigator?.locks
      ? win.navigator.locks.request('gr4-studio-recent-documents', operation)
      : operation());
    pending = result.catch(() => {});
    return result;
  };
  const read = async () => {
    if (!sessionOnly) {
      try {
        const entries = native ? await native.listRecent() : await storage.read();
        memory = Array.isArray(entries) ? entries.filter((entry) =>
          typeof entry?.id === 'string' && typeof entry.name === 'string' && typeof entry.lastOpenedAt === 'string',
        ).slice(0, 10) : [];
      } catch {
        if (native) throw new Error('Could not load recent files. Try again or use Open.');
        sessionOnly = true;
        warning = 'Recent files could not be stored in this browser. History will last only for this page session.';
      }
    }
    return memory;
  };
  const write = async (entries: RecentDocument[]) => {
    memory = entries;
    if (sessionOnly) return;
    try {
      await storage.write(entries);
    } catch {
      sessionOnly = true;
      warning = 'Recent files could not be stored in this browser. History will last only for this page session.';
    }
  };
  return {
    get warning() { return warning; },
    list: () => serial(read),
    remember: (document: DocumentIdentityState, replaceId?: string) => serial(async () => {
      if (document.isUntitled || document.sourceKind === 'downloaded_export') return;
      if (native && document.nativeFileToken) {
        await native.rememberRecent({ token: document.nativeFileToken, replaceId });
        return;
      }
      if (native) return;
      const entries = await read();
      let existing: RecentDocument | undefined;
      for (const entry of entries) {
        if (document.fileHandle && entry.fileHandle) {
          try {
            if (await document.fileHandle.isSameEntry(entry.fileHandle)) { existing = entry; break; }
          } catch { /* Missing files should not prevent other entries from being recorded. */ }
        } else if (!document.fileHandle && document.fileFingerprint && entry.fingerprint === document.fileFingerprint) {
          existing = entry;
          break;
        }
      }
      await write([{
        // getRandomValues also works on HTTP origins where randomUUID is unavailable.
        id: existing?.id ?? Array.from(crypto.getRandomValues(new Uint32Array(4)), (value) => value.toString(16).padStart(8, '0')).join(''),
        name: document.displayName,
        lastOpenedAt: new Date().toISOString(),
        ...(document.fileHandle ? { fileHandle: document.fileHandle } : { requiresSelection: true }),
        ...(document.fileFingerprint ? { fingerprint: document.fileFingerprint } : {}),
      }, ...entries.filter((entry) => entry.id !== existing?.id && entry.id !== replaceId)].slice(0, 10));
    }),
    remove: (id: string) => serial(async () => {
      if (native) return native.removeRecent({ id });
      await write((await read()).filter((entry) => entry.id !== id));
    }),
    clear: () => serial(async () => {
      if (native) return native.clearRecent();
      await write([]);
    }),
  };
}
