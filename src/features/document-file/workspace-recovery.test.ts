import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useGraphTabsStore, type EditorSnapshot } from '../graph-tabs/store/graphTabsStore';
import { createWorkspaceRecovery, type WorkspaceCheckpoint, type WorkspaceStorage } from './workspace-recovery';
import { serializeEditorSnapshot } from './document-serialization';

const win = {} as Window;
const snapshot = (name: string, text = 'draft'): EditorSnapshot => ({
  metadata: { name, studioVariables: [{ id: 'var-1', name: 'gain', binding: { kind: 'literal', value: 2 } }] },
  nodes: [{ instanceId: 'note', blockTypeId: 'studio::Note', displayName: 'Note', position: { x: 20, y: 30 },
    parameters: { text: { bindingKind: 'literal', value: text } } }],
  edges: [],
});
function setup(initial: unknown = null) {
  let saved = initial;
  const storage: WorkspaceStorage = {
    read: vi.fn(async () => saved),
    write: vi.fn(async (value) => { saved = value; }),
  };
  const warning = vi.fn();
  return { storage, warning, recovery: createWorkspaceRecovery(win, storage, warning), saved: () => saved as WorkspaceCheckpoint };
}

beforeEach(() => {
  vi.useFakeTimers();
  useGraphTabsStore.setState({ tabs: [], activeTabId: null, initialized: false, recoveryWarning: null });
});
afterEach(() => vi.useRealTimers());

describe('workspace recovery', () => {
  it('restores tab order, selection, untitled edits and dirty baselines across a restart', async () => {
    const { recovery, storage } = setup();
    await recovery.restore();
    const state = useGraphTabsStore.getState();
    state.initializeFromSnapshot(snapshot('Untitled.gr4s'));
    const first = useGraphTabsStore.getState().tabs[0];
    state.updateTabSnapshot(first.id, snapshot('Untitled.gr4s', 'unsaved edits'), { dirty: true });
    const second = state.createTab({ snapshot: snapshot('second.gr4s'), document: {
      ...first.document, displayName: 'second.gr4s', isUntitled: false, sourceKind: 'imported_file',
    } });
    state.setActiveTab(first.id);
    recovery.schedule(useGraphTabsStore.getState());
    await vi.advanceTimersByTimeAsync(250);

    const restored = await createWorkspaceRecovery(win, storage, vi.fn()).restore();
    expect(restored?.activeTabIndex).toBe(0);
    expect(restored?.tabs.map((tab) => tab.document.displayName)).toEqual(['Untitled.gr4s', 'second.gr4s']);
    expect(restored?.tabs[0].snapshot.nodes[0].parameters.text.value).toBe('unsaved edits');
    expect(restored?.tabs[0].snapshot.metadata.studioVariables).toEqual(first.snapshot.metadata.studioVariables);
    expect(restored?.tabs[0].document).toMatchObject({ isDirty: true, isUntitled: true,
      lastPersistedContentHash: first.document.lastPersistedContentHash });
    expect(restored?.tabs[0].document.internalDocumentId).not.toBe(first.document.internalDocumentId);
    // A closed tab disappears from the next recovery checkpoint.
    state.closeTab(second.id);
    recovery.flush(useGraphTabsStore.getState());
    expect((await createWorkspaceRecovery(win, storage, vi.fn()).restore())?.tabs).toHaveLength(1);
  });

  it('retains browser file handles without requesting permission, and keeps uploads usable without a file', async () => {
    const { recovery, storage } = setup();
    await recovery.restore();
    useGraphTabsStore.getState().initializeFromSnapshot(snapshot('Untitled.gr4s'));
    const tab = useGraphTabsStore.getState().tabs[0];
    const handle = { getFile: vi.fn(), requestPermission: vi.fn() } as unknown as FileSystemFileHandle;
    useGraphTabsStore.getState().patchTabDocument(tab.id, (document) => ({
      ...document, sourceKind: 'file_handle', fileHandle: handle, hasWritableBacking: true, isUntitled: false,
    }));
    recovery.flush(useGraphTabsStore.getState());
    const restored = await createWorkspaceRecovery(win, storage, vi.fn()).restore();
    expect(restored?.tabs[0].document.fileHandle).toBe(handle);
    expect(restored?.tabs[0].document.hasWritableBacking).toBe(true);
    expect(handle.getFile).not.toHaveBeenCalled();
    expect((handle as unknown as { requestPermission: unknown }).requestPermission).not.toHaveBeenCalled();
    useGraphTabsStore.getState().patchTabDocument(tab.id, (document) => ({
      ...document, sourceKind: 'imported_file', fileHandle: null, hasWritableBacking: false,
    }));
    recovery.flush(useGraphTabsStore.getState());
    expect((await createWorkspaceRecovery(win, storage, vi.fn()).restore())?.tabs[0].document.hasWritableBacking).toBe(false);
  });

  it('coalesces changes and writes the latest state synchronously on desktop close', async () => {
    const { storage, recovery } = setup();
    storage.writeSync = vi.fn();
    await recovery.restore();
    useGraphTabsStore.getState().initializeFromSnapshot(snapshot('Untitled.gr4s'));
    recovery.schedule(useGraphTabsStore.getState());
    useGraphTabsStore.getState().createTab();
    recovery.schedule(useGraphTabsStore.getState());
    recovery.flush(useGraphTabsStore.getState(), true);
    expect(storage.writeSync).toHaveBeenCalledWith(expect.objectContaining({ activeTabIndex: 1, tabs: expect.any(Array) }));
    expect((vi.mocked(storage.writeSync).mock.calls[0][0]).tabs).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(300);
    expect(storage.write).not.toHaveBeenCalled();
  });

  it('skips a malformed tab and still selects a surviving tab at its original index', async () => {
    const { recovery, saved } = setup();
    await recovery.restore();
    useGraphTabsStore.getState().initializeFromSnapshot(snapshot('Untitled.gr4s'));
    recovery.flush(useGraphTabsStore.getState());
    const valid = saved().tabs[0];
    const { recovery: restarted, warning } = setup({ version: 1, activeTabIndex: 2,
      tabs: [valid, { ...valid, content: 'broken' }, { ...valid, document: { ...valid.document, displayName: 'third.gr4s' } }] });
    const restored = await restarted.restore();
    expect(restored?.tabs).toHaveLength(2);
    expect(restored?.activeTabIndex).toBe(1);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('Some tabs'));
  });

  it('does not overwrite unreadable or unsupported recovery storage', async () => {
    const { storage, recovery, warning } = setup({ version: 99 });
    expect(await recovery.restore()).toBeUndefined();
    useGraphTabsStore.getState().initializeFromSnapshot(snapshot('Untitled.gr4s'));
    recovery.flush(useGraphTabsStore.getState());
    expect(storage.write).not.toHaveBeenCalled();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('could not be restored'));
  });

  it('reports unavailable storage and write failures without interrupting editing', async () => {
    const { storage, recovery, warning } = setup();
    await recovery.restore();
    useGraphTabsStore.getState().initializeFromSnapshot(snapshot('Untitled.gr4s'));
    vi.mocked(storage.write).mockRejectedValue(new Error('quota exceeded'));
    recovery.flush(useGraphTabsStore.getState());
    await Promise.resolve();
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('could not be backed up'));
    const read = vi.fn().mockRejectedValue(new Error('storage disabled'));
    expect(await createWorkspaceRecovery(win, { ...storage, read }, warning).restore()).toBeUndefined();
    expect(useGraphTabsStore.getState().tabs).toHaveLength(1);
  });

  it('restored dirty content remains dirty when loaded into the tabs store', async () => {
    const { recovery, storage } = setup();
    await recovery.restore();
    useGraphTabsStore.getState().initializeFromSnapshot(snapshot('Untitled.gr4s', 'saved'));
    const tab = useGraphTabsStore.getState().tabs[0];
    useGraphTabsStore.getState().updateTabSnapshot(tab.id, snapshot('Untitled.gr4s', 'draft'), { dirty: true });
    recovery.flush(useGraphTabsStore.getState());
    const restored = (await createWorkspaceRecovery(win, storage, vi.fn()).restore())!;
    useGraphTabsStore.setState({ tabs: [], activeTabId: null, initialized: false });
    useGraphTabsStore.getState().restoreTabs(restored.tabs, restored.activeTabIndex);
    const recovered = useGraphTabsStore.getState().tabs[0];
    expect(recovered.document.isDirty).toBe(true);
    expect(serializeEditorSnapshot(recovered.snapshot).contentHash).not.toBe(recovered.document.lastPersistedContentHash);
    const added = useGraphTabsStore.getState().createTab();
    expect(added.id).not.toBe(recovered.id);
    useGraphTabsStore.getState().restoreTabs(restored.tabs, 0);
    expect(useGraphTabsStore.getState().tabs).toHaveLength(2);
  });
});
