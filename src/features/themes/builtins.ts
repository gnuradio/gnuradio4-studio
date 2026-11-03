import { darkTokens, type ThemeTokens } from './tokens';

export const DEFAULT_THEME_ID = 'builtin.dark';
export const builtinIds = ['builtin.light', 'builtin.dark', 'builtin.high-contrast', 'builtin.paper'] as const;
export type BuiltinId = typeof builtinIds[number];
export type BuiltinTheme = { id: BuiltinId; name: string; colorScheme: 'light' | 'dark'; tokens: ThemeTokens };

const light: ThemeTokens = {
  ...darkTokens,
  'app.background': '#f1f5f9', 'app.surface': '#ffffff', 'app.control': '#e8edf3',
  'app.hover': '#d7e1eb', 'app.text': '#172132', 'app.textSecondary': '#475569',
  'app.disabled': '#596779', 'app.border': '#8796a8', 'app.borderStrong': '#526176',
  'app.accent': '#166344', 'app.accentSurface': '#e0f1e8', 'app.selected': '#d3eadf',
  'app.focus': '#075c99', 'app.shadow': '#64748b',
  'canvas.background': '#f7f9fc', 'canvas.grid': '#d4dce7', 'canvas.selection': '#075c99',
  'block.background': '#ffffff', 'block.header': '#edf2f7', 'block.border': '#65758b',
  'block.text': '#172132', 'block.selected': '#166344', 'block.disabled': '#596779',
  'block.error': '#a51d35', 'block.note': '#fff8df', 'block.virtual': '#075c99',
  'connection.default': '#526176', 'connection.selected': '#166344',
  'connection.highlighted': '#075c99', 'connection.invalid': '#a51d35',
  'state.success': '#166344', 'state.successSurface': '#e0f1e8',
  'state.warning': '#805100', 'state.warningSurface': '#fff1cf',
  'state.error': '#a51d35', 'state.errorSurface': '#fce7eb',
  'state.info': '#075c99', 'state.infoSurface': '#e0effa',
  'state.running': '#166344', 'state.stopped': '#475569',
};

export const builtinThemes: readonly BuiltinTheme[] = [
  { id: 'builtin.light', name: 'Light', colorScheme: 'light', tokens: light },
  { id: 'builtin.dark', name: 'Dark', colorScheme: 'dark', tokens: { ...darkTokens } },
  {
    id: 'builtin.high-contrast', name: 'High Contrast', colorScheme: 'dark', tokens: {
      ...darkTokens,
      'app.background': '#000000', 'app.surface': '#000000', 'app.control': '#000000',
      'app.hover': '#303030', 'app.text': '#ffffff', 'app.textSecondary': '#ffffff',
      'app.disabled': '#cccccc', 'app.border': '#ffffff', 'app.borderStrong': '#ffffff',
      'app.accent': '#ffff00', 'app.accentSurface': '#000000', 'app.selected': '#303030',
      'app.focus': '#ffff00', 'canvas.background': '#000000', 'canvas.grid': '#555555',
      'canvas.selection': '#ffff00', 'block.background': '#000000', 'block.header': '#202020',
      'block.border': '#ffffff', 'block.text': '#ffffff', 'block.selected': '#ffff00',
      'block.disabled': '#cccccc', 'block.error': '#ff9eae', 'block.note': '#202020',
      'block.virtual': '#00ffff',
      'connection.default': '#ffffff',
      'connection.selected': '#ffff00', 'connection.highlighted': '#00ffff',
      'connection.invalid': '#ff9eae', 'state.success': '#88ff88',
      'state.successSurface': '#000000', 'state.warning': '#ffff00', 'state.warningSurface': '#000000',
      'state.error': '#ff9eae', 'state.errorSurface': '#000000',
      'state.info': '#00ffff', 'state.infoSurface': '#000000',
      'state.running': '#88ff88', 'state.stopped': '#ffffff',
    },
  },
  {
    id: 'builtin.paper', name: 'Paper', colorScheme: 'light', tokens: {
      ...light,
      'app.background': '#eeeae1', 'app.surface': '#faf8f2', 'app.control': '#e9e5da',
      'app.hover': '#ddd8cc', 'app.text': '#302f2b', 'app.textSecondary': '#625e55',
      'app.disabled': '#6d685e', 'app.border': '#aaa394', 'app.borderStrong': '#746e61',
      'app.accent': '#435f54', 'app.accentSurface': '#e4e9df', 'app.selected': '#e2e5da',
      'app.focus': '#3f6178', 'app.shadow': '#b6b0a3',
      'canvas.background': '#f5f1e6', 'canvas.grid': '#ded9ce', 'canvas.selection': '#5e766b',
      'block.background': '#fffdf7', 'block.header': '#efebe0', 'block.border': '#746e61',
      'block.text': '#302f2b', 'block.selected': '#435f54', 'block.disabled': '#6d685e',
      'block.error': '#92483f', 'block.note': '#f5ecd2', 'block.virtual': '#3f6178',
      'connection.default': '#625e55', 'connection.selected': '#435f54',
      'connection.highlighted': '#3f6178', 'connection.invalid': '#92483f',
      'state.success': '#435f54', 'state.successSurface': '#e4e9df',
      'state.warning': '#795724', 'state.warningSurface': '#f5ecd2',
      'state.error': '#92483f', 'state.errorSurface': '#f3e3dc',
      'state.info': '#3f6178', 'state.infoSurface': '#e2e8ea',
      'state.running': '#435f54', 'state.stopped': '#625e55',
    },
  },
];
