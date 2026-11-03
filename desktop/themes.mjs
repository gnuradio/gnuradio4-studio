import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const MAX_THEME_BYTES = 64 * 1024;
function validateId(id, imported = false) {
  if (typeof id !== 'string' || id.length > 100 || !/^[a-z0-9][a-z0-9._-]*$/.test(id)
    || (imported && id.startsWith('builtin.'))) {
    throw new Error('Invalid theme ID.');
  }
  return id;
}

async function atomicWrite(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, text, { flag: 'wx', mode: 0o600 });
    await fs.rename(temporary, file);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

// The renderer supplies IDs/definitions only, never filesystem paths.
// userData is stable even though the desktop HTTP server changes ports.
export function createDesktopThemes({ getUserData }) {
  const settingsPath = () => path.join(getUserData(), 'appearance.json');
  const themesPath = () => path.join(getUserData(), 'themes');
  const themePath = (id, extension = '.gr4stheme') => path.join(themesPath(), `${validateId(id, true)}${extension}`);
  let pending = Promise.resolve();
  const enqueue = (operation) => {
    const result = pending.then(operation);
    pending = result.catch(() => {});
    return result;
  };
  return {
    load: () => enqueue(async () => {
      const files = await fs.readdir(themesPath()).catch((error) => {
        if (error.code === 'ENOENT') return [];
        throw error;
      });
      // Keep themes saved before the extension change; new-format files take precedence.
      const installed = new Map();
      for (const file of files) {
        const extension = file.endsWith('.gr4stheme') ? '.gr4stheme' : file.endsWith('.grtheme') ? '.grtheme' : null;
        if (!extension) continue;
        const id = file.slice(0, -extension.length);
        if (extension === '.gr4stheme' || !installed.has(id)) installed.set(id, extension);
      }
      return Promise.all([...installed].map(async ([id, extension]) => {
        try {
          const target = themePath(id, extension);
          if ((await fs.stat(target)).size > MAX_THEME_BYTES) return null;
          const definition = JSON.parse(await fs.readFile(target, 'utf8'));
          return definition?.id === id ? definition : null;
        } catch { return null; } // Frontend reports and skips invalid stored definitions.
      }));
    }),
    put: (definition) => enqueue(async () => {
      const file = themePath(definition?.id);
      const text = `${JSON.stringify(definition, null, 2)}\n`;
      if (definition?.schemaVersion !== 1 || Buffer.byteLength(text) > MAX_THEME_BYTES) {
        throw new Error('Invalid or oversized theme definition.');
      }
      await atomicWrite(file, text);
    }),
    delete: (id) => enqueue(async () => {
      await Promise.all(['.gr4stheme', '.grtheme'].map((extension) => fs.rm(themePath(id, extension), { force: true })));
    }),
    readSelected: () => enqueue(async () => {
      try {
        const settings = JSON.parse(await fs.readFile(settingsPath(), 'utf8'));
        return settings.selectedTheme == null ? null : validateId(settings.selectedTheme);
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
    }),
    writeSelected: (id) => enqueue(() => atomicWrite(settingsPath(), `${JSON.stringify({ selectedTheme: validateId(id) }, null, 2)}\n`)),
  };
}
