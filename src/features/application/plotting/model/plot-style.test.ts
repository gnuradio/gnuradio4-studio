import { describe, expect, it } from 'vitest';
import { buildDefaultStudioPlotPalettes, resolveStudioPlotStyle, STUDIO_BUILTIN_PLOT_PALETTES } from './plot-style';

describe('resolveStudioPlotStyle', () => {
  it('uses panel custom palette over workspace/default', () => {
    const resolved = resolveStudioPlotStyle({
      workspaceDefault: {
        palette: { kind: 'builtin', id: 'warm' },
      },
      panelOverride: {
        palette: { kind: 'custom', colors: ['#ffffff', '#00ff00'] },
      },
    });

    expect(resolved.assignmentMode).toBe('byIndex');
    expect(resolved.colors).toEqual(['#ffffff', '#00ff00']);
  });

  it('falls back to workspace builtin palette when panel override is absent', () => {
    const resolved = resolveStudioPlotStyle({
      workspaceDefault: {
        palette: { kind: 'builtin', id: 'cool' },
      },
    });
    expect(resolved.colors).toEqual([...STUDIO_BUILTIN_PLOT_PALETTES.cool]);
  });

  it('falls back to studio default palette when custom override is invalid', () => {
    const resolved = resolveStudioPlotStyle({
      panelOverride: {
        palette: { kind: 'custom', colors: ['invalid', 'also-bad'] },
      },
    });
    expect(resolved.colors).toEqual([...STUDIO_BUILTIN_PLOT_PALETTES['studio-default']]);
  });

  it('resolves studio palette references from editable studio palette arrays', () => {
    const resolved = resolveStudioPlotStyle({
      panelOverride: {
        palette: { kind: 'studio', id: 'ops' },
      },
      studioPalettes: [
        { id: 'ops', colors: ['#111111', '#222222', '#333333'] },
      ],
    });
    expect(resolved.colors).toEqual(['#111111', '#222222', '#333333']);
  });

  it('builds deterministic default studio palette definitions', () => {
    const defaults = buildDefaultStudioPlotPalettes();
    expect(defaults.length).toBeGreaterThan(0);
    expect(defaults[0]).toHaveProperty('id');
    expect(defaults[0].colors.length).toBeGreaterThan(0);
  });

  it('uses a GNU Radio-style default series color order', () => {
    expect(STUDIO_BUILTIN_PLOT_PALETTES['studio-default']).toEqual([
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
    ]);
  });
});
