import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

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

// The renderer receives opaque handles only. It cannot choose a filesystem path via IPC.
export function createDesktopDocuments({ dialog, getWindow }) {
  const files = new Map();
  const remember = (filePath) => {
    const token = randomUUID();
    files.set(token, filePath);
    return { token, name: path.basename(filePath) };
  };
  const filters = [{ name: 'Studio documents', extensions: ['gr4s'] }, { name: 'All files', extensions: ['*'] }];
  return {
    clear() { files.clear(); },
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
