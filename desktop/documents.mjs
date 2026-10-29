import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRecentDocuments } from './recent-documents.mjs';

async function writeDocument(filePath, content) {
  if (typeof content !== 'string') throw new Error('Document content must be text.');
  // Preserve a selected symlink and existing permissions; replace only after a complete write.
  const target = await fs.realpath(filePath).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return filePath;
  });
  const existing = await fs.stat(target).catch((error) => {
    if (error.code !== 'ENOENT') throw error;
    return null;
  });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, content, { flag: 'wx', mode: existing ? existing.mode & 0o777 : 0o666 });
    await fs.rename(temporary, target);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

// File access uses opaque handles or stored recent IDs. The renderer cannot choose a path via IPC.
export function createDesktopDocuments({ dialog, getWindow, getRecentPath }) {
  const files = new Map();
  const recent = createRecentDocuments(getRecentPath);
  const remember = (filePath) => {
    const token = randomUUID();
    files.set(token, filePath);
    return { token, name: path.basename(filePath) };
  };
  const filters = [{ name: 'Studio documents', extensions: ['gr4s'] }, { name: 'All files', extensions: ['*'] }];
  return {
    clear() { files.clear(); },
    listRecent: () => recent.list(),
    clearRecent: () => recent.clear(),
    removeRecent: ({ id }) => recent.remove(id),
    async rememberRecent({ token, replaceId }) {
      const filePath = files.get(token);
      if (!filePath) throw new Error('This document handle has expired.');
      await recent.remember(filePath, replaceId);
    },
    async openRecent({ id }) {
      const filePath = await recent.resolve(id);
      const content = await fs.readFile(filePath, 'utf8');
      return { ...remember(filePath), content };
    },
    async open() {
      const result = await dialog.showOpenDialog(getWindow(), { filters, properties: ['openFile'] });
      if (result.canceled || !result.filePaths[0]) return null;
      const content = await fs.readFile(result.filePaths[0], 'utf8');
      return { ...remember(result.filePaths[0]), content };
    },
    async saveAs({ name, content }) {
      if (typeof name !== 'string' || typeof content !== 'string') throw new Error('Invalid document.');
      const result = await dialog.showSaveDialog(getWindow(), { filters, defaultPath: path.basename(name) });
      if (result.canceled || !result.filePath) return null;
      await writeDocument(result.filePath, content);
      return remember(result.filePath);
    },
    async save({ token, content }) {
      const filePath = typeof token === 'string' ? files.get(token) : null;
      if (!filePath) throw new Error('This document handle has expired. Use Save As.');
      await writeDocument(filePath, content);
      return { token, name: path.basename(filePath) };
    },
  };
}
