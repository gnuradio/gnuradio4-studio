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
});
