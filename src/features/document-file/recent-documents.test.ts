import { describe, expect, it, vi } from 'vitest';
import { createRecentDocuments, type RecentDocument, type RecentDocumentsStorage } from './recent-documents';
import { createUntitledDocumentIdentity } from './document-persistence-service';
import { detectDocumentPersistenceCapabilities } from './document-persistence-capabilities';

const win = {} as Window;
function identity(name: string, handle?: FileSystemFileHandle) {
  return {
    ...createUntitledDocumentIdentity(detectDocumentPersistenceCapabilities(win)),
    displayName: name, isUntitled: false, sourceKind: 'imported_file' as const,
    fileHandle: handle ?? null, fileFingerprint: `${name}:123:456`,
  };
}
function setup() {
  let saved: RecentDocument[] = [];
  const storage: RecentDocumentsStorage = {
    read: vi.fn(async () => saved),
    write: vi.fn(async (entries) => { saved = entries; }),
  };
  return { storage, history: createRecentDocuments(win, storage) };
}

describe('browser recent documents', () => {
  it('persists a bounded MRU list and deduplicates uploads by name, size and modified time', async () => {
    const { storage, history } = setup();
    for (let i = 0; i < 12; i++) await history.remember(identity(`${i}.gr4s`));
    await history.remember(identity('4.gr4s'));
    const restarted = createRecentDocuments(win, storage);
    const entries = await restarted.list();
    expect(entries).toHaveLength(10);
    expect(entries[0]).toMatchObject({ name: '4.gr4s', requiresSelection: true });
    expect(entries.filter((entry) => entry.name === '4.gr4s')).toHaveLength(1);
    expect(entries.some((entry) => entry.name === '0.gr4s')).toBe(false);
    // Same filename alone does not identify a file selected in a browser.
    await history.remember({ ...identity('4.gr4s'), fileFingerprint: '4.gr4s:99:101' });
    expect((await history.list()).filter((entry) => entry.name === '4.gr4s')).toHaveLength(2);
  });
  it('uses file identity rather than filename to deduplicate persisted handles', async () => {
    const { history } = setup();
    const first = { name: 'same.gr4s', isSameEntry: vi.fn(async (other) => other === first) } as unknown as FileSystemFileHandle;
    const second = { name: 'same.gr4s', isSameEntry: vi.fn(async (other) => other === second) } as unknown as FileSystemFileHandle;
    await history.remember(identity(first.name, first));
    await history.remember(identity(second.name, second));
    await history.remember(identity(first.name, first));
    const entries = await history.list();
    expect(entries).toHaveLength(2);
    expect(entries[0].fileHandle).toBe(first);
    expect(entries[0].requiresSelection).toBeUndefined();
  });
  it('replaces a located entry, removes entries and clears persisted history', async () => {
    const { history, storage } = setup();
    await history.remember(identity('old.gr4s'));
    const [old] = await history.list();
    await history.remember(identity('moved.gr4s'), old.id);
    expect((await history.list()).map((entry) => entry.name)).toEqual(['moved.gr4s']);
    await history.remove((await history.list())[0].id);
    expect(await history.list()).toEqual([]);
    await history.remember(identity('new.gr4s'));
    await history.clear();
    expect(await createRecentDocuments(win, storage).list()).toEqual([]);
  });
  it('keeps usable session history when IndexedDB is unavailable and reports the limitation', async () => {
    const storage = { read: vi.fn().mockRejectedValue(new Error('blocked')), write: vi.fn() };
    const history = createRecentDocuments(win, storage);
    await history.remember(identity('saved.gr4s'));
    expect(await history.list()).toHaveLength(1);
    expect(history.warning).toContain('page session');
    expect(storage.write).not.toHaveBeenCalled();
    await history.clear();
    expect(await history.list()).toEqual([]);
  });
  it('does not record untitled documents or downloads whose disk location is unknown', async () => {
    const { history } = setup();
    await history.remember({ ...identity('untitled.gr4s'), isUntitled: true });
    await history.remember({ ...identity('download.gr4s'), sourceKind: 'downloaded_export' });
    expect(await history.list()).toEqual([]);
  });
  it('serializes overlapping updates without losing an entry', async () => {
    const { history } = setup();
    await Promise.all([history.remember(identity('one.gr4s')), history.remember(identity('two.gr4s'))]);
    expect((await history.list()).map((entry) => entry.name)).toEqual(['two.gr4s', 'one.gr4s']);
  });
});
