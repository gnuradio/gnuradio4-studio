import { describe, expect, it, vi } from 'vitest';
import { buildMenuTemplate, sanitizeMenuState, EDIT_COMMANDS } from './application-menu.mjs';

const items = (options) => buildMenuTemplate({ platform: 'linux', ...options }).flatMap((menu) => menu.submenu ?? []);

describe('desktop menu routing', () => {
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
    expect(sanitizeMenuState({ commands: { save: { enabled: true }, quit: { enabled: true }, run: { enabled: 'yes' } } })).toEqual({ commands: { save: { enabled: true } }, editingText: false });
  });
  it('uses a macOS app menu only on macOS', () => {
    expect(buildMenuTemplate({ platform: 'darwin' })[0].role).toBe('appMenu');
    expect(buildMenuTemplate({ platform: 'linux' })[0].label).toBe('File');
  });
});
