import { describe, expect, it, vi } from 'vitest';
import { builtinThemes, DEFAULT_THEME_ID } from './builtins';
import { exportTheme, parseTheme, resolveTheme, validateTheme } from './theme';
import { applyTheme, createThemeManager } from './theme-store';
import { tokenNames, tokenVariable } from './tokens';
import type { ThemePersistence } from './persistence';
import { getPortTypeColor } from '../ports/model/typeColors';
import { useEditorStore } from '../graph-editor/store/editorStore';

const sample = {
  schemaVersion: 1, id: 'community.midnight', name: 'Midnight', author: 'Community',
  extends: 'builtin.dark', tokens: { 'canvas.background': '#101722', 'block.text': '#F0F4FA' },
};
const text = JSON.stringify(sample);

function fixture(values: unknown[] = [], selected: string | null = null) {
  const records = new Map(values.map((value, index) => [String((value as { id?: string })?.id ?? index), value]));
  let preference = selected;
  const persistence: ThemePersistence = {
    load: vi.fn(async () => [...records.values()]),
    put: vi.fn(async (theme) => { records.set(theme.id, structuredClone(theme)); }),
    delete: vi.fn(async (id) => { records.delete(id); }),
    readSelected: vi.fn(() => preference),
    writeSelected: vi.fn((id) => { preference = id; }),
  };
  const apply = vi.fn();
  return { persistence, records, apply, manager: createThemeManager(persistence, apply) };
}

describe('v1 theme definitions', () => {
  it('registers four complete built-ins with distinct canvas colors', () => {
    expect(builtinThemes.map((theme) => theme.name)).toEqual(['Light', 'Dark', 'High Contrast', 'Paper']);
    expect(new Set(builtinThemes.map((theme) => theme.tokens['canvas.background'])).size).toBe(4);
    for (const builtin of builtinThemes) {
      const theme = resolveTheme(builtin.id);
      expect(Object.keys(theme.tokens)).toEqual(tokenNames);
      expect(Object.values(theme.tokens).every((color) => /^#[0-9a-f]{6}$/i.test(color))).toBe(true);
    }
  });

  it('inherits all missing values from a built-in and preserves overrides', () => {
    const definition = parseTheme(text);
    const resolved = resolveTheme(definition.id, [definition]);
    expect(resolved.tokens).toEqual({ ...resolveTheme('builtin.dark').tokens, ...sample.tokens });
    expect(parseTheme(JSON.stringify({ ...sample, extends: undefined })).extends).toBe(DEFAULT_THEME_ID);
  });

  it('exports and reimports the original definition, retaining partial overrides', () => {
    const definition = parseTheme(text);
    expect(parseTheme(exportTheme(definition))).toEqual(sample);
    expect(Object.keys(parseTheme(exportTheme(definition)).tokens)).toHaveLength(2);
  });

  it.each([
    { schemaVersion: 2 }, { schemaVersion: '1' }, { id: 'builtin.dark' },
    { id: '../unsafe' }, { id: 'javascript:alert(1)' }, { name: '' }, { name: '<script>' },
    { extends: 'community.other' }, { extends: 'community.midnight' }, { extends: 'builtin.missing' },
    { tokens: { 'canvas.unknown': '#ffffff' } }, { tokens: { 'canvas.background': 'red' } },
    { tokens: { 'block.background': '#fff' } }, { tokens: { 'app.text': '#ffffff00' } },
    { tokens: { 'app.text': 'url(https://example.com)' } }, { tokens: { 'app.text': 'var(--unsafe)' } },
    { tokens: { 'app.text': 'expression(alert(1))' } }, { tokens: { 'app.text': '#ffffff; color:red' } },
    { tokens: { 'app.text': 123 } }, { tokens: [] }, { tokens: null },
    { css: 'body{display:none}' }, { script: 'alert(1)' }, { assets: ['https://example.com'] },
  ])('rejects unsupported schema, inheritance, tokens, or executable values: %j', (patch) => {
    expect(() => parseTheme(JSON.stringify({ ...sample, ...patch }))).toThrow();
  });

  it('rejects malformed, oversized and prototype-like JSON properties', () => {
    for (const raw of ['alert(1)', '{}', 'null', '[]', ' '.repeat(65537),
      text.replace('"canvas.background":"#101722"', '"__proto__":"#101722"')]) {
      expect(() => parseTheme(raw)).toThrow();
    }
    expect(() => validateTheme({ ...sample, tokens: JSON.parse('{"constructor":"#ffffff"}') })).toThrow();
  });

  it('keeps built-ins immutable when resolving and extending', () => {
    const before = structuredClone(builtinThemes);
    resolveTheme('builtin.dark').tokens['app.text'] = '#000000';
    resolveTheme(sample.id, [parseTheme(text)]).tokens['app.text'] = '#000000';
    expect(builtinThemes).toEqual(before);
  });
});

describe('theme registration, selection and persistence', () => {
  it('switches immediately and applies complete tokens without navigation', async () => {
    const { manager, apply, persistence } = fixture();
    await manager.initialize();
    for (const builtin of builtinThemes) {
      await manager.select(builtin.id);
      expect(manager.store.getState().active.id).toBe(builtin.id);
      expect(apply).toHaveBeenLastCalledWith(resolveTheme(builtin.id));
      expect(persistence.writeSelected).toHaveBeenLastCalledWith(builtin.id);
    }
  });

  it('imports durably without selecting and restores selection on restart', async () => {
    const { manager, persistence } = fixture();
    await manager.initialize();
    await manager.import(text);
    expect(manager.store.getState().active.id).toBe(DEFAULT_THEME_ID);
    await manager.select(sample.id);
    const restarted = createThemeManager(persistence, vi.fn());
    await restarted.initialize();
    expect(restarted.store.getState().active).toEqual(manager.store.getState().active);
    expect(restarted.export(sample.id)).toBe(manager.export(sample.id));
  });

  it('rejects duplicates until replacement is explicitly confirmed', async () => {
    const { manager, persistence } = fixture();
    await manager.initialize();
    await manager.import(text);
    const replacement = JSON.stringify({ ...sample, name: 'Updated', tokens: { 'app.text': '#ffffff' } });
    await expect(manager.import(replacement)).rejects.toThrow('Confirm replacement');
    expect(persistence.put).toHaveBeenCalledTimes(1);
    expect(manager.store.getState().installed[0].name).toBe('Midnight');
    await manager.select(sample.id);
    await manager.import(replacement, true);
    expect(manager.store.getState().installed).toHaveLength(1);
    expect(manager.store.getState().active.name).toBe('Updated');
  });

  it('serializes concurrent imports and preserves selection during an awaited write', async () => {
    const { manager, persistence } = fixture();
    await manager.initialize();
    const results = await Promise.allSettled([manager.import(text), manager.import(text)]);
    expect(results.map((result) => result.status)).toEqual(['fulfilled', 'rejected']);
    let finish!: () => void;
    vi.mocked(persistence.put).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const writing = manager.import(JSON.stringify({ ...sample, id: 'community.next' }));
    await Promise.resolve();
    const selecting = manager.select('builtin.paper');
    finish();
    await Promise.all([writing, selecting]);
    expect(manager.store.getState().active.id).toBe('builtin.paper');
  });

  it.each([false, true])('deletes imported themes and persists fallback when active: %s', async (active) => {
    const { manager, persistence, records } = fixture([sample]);
    await manager.initialize();
    await manager.select(active ? sample.id : 'builtin.paper');
    await manager.delete(sample.id);
    expect(records.size).toBe(0);
    expect(manager.store.getState().installed).toEqual([]);
    expect(manager.store.getState().active.id).toBe(active ? DEFAULT_THEME_ID : 'builtin.paper');
    const restarted = createThemeManager(persistence, vi.fn());
    await restarted.initialize();
    expect(restarted.store.getState().active.id).toBe(manager.store.getState().active.id);
    await expect(manager.delete('builtin.dark')).rejects.toThrow('Only imported');
    expect(() => manager.export('builtin.dark')).toThrow('Only imported');
  });

  it.each([
    [[], 'community.missing'], [[{ ...sample, tokens: { unsafe: 'red' } }], sample.id],
    [[{ ...sample, extends: sample.id }], sample.id], [[null], 'builtin.unknown'],
  ])('falls back and repairs missing or corrupt persisted selections', async (values, selected) => {
    const { manager, persistence } = fixture(values as unknown[], selected as string);
    await manager.initialize();
    expect(manager.store.getState().active.id).toBe(DEFAULT_THEME_ID);
    expect(manager.store.getState().notice).toBeTruthy();
    expect(persistence.writeSelected).toHaveBeenCalledWith(DEFAULT_THEME_ID);
  });

  it('ignores invalid stored entries while restoring valid installed themes', async () => {
    const { manager } = fixture([null, sample, { ...sample, id: 'builtin.dark' }], sample.id);
    await manager.initialize();
    expect(manager.store.getState().installed).toEqual([sample]);
    expect(manager.store.getState().active.id).toBe(sample.id);
  });

  it('handles unavailable storage and failed writes without false success', async () => {
    const { manager, persistence } = fixture();
    vi.mocked(persistence.load).mockRejectedValue(new Error('Unavailable'));
    vi.mocked(persistence.readSelected).mockImplementation(() => { throw new Error('Unavailable'); });
    await manager.initialize();
    expect(manager.store.getState().ready).toBe(true);
    expect(manager.store.getState().notice).toContain('unavailable');
    vi.mocked(persistence.put).mockRejectedValue(new Error('Quota exceeded'));
    await expect(manager.import(text)).rejects.toThrow('Quota exceeded');
    expect(manager.store.getState().installed).toHaveLength(0);
    vi.mocked(persistence.writeSelected).mockImplementation(() => { throw new Error('Unavailable'); });
    await expect(manager.select('builtin.paper')).rejects.toThrow();
    expect(manager.store.getState().active.id).toBe(DEFAULT_THEME_ID);
  });

  it('initializes only once and leaves graph editing/execution data unchanged', async () => {
    const { manager, persistence } = fixture();
    const snapshot = useEditorStore.getState().getGraphSnapshot();
    await Promise.all([manager.initialize(), manager.initialize()]);
    for (const builtin of builtinThemes) await manager.select(builtin.id);
    expect(persistence.load).toHaveBeenCalledTimes(1);
    expect(useEditorStore.getState().getGraphSnapshot()).toEqual(snapshot);
  });
});

describe('rendering token application and accessibility', () => {
  it('applies every appearance token while preserving the existing port palette', () => {
    const setProperty = vi.fn();
    const root = { style: { setProperty, colorScheme: '' }, dataset: {} };
    const theme = resolveTheme('builtin.paper');
    applyTheme(theme, root as unknown as HTMLElement);
    for (const name of tokenNames) expect(setProperty).toHaveBeenCalledWith(tokenVariable(name), theme.tokens[name]);
    expect(root.dataset).toEqual({ theme: 'builtin.paper', themeBase: 'builtin.paper' });
    expect(root.style.colorScheme).toBe('light');
    expect(getPortTypeColor('float32').background).toBe('#f08c00');
    expect(getPortTypeColor('uint32')).toEqual(getPortTypeColor('int32'));
    expect(getPortTypeColor('message').background).toBe('#9ca3af');
    expect(getPortTypeColor('unknown').background).toMatch(/^hsl\(/);
  });

  it.each(builtinThemes)('preserves semantic port colors when switching to $name', async (builtin) => {
    const { manager } = fixture();
    await manager.initialize();
    const types = ['float32', 'float64', 'complexfloat32', 'complexfloat64',
      'int8', 'int16', 'int32', 'int64', 'uint8', 'uint16', 'uint32', 'uint64',
      'bool', 'bit', 'string', 'message', 'wildcard', 'custom-type', undefined];
    const original = types.map(getPortTypeColor);
    await manager.select(builtin.id);
    expect(types.map(getPortTypeColor)).toEqual(original);
    expect(getPortTypeColor('float32')).toEqual({ background: '#f08c00', border: '#c06f00', text: '#111827' });
    expect(getPortTypeColor('int8')).toEqual({ background: '#c200ff', border: '#8f00bb', text: '#f8fafc' });
    expect(Object.values(getPortTypeColor('custom-type')).every((value) => !value.includes('var('))).toBe(true);
    expect(tokenNames.some((name) => name.startsWith('port.'))).toBe(false);
  });

  it('preserves type colors in imported themes and rejects semantic color overrides', async () => {
    const { manager } = fixture();
    await manager.initialize();
    await manager.import(text);
    await manager.select(sample.id);
    expect(getPortTypeColor('float32').background).toBe('#f08c00');
    expect(getPortTypeColor('int8').background).toBe('#c200ff');
    for (const token of ['port.float32', 'port.int8', 'port.message', 'port.stream']) {
      await expect(manager.import(JSON.stringify({ ...sample, tokens: { [token]: '#ffffff' } }), true))
        .rejects.toThrow(token);
    }
  });

  function contrast(a: string, b: string) {
    const luminance = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map((v) => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
      .reduce((sum, value, i) => sum + value * [0.2126, 0.7152, 0.0722][i], 0);
    const [low, high] = [luminance(a), luminance(b)].sort((x, y) => x - y);
    return (high + 0.05) / (low + 0.05);
  }

  it('meets text contrast targets in each built-in and enhanced high contrast boundaries', () => {
    for (const theme of builtinThemes) {
      const t = theme.tokens;
      for (const surface of ['app.background', 'app.surface', 'app.control', 'app.selected'] as const) {
        expect(contrast(t['app.text'], t[surface])).toBeGreaterThanOrEqual(7);
        expect(contrast(t['app.textSecondary'], t[surface])).toBeGreaterThanOrEqual(4.5);
      }
      expect(contrast(t['block.text'], t['block.background'])).toBeGreaterThanOrEqual(7);
      expect(contrast(t['block.border'], t['canvas.background'])).toBeGreaterThanOrEqual(3);
      expect(contrast(t['connection.default'], t['canvas.background'])).toBeGreaterThanOrEqual(3);
    }
    const t = resolveTheme('builtin.high-contrast').tokens;
    for (const name of ['block.border', 'block.selected', 'connection.default', 'connection.selected', 'app.focus'] as const) {
      expect(contrast(t[name], t['canvas.background'])).toBeGreaterThanOrEqual(7);
    }
  });
});
