import type { StudioPlotPaletteSpec, StudioPlotStyleConfig } from '../../../graph-document/model/studio-workspace';

export const STUDIO_BUILTIN_PLOT_PALETTES = {
  'studio-default': [
    '#3b82f6',
    '#ef4444',
    '#22c55e',
    '#f8fafc',
    '#06b6d4',
    '#d946ef',
    '#facc15',
    '#be123c',
    '#15803d',
    '#1d4ed8',
  ],
  cool: ['#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7', '#14b8a6', '#10b981'],
  warm: ['#f97316', '#fb7185', '#ef4444', '#eab308', '#f59e0b', '#f43f5e', '#fda4af', '#fb923c'],
} as const;

const HEX_COLOR_RE = /^#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export type ResolvedStudioPlotStyle = {
  assignmentMode: 'byIndex';
  colors: string[];
};

export function buildDefaultStudioPlotPalettes(): StudioPlotPaletteSpec[] {
  return Object.entries(STUDIO_BUILTIN_PLOT_PALETTES).map(([id, colors]) => ({
    id,
    colors: [...colors],
  }));
}

function sanitizeCustomColors(colors: readonly string[] | undefined): string[] | undefined {
  if (!colors || colors.length === 0) {
    return undefined;
  }
  const normalized = colors
    .map((value) => value.trim())
    .filter((value) => HEX_COLOR_RE.test(value));
  return normalized.length > 0 ? normalized : undefined;
}

function resolvePaletteColors(
  config: StudioPlotStyleConfig | undefined,
  studioPaletteById: ReadonlyMap<string, StudioPlotPaletteSpec>,
): string[] | undefined {
  if (!config?.palette) {
    return undefined;
  }
  if (config.palette.kind === 'custom') {
    return sanitizeCustomColors(config.palette.colors);
  }
  if (config.palette.kind === 'studio') {
    return sanitizeCustomColors(studioPaletteById.get(config.palette.id)?.colors);
  }
  const builtin = STUDIO_BUILTIN_PLOT_PALETTES[config.palette.id as keyof typeof STUDIO_BUILTIN_PLOT_PALETTES];
  return builtin ? [...builtin] : undefined;
}

export function resolveStudioPlotStyle(params: {
  panelOverride?: StudioPlotStyleConfig;
  workspaceDefault?: StudioPlotStyleConfig;
  studioPalettes?: readonly StudioPlotPaletteSpec[];
}): ResolvedStudioPlotStyle {
  const effectiveStudioPalettes = params.studioPalettes && params.studioPalettes.length > 0
    ? params.studioPalettes
    : buildDefaultStudioPlotPalettes();
  const studioPaletteById = new Map(effectiveStudioPalettes.map((palette) => [palette.id, palette]));
  const panelColors = resolvePaletteColors(params.panelOverride, studioPaletteById);
  const workspaceColors = resolvePaletteColors(params.workspaceDefault, studioPaletteById);
  const colors = panelColors ?? workspaceColors ?? [...STUDIO_BUILTIN_PLOT_PALETTES['studio-default']];
  return {
    assignmentMode: 'byIndex',
    colors,
  };
}
