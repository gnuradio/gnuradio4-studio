import { useEffect, useMemo, useState } from 'react';
import type { StudioPlotPaletteSpec, StudioPlotStyleConfig } from '../graph-document/model/studio-workspace';
import type { WorkspacePanelViewModel } from './workspace-view';
import { STUDIO_BUILTIN_PLOT_PALETTES } from '../application/plotting/model/plot-style';

type PlotStyleModalProps = {
  open: boolean;
  panelEntry: WorkspacePanelViewModel | null;
  studioPalettes: readonly StudioPlotPaletteSpec[];
  onClose: () => void;
  onApply: (params: {
    panelId: string;
    plotStyle: StudioPlotStyleConfig | undefined;
    studioPalettes: StudioPlotPaletteSpec[];
  }) => void;
};

type PaletteMode = 'default' | 'studio' | 'custom';

function ensureHexColor(value: string): string {
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
    return trimmed;
  }
  return '#22d3ee';
}

function normalizeColorList(colors: readonly string[] | undefined): string[] {
  if (!colors || colors.length === 0) {
    return ['#22d3ee', '#38bdf8', '#818cf8'];
  }
  return colors.map(ensureHexColor);
}

function ColorListEditor({
  colors,
  onChange,
}: {
  colors: readonly string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <div className="space-y-2">
      {colors.map((color, index) => (
        <div key={`${color}-${index}`} className="flex items-center gap-2">
          <input
            type="color"
            value={ensureHexColor(color)}
            onChange={(event) => {
              const next = [...colors];
              next[index] = ensureHexColor(event.target.value);
              onChange(next);
            }}
            className="h-7 w-10 rounded border border-slate-600 bg-slate-900 p-0"
          />
          <span className="w-24 shrink-0 text-xs text-slate-300">{ensureHexColor(color)}</span>
          <div className="ml-auto flex items-center gap-1">
            <button
              type="button"
              disabled={index === 0}
              onClick={() => {
                const next = [...colors];
                [next[index - 1], next[index]] = [next[index], next[index - 1]];
                onChange(next);
              }}
              className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-200 disabled:opacity-40"
            >
              ↑
            </button>
            <button
              type="button"
              disabled={index === colors.length - 1}
              onClick={() => {
                const next = [...colors];
                [next[index], next[index + 1]] = [next[index + 1], next[index]];
                onChange(next);
              }}
              className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-200 disabled:opacity-40"
            >
              ↓
            </button>
            <button
              type="button"
              disabled={colors.length <= 1}
              onClick={() => {
                const next = colors.filter((_, i) => i !== index);
                onChange(next.length > 0 ? next : ['#22d3ee']);
              }}
              className="rounded border border-rose-700/70 bg-rose-900/35 px-2 py-1 text-sm text-rose-200 disabled:opacity-40"
            >
              Remove
            </button>
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...colors, '#22d3ee'])}
        className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-200"
      >
        Add color
      </button>
    </div>
  );
}

export function PlotStyleModal({ open, panelEntry, studioPalettes, onClose, onApply }: PlotStyleModalProps) {
  const [mode, setMode] = useState<PaletteMode>('default');
  const [selectedStudioPaletteId, setSelectedStudioPaletteId] = useState<string>('');
  const [customColors, setCustomColors] = useState<string[]>(['#22d3ee', '#38bdf8', '#818cf8']);
  const [draftStudioPalettes, setDraftStudioPalettes] = useState<StudioPlotPaletteSpec[]>([]);

  const effectiveStudioPalettes = useMemo(() => {
    if (studioPalettes.length > 0) {
      return studioPalettes.map((palette) => ({
        id: palette.id,
        colors: normalizeColorList(palette.colors),
      }));
    }
    return Object.entries(STUDIO_BUILTIN_PLOT_PALETTES).map(([id, colors]) => ({
      id,
      colors: [...colors],
    }));
  }, [studioPalettes]);

  useEffect(() => {
    if (!open || !panelEntry) {
      return;
    }
    setDraftStudioPalettes(effectiveStudioPalettes);
    const palette = panelEntry.panel.plotStyle?.palette;
    if (!palette) {
      setMode('default');
      setSelectedStudioPaletteId(effectiveStudioPalettes[0]?.id ?? '');
      setCustomColors(['#22d3ee', '#38bdf8', '#818cf8']);
      return;
    }
    if (palette.kind === 'custom') {
      setMode('custom');
      setCustomColors(normalizeColorList(palette.colors));
      setSelectedStudioPaletteId(effectiveStudioPalettes[0]?.id ?? '');
      return;
    }
    setMode('studio');
    setSelectedStudioPaletteId(palette.id || effectiveStudioPalettes[0]?.id || '');
    setCustomColors(['#22d3ee', '#38bdf8', '#818cf8']);
  }, [effectiveStudioPalettes, open, panelEntry]);

  if (!open || !panelEntry) {
    return null;
  }

  const selectedStudioPalette = draftStudioPalettes.find((palette) => palette.id === selectedStudioPaletteId);
  const canApplyStudio = mode !== 'studio' || selectedStudioPaletteId.length > 0;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-950/70 p-4">
      <div className="w-full max-w-2xl rounded-lg border border-slate-700 bg-slate-900 shadow-xl">
        <header className="flex items-center justify-between border-b border-slate-700 px-4 py-3">
          <div>
            <h3 className="text-lg font-semibold text-slate-100">Plot Style</h3>
            <p className="text-xs text-slate-400">
              {panelEntry.nodePanelTitle ?? panelEntry.panel.title ?? panelEntry.panel.nodeId}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-200 hover:bg-slate-800"
          >
            Close
          </button>
        </header>

        <div className="space-y-4 px-4 py-4">
          <label className="block text-sm text-slate-300">
            <span className="mb-1 block text-slate-400">Palette mode</span>
            <select
              value={mode}
              onChange={(event) => setMode(event.target.value as PaletteMode)}
              className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-100"
            >
              <option value="default">Default / Inherited</option>
              <option value="studio">Studio palette</option>
              <option value="custom">Custom</option>
            </select>
          </label>

          {mode === 'studio' ? (
            <div className="space-y-3 rounded border border-slate-700 bg-slate-950/30 p-3">
              <label className="block text-sm text-slate-300">
                <span className="mb-1 block text-slate-400">Studio palette</span>
                <select
                  value={selectedStudioPaletteId}
                  onChange={(event) => setSelectedStudioPaletteId(event.target.value)}
                  className="w-full rounded border border-slate-600 bg-slate-900 px-2 py-1.5 text-xs text-slate-100"
                >
                  {draftStudioPalettes.map((palette) => (
                    <option key={palette.id} value={palette.id}>
                      {palette.id}
                    </option>
                  ))}
                </select>
              </label>
              {selectedStudioPalette ? (
                <div>
                  <p className="mb-2 text-xs text-slate-400">Edit studio palette colors</p>
                  <ColorListEditor
                    colors={selectedStudioPalette.colors}
                    onChange={(nextColors) => {
                      setDraftStudioPalettes((current) =>
                        current.map((palette) =>
                          palette.id === selectedStudioPalette.id
                            ? { ...palette, colors: normalizeColorList(nextColors) }
                            : palette,
                        ),
                      );
                    }}
                  />
                </div>
              ) : null}
            </div>
          ) : null}

          {mode === 'custom' ? (
            <div className="space-y-2 rounded border border-slate-700 bg-slate-950/30 p-3">
              <p className="text-xs text-slate-400">Custom colors</p>
              <ColorListEditor colors={customColors} onChange={(next) => setCustomColors(normalizeColorList(next))} />
            </div>
          ) : null}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-slate-700 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-600 bg-slate-900 px-2 py-1 text-sm text-slate-200 hover:bg-slate-800"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canApplyStudio}
            onClick={() => {
              const nextStyle: StudioPlotStyleConfig | undefined =
                mode === 'default'
                  ? undefined
                  : mode === 'studio'
                    ? {
                        assignmentMode: 'byIndex',
                        palette: {
                          kind: 'studio',
                          id: selectedStudioPaletteId,
                        },
                      }
                    : {
                        assignmentMode: 'byIndex',
                        palette: {
                          kind: 'custom',
                          colors: normalizeColorList(customColors),
                        },
                      };
              onApply({
                panelId: panelEntry.panel.id,
                plotStyle: nextStyle,
                studioPalettes: draftStudioPalettes.map((palette) => ({
                  ...palette,
                  colors: normalizeColorList(palette.colors),
                })),
              });
              onClose();
            }}
            className="rounded border border-emerald-700/70 bg-emerald-900/40 px-2 py-1 text-sm text-emerald-100 hover:bg-emerald-800/50 disabled:opacity-40"
          >
            Apply
          </button>
        </footer>
      </div>
    </div>
  );
}
