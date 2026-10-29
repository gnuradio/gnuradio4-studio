import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function createRecentDocuments(getPath) {
  let pending = Promise.resolve();
  const serial = (operation) => {
    const result = pending.then(operation);
    pending = result.catch(() => {});
    return result;
  };
  const read = async () => {
    try {
      const value = JSON.parse(await fs.readFile(getPath(), 'utf8'));
      return Array.isArray(value?.entries) ? value.entries.filter((entry) =>
        typeof entry?.id === 'string' && typeof entry.path === 'string' && path.isAbsolute(entry.path)
        && typeof entry.lastOpenedAt === 'string').slice(0, 10) : [];
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError) return [];
      throw error;
    }
  };
  const write = async (entries) => {
    const destination = getPath();
    await fs.mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, destination);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  };
  return {
    list: () => serial(async () => (await read()).map((entry) => ({
      id: entry.id, name: path.basename(entry.path), location: path.dirname(entry.path), lastOpenedAt: entry.lastOpenedAt,
    }))),
    resolve: (id) => serial(async () => {
      const entry = (await read()).find((entry) => entry.id === id);
      if (!entry) throw new Error('This recent file is no longer in the list. Choose Open to select it again.');
      return entry.path;
    }),
    remember: (filePath, replaceId) => serial(async () => {
      const canonical = await fs.realpath(filePath);
      const entries = await read();
      const existing = entries.find((entry) => entry.path === canonical);
      await write([{ id: existing?.id ?? randomUUID(), path: canonical, lastOpenedAt: new Date().toISOString() },
        ...entries.filter((entry) => entry.path !== canonical && entry.id !== replaceId)].slice(0, 10));
    }),
    remove: (id) => serial(async () => write((await read()).filter((entry) => entry.id !== id))),
    clear: () => serial(() => write([])),
  };
}
