import type { WorkspacePanelViewModel } from '../../../workspace/workspace-view';
import { lookupStudioKnownBlockBinding } from '../../../graph-editor/runtime/known-block-bindings';
import type { PhosphorSpectrumTuning, PlotPanelSpec } from './types';
import { resolveStudioPlotStyle } from './plot-style';

const plotSpecCache = new Map<string, PlotPanelSpec>();
const X_RANGE_PARAMETER_KEYS = ['x_min', 'xmin', 'xMin', 'x_max', 'xmax', 'xMax'] as const;
const Y_RANGE_PARAMETER_KEYS = ['y_min', 'ymin', 'yMin', 'y_max', 'ymax', 'yMax'] as const;
type PlotParameterValue = string | number | boolean | null;
type PlotParameterMap = Readonly<Record<string, PlotParameterValue>>;

// Scalar timeseries metadata remains graph/block-owned.
// Accepted optional keys from node parameters:
// - plot_title | title
// - x_label | xlabel
// - y_label | ylabel
// - series_labels | channel_labels (comma-separated)
function readParameterValue(parameters: PlotParameterMap | undefined, keys: readonly string[]): PlotParameterValue | undefined {
  if (!parameters) {
    return undefined;
  }

  for (const key of keys) {
    const value = parameters[key];
    if (typeof value === 'string') {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
      continue;
    }

    if (value !== null && value !== undefined) {
      return value;
    }
  }

  return undefined;
}

function readTextParameterValue(parameters: PlotParameterMap | undefined, keys: readonly string[]): string | undefined {
  const value = readParameterValue(parameters, keys);
  return typeof value === 'string' ? value : undefined;
}

function parseSeriesLabels(parameters: PlotParameterMap | undefined): string[] | undefined {
  const raw = readTextParameterValue(parameters, ['series_labels', 'channel_labels']);
  if (!raw) {
    return undefined;
  }
  const labels = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return labels.length > 0 ? labels : undefined;
}

function parseChannels(parameters: PlotParameterMap | undefined): number | undefined {
  const raw = readParameterValue(parameters, ['channels']);
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function buildDefaultSeriesLabels(channelCount: number | undefined): string[] | undefined {
  if (!channelCount || channelCount <= 1) {
    return undefined;
  }
  return Array.from({ length: channelCount }, (_, index) => `ch${index}`);
}

function parseWindowSize(parameters: PlotParameterMap | undefined): number | undefined {
  const raw = readParameterValue(parameters, ['window_size']);
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function parseBooleanValue(raw: PlotParameterValue | undefined): boolean | undefined {
  if (typeof raw === 'boolean') {
    return raw;
  }
  if (raw === undefined || raw === null) {
    return undefined;
  }
  const normalized = String(raw).trim().toLowerCase();
  if (normalized === 'true' || normalized === '1' || normalized === 'yes' || normalized === 'on') {
    return true;
  }
  if (normalized === 'false' || normalized === '0' || normalized === 'no' || normalized === 'off') {
    return false;
  }
  return undefined;
}

function parseOptionalNumber(parameters: PlotParameterMap | undefined, keys: readonly string[]): number | undefined {
  const raw = readParameterValue(parameters, keys);
  if (raw === undefined || raw === null || raw === '') {
    return undefined;
  }
  const parsed = Number.parseFloat(String(raw));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function resolvePhosphorSpectrumTuning(
  parameters: PlotParameterMap | undefined,
): PhosphorSpectrumTuning | undefined {
  const intensity = parseOptionalNumber(parameters, ['phosphor_intensity', 'histo_scale', 'phosphor_scale']);
  const decayMs = parseOptionalNumber(parameters, ['phosphor_decay_ms', 'histo_t0d']);
  const colorMap = readTextParameterValue(parameters, ['color_map', 'phosphor_color_map']);

  if (
    intensity === undefined &&
    decayMs === undefined &&
    colorMap === undefined
  ) {
    return {
      intensity: 1.1,
      decayMs: 1024,
      colorMap: 'gqrx',
    };
  }

  return {
    intensity: intensity ?? 1.1,
    decayMs: decayMs ?? 1024,
    colorMap: colorMap ?? 'gqrx',
  };
}

function hasValidManualRange(min: number | undefined, max: number | undefined): boolean {
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return false;
  }
  return (max as number) !== (min as number);
}

function normalizeManualRange(
  min: number | undefined,
  max: number | undefined,
): { min: number; max: number } | undefined {
  if (!hasValidManualRange(min, max)) {
    return undefined;
  }

  return {
    min: Math.min(min as number, max as number),
    max: Math.max(min as number, max as number),
  };
}

function serializeParameters(parameters: PlotParameterMap | undefined, excludedKeys: readonly string[] = []): string {
  if (!parameters) {
    return '';
  }

  const excluded = new Set(excludedKeys);
  return JSON.stringify(
    Object.keys(parameters)
      .filter((key) => !excluded.has(key))
      .sort()
      .reduce<Record<string, PlotParameterValue>>((acc, key) => {
        acc[key] = parameters[key];
        return acc;
      }, {}),
  );
}

function buildPlotSpecCacheKey(entry: WorkspacePanelViewModel, excludedParameterKeys: readonly string[] = []): string {
  return JSON.stringify({
    panel: {
      id: entry.panel.id,
      kind: entry.panel.kind,
      title: entry.panel.title ?? '',
      nodeId: entry.panel.nodeId,
      visible: entry.panel.visible,
      previewOnCanvas: entry.panel.previewOnCanvas,
      plotStyle: entry.panel.plotStyle ?? null,
    },
    node: {
      displayName: entry.nodeDisplayName ?? '',
      blockTypeId: entry.nodeBlockTypeId ?? '',
      parameters: serializeParameters(entry.nodeParameters, excludedParameterKeys),
      palettes: entry.studioPlotPalettes ?? null,
    },
  });
}

export function derivePlotPanelSpec(entry: WorkspacePanelViewModel): PlotPanelSpec | null {
  if (
    entry.panel.kind !== 'series' &&
    entry.panel.kind !== 'series2d' &&
    entry.panel.kind !== 'histogram' &&
    entry.panel.kind !== 'waterfall'
  ) {
    return null;
  }

  const binding = entry.nodeBlockTypeId ? lookupStudioKnownBlockBinding(entry.nodeBlockTypeId) : null;
  const payloadFormat = binding?.payloadFormat;
  const title =
    readTextParameterValue(entry.nodeParameters, ['plot_title', 'title']) ??
    entry.nodeDisplayName ??
    entry.panel.title ??
    entry.panel.nodeId;
  const persistenceEnabled = parseBooleanValue(readParameterValue(entry.nodeParameters, ['persistence'])) ?? false;
  const isPowerSpectrum =
    Boolean(binding?.blockTypeId.startsWith('gr::studio::StudioPowerSpectrumSink'));
  const isPersistentSpectrum =
    persistenceEnabled &&
    isPowerSpectrum;
  const isHistogram = entry.panel.kind === 'histogram' || isPersistentSpectrum;
  const isSeries2D =
    !isHistogram &&
    (entry.panel.kind === 'series2d' ||
      payloadFormat === 'series2d-xy-json-v1' ||
      payloadFormat === 'dataset-xy-json-v1');
  const isWaterfall = entry.panel.kind === 'waterfall' || payloadFormat === 'waterfall-spectrum-json-v1';
  const defaultXLabel = isWaterfall || isHistogram ? 'Frequency' : isSeries2D ? 'x' : 'sample';
  const defaultYLabel = isWaterfall || isHistogram ? 'Power' : isSeries2D ? 'y' : 'value';
  const xLabel = readTextParameterValue(entry.nodeParameters, ['x_label', 'xlabel']) ?? defaultXLabel;
  const yLabel = readTextParameterValue(entry.nodeParameters, ['y_label', 'ylabel']) ?? defaultYLabel;
  // Metadata precedence:
  // 1) explicit graph/block params (series_labels/channel_labels)
  // 2) payload-side metadata (handled at runtime for dataset/vector payloads)
  // 3) stable defaults
  const seriesLabels =
    parseSeriesLabels(entry.nodeParameters) ??
    (isSeries2D || isWaterfall || isHistogram ? undefined : buildDefaultSeriesLabels(parseChannels(entry.nodeParameters)));
  const windowSize = parseWindowSize(entry.nodeParameters) ?? 1024;
  const autoscale =
    parseBooleanValue(readParameterValue(entry.nodeParameters, ['autoscale', 'auto_scale'])) ?? true;
  const xMin = parseOptionalNumber(entry.nodeParameters, ['x_min', 'xmin', 'xMin']);
  const xMax = parseOptionalNumber(entry.nodeParameters, ['x_max', 'xmax', 'xMax']);
  const yMin = parseOptionalNumber(entry.nodeParameters, ['y_min', 'ymin', 'yMin']);
  const yMax = parseOptionalNumber(entry.nodeParameters, ['y_max', 'ymax', 'yMax']);
  const manualXRange = normalizeManualRange(xMin, xMax);
  const manualYRange = normalizeManualRange(yMin, yMax);
  const resolvedPayloadFormat =
    payloadFormat === 'dataset-xy-json-v1'
      ? 'dataset-xy-json-v1'
      : payloadFormat === 'series2d-xy-json-v1'
        ? 'series2d-xy-json-v1'
        : payloadFormat === 'waterfall-spectrum-json-v1'
          ? 'waterfall-spectrum-json-v1'
        : isHistogram
          ? 'dataset-xy-json-v1'
        : isWaterfall
          ? 'waterfall-spectrum-json-v1'
        : isSeries2D
            ? 'series2d-xy-json-v1'
            : 'series-window-json-v1';
  const resolvedPlotStyle = resolveStudioPlotStyle({
    panelOverride: entry.panel.plotStyle,
    studioPalettes: entry.studioPlotPalettes,
  });
  const phosphorTuning = isHistogram ? resolvePhosphorSpectrumTuning(entry.nodeParameters) : undefined;
  const ignoredRangeKeys = isWaterfall
    ? [...X_RANGE_PARAMETER_KEYS, ...Y_RANGE_PARAMETER_KEYS]
    : isPowerSpectrum
      ? X_RANGE_PARAMETER_KEYS
      : isSeries2D || isHistogram
      ? []
      : X_RANGE_PARAMETER_KEYS;
  const cacheKey = buildPlotSpecCacheKey(entry, ignoredRangeKeys);
  const cached = plotSpecCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const rangeSpec = isWaterfall
    ? {}
    : {
        xRange: isSeries2D || isHistogram
          ? !isPowerSpectrum && !autoscale && manualXRange
            ? {
                auto: false,
                min: manualXRange.min,
                max: manualXRange.max,
              }
            : { auto: true }
          : {
              auto: false,
              min: 0,
              max: Math.max(0, windowSize - 1),
            },
        yRange: {
          auto: !(!autoscale && manualYRange),
          min: !autoscale && manualYRange ? manualYRange.min : undefined,
          max: !autoscale && manualYRange ? manualYRange.max : undefined,
        },
      };

  const spec: PlotPanelSpec = {
    panelId: entry.panel.id,
    kind: isWaterfall ? 'waterfall' : isHistogram ? 'histogram' : 'timeseries',
    source: {
      sinkId: entry.panel.nodeId,
      channel: 'all',
      field: isWaterfall ? 'image' : 'y',
      payloadFormat: resolvedPayloadFormat,
    },
    view: {
      kind: isWaterfall ? 'waterfall' : isHistogram ? 'histogram' : 'timeseries',
      title,
      xMode: isSeries2D || isWaterfall || isHistogram ? 'frequency' : 'sample-index',
      streaming: true,
      legend: !isWaterfall,
      windowSize,
      xLabel,
      yLabel,
      seriesLabels,
      ...(phosphorTuning ? { phosphor: phosphorTuning } : {}),
      ...rangeSpec,
      plotColors: resolvedPlotStyle.colors,
      colorAssignmentMode: resolvedPlotStyle.assignmentMode,
    },
  };

  plotSpecCache.set(cacheKey, spec);
  return spec;
}
