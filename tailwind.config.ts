import type { Config } from 'tailwindcss';

// Bridge existing utility names to semantic tokens, including opacity modifiers.
const color = (token: string) => `rgb(var(--theme-${token.replace(/\./g, '-')}-rgb) / <alpha-value>)`;
const statePalette = (foreground: string, surface: string) => Object.fromEntries(
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((shade) =>
    [shade, color(shade >= 800 ? surface : foreground)]),
);

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        hover: color('app.hover'),
        selected: color('app.selected'),
        panel: color('app.surface'),
        panelAlt: color('app.background'),
        border: color('app.border'),
        accent: color('app.accent'),
        white: color('app.text'),
        black: color('app.overlay'),
        slate: {
          50: color('app.text'), 100: color('app.text'), 200: color('app.text'),
          300: color('app.textSecondary'), 400: color('app.textSecondary'), 500: color('app.disabled'),
          600: color('app.borderStrong'), 700: color('app.border'), 800: color('app.control'),
          900: color('app.surface'), 950: color('app.background'),
        },
        emerald: statePalette('state.success', 'state.successSurface'),
        amber: statePalette('state.warning', 'state.warningSurface'),
        yellow: statePalette('state.warning', 'state.warningSurface'),
        rose: statePalette('state.error', 'state.errorSurface'),
        cyan: statePalette('state.info', 'state.infoSurface'),
        sky: statePalette('state.info', 'state.infoSurface'),
        indigo: statePalette('state.info', 'state.infoSurface'),
      },
      borderColor: {
        slate: Object.fromEntries([500, 600, 700, 800, 900].map((shade) => [shade, color(shade <= 600 ? 'app.borderStrong' : 'app.border')])),
        ...Object.fromEntries([
          ['emerald', 'state.success'], ['amber', 'state.warning'], ['yellow', 'state.warning'],
          ['rose', 'state.error'], ['cyan', 'state.info'], ['sky', 'state.info'], ['indigo', 'state.info'],
        ].map(([name, token]) => [name, statePalette(token, token)])),
      },
      boxShadowColor: { DEFAULT: color('app.shadow') },
    },
  },
  plugins: [],
} satisfies Config;
