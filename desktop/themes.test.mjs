import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDesktopThemes } from './themes.mjs';
import { createThemeManager } from '../src/features/themes/theme-store';
import { getThemePersistence } from '../src/features/themes/persistence';

const roots = [];
afterEach(async () => {
  for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true });
});
async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-themes-'));
  roots.push(root);
  const reopen = () => createDesktopThemes({ getUserData: () => root });
  return { root, reopen, storage: reopen() };
}
const definition = {
  schemaVersion: 1, id: 'community.midnight', name: 'Midnight', extends: 'builtin.dark',
  tokens: { 'canvas.background': '#101722' },
};

describe('desktop theme persistence across application launches', () => {
  it('uses native storage when the desktop bridge is available', async () => {
    const { storage } = await fixture();
    expect(getThemePersistence({ themes: storage })).toBe(storage);
    expect(getThemePersistence({})).not.toBe(storage);
  });

  it('restores a built-in selection from userData after restarting the app', async () => {
    const { root, storage, reopen } = await fixture();
    const first = createThemeManager(storage, () => {});
    await first.initialize();
    await first.select('builtin.high-contrast');
    const second = createThemeManager(reopen(), () => {});
    await second.initialize();
    expect(second.store.getState().active.id).toBe('builtin.high-contrast');
    expect(JSON.parse(await fs.readFile(path.join(root, 'appearance.json'), 'utf8')))
      .toEqual({ selectedTheme: 'builtin.high-contrast' });
  });

  it('restores an imported theme and selection independently of browser origins', async () => {
    const { root, storage, reopen } = await fixture();
    const first = createThemeManager(storage, () => {});
    await first.initialize();
    await first.import(JSON.stringify(definition));
    await first.select(definition.id);
    const second = createThemeManager(reopen(), () => {});
    await second.initialize();
    expect(second.store.getState().active.id).toBe(definition.id);
    expect(second.store.getState().active.tokens['canvas.background']).toBe('#101722');
    expect(JSON.parse(await fs.readFile(path.join(root, 'themes', `${definition.id}.gr4stheme`), 'utf8'))).toEqual(definition);
    expect(second.export(definition.id)).toBe(first.export(definition.id));
    await second.delete(definition.id);
    const third = createThemeManager(reopen(), () => {});
    await third.initialize();
    expect(third.store.getState().installed).toEqual([]);
    expect(third.store.getState().active.id).toBe('builtin.dark');
  });

  it('serializes rapid selections so the last choice survives restart', async () => {
    const { storage, reopen } = await fixture();
    const manager = createThemeManager(storage, () => {});
    await manager.initialize();
    await Promise.all(['builtin.light', 'builtin.high-contrast', 'builtin.paper'].map((id) => manager.select(id)));
    const restarted = createThemeManager(reopen(), () => {});
    await restarted.initialize();
    expect(manager.store.getState().active.id).toBe('builtin.paper');
    expect(restarted.store.getState().active.id).toBe('builtin.paper');
  });

  it('preserves and deletes themes saved before the extension change', async () => {
    const { root, storage, reopen } = await fixture();
    await fs.mkdir(path.join(root, 'themes'));
    await fs.writeFile(path.join(root, 'themes', `${definition.id}.grtheme`), JSON.stringify(definition));
    await storage.writeSelected(definition.id);
    const restarted = createThemeManager(reopen(), () => {});
    await restarted.initialize();
    expect(restarted.store.getState().active.id).toBe(definition.id);
    await restarted.delete(definition.id);
    expect(await reopen().load()).toEqual([]);
  });

  it('prefers .gr4stheme when both extensions exist for an installed theme', async () => {
    const { root, storage, reopen } = await fixture();
    await storage.put(definition);
    await fs.writeFile(path.join(root, 'themes', `${definition.id}.grtheme`), JSON.stringify({ ...definition, name: 'Old definition' }));
    expect(await reopen().load()).toEqual([definition]);
    await storage.delete(definition.id);
    expect(await fs.readdir(path.join(root, 'themes'))).toEqual([]);
  });

  it('ignores corrupt definitions and persists a safe fallback', async () => {
    const { root, storage, reopen } = await fixture();
    await storage.put(definition);
    await storage.writeSelected(definition.id);
    await fs.writeFile(path.join(root, 'themes', `${definition.id}.gr4stheme`), 'invalid JSON');
    const manager = createThemeManager(reopen(), () => {});
    await manager.initialize();
    expect(manager.store.getState().active.id).toBe('builtin.dark');
    expect(manager.store.getState().notice).toContain('invalid stored theme');
    expect(await reopen().readSelected()).toBe('builtin.dark');
  });

  it('rejects filesystem paths, reserved imported IDs, and oversized definitions', async () => {
    const { root, storage } = await fixture();
    for (const id of ['../escape', '/tmp/escape', 'builtin.dark', 'a/b', '', '.']) {
      await expect(storage.put({ ...definition, id })).rejects.toThrow('Invalid theme ID');
      await expect(storage.delete(id)).rejects.toThrow('Invalid theme ID');
    }
    await expect(storage.put({ ...definition, name: 'x'.repeat(65536) })).rejects.toThrow('oversized');
    expect(await fs.readdir(root)).toEqual([]);
  });

  it('reports write failures without applying or reporting a saved selection', async () => {
    const { root, storage } = await fixture();
    await fs.mkdir(path.join(root, 'appearance.json'));
    const manager = createThemeManager(storage, () => {});
    await manager.initialize();
    await expect(manager.select('builtin.paper')).rejects.toThrow();
    expect(manager.store.getState().active.id).toBe('builtin.dark');
    expect((await fs.readdir(root)).filter((file) => file.endsWith('.tmp'))).toEqual([]);
  });
});
