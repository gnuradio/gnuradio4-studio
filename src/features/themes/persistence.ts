import type { ThemeDefinition } from './theme';

export const SELECTED_THEME_KEY = 'gr4-studio.theme';
export interface ThemePersistence {
  load: () => Promise<unknown[]>;
  put: (theme: ThemeDefinition) => Promise<void>;
  delete: (id: string) => Promise<void>;
  readSelected: () => string | null | Promise<string | null>;
  writeSelected: (id: string) => void | Promise<void>;
}

// A transaction must commit before the registry/UI reports success.
function transaction<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open('gr4-studio-themes', 1);
    open.onupgradeneeded = () => open.result.createObjectStore('themes', { keyPath: 'id' });
    open.onerror = () => reject(new Error('Theme storage could not be opened.'));
    open.onblocked = () => reject(new Error('Theme storage is blocked by another Studio window.'));
    open.onsuccess = () => {
      const db = open.result;
      try {
        const tx = db.transaction('themes', mode);
        const request = action(tx.objectStore('themes'));
        tx.oncomplete = () => { db.close(); resolve(request.result); };
        tx.onabort = tx.onerror = () => { db.close(); reject(new Error('Theme storage failed; changes were not saved.')); };
      } catch {
        db.close();
        reject(new Error('Theme storage is invalid; changes were not saved.'));
      }
    };
  });
}

export const browserThemePersistence: ThemePersistence = {
  load: () => transaction('readonly', (store) => store.getAll()),
  put: async (theme) => { await transaction('readwrite', (store) => store.put(theme)); },
  delete: async (id) => { await transaction('readwrite', (store) => store.delete(id)); },
  readSelected: () => localStorage.getItem(SELECTED_THEME_KEY),
  writeSelected: (id) => localStorage.setItem(SELECTED_THEME_KEY, id),
};

export function getThemePersistence(shell = typeof window === 'undefined' ? undefined : window.gr4StudioShell): ThemePersistence {
  return shell?.themes ?? browserThemePersistence;
}
