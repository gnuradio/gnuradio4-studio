import { create } from 'zustand';
import type { ApplicationSpec, StudioLayoutSpec, StudioPanelSpec, StudioPlotPaletteSpec, StudioVariable } from '../../graph-document/model/studio-workspace';
import type { EditorGraphEdge, EditorGraphNode } from '../../graph-editor/model/types';
import { createUntitledDocumentIdentity, type DocumentIdentityState } from '../../document-file/document-persistence-service';
import { detectDocumentPersistenceCapabilities } from '../../document-file/document-persistence-capabilities';
import { serializeEditorSnapshot, STUDIO_UNTITLED_NAME } from '../../document-file/document-serialization';

export type EditorSnapshot = {
  metadata: {
    name: string;
    description?: string;
    schedulerId?: string;
    studioPanels?: StudioPanelSpec[];
    studioVariables?: StudioVariable[];
    studioLayout?: StudioLayoutSpec;
    studioPlotPalettes?: StudioPlotPaletteSpec[];
    application?: ApplicationSpec;
  };
  nodes: EditorGraphNode[];
  edges: EditorGraphEdge[];
};

export type GraphTab = {
  id: string;
  title: string;
  isDirty: boolean;
  snapshot: EditorSnapshot;
  document: DocumentIdentityState;
};

type GraphTabsState = {
  tabs: GraphTab[];
  activeTabId: string | null;
  initialized: boolean;
  recoveryWarning: string | null;
  restoreTabs: (tabs: Array<{ snapshot: EditorSnapshot; document: DocumentIdentityState }>, activeTabIndex: number) => void;
  initializeFromSnapshot: (snapshot: EditorSnapshot) => void;
  createTab: (input?: { snapshot?: EditorSnapshot; document?: DocumentIdentityState; activate?: boolean }) => GraphTab;
  updateActiveSnapshot: (snapshot: EditorSnapshot, options?: { dirty?: boolean }) => void;
  updateTabSnapshot: (tabId: string, snapshot: EditorSnapshot, options?: { dirty?: boolean }) => void;
  setTabDocument: (tabId: string, document: DocumentIdentityState) => void;
  patchTabDocument: (tabId: string, updater: (current: DocumentIdentityState) => DocumentIdentityState) => void;
  renameTabDocument: (tabId: string, displayName: string) => void;
  setActiveTab: (tabId: string) => void;
  closeTab: (tabId: string) => { nextActiveTabId: string | null };
  markActiveSaved: () => void;
  anyDirty: () => boolean;
};

let tabCounter = 1;

function createTabId(): string {
  tabCounter += 1;
  return `tab-${tabCounter}`;
}

function createEmptySnapshot(index: number): EditorSnapshot {
  const untitledName = index === 1 ? STUDIO_UNTITLED_NAME : `Untitled-${index}${STUDIO_UNTITLED_NAME.slice('Untitled'.length)}`;
  return {
    metadata: {
      name: untitledName,
      description: undefined,
      studioVariables: [],
    },
    nodes: [],
    edges: [],
  };
}

function getDefaultCapabilities() {
  if (typeof window === 'undefined') {
    return {
      canUseFileSystemAccessApi: false,
      canSaveInPlace: false,
      canPromptForSaveLocation: false,
      usesDownloadFallback: true,
      canOpenWithPicker: false,
    };
  }
  return detectDocumentPersistenceCapabilities(window);
}

function withDocumentMetadata(snapshot: EditorSnapshot, document: DocumentIdentityState): EditorSnapshot {
  return {
    ...snapshot,
    metadata: {
      ...snapshot.metadata,
      name: document.displayName,
    },
  };
}

function createTabFromSnapshot(id: string, snapshot: EditorSnapshot, document?: DocumentIdentityState): GraphTab {
  const baseDocument = document ?? createUntitledDocumentIdentity(getDefaultCapabilities());
  const normalizedSnapshot = withDocumentMetadata(snapshot, baseDocument);
  const baselineHash = serializeEditorSnapshot(normalizedSnapshot).contentHash;
  const normalizedDocument: DocumentIdentityState = {
    ...baseDocument,
    displayName: baseDocument.displayName || normalizedSnapshot.metadata.name || STUDIO_UNTITLED_NAME,
    isDirty: baseDocument.isDirty ?? false,
    lastPersistedContentHash: baseDocument.lastPersistedContentHash ?? baselineHash,
    documentFormat: baseDocument.documentFormat || 'gr4-studio.graph@1',
  };

  return {
    id,
    title: normalizedDocument.displayName,
    isDirty: normalizedDocument.isDirty,
    snapshot: withDocumentMetadata(normalizedSnapshot, normalizedDocument),
    document: normalizedDocument,
  };
}

export const useGraphTabsStore = create<GraphTabsState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  initialized: false,
  recoveryWarning: null,

  restoreTabs: (restored, activeTabIndex) => {
    if (get().initialized || get().tabs.length > 0 || restored.length === 0) return;
    tabCounter = 0;
    const tabs = restored.map(({ snapshot, document }) => createTabFromSnapshot(createTabId(), snapshot, document));
    set({ initialized: true, tabs, activeTabId: tabs[activeTabIndex]?.id ?? tabs[0].id });
  },

  initializeFromSnapshot: (snapshot) => {
    const state = get();
    if (state.initialized || state.tabs.length > 0) {
      return;
    }

    tabCounter = 1;
    set({
      initialized: true,
      tabs: [createTabFromSnapshot('tab-1', snapshot)],
      activeTabId: 'tab-1',
    });
  },

  createTab: (input) => {
    const id = createTabId();
    const snapshot = input?.snapshot ?? createEmptySnapshot(tabCounter);
    const tab = createTabFromSnapshot(id, snapshot, input?.document);

    set((state) => ({
      initialized: true,
      tabs: [...state.tabs, tab],
      activeTabId: input?.activate === false ? state.activeTabId : id,
    }));

    return tab;
  },

  updateActiveSnapshot: (snapshot, options) => {
    const { activeTabId } = get();
    if (!activeTabId) {
      return;
    }

    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== activeTabId) {
          return tab;
        }

        const nextDirty = options?.dirty ?? tab.document.isDirty;
        const nextSnapshot = withDocumentMetadata(snapshot, tab.document);
        return {
          ...tab,
          title: tab.document.displayName || nextSnapshot.metadata.name || tab.title,
          isDirty: nextDirty,
          snapshot: nextSnapshot,
          document: {
            ...tab.document,
            isDirty: nextDirty,
          },
        };
      }),
    }));
  },

  updateTabSnapshot: (tabId, snapshot, options) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId) {
          return tab;
        }

        const nextDirty = options?.dirty ?? tab.document.isDirty;
        const nextSnapshot = withDocumentMetadata(snapshot, tab.document);
        return {
          ...tab,
          title: tab.document.displayName || nextSnapshot.metadata.name || tab.title,
          isDirty: nextDirty,
          snapshot: nextSnapshot,
          document: {
            ...tab.document,
            isDirty: nextDirty,
          },
        };
      }),
    }));
  },

  setTabDocument: (tabId, document) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId) {
          return tab;
        }
        const nextSnapshot = withDocumentMetadata(tab.snapshot, document);
        return {
          ...tab,
          title: document.displayName || tab.title,
          isDirty: document.isDirty,
          snapshot: nextSnapshot,
          document,
        };
      }),
    }));
  },

  patchTabDocument: (tabId, updater) => {
    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId) {
          return tab;
        }
        const nextDocument = updater(tab.document);
        const nextSnapshot = withDocumentMetadata(tab.snapshot, nextDocument);
        return {
          ...tab,
          title: nextDocument.displayName || tab.title,
          isDirty: nextDocument.isDirty,
          snapshot: nextSnapshot,
          document: nextDocument,
        };
      }),
    }));
  },

  renameTabDocument: (tabId, displayName) => {
    const trimmed = displayName.trim();
    if (!trimmed) {
      return;
    }

    set((state) => ({
      tabs: state.tabs.map((tab) => {
        if (tab.id !== tabId) {
          return tab;
        }
        const nextDocument: DocumentIdentityState = {
          ...tab.document,
          displayName: trimmed,
        };
        const nextSnapshot = withDocumentMetadata(tab.snapshot, nextDocument);
        return {
          ...tab,
          title: trimmed,
          snapshot: nextSnapshot,
          document: nextDocument,
        };
      }),
    }));
  },

  setActiveTab: (tabId) => {
    set({ activeTabId: tabId });
  },

  closeTab: (tabId) => {
    const state = get();
    if (state.tabs.length <= 1) {
      return { nextActiveTabId: state.activeTabId };
    }

    const remainingTabs = state.tabs.filter((tab) => tab.id !== tabId);
    const nextActiveTabId =
      state.activeTabId === tabId
        ? (remainingTabs[0]?.id ?? null)
        : state.activeTabId;

    set({
      tabs: remainingTabs,
      activeTabId: nextActiveTabId,
    });

    return { nextActiveTabId };
  },

  markActiveSaved: () => {
    const { activeTabId } = get();
    if (!activeTabId) {
      return;
    }

    set((state) => ({
      tabs: state.tabs.map((tab) =>
        tab.id === activeTabId
          ? {
              ...tab,
              isDirty: false,
              document: {
                ...tab.document,
                isDirty: false,
              },
            }
          : tab,
      ),
    }));
  },

  anyDirty: () => {
    return get().tabs.some((tab) => tab.document.isDirty);
  },
}));
