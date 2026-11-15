import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// Paths stay in the main process. Renderer-supplied paths never grant file access.
export function createDesktopWorkspace({ getPath, resolveToken, rememberFile }) {
  return {
    async load() {
      let workspace;
      try {
        workspace = JSON.parse(await fs.promises.readFile(getPath(), 'utf8'));
      } catch (error) {
        if (error.code === 'ENOENT') return null;
        throw error;
      }
      if (workspace?.version !== 1 || !Array.isArray(workspace.tabs)) throw new Error('Invalid workspace recovery file.');
      const tabs = await Promise.all(workspace.tabs.map(async ({ backingPath, ...tab }) => {
        let nativeFileToken;
        if (typeof backingPath === 'string' && path.isAbsolute(backingPath)) {
          try {
            if ((await fs.promises.stat(backingPath)).isFile()) nativeFileToken = rememberFile(backingPath).token;
          } catch { /* Recover the snapshot even when its original file is missing. */ }
        }
        return { ...tab, document: { ...tab.document, fileHandle: null, nativeFileToken } };
      }));
      return { version: 1, activeTabIndex: workspace.activeTabIndex, tabs };
    },
    // Synchronous only for a small, debounced checkpoint and the final beforeunload
    // checkpoint. A completed IPC reply means closing cannot interrupt this write.
    save(workspace) {
      if (workspace?.version !== 1 || !Array.isArray(workspace.tabs)
        || workspace.tabs.some((tab) => typeof tab?.content !== 'string' || !tab.document)) {
        throw new Error('Invalid workspace checkpoint.');
      }
      const tabs = workspace.tabs.map((tab) => {
        const { nativeFileToken, fileHandle: _handle, ...document } = tab.document;
        return { content: tab.content, document, backingPath: resolveToken(nativeFileToken) };
      });
      const destination = getPath();
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      const temporary = `${destination}.${randomUUID()}.tmp`;
      try {
        fs.writeFileSync(temporary, JSON.stringify({ version: 1, activeTabIndex: workspace.activeTabIndex, tabs }),
          { flag: 'wx', mode: 0o600 });
        fs.renameSync(temporary, destination);
      } finally {
        fs.rmSync(temporary, { force: true });
      }
    },
  };
}
