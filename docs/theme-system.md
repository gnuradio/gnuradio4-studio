# THEME-1: modular themes

## Inspection and proposed architecture

Studio uses React 18, Tailwind 3, Zustand 5, and React Flow 12 (DOM nodes,
SVG connections/grid). There is no existing appearance/settings interface or
theme registry. Styling is a fixed dark Tailwind palette plus inline graph/plot
colors. Existing preferences are browser-local. Electron has a private recent
backend endpoint file in `userData`, but no shared user settings API. The HTTP
control plane owns sessions and blocks, not UI settings.

Implement one small frontend theme registry/store. Built-in definitions supply
semantic color tokens; strict JSON validation permits partial overrides of a
built-in base only. Resolved tokens become CSS custom properties. Tailwind's
existing palette names bridge to those properties to cover existing application
surfaces without rewriting components. Graph nodes, ports, SVG connections and
canvas use explicit semantic variables. Canvas plot adapters read resolved
colors from the same store.

In browsers, persist imported definitions in IndexedDB and the selected ID in
localStorage. In desktop Studio, persist both through Electron's existing
`userData` directory and preload bridge (see the restart correction below).
Restore and validate before mounting React, keeping the root hidden until ready
to avoid a wrong-theme flash. Keep imports separate from selection; mutations
must finish durable storage before updating in-memory state. Add an Appearance
control in the tab bar, visible in both desktop and web layouts, using existing
button/menu patterns. No backend endpoints, graph format changes, runtime
changes, dependencies, or geometry changes are needed.

## Implementation

`src/features/themes/` contains the complete registry and management UI:

- `tokens.ts`: the v1 token vocabulary and complete default values.
- `builtins.ts`: Light, Dark (the safe default), High Contrast, and Paper.
- `theme.ts`: strict Zod validation, JSON parsing, built-in-only resolution,
  and definition export. Add another built-in definition here via `builtins.ts`
  and register its ID in `builtinIds`.
- `persistence.ts`: IndexedDB `gr4-studio-themes`, object store `themes`, keyed
  by theme ID; localStorage `gr4-studio.theme` holds only the selected ID.
  When the native theme bridge is present, use it for all persistence instead.
- `theme-store.ts`: one Zustand store, initialize/select/import/export/delete
  operations, serialized durable mutations, and CSS property application.
- `theme-manager.tsx`: Appearance selector and file actions. Duplicate IDs
  require the explicit **Replace Theme** button; cancellation preserves the
  installed definition. Import does not select a new theme. Replacing the active
  definition updates its resolved values while retaining its selected ID.

`main.tsx` waits for restoration before mounting. The tab bar hosts Appearance
in web and desktop modes. Tailwind aliases its existing palette utilities to
semantic tokens, with independent border mappings. `styles/index.css` defines
focus, hover, selection, graph states, and React Flow variable bindings. Graph
nodes use state attributes and semantic header/body colors; typed ports retain
the existing type normalization and fixed pre-theme palette. SVG grid/connections and plot axes/
backgrounds use the same resolved values. Plot palettes, authored data colors,
and waterfall/phosphor color scales retain their existing data meaning.

Other changed files: `graph-editor-panel.tsx`, `graph-node.tsx`,
`status-pill.tsx`, the three plot adapters,
`http-time-series-popout.tsx`, `series-live-renderer.tsx`, `workspace-view.tsx`,
`studio-page.tsx`, and `backend-console-drawer.tsx`. The last three replace
literal decorative color shadows with shared utility shadows. No dependencies
were added. Graph formats, geometry, type compatibility, and execution APIs
are unchanged.

### Desktop restart correction

The desktop HTTP server binds port `0`, choosing a new localhost port at each
launch. Browser storage is origin-bound, so localStorage/IndexedDB alone cannot
restore desktop preferences across launches. The initial browser-only design
missed this behavior.

`desktop/themes.mjs` now stores `appearance.json` (selected theme ID) and
`themes/<id>.gr4stheme` under `app.getPath('userData')`. Its narrow async IPC API is
registered in `desktop/main.mjs`, exposed in `desktop/preload.cjs`, and typed in
`src/vite-env.d.ts`. It accepts IDs/definitions rather than renderer-provided
paths, bounds stored definitions, and uses atomic file replacement. Access is
limited to the main frame of Studio editor/display windows. Writes are queued;
selection is applied only after persistence succeeds. Browser deployments keep
their existing storage model. The HTTP server and runtime routing are unchanged.

`desktop/themes.test.mjs` exercises real filesystem persistence across fresh
storage/manager instances, including imported theme restoration/deletion,
rapid selection changes, corruption, invalid paths, and failed writes. Existing
preferences saved under previous random desktop origins are not automatically
recovered; choose the theme once in the updated app to save it in userData.

The public theme extension is `.gr4stheme` for file pickers, imports, exports,
examples, and new desktop writes. Already installed desktop `.grtheme` files
remain readable; `.gr4stheme` takes precedence for duplicate IDs. Deleting a
theme removes both stored extensions. To import an older exported file, rename
its extension to `.gr4stheme`; its JSON format is unchanged.

## File and token contract

Files must be `.gr4stheme`, JSON, at most 64 KiB. The only allowed top-level fields
are `schemaVersion: 1`, `id`, `name`, optional `author`, optional `extends`
(defaults to `builtin.dark`), and `tokens`. IDs use lowercase ASCII letters,
digits, dots, underscores, and hyphens; `builtin.` is reserved. Names/authors
are bounded plain text. Each supplied token value must be an opaque six-digit
hex color (`#RRGGBB`). Unknown fields/tokens, CSS, JavaScript, asset URLs, and
non-built-in inheritance are rejected, including self/circular references.
Unknown JSON object properties such as `__proto__` and `constructor` are rejected.

The supported keys are defined by `ThemeToken` in `tokens.ts`:

| Group | Keys (prefix each with the group and a dot) |
| --- | --- |
| `app` | `background`, `surface`, `control`, `hover`, `text`, `textSecondary`, `disabled`, `border`, `borderStrong`, `accent`, `accentSurface`, `selected`, `focus`, `overlay`, `shadow` |
| `canvas` | `background`, `grid`, `selection` |
| `block` | `background`, `header`, `border`, `text`, `selected`, `disabled`, `error`, `note`, `virtual` |
| `connection` | `default`, `selected`, `highlighted`, `invalid` |
| `state` | `success`, `successSurface`, `warning`, `warningSurface`, `error`, `errorSurface`, `info`, `infoSurface`, `running`, `stopped` |

Port colors encode data types and are independent of appearance themes.
`ports/model/typeColors.ts` retains its complete pre-theme palette, including
orange float32, purple int8/uint8, the existing per-type borders/text, and
deterministic hashed colors for unknown types. Unsigned integer ports retain
their corresponding signed integer color family. Built-in themes cannot
recolor these mappings, and imported `port.*` overrides are rejected as
unsupported tokens. Previously exported definitions containing port overrides
must remove those overrides before reimporting. No minimap or emphasized grid exists,
so neither has speculative tokens. Panels, menus, and dialogs reuse application
surfaces; transparency remains controlled by application CSS. Each token maps
to `--theme-<group>-<key>` and a derived RGB triplet property for Tailwind alpha
utilities. Imports cannot inject CSS property names or CSS expressions.

Example:

```json
{
  "schemaVersion": 1,
  "id": "community.midnight",
  "name": "Midnight",
  "author": "Community",
  "extends": "builtin.dark",
  "tokens": {
    "canvas.background": "#101722",
    "canvas.grid": "#253247",
    "block.background": "#202B3B",
    "block.text": "#F0F4FA",
    "connection.default": "#8BA7CC"
  }
}
```

## Verification and acceptance — CONDITIONAL

- `TMPDIR=/private/tmp npm test`: **544/544 tests pass**, 84 files, including
  49 theme tests and 9 desktop persistence regression tests. The canonical TMPDIR avoids existing macOS `/var` versus
  `/private/var` alias failures in Linux AppArmor launcher tests.
- `npm run build:web`: **PASS** (TypeScript and production Vite build).
- `npm run desktop:build`: **PASS** after the native persistence correction.
- `npm run lint`: **PASS**, no errors; 25 existing fast-refresh/hook warnings.
- `git diff --check`: **PASS**.
- Theme tests cover all built-ins, complete resolution, switching, safe schema/
  value rejection, partial inheritance, persistence/restart, round-trip,
  duplicate confirmation requirements, deletion/fallback, corruption, storage
  errors, concurrent writes, root CSS properties, type color mapping, and graph
  state preservation, fixed port type colors across all four built-ins and
  imported themes, and rejection of semantic port color overrides. Existing
  editing, submission, and runtime tests pass.
- All built-ins meet tested 7:1 primary/block text and 4.5:1 secondary text
  targets on their main surfaces. Block boundaries and default connections
  meet 3:1 against the canvas; High Contrast boundaries/focus exceed 7:1.
  Disabled blocks retain hatching and labels; bypass retains its label; missing
  blocks and invalid connections have dashed boundaries/lines.
- Hardcoded-color audit: remaining literal colors outside theme definitions
  are startup fallbacks, the semantic port palette, data palettes, and data
  color scales. Graph chrome, grid, and connections resolve theme properties;
  port fills and borders deliberately retain their fixed type meanings.

`scripts/theme-browser-acceptance.mjs` is a dependency-free Chrome DevTools
runner for UI switching/import/replacement/deletion, real IndexedDB persistence,
computed surface colors, unchanged geometry, and four screenshots of the same
nine-node diagram. It uses an offline reflected catalog fixture and empty
session list, never a fabricated running session. Run a Vite development server,
then:

```sh
CHROME_PATH=/path/to/chrome node scripts/theme-browser-acceptance.mjs
```

Optional `STUDIO_URL` and `THEME_EVIDENCE_DIR` override its local URL and output
directory. Successful runs write `light.png`, `dark.png`, `high-contrast.png`,
`paper.png`, and `acceptance.json` under `docs/evidence/theme-1/`.

**Remaining acceptance limitation:** screenshots and real-browser persistence
checks could not execute in this environment. Chrome and Electron abort before
rendering. A diagnostic backtrace of an isolated, ad hoc signed Electron copy
shows macOS `HIServices::_RegisterApplication` aborting during AppKit startup;
changing signatures does not resolve the GUI-session restriction. Downloading
a temporary browser was also unavailable because `registry.npmjs.org` DNS
resolution failed. No installed browser or repository dependency was modified.
See [the environment evidence](evidence/theme-1/acceptance-environment.json).
The runner is supplied for a machine with a working browser; visual acceptance
and live GR4 execution remain unverified. No screenshots are claimed.

Web preferences are local to the browser profile/origin; desktop preferences
are saved in Electron's platform-specific userData directory. Separate open
windows pick up persisted choices when reopened;
live cross-window synchronization is outside this implementation. Imported
theme contrast is user-controlled; only built-in contrast is tested.
