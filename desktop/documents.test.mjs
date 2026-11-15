import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDesktopDocuments } from './documents.mjs';
const roots = [];
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }); });
async function setup() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-documents-'));
  roots.push(root);
  const file = path.join(root, 'flow.gr4s');
  await fs.writeFile(file, 'original', { mode: 0o640 });
  const dialog = {
    showOpenDialog: vi.fn().mockResolvedValue({ filePaths: [file] }),
    showSaveDialog: vi.fn().mockResolvedValue({ filePath: file }),
  };
  const getRecentPath = () => path.join(root, 'state', 'recent-documents.json');
  const getWorkspacePath = () => path.join(root, 'state', 'workspace.json');
  return { root, file, dialog, getRecentPath, getWorkspacePath,
    documents: createDesktopDocuments({ dialog, getWindow: () => ({}), getRecentPath, getWorkspacePath }) };
}

describe('native document handles', () => {
  it('restores workspace snapshots and fresh writable handles after a desktop restart', async () => {
    const { documents, dialog, file, getRecentPath, getWorkspacePath } = await setup();
    const opened = await documents.open();
    const checkpoint = { version: 1, activeTabIndex: 1, tabs: [
      { content: 'unsaved graph', document: { displayName: 'flow.gr4s', isDirty: true, nativeFileToken: opened.token } },
      { content: 'untitled draft', document: { displayName: 'Untitled.gr4s', isDirty: true } },
    ] };
    documents.saveWorkspace(checkpoint);
    const persisted = JSON.parse(await fs.readFile(getWorkspacePath(), 'utf8'));
    expect(persisted.tabs[0].backingPath).toBe(file);
    expect(persisted.tabs[0].document).not.toHaveProperty('nativeFileToken');
    expect((await fs.stat(getWorkspacePath())).mode & 0o777).toBe(0o600);
    const restarted = createDesktopDocuments({ dialog, getWindow: () => ({}), getRecentPath, getWorkspacePath });
    const restored = await restarted.loadWorkspace();
    expect(restored.activeTabIndex).toBe(1);
    expect(restored.tabs.map((tab) => tab.content)).toEqual(['unsaved graph', 'untitled draft']);
    expect(restored.tabs[0]).not.toHaveProperty('backingPath');
    expect(restored.tabs[0].document.nativeFileToken).not.toBe(opened.token);
    expect(restored.tabs[1].document.nativeFileToken).toBeUndefined();
    expect(await fs.readFile(file, 'utf8')).toBe('original');
    await restarted.save({ token: restored.tabs[0].document.nativeFileToken, content: 'saved after restart' });
    expect(await fs.readFile(file, 'utf8')).toBe('saved after restart');
  });
  it('recovers missing files as snapshots and never trusts renderer paths or stale tokens', async () => {
    const { documents, file, getWorkspacePath } = await setup();
    const opened = await documents.open();
    documents.saveWorkspace({ version: 1, activeTabIndex: 0, tabs: [
      { content: 'missing-file edits', document: { nativeFileToken: opened.token } },
      { content: 'untrusted', backingPath: file, document: { nativeFileToken: file, filePathHint: file } },
    ] });
    expect(JSON.parse(await fs.readFile(getWorkspacePath(), 'utf8')).tabs[1]).not.toHaveProperty('backingPath');
    await fs.rm(file);
    const restored = await documents.loadWorkspace();
    expect(restored.tabs[0].content).toBe('missing-file edits');
    expect(restored.tabs.every((tab) => !tab.document.nativeFileToken)).toBe(true);
  });
  it('keeps the previous checkpoint when invalid input is rejected', async () => {
    const { documents } = await setup();
    expect(await documents.loadWorkspace()).toBeNull();
    documents.saveWorkspace({ version: 1, activeTabIndex: 0, tabs: [{ content: 'kept', document: {} }] });
    expect(() => documents.saveWorkspace({ version: 1, tabs: [{ content: 1 }] })).toThrow('Invalid');
    expect((await documents.loadWorkspace()).tabs[0].content).toBe('kept');
  });
  it('opens a selected file and saves via an opaque handle, preserving permissions', async () => {
    const { file, documents } = await setup();
    const opened = await documents.open();
    expect(opened.content).toBe('original');
    expect(opened).not.toHaveProperty('path');
    await documents.save({ token: opened.token, content: 'changed' });
    expect(await fs.readFile(file, 'utf8')).toBe('changed');
    expect((await fs.stat(file)).mode & 0o777).toBe(0o640);
  });
  it('cannot save arbitrary renderer paths or expired handles', async () => {
    const { file, documents } = await setup();
    await expect(documents.save({ token: file, content: 'bad' })).rejects.toThrow('expired');
    const opened = await documents.open();
    documents.clear();
    await expect(documents.save({ token: opened.token, content: 'bad' })).rejects.toThrow('expired');
    expect(await fs.readFile(file, 'utf8')).toBe('original');
  });
  it('canceling Save As leaves the document untouched', async () => {
    const { file, dialog, documents } = await setup();
    dialog.showSaveDialog.mockResolvedValue({ canceled: true });
    expect(await documents.saveAs({ name: 'flow.gr4s', content: 'bad' })).toBeNull();
    expect(await fs.readFile(file, 'utf8')).toBe('original');
  });
  it('Save As obtains a handle only after writing successfully', async () => {
    const { file, documents } = await setup();
    const saved = await documents.saveAs({ name: 'flow.gr4s', content: 'saved' });
    await documents.save({ token: saved.token, content: 'saved again' });
    expect(await fs.readFile(file, 'utf8')).toBe('saved again');
  });
  it('prefers the active file directory over the most recently opened directory', async () => {
    const { root, dialog, documents } = await setup();
    const first = await documents.open();
    const otherDirectory = path.join(root, 'other');
    await fs.mkdir(otherDirectory);
    const otherFile = path.join(otherDirectory, 'other.gr4s');
    await fs.writeFile(otherFile, 'other');
    dialog.showOpenDialog.mockResolvedValueOnce({ filePaths: [otherFile] });
    await documents.open({ token: first.token });
    dialog.showOpenDialog.mockResolvedValue({ canceled: true });

    await documents.open({ token: first.token });
    expect(dialog.showOpenDialog).toHaveBeenLastCalledWith(expect.anything(),
      expect.objectContaining({ defaultPath: root }));
    await documents.open();
    expect(dialog.showOpenDialog).toHaveBeenLastCalledWith(expect.anything(),
      expect.objectContaining({ defaultPath: otherDirectory }));
  });
  it('uses the active file directory for Save As and remembers a successful new location', async () => {
    const { root, dialog, documents } = await setup();
    const first = await documents.open();
    const otherDirectory = path.join(root, 'saved');
    await fs.mkdir(otherDirectory);
    dialog.showSaveDialog.mockResolvedValue({ filePath: path.join(otherDirectory, 'copy.gr4s') });
    await documents.saveAs({ token: first.token, name: 'copy.gr4s', content: 'copy' });
    expect(dialog.showSaveDialog).toHaveBeenLastCalledWith(expect.anything(),
      expect.objectContaining({ defaultPath: path.join(root, 'copy.gr4s') }));

    dialog.showOpenDialog.mockResolvedValue({ canceled: true });
    await documents.open();
    expect(dialog.showOpenDialog).toHaveBeenLastCalledWith(expect.anything(),
      expect.objectContaining({ defaultPath: otherDirectory }));
  });
  it('does not use renderer paths or remember canceled or failed selections', async () => {
    const { root, dialog, documents } = await setup();
    await documents.open();
    dialog.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: ['/unselected/flow.gr4s'] });
    await documents.open();
    dialog.showOpenDialog.mockResolvedValueOnce({ filePaths: [path.join(root, 'missing', 'flow.gr4s')] });
    await expect(documents.open()).rejects.toThrow();
    dialog.showOpenDialog.mockResolvedValue({ canceled: true });
    await documents.open({ token: '/renderer/chosen/path.gr4s' });
    expect(dialog.showOpenDialog).toHaveBeenLastCalledWith(expect.anything(),
      expect.objectContaining({ defaultPath: root }));
  });
  it('records only confirmed opens and persists recent paths across restarts with fresh tokens', async () => {
    const { documents, dialog, file, getRecentPath } = await setup();
    const opened = await documents.open();
    expect(await documents.listRecent()).toEqual([]);
    await documents.rememberRecent({ token: opened.token });
    const restarted = createDesktopDocuments({ dialog, getWindow: () => ({}), getRecentPath });
    const [entry] = await restarted.listRecent();
    expect(entry.name).toBe('flow.gr4s');
    expect(entry).not.toHaveProperty('path');
    const reopened = await restarted.openRecent({ id: entry.id });
    expect(reopened.content).toBe('original');
    expect(reopened.token).not.toBe(opened.token);
    await restarted.save({ token: reopened.token, content: 'after restart' });
    expect(await fs.readFile(file, 'utf8')).toBe('after restart');
    await expect(restarted.openRecent({ id: file })).rejects.toThrow('no longer in the list');
    await expect(restarted.rememberRecent({ token: file })).rejects.toThrow('expired');
  });
  it('bounds history, deduplicates paths and symlinks, and removes only metadata', async () => {
    const { documents, root, file, dialog } = await setup();
    for (let i = 0; i < 12; i++) {
      const next = path.join(root, `${i}.gr4s`);
      await fs.writeFile(next, 'graph');
      dialog.showOpenDialog.mockResolvedValue({ filePaths: [next] });
      await documents.rememberRecent({ token: (await documents.open()).token });
    }
    expect((await documents.listRecent()).map((entry) => entry.name)).toEqual(
      Array.from({ length: 10 }, (_, i) => `${11 - i}.gr4s`));
    const link = path.join(root, 'alias.gr4s');
    await fs.symlink(path.join(root, '4.gr4s'), link);
    dialog.showOpenDialog.mockResolvedValue({ filePaths: [link] });
    await documents.rememberRecent({ token: (await documents.open()).token });
    const list = await documents.listRecent();
    expect(list[0].name).toBe('4.gr4s');
    expect(list).toHaveLength(10);
    await documents.removeRecent({ id: list[0].id });
    expect(await documents.listRecent()).toHaveLength(9);
    await documents.clearRecent();
    expect(await documents.listRecent()).toEqual([]);
    expect(await fs.readFile(file, 'utf8')).toBe('original');
    expect(await fs.readFile(link, 'utf8')).toBe('graph');
  });
  it('retains a missing recent entry until a successful Locate or explicit removal', async () => {
    const { documents, file, root, dialog } = await setup();
    await documents.rememberRecent({ token: (await documents.open()).token });
    const [entry] = await documents.listRecent();
    const moved = path.join(root, 'moved.gr4s');
    await fs.rename(file, moved);
    await expect(documents.openRecent({ id: entry.id })).rejects.toThrow();
    expect(await documents.listRecent()).toHaveLength(1);
    dialog.showOpenDialog.mockResolvedValue({ filePaths: [moved] });
    await documents.rememberRecent({ token: (await documents.open()).token, replaceId: entry.id });
    expect((await documents.listRecent()).map((entry) => entry.name)).toEqual(['moved.gr4s']);
  });
});
