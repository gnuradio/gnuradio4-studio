import { describe, expect, it, vi } from 'vitest';
import { buildMenuTemplate, sanitizeMenuState } from './application-menu.mjs';

const items = (options) => buildMenuTemplate({ platform: 'linux', ...options }).flatMap((menu) => menu.submenu ?? []);

describe('desktop menu routing', () => {
  it('routes Open Recent through the editor command and disables it outside the editor', () => {
    const dispatch = vi.fn();
    const state = { openRecent: { enabled: true } };
    const item = items({ editor: true, dispatch, state }).find((entry) => entry.id === 'openRecent');
    expect(item.enabled).toBe(true);
    item.click();
    expect(dispatch).toHaveBeenCalledWith('openRecent');
    expect(items({ editor: false, state }).find((entry) => entry.id === 'openRecent').enabled).toBe(false);
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
  it('rejects unknown commands and malformed state', () => {
    expect(sanitizeMenuState({ commands: { save: { enabled: true }, quit: { enabled: true }, run: { enabled: 'yes' } } })).toEqual({ commands: { save: { enabled: true } }, editingText: false });
  });
  it('uses a macOS app menu only on macOS', () => {
    expect(buildMenuTemplate({ platform: 'darwin' })[0].role).toBe('appMenu');
    expect(buildMenuTemplate({ platform: 'linux' })[0].label).toBe('File');
  });
});
