import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { DEFAULT_THEME_ID } from './builtins';
import { getThemePersistence, type ThemePersistence } from './persistence';
import { exportTheme, parseTheme, resolveTheme, validateTheme, type ResolvedTheme, type ThemeDefinition } from './theme';
import { tokenNames, tokenVariable } from './tokens';

type ThemeState = {
  installed: ThemeDefinition[];
  active: ResolvedTheme;
  ready: boolean;
  notice: string | null;
};

export function applyTheme(theme: ResolvedTheme, root = document.documentElement) {
  for (const name of tokenNames) {
    const value = theme.tokens[name];
    root.style.setProperty(tokenVariable(name), value);
    const rgb = [1, 3, 5].map((offset) => parseInt(value.slice(offset, offset + 2), 16)).join(' ');
    root.style.setProperty(`${tokenVariable(name)}-rgb`, rgb);
  }
  root.style.colorScheme = theme.colorScheme;
  root.dataset.theme = theme.id;
  root.dataset.themeBase = theme.baseId;
}

export function createThemeManager(
  persistence: ThemePersistence,
  apply: (theme: ResolvedTheme) => void,
) {
  const store = createStore<ThemeState>(() => ({
    installed: [], active: resolveTheme(DEFAULT_THEME_ID), ready: false, notice: null,
  }));
  let initialization: Promise<void> | undefined;
  // Serialize durable mutations, including duplicate checks after earlier imports.
  let pending = Promise.resolve();
  const enqueue = <T,>(action: () => Promise<T>): Promise<T> => {
    const result = pending.then(action);
    pending = result.then(() => undefined, () => undefined);
    return result;
  };
  const applySelection = async (id: string) => {
    const active = resolveTheme(id, store.getState().installed);
    await persistence.writeSelected(id);
    apply(active);
    store.setState({ active });
  };
  return {
    store,
    initialize: () => initialization ??= (async () => {
      const installed: ThemeDefinition[] = [];
      const notices: string[] = [];
      try {
        for (const raw of await persistence.load()) {
          try {
            const definition = validateTheme(raw);
            if (installed.some((entry) => entry.id === definition.id)) throw new Error('Duplicate stored ID');
            installed.push(definition);
          } catch { notices.push('An invalid stored theme was ignored.'); }
        }
      } catch { notices.push('Imported themes could not be restored. Theme storage may be unavailable.'); }
      let id = DEFAULT_THEME_ID;
      try { id = await persistence.readSelected() ?? DEFAULT_THEME_ID; }
      catch { notices.push('Theme preference storage is unavailable.'); }
      let active: ResolvedTheme;
      try { active = resolveTheme(id, installed); }
      catch {
        active = resolveTheme(DEFAULT_THEME_ID);
        notices.push('The selected theme was unavailable; Dark was restored.');
        try { await persistence.writeSelected(DEFAULT_THEME_ID); } catch { /* Usable without storage. */ }
      }
      apply(active);
      store.setState({ installed, active, ready: true, notice: notices.join(' ') || null });
    })(),
    select: (id: string) => enqueue(() => applySelection(id)),
    import: (text: string, replace = false) => enqueue(async () => {
      const definition = parseTheme(text);
      const state = store.getState();
      if (state.installed.some((theme) => theme.id === definition.id) && !replace) {
        throw new Error(`Theme “${definition.id}” already exists. Confirm replacement first.`);
      }
      await persistence.put(definition);
      const current = store.getState();
      const installed = [...current.installed.filter((theme) => theme.id !== definition.id), definition];
      const active = current.active.id === definition.id ? resolveTheme(definition.id, installed) : current.active;
      apply(active);
      store.setState({ installed, active });
      return definition;
    }),
    export: (id: string) => {
      const definition = store.getState().installed.find((theme) => theme.id === id);
      if (!definition) throw new Error('Only imported themes can be exported.');
      return exportTheme(definition);
    },
    delete: (id: string) => enqueue(async () => {
      const state = store.getState();
      if (!state.installed.some((theme) => theme.id === id)) throw new Error('Only imported themes can be deleted.');
      if (state.active.id === id) await applySelection(DEFAULT_THEME_ID);
      await persistence.delete(id);
      store.setState({ installed: store.getState().installed.filter((theme) => theme.id !== id) });
    }),
  };
}

export const themeManager = createThemeManager(getThemePersistence(), applyTheme);
export const useTheme = () => useStore(themeManager.store, (state) => state.active);
