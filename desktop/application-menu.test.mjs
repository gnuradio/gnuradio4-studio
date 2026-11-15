import { describe, expect, it, vi } from 'vitest';
import { buildMenuTemplate, sanitizeMenuState, EDIT_COMMANDS } from './application-menu.mjs';

const items = (options) => buildMenuTemplate({ platform: 'linux', ...options }).flatMap((menu) => menu.submenu ?? []);

describe('desktop menu routing', () => {
  it('lists recent files in order and routes a selection by ID to the editor', () => {
    const dispatch = vi.fn();
    const state = { openRecent: { enabled: true }, clearRecent: { enabled: true }, manageRecent: { enabled: true } };
    const recentDocuments = [{ id: 'second', name: 'second.gr4s' }, { id: 'first', name: 'a&b.gr4s', location: '/graphs' }];
    const item = items({ editor: true, dispatch, state, recentDocuments }).find((entry) => entry.id === 'openRecent');
    expect(item.enabled).toBe(true);
    expect(item.submenu.slice(0, 2).map((entry) => entry.label)).toEqual(['second.gr4s', 'a&&b.gr4s — /graphs']);
    item.submenu[1].click();
    expect(dispatch).toHaveBeenCalledWith('openRecent', 'first');
    item.submenu.find((entry) => entry.id === 'clearRecent').click();
    expect(dispatch).toHaveBeenLastCalledWith('clearRecent');
    item.submenu.find((entry) => entry.id === 'manageRecent').click();
    expect(dispatch).toHaveBeenLastCalledWith('manageRecent');
    expect(items({ editor: false, state }).find((entry) => entry.id === 'openRecent').enabled).toBe(false);
  });
  it('bounds the submenu and keeps management available for empty history', () => {
    const recentDocuments = Array.from({ length: 12 }, (_, index) => ({ id: `${index}`, name: `${index}.gr4s` }));
    const full = items({ editor: true, recentDocuments }).find((entry) => entry.id === 'openRecent');
    expect(full.submenu.filter((entry) => entry.label?.endsWith('.gr4s'))).toHaveLength(10);
    const state = { openRecent: { enabled: true }, manageRecent: { enabled: true }, clearRecent: { enabled: false } };
    const empty = items({ editor: true, state }).find((entry) => entry.id === 'openRecent');
    expect(empty.submenu[0]).toEqual({ label: 'No recent files', enabled: false });
    expect(empty.submenu.find((entry) => entry.id === 'manageRecent').enabled).toBe(true);
    expect(empty.submenu.find((entry) => entry.id === 'clearRecent').enabled).toBe(false);
    expect(items({ editor: true, state: { ...state, openRecent: { enabled: false } } })
      .find((entry) => entry.id === 'openRecent').enabled).toBe(false);
  });
  it('disables document and graph commands in display windows', () => {
    const menu = items({ editor: false, state: { save: { enabled: true }, run: { enabled: true } } });
    expect(menu.find((item) => item.id === 'save').enabled).toBe(false);
    expect(menu.find((item) => item.id === 'run').enabled).toBe(false);
    expect(menu.some((item) => item.role === 'close')).toBe(true);
  });
  it('routes graph copy through Studio and text copy through the native role', () => {
    const dispatch = vi.fn();
    const graphMenu = items({ editor: true, dispatch, state: { copy: { enabled: true } } });
    graphMenu.find((item) => item.id === 'copy').click();
    expect(dispatch).toHaveBeenCalledWith('copy');
    expect(graphMenu.find((item) => item.role === 'undo').enabled).toBe(false);
    const textMenu = items({ editor: true, editingText: true });
    expect(textMenu.some((item) => item.role === 'copy')).toBe(true);
    expect(textMenu.find((item) => item.role === 'undo').enabled).toBe(true);
  });
  it.each(['linux', 'win32', 'darwin'])('leaves canvas edit keys to the renderer on %s', (platform) => {
    const dispatch = vi.fn();
    const menu = items({ platform, editor: true, dispatch,
      state: Object.fromEntries(EDIT_COMMANDS.map((id) => [id, { enabled: true }])) });
    for (const id of EDIT_COMMANDS) {
      const item = menu.find((entry) => entry.id === id);
      expect(item.enabled).toBe(true);
      expect(item.accelerator).toBeUndefined();
      item.click();
      expect(dispatch).toHaveBeenLastCalledWith(id);
    }
    const textMenu = items({ platform, editor: true, editingText: true });
    for (const id of EDIT_COMMANDS) expect(textMenu.some((item) => item.role === id)).toBe(true);
  });
  it('rejects unknown commands and malformed state', () => {
    expect(sanitizeMenuState({ commands: { save: { enabled: true }, quit: { enabled: true }, run: { enabled: 'yes' } } })).toEqual({ commands: { save: { enabled: true } }, editingText: false, recentDocuments: [] });
  });
  it('accepts nested command state and only serializable recent-file menu metadata', () => {
    const value = sanitizeMenuState({ commands: { clearRecent: { enabled: true }, manageRecent: { enabled: false } },
      recentDocuments: [null, { id: 1, name: 'bad' }, { id: 'a', name: 'a.gr4s', location: '/graphs', fileHandle: {} },
        { id: 'a', name: 'duplicate' }, ...Array.from({ length: 12 }, (_, index) => ({ id: `${index}`, name: `${index}.gr4s`, requiresSelection: true }))] });
    expect(value.commands).toEqual({ clearRecent: { enabled: true }, manageRecent: { enabled: false } });
    expect(value.recentDocuments).toHaveLength(10);
    expect(value.recentDocuments[0]).toEqual({ id: 'a', name: 'a.gr4s', location: '/graphs' });
    expect(value.recentDocuments[1].requiresSelection).toBe(true);
  });
  it('uses a macOS app menu only on macOS', () => {
    expect(buildMenuTemplate({ platform: 'darwin' })[0].role).toBe('appMenu');
    expect(buildMenuTemplate({ platform: 'linux' })[0].label).toBe('File');
  });
});
