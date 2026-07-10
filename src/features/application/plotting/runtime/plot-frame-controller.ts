import type { PlotDataFrame, PlotPanelSpec, PlotSeriesFrame } from '../model/types';

function asNumberArray(values: number[] | Float32Array | Float64Array): number[] {
  return Array.isArray(values) ? [...values] : Array.from(values);
}

export type PlotFrameController = {
  getVersion: () => number;
  getFrame: () => PlotDataFrame;
  reset: () => void;
  setLoading: (statusMessage?: string) => void;
  setNoData: (statusMessage?: string) => void;
  setError: (message: string, errorKind?: 'invalid-binding' | 'runtime') => void;
  ingestSeries: (
    series: PlotSeriesFrame[],
    emittedAtMs?: number,
    mode?: 'append' | 'replace',
    metadata?: {
      xyRenderMode?: NonNullable<PlotDataFrame['meta']>['xyRenderMode'];
      xyPointSize?: number;
      xyPointAlpha?: number;
      tags?: NonNullable<PlotDataFrame['meta']>['tags'];
      statusMessage?: string;
      liveIngressFpsHz?: number;
    },
  ) => void;
  ingestImage: (
    image: NonNullable<PlotDataFrame['image']>,
    emittedAtMs?: number,
    metadata?: {
      statusMessage?: string;
      liveIngressFpsHz?: number;
    },
  ) => void;
};

export function createPlotFrameController(spec: PlotPanelSpec): PlotFrameController {
  let version = 0;
  let dirty = true;
  let sequence = 0;
  let state: NonNullable<PlotDataFrame['meta']> = {
    state: 'no-data',
    domain: spec.kind === 'timeseries' || spec.kind === 'fft'
      ? 'time'
      : spec.kind === 'waterfall' || spec.kind === 'histogram'
        ? 'frequency'
        : 'image',
  };
  let seriesById = new Map<string, { id: string; label: string; x?: number[]; y: number[] }>();
  let imageFrame: PlotDataFrame['image'] | undefined;
  let cachedFrame: PlotDataFrame = {
    kind: spec.kind,
    series: [],
    meta: state,
  };

  const markDirty = () => {
    version += 1;
    dirty = true;
  };

  const getVersion = () => version;

  const getFrame = (): PlotDataFrame => {
    if (!dirty) {
      return cachedFrame;
    }

    cachedFrame = {
      kind: spec.kind,
      series: Array.from(seriesById.values()).map((series) => ({
        id: series.id,
        label: series.label,
        ...(series.x ? { x: series.x } : {}),
        y: series.y,
      })),
      ...(imageFrame ? { image: imageFrame } : {}),
      meta: state,
    };
    dirty = false;
    return cachedFrame;
  };

  const reset = () => {
    sequence = 0;
    state = {
      state: 'no-data',
      domain: spec.kind === 'timeseries' || spec.kind === 'fft'
        ? 'time'
        : spec.kind === 'waterfall' || spec.kind === 'histogram'
          ? 'frequency'
          : 'image',
    };
    seriesById = new Map();
    imageFrame = undefined;
    markDirty();
  };

  const setLoading = (statusMessage?: string) => {
    if (state.state === 'loading' && state.statusMessage === statusMessage) {
      return;
    }
    state = {
      ...state,
      state: 'loading',
      errorKind: undefined,
      errorMessage: undefined,
      statusMessage,
    };
    markDirty();
  };

  const setNoData = (statusMessage?: string) => {
    if (state.state === 'no-data' && !state.errorMessage && state.statusMessage === statusMessage) {
      return;
    }
    state = {
      ...state,
      state: 'no-data',
      errorKind: undefined,
      errorMessage: undefined,
      statusMessage,
    };
    markDirty();
  };

  const setError = (message: string, errorKind: 'invalid-binding' | 'runtime' = 'runtime') => {
    if (state.state === 'error' && state.errorMessage === message && state.errorKind === errorKind) {
      return;
    }
    state = {
      ...state,
      state: 'error',
      errorKind,
      errorMessage: message,
      statusMessage: message,
    };
    markDirty();
  };

  const ingestSeries = (
    series: PlotSeriesFrame[],
    emittedAtMs?: number,
    mode: 'append' | 'replace' = 'append',
    metadata?: {
      xyRenderMode?: NonNullable<PlotDataFrame['meta']>['xyRenderMode'];
      xyPointSize?: number;
      xyPointAlpha?: number;
      tags?: NonNullable<PlotDataFrame['meta']>['tags'];
      statusMessage?: string;
      liveIngressFpsHz?: number;
    },
  ) => {
    const windowSize = spec.view.windowSize;
    const next = new Map<string, { id: string; label: string; x?: number[]; y: number[] }>();
    let hasSamples = false;
    for (const item of series) {
      const previous = seriesById.get(item.id);
      const nextChunk = asNumberArray(item.y);
      const mergedY = mode === 'append' && previous ? previous.y : [];
      const nextXChunk = item.x ? asNumberArray(item.x) : undefined;
      const mergedX = mode === 'append' && previous && previous.x ? previous.x : undefined;
      if (mode === 'replace') {
        mergedY.length = 0;
        if (mergedX) {
          mergedX.length = 0;
        }
      }
      mergedY.push(...nextChunk);
      if (mergedX && nextXChunk) {
        mergedX.push(...nextXChunk);
      }
      if (windowSize && windowSize > 0 && mergedY.length > windowSize) {
        const overflow = mergedY.length - windowSize;
        mergedY.splice(0, overflow);
        if (mergedX) {
          if (mergedX.length <= overflow) {
            mergedX.length = 0;
          } else {
            mergedX.splice(0, overflow);
          }
        }
      }
      next.set(item.id, {
        id: item.id,
        label: item.label,
        x: nextXChunk ? nextXChunk : mergedX,
        y: mergedY,
      });
      hasSamples = hasSamples || mergedY.length > 0;
    }
    sequence += 1;
    seriesById = next;
    imageFrame = undefined;
    state = {
      ...state,
      sequence,
      emittedAtMs,
      state: hasSamples ? 'ready' : 'no-data',
      xyRenderMode: metadata?.xyRenderMode,
      xyPointSize: metadata?.xyPointSize,
      xyPointAlpha: metadata?.xyPointAlpha,
      tags: metadata?.tags,
      statusMessage: metadata?.statusMessage,
      liveIngressFpsHz: metadata?.liveIngressFpsHz,
      errorKind: undefined,
      errorMessage: undefined,
    };
    markDirty();
  };

  const ingestImage = (
    image: NonNullable<PlotDataFrame['image']>,
    emittedAtMs?: number,
    metadata?: {
      statusMessage?: string;
      liveIngressFpsHz?: number;
    },
  ) => {
    const nextValues = image.values;
    const hasPixels = image.width > 0 && image.height > 0 && nextValues.length > 0;
    sequence += 1;
    imageFrame = {
      ...image,
      values: nextValues,
    };
    seriesById = new Map();
    state = {
      ...state,
      sequence,
      emittedAtMs,
      state: hasPixels ? 'ready' : 'no-data',
      statusMessage: metadata?.statusMessage,
      liveIngressFpsHz: metadata?.liveIngressFpsHz,
      errorKind: undefined,
      errorMessage: undefined,
      domain: spec.kind === 'waterfall' ? 'frequency' : state.domain,
    };
    markDirty();
  };

  return {
    getVersion,
    getFrame,
    reset,
    setLoading,
    setNoData,
    setError,
    ingestSeries,
    ingestImage,
  };
}
