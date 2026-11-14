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
  return { root, file, dialog, documents: createDesktopDocuments({ dialog, getWindow: () => ({}) }) };
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
});
