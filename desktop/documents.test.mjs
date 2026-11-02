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
  return { root, file, dialog, getRecentPath, documents: createDesktopDocuments({ dialog, getWindow: () => ({}), getRecentPath }) };
}

describe('native document handles', () => {
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
