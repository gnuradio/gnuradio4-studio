import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { PlotAdapterProps, PlotAxisMode, PlotSeriesFrame, PlotTagAnnotation, PlotViewSpec } from '../model/types';
import { STUDIO_BUILTIN_PLOT_PALETTES } from '../model/plot-style';
import { buildPlotTagMarkers, type PlotTagMarker } from './timeseries-tag-markers';

const AXIS_STROKE = '#94a3b8';
const GRID_STROKE = '#334155';
const X_SCALE_KEY = 'x';
const Y_SCALE_KEY = 'y';

type NumericRange = {
  min: number;
  max: number;
};

type ViewRanges = {
  x?: NumericRange;
  y?: NumericRange;
};

function toNumberArray(values: number[] | Float32Array | Float64Array): number[] {
  return Array.isArray(values) ? values : Array.from(values);
}

export type NormalizedTimeseriesData = {
  x: number[];
  yBySeries: number[][];
  labels: string[];
};

export function normalizeSeriesData(
  series: PlotSeriesFrame[] | undefined,
  xMode: 'time' | 'sample-index' | 'frequency' | undefined,
  windowSize: number | undefined,
  xyRenderMode: 'line' | 'scatter',
): NormalizedTimeseriesData {
  if (!series || series.length === 0) {
    return { x: [], yBySeries: [], labels: [] };
  }

  const yArrays = series.map((item) => toNumberArray(item.y));
  const maxLen = yArrays.reduce((max, values) => Math.max(max, values.length), 0);
  const fixedSampleWindow =
    xMode === 'sample-index' && typeof windowSize === 'number' && Number.isFinite(windowSize) && windowSize > 0
      ? Math.floor(windowSize)
      : undefined;
  const targetLen = fixedSampleWindow ?? maxLen;
  const useSourceX = xMode === 'time' || xMode === 'frequency';
  const xFromSource = useSourceX && series[0].x ? Array.from(series[0].x) : undefined;
  const canUseScatterPairs =
    xyRenderMode === 'scatter' && xFromSource && xFromSource.length > 0 && yArrays.length > 0 && yArrays[0].length > 0;
  const sortedScatterPairs = canUseScatterPairs
    ? xFromSource
        .map((xValue, index) => [xValue, yArrays[0][index]] as const)
        .filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]))
        .sort((a, b) => a[0] - b[0])
    : undefined;
  const scatterLen = sortedScatterPairs?.length ?? 0;
  if (xyRenderMode === 'scatter' && scatterLen > 0) {
    return {
      x: sortedScatterPairs!.map((point) => point[0]),
      yBySeries: [sortedScatterPairs!.map((point) => point[1])],
      labels: series.map((item) => item.label || item.id),
    };
  }
  const x =
    xFromSource && xFromSource.length > 0
      ? xFromSource.slice(-targetLen)
      : Array.from({ length: targetLen }, (_, i) => i);

  const yBySeries = yArrays.map((values) => {
    const trimmed = values.slice(-targetLen);
    if (trimmed.length === targetLen) {
      return trimmed;
    }
    const padded = Array.from({ length: targetLen }, () => Number.NaN);
    const offset = 0;
    trimmed.forEach((value, index) => {
      padded[offset + index] = value;
    });
    return padded;
  });

  return {
    x,
    yBySeries,
    labels: series.map((item) => item.label || item.id),
  };
}

export function assertTimeseriesAdapterShape(normalized: NormalizedTimeseriesData): void {
  if (normalized.yBySeries.length !== normalized.labels.length) {
    throw new Error(
      `Timeseries adapter shape mismatch: labels=${normalized.labels.length} series=${normalized.yBySeries.length}`,
    );
  }
  for (let index = 0; index < normalized.yBySeries.length; index += 1) {
    const y = normalized.yBySeries[index];
    if (y.length !== normalized.x.length) {
      throw new Error(
        `Timeseries adapter shape mismatch: x.length=${normalized.x.length}, y[${index}].length=${y.length}, label=${normalized.labels[index]}`,
      );
    }
  }
}

function colorWithAlpha(hexColor: string, alpha: number): string {
  const clamped = Math.max(0, Math.min(1, alpha));
  const encoded = Math.round(clamped * 255)
    .toString(16)
    .padStart(2, '0');
  return `${hexColor}${encoded}`;
}

export function buildSeriesOptions(
  labels: string[],
  palette: readonly string[],
  mode: 'line' | 'scatter',
  pointSize?: number,
  pointAlpha?: number,
): uPlot.Series[] {
  return [
    {},
    ...labels.map((label, index) => {
      const color = palette[index % palette.length];
      return {
        label,
        stroke: mode === 'scatter' ? colorWithAlpha(color, 0) : color,
        width: mode === 'scatter' ? 1 : 1.8,
        points: {
          show: mode === 'scatter',
          size: pointSize && Number.isFinite(pointSize) ? Math.max(2, pointSize) : 4,
          width: mode === 'scatter' ? 2 : 1,
          stroke: color,
          fill: mode === 'scatter' ? colorWithAlpha(color, pointAlpha ?? 0.9) : color,
        },
      } satisfies uPlot.Series;
    }),
  ];
}

export function buildEmptyAlignedData(seriesCount: number): uPlot.AlignedData {
  return Array.from({ length: seriesCount + 1 }, () => []) as unknown as uPlot.AlignedData;
}

export function buildTimeseriesScaleOptions(xMode: PlotViewSpec['xMode']): uPlot.Options['scales'] {
  return {
    x: { time: xMode === 'time' },
    y: {},
  };
}

function formatTagValue(value: PlotTagAnnotation['value']): string {
  if (value === undefined) {
    return '';
  }
  if (value === null) {
    return 'null';
  }
  return String(value);
}

function formatTagTooltip(tag: PlotTagAnnotation): string {
  const lines = [
    tag.label || tag.key,
    `key: ${tag.key}`,
    ...(tag.offset !== undefined ? [`offset: ${tag.offset}`] : []),
    ...(tag.x !== undefined ? [`x: ${tag.x}`] : []),
    ...(tag.y !== undefined ? [`y: ${tag.y}`] : []),
    ...(tag.value !== undefined ? [`value: ${formatTagValue(tag.value)}`] : []),
    ...Object.entries(tag.metadata ?? {}).map(([key, value]) => `${key}: ${formatTagValue(value)}`),
  ];
  return lines.join('\n');
}

function clearOverlay(overlay: HTMLDivElement): void {
  while (overlay.firstChild) {
    overlay.removeChild(overlay.firstChild);
  }
}

function renderTagOverlay(
  chart: uPlot,
  overlay: HTMLDivElement,
  markers: readonly PlotTagMarker[],
  maxLabels: number,
): void {
  clearOverlay(overlay);
  const bbox = chart.bbox;
  const plotLeft = bbox.left;
  const plotTop = bbox.top;
  const plotRight = bbox.left + bbox.width;
  const plotBottom = bbox.top + bbox.height;

  markers.forEach((marker, index) => {
    const plotX = chart.valToPos(marker.x, 'x', false);
    if (!Number.isFinite(plotX)) {
      return;
    }
    const xPos = plotLeft + plotX;
    if (xPos < plotLeft || xPos > plotRight) {
      return;
    }

    const labelText = marker.tag.label || marker.tag.key;
    const title = formatTagTooltip(marker.tag);
    if (marker.kind === 'point' && typeof marker.y === 'number') {
      const plotY = chart.valToPos(marker.y, 'y', false);
      if (!Number.isFinite(plotY)) {
        return;
      }
      const yPos = plotTop + plotY;
      if (yPos < plotTop || yPos > plotBottom) {
        return;
      }
      const point = document.createElement('div');
      point.className = 'pointer-events-auto absolute z-10 h-2.5 w-2.5 rounded-full border border-amber-200 bg-amber-400 shadow';
      point.style.left = `${xPos - 5}px`;
      point.style.top = `${yPos - 5}px`;
      point.title = title;
      point.setAttribute('aria-label', title);
      overlay.appendChild(point);

      if (index < maxLabels) {
        const label = document.createElement('div');
        label.className = 'pointer-events-auto absolute z-10 max-w-32 truncate rounded-sm border border-amber-300/60 bg-slate-950/90 px-1 text-[10px] leading-4 text-amber-100 shadow';
        label.style.left = `${Math.min(plotRight, xPos + 6)}px`;
        label.style.top = `${Math.max(plotTop, yPos - 10)}px`;
        label.title = title;
        label.textContent = labelText;
        overlay.appendChild(label);
      }
      return;
    }

    const line = document.createElement('div');
    line.className = 'pointer-events-auto absolute z-10 w-px bg-amber-300/80';
    line.style.left = `${xPos}px`;
    line.style.top = `${plotTop}px`;
    line.style.height = `${bbox.height}px`;
    line.title = title;
    line.setAttribute('aria-label', title);
    overlay.appendChild(line);

    if (index < maxLabels) {
      const label = document.createElement('div');
      label.className = 'pointer-events-auto absolute top-1 z-10 max-w-32 -translate-x-1/2 truncate rounded-sm border border-amber-300/60 bg-slate-950/90 px-1 text-[10px] leading-4 text-amber-100 shadow';
      label.style.left = `${xPos}px`;
      label.style.top = `${plotTop + 4}px`;
      label.title = title;
      label.textContent = labelText;
      overlay.appendChild(label);
    }
  });
}

export function shouldAutoscaleOnDataUpdate(
  ranges: Pick<PlotViewSpec, 'xRange' | 'yRange'>,
  hasCustomView: boolean,
): boolean {
  return !hasCustomView && ranges.xRange?.auto !== false && ranges.yRange?.auto !== false;
}

function finiteExtent(values: readonly number[]): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  values.forEach((value) => {
    if (!Number.isFinite(value)) {
      return;
    }
    min = Math.min(min, value);
    max = Math.max(max, value);
  });

  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }
  if (min === max) {
    const padding = Math.abs(min) > 0 ? Math.abs(min) * 0.01 : 1;
    return { min: min - padding, max: max + padding };
  }
  return { min, max };
}

function applyExplicitScales(chart: uPlot, ranges: Pick<PlotViewSpec, 'xRange' | 'yRange'>): void {
  if (ranges.xRange?.auto === false) {
    chart.setScale(X_SCALE_KEY, {
      min: ranges.xRange.min ?? 0,
      max: ranges.xRange.max ?? 1,
    });
  }
  if (ranges.yRange?.auto === false) {
    chart.setScale(Y_SCALE_KEY, {
      min: ranges.yRange.min ?? 0,
      max: ranges.yRange.max ?? 1,
    });
  }
}

function applyDataUpdateScales(
  chart: uPlot,
  data: uPlot.AlignedData,
  ranges: Pick<PlotViewSpec, 'xRange' | 'yRange'>,
): void {
  if (ranges.xRange?.auto === false) {
    chart.setScale(X_SCALE_KEY, {
      min: ranges.xRange.min ?? 0,
      max: ranges.xRange.max ?? 1,
    });
  } else {
    const xExtent = finiteExtent((data[0] ?? []) as readonly number[]);
    if (xExtent) {
      chart.setScale(X_SCALE_KEY, xExtent);
    }
  }

  if (ranges.yRange?.auto === false) {
    chart.setScale(Y_SCALE_KEY, {
      min: ranges.yRange.min ?? 0,
      max: ranges.yRange.max ?? 1,
    });
  } else {
    const values: number[] = [];
    data.slice(1).forEach((series) => {
      values.push(...((series ?? []) as readonly number[]));
    });
    const yExtent = finiteExtent(values);
    if (yExtent) {
      chart.setScale(Y_SCALE_KEY, yExtent);
    }
  }
}

function includesAxis(mode: PlotAxisMode | undefined, scaleKey: 'x' | 'y'): boolean {
  const resolved = mode ?? 'x';
  return resolved === scaleKey || resolved === 'xy';
}

function zoomRangeAroundAnchor(min: number, max: number, anchor: number, factor: number): { min: number; max: number } | null {
  if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(anchor) || !Number.isFinite(factor) || factor <= 0) {
    return null;
  }
  const span = max - min;
  if (span <= 0) {
    return null;
  }
  const nextSpan = span * factor;
  const ratio = (anchor - min) / span;
  return {
    min: anchor - nextSpan * ratio,
    max: anchor + nextSpan * (1 - ratio),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function deriveWheelZoomRanges(chart: uPlot, event: WheelEvent, mode: PlotAxisMode | undefined): ViewRanges {
  const factor = event.deltaY < 0 ? 0.82 : 1.22;
  const rect = chart.over.getBoundingClientRect();
  const cursorLeft = clamp(event.clientX - rect.left, 0, rect.width);
  const cursorTop = clamp(event.clientY - rect.top, 0, rect.height);
  const ranges: ViewRanges = {};

  if (includesAxis(mode, 'x')) {
    const scale = chart.scales[X_SCALE_KEY];
    const anchor = chart.posToVal(cursorLeft, X_SCALE_KEY);
    const next = zoomRangeAroundAnchor(scale.min ?? 0, scale.max ?? 1, anchor, factor);
    if (next) {
      ranges.x = next;
    }
  }

  if (includesAxis(mode, 'y')) {
    const scale = chart.scales[Y_SCALE_KEY];
    const anchor = chart.posToVal(cursorTop, Y_SCALE_KEY);
    const next = zoomRangeAroundAnchor(scale.min ?? 0, scale.max ?? 1, anchor, factor);
    if (next) {
      ranges.y = next;
    }
  }

  return ranges;
}

function createZoomSelectionElement(): HTMLDivElement {
  const element = document.createElement('div');
  element.className = 'absolute z-20 border border-cyan-300/90 bg-cyan-400/20 shadow-[0_0_0_1px_rgba(8,47,73,0.65)]';
  element.style.pointerEvents = 'none';
  element.style.display = 'none';
  return element;
}

function updateZoomSelectionElement(
  element: HTMLDivElement,
  start: { left: number; top: number },
  end: { left: number; top: number },
  mode: PlotAxisMode,
  bounds: { width: number; height: number },
): void {
  const x0 = Math.min(start.left, end.left);
  const x1 = Math.max(start.left, end.left);
  const y0 = Math.min(start.top, end.top);
  const y1 = Math.max(start.top, end.top);
  const left = includesAxis(mode, 'x') ? x0 : 0;
  const top = includesAxis(mode, 'y') ? y0 : 0;
  const width = includesAxis(mode, 'x') ? x1 - x0 : bounds.width;
  const height = includesAxis(mode, 'y') ? y1 - y0 : bounds.height;

  element.style.display = 'block';
  element.style.left = `${left}px`;
  element.style.top = `${top}px`;
  element.style.width = `${Math.max(1, width)}px`;
  element.style.height = `${Math.max(1, height)}px`;
}

function deriveDragZoomRanges(
  chart: uPlot,
  start: { left: number; top: number },
  end: { left: number; top: number },
  mode: PlotAxisMode,
): ViewRanges {
  const x0 = Math.min(start.left, end.left);
  const x1 = Math.max(start.left, end.left);
  const y0 = Math.min(start.top, end.top);
  const y1 = Math.max(start.top, end.top);
  const ranges: ViewRanges = {};

  if (includesAxis(mode, 'x') && x1 - x0 >= 3) {
    ranges.x = {
      min: chart.posToVal(x0, X_SCALE_KEY),
      max: chart.posToVal(x1, X_SCALE_KEY),
    };
  }

  if (includesAxis(mode, 'y') && y1 - y0 >= 3) {
    ranges.y = {
      min: chart.posToVal(y1, Y_SCALE_KEY),
      max: chart.posToVal(y0, Y_SCALE_KEY),
    };
  }

  return ranges;
}

function hasViewRanges(ranges: ViewRanges): boolean {
  return Boolean(ranges.x || ranges.y);
}

export function panRangesByPixels(
  ranges: ViewRanges,
  deltaX: number,
  deltaY: number,
  width: number,
  height: number,
  mode: PlotAxisMode,
): ViewRanges {
  const next: ViewRanges = {};
  if (includesAxis(mode, 'x') && ranges.x && width > 0) {
    const shift = -deltaX * (ranges.x.max - ranges.x.min) / width;
    next.x = {
      min: ranges.x.min + shift,
      max: ranges.x.max + shift,
    };
  }
  if (includesAxis(mode, 'y') && ranges.y && height > 0) {
    const shift = deltaY * (ranges.y.max - ranges.y.min) / height;
    next.y = {
      min: ranges.y.min + shift,
      max: ranges.y.max + shift,
    };
  }
  return next;
}

function applyViewRanges(chart: uPlot, ranges: ViewRanges): void {
  chart.batch(() => {
    if (ranges.x) {
      chart.setScale(X_SCALE_KEY, ranges.x);
    }
    if (ranges.y) {
      chart.setScale(Y_SCALE_KEY, ranges.y);
    }
  });
}

export function TimeseriesUplotAdapter({ spec, frame, width, height, axisMode = 'x', viewResetKey = 0 }: PlotAdapterProps) {
  const minWidth = 180;
  const minHeight = 120;
  const canRender = width >= minWidth && height >= minHeight;
  const showLegend = (spec.legend ?? true) && width >= 420 && height >= 220;
  const plotHostRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<uPlot | null>(null);
  const lastDataSignatureRef = useRef<string>('');
  const customViewRangesRef = useRef<ViewRanges>({});
  const axisModeRef = useRef(axisMode);
  const alignedDataRef = useRef<uPlot.AlignedData>(buildEmptyAlignedData(0));
  const tagMarkersRef = useRef<readonly PlotTagMarker[]>([]);
  const maxLabelsRef = useRef(100);
  const resolvedPalette = useMemo(() => {
    if (spec.plotColors && spec.plotColors.length > 0) {
      return spec.plotColors;
    }
    return STUDIO_BUILTIN_PLOT_PALETTES['studio-default'];
  }, [spec.plotColors]);

  const normalized = useMemo(
    () => normalizeSeriesData(frame.series, spec.xMode, spec.windowSize, frame.meta?.xyRenderMode ?? 'line'),
    [frame.meta?.xyRenderMode, frame.series, spec.windowSize, spec.xMode],
  );
  if (import.meta.env.DEV) {
    assertTimeseriesAdapterShape(normalized);
  }
  const seriesLabelSignature = useMemo(() => normalized.labels.join('|'), [normalized.labels]);
  const alignedData = useMemo<uPlot.AlignedData>(
    () => [normalized.x, ...normalized.yBySeries],
    [normalized.x, normalized.yBySeries],
  );
  const seriesOptions = useMemo(
    () =>
      buildSeriesOptions(
        seriesLabelSignature.length > 0 ? seriesLabelSignature.split('|') : [],
        resolvedPalette,
        frame.meta?.xyRenderMode ?? 'line',
        frame.meta?.xyPointSize,
        frame.meta?.xyPointAlpha,
      ),
    [frame.meta?.xyPointAlpha, frame.meta?.xyPointSize, frame.meta?.xyRenderMode, resolvedPalette, seriesLabelSignature],
  );
  const tagMarkers = useMemo(
    () => buildPlotTagMarkers(frame.meta?.tags, normalized, frame.meta?.xyRenderMode ?? 'line'),
    [frame.meta?.tags, frame.meta?.xyRenderMode, normalized],
  );
  const maxLabels = useMemo(
    () => Math.max(0, Math.floor(spec.maxLabels ?? 100)),
    [spec.maxLabels],
  );
  alignedDataRef.current = alignedData;
  tagMarkersRef.current = tagMarkers;
  maxLabelsRef.current = maxLabels;
  axisModeRef.current = axisMode;

  useEffect(() => {
    const host = plotHostRef.current;
    if (!host) {
      return;
    }

    if (!canRender) {
      chartRef.current?.destroy();
      chartRef.current = null;
      if (overlayRef.current) {
        clearOverlay(overlayRef.current);
      }
      return;
    }

    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    const overlay = overlayRef.current;
    const hostWidth = Math.max(minWidth, Math.floor(host.clientWidth || 320));
    const hostHeight = Math.max(minHeight, Math.floor(host.clientHeight || 180));
    const chart = new uPlot(
      {
        width: hostWidth,
        height: hostHeight,
        legend: {
          show: showLegend,
        },
        series: seriesOptions,
        scales: buildTimeseriesScaleOptions(spec.xMode),
        axes: [
          {
            label: spec.xLabel ?? 'sample',
            stroke: AXIS_STROKE,
            grid: {
              stroke: GRID_STROKE,
              width: 1,
            },
          },
          {
            label: spec.yLabel ?? 'value',
            stroke: AXIS_STROKE,
            grid: {
              stroke: GRID_STROKE,
              width: 1,
            },
          },
        ],
        cursor: {
          drag: {
            x: false,
            y: false,
            setScale: false,
            dist: 0,
          },
        },
      },
      buildEmptyAlignedData(seriesOptions.length - 1),
      host,
    );
    const selectionElement = createZoomSelectionElement();
    chart.over.appendChild(selectionElement);
    const renderCurrentTags = () => {
      if (overlayRef.current) {
        renderTagOverlay(chart, overlayRef.current, tagMarkersRef.current, maxLabelsRef.current);
      }
    };
    const applyCustomView = (deriveRanges: () => ViewRanges) => {
      const ranges = deriveRanges();
      if (hasViewRanges(ranges)) {
        customViewRangesRef.current = {
          ...customViewRangesRef.current,
          ...ranges,
        };
        applyViewRanges(chart, customViewRangesRef.current);
        renderCurrentTags();
      }
    };
    const handleWheel = (event: WheelEvent) => {
      event.preventDefault();
      applyCustomView(() => deriveWheelZoomRanges(chart, event, axisModeRef.current));
    };
    chart.over.addEventListener('wheel', handleWheel, { passive: false });

    type DragGesture =
      | {
          kind: 'zoom';
          start: { left: number; top: number };
          latest: { left: number; top: number };
        }
      | {
          kind: 'pan';
          start: { left: number; top: number };
          ranges: ViewRanges;
          previousCustomView: ViewRanges;
        };
    let dragGesture: DragGesture | null = null;
    const readPlotPosition = (event: MouseEvent) => {
      const rect = chart.over.getBoundingClientRect();
      return {
        left: clamp(event.clientX - rect.left, 0, rect.width),
        top: clamp(event.clientY - rect.top, 0, rect.height),
        width: rect.width,
        height: rect.height,
      };
    };
    const readCurrentRanges = (): ViewRanges => ({
      x:
        Number.isFinite(chart.scales[X_SCALE_KEY]?.min) && Number.isFinite(chart.scales[X_SCALE_KEY]?.max)
          ? { min: chart.scales[X_SCALE_KEY].min!, max: chart.scales[X_SCALE_KEY].max! }
          : undefined,
      y:
        Number.isFinite(chart.scales[Y_SCALE_KEY]?.min) && Number.isFinite(chart.scales[Y_SCALE_KEY]?.max)
          ? { min: chart.scales[Y_SCALE_KEY].min!, max: chart.scales[Y_SCALE_KEY].max! }
          : undefined,
    });
    const applyPan = (
      gesture: Extract<DragGesture, { kind: 'pan' }>,
      position: ReturnType<typeof readPlotPosition>,
    ) => {
      const ranges = panRangesByPixels(
        gesture.ranges,
        position.left - gesture.start.left,
        position.top - gesture.start.top,
        position.width,
        position.height,
        axisModeRef.current,
      );
      if (!hasViewRanges(ranges)) {
        return;
      }
      customViewRangesRef.current = {
        ...customViewRangesRef.current,
        ...ranges,
      };
      applyViewRanges(chart, customViewRangesRef.current);
      renderCurrentTags();
    };
    const removeDragListeners = () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', finishDrag);
      window.removeEventListener('keydown', cancelDrag);
    };
    const clearDrag = () => {
      selectionElement.style.display = 'none';
      chart.over.style.cursor = '';
      dragGesture = null;
      removeDragListeners();
    };
    const handleMouseMove = (event: MouseEvent) => {
      if (!dragGesture) {
        return;
      }
      event.preventDefault();
      const next = readPlotPosition(event);
      if (dragGesture.kind === 'pan') {
        applyPan(dragGesture, next);
      } else {
        dragGesture.latest = { left: next.left, top: next.top };
        updateZoomSelectionElement(selectionElement, dragGesture.start, dragGesture.latest, axisModeRef.current, {
          width: next.width,
          height: next.height,
        });
      }
    };
    const finishDrag = (event: MouseEvent) => {
      if (!dragGesture) {
        return;
      }
      event.preventDefault();
      const next = readPlotPosition(event);
      const gesture = dragGesture;
      if (gesture.kind === 'pan') {
        applyPan(gesture, next);
      } else {
        applyCustomView(() => deriveDragZoomRanges(chart, gesture.start, gesture.latest, axisModeRef.current));
      }
      clearDrag();
    };
    const cancelDrag = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !dragGesture) {
        return;
      }
      event.preventDefault();
      if (dragGesture.kind === 'pan') {
        customViewRangesRef.current = dragGesture.previousCustomView;
        applyViewRanges(chart, dragGesture.ranges);
        renderCurrentTags();
      }
      clearDrag();
    };
    const handleMouseDown = (event: MouseEvent) => {
      const isPan = event.button === 1 || (event.button === 0 && event.shiftKey);
      const isZoom = event.button === 0 && !event.shiftKey;
      if (!isPan && !isZoom) {
        return;
      }
      event.preventDefault();
      const next = readPlotPosition(event);
      if (isPan) {
        dragGesture = {
          kind: 'pan',
          start: { left: next.left, top: next.top },
          ranges: readCurrentRanges(),
          previousCustomView: { ...customViewRangesRef.current },
        };
        chart.over.style.cursor = 'grabbing';
      } else {
        const start = { left: next.left, top: next.top };
        dragGesture = { kind: 'zoom', start, latest: start };
        updateZoomSelectionElement(selectionElement, start, start, axisModeRef.current, {
          width: next.width,
          height: next.height,
        });
      }
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', finishDrag);
      window.addEventListener('keydown', cancelDrag);
    };
    const preventMiddleClick = (event: MouseEvent) => {
      if (event.button === 1) {
        event.preventDefault();
      }
    };
    chart.over.addEventListener('mousedown', handleMouseDown);
    chart.over.addEventListener('auxclick', preventMiddleClick);

    chart.root.addEventListener('dblclick', () => {
      customViewRangesRef.current = {};
      chart.setData(alignedDataRef.current, true);
      applyDataUpdateScales(chart, alignedDataRef.current, { xRange: spec.xRange, yRange: spec.yRange });
      if (overlayRef.current) {
        renderTagOverlay(chart, overlayRef.current, tagMarkersRef.current, maxLabelsRef.current);
      }
    });
    applyExplicitScales(chart, { xRange: spec.xRange, yRange: spec.yRange });
    chartRef.current = chart;
    lastDataSignatureRef.current = '';

    return () => {
      chart.over.removeEventListener('wheel', handleWheel);
      chart.over.removeEventListener('mousedown', handleMouseDown);
      chart.over.removeEventListener('auxclick', preventMiddleClick);
      removeDragListeners();
      selectionElement.remove();
      chartRef.current?.destroy();
      chartRef.current = null;
      if (overlay) {
        clearOverlay(overlay);
      }
    };
  }, [
    canRender,
    minHeight,
    minWidth,
    seriesOptions,
    showLegend,
    spec.xLabel,
    spec.xMode,
    spec.xRange,
    spec.yLabel,
    spec.yRange,
  ]);

  useEffect(() => {
    if (!chartRef.current || !canRender) {
      return;
    }
    const nextWidth = Math.max(minWidth, Math.floor(width));
    const nextHeight = Math.max(minHeight, Math.floor(height));
    chartRef.current.setSize({ width: nextWidth, height: nextHeight });
    if (hasViewRanges(customViewRangesRef.current)) {
      applyViewRanges(chartRef.current, customViewRangesRef.current);
    }
    if (overlayRef.current) {
      renderTagOverlay(chartRef.current, overlayRef.current, tagMarkers, maxLabels);
    }
  }, [canRender, height, maxLabels, minHeight, minWidth, tagMarkers, width]);

  useEffect(() => {
    if (!chartRef.current) {
      return;
    }
    if (alignedData.length !== chartRef.current.series.length) {
      return;
    }
    const sequence = frame.meta?.sequence ?? -1;
    const firstPoints = alignedData[0]?.length ?? 0;
    const signature = `${sequence}:${firstPoints}:${frame.meta?.state ?? 'na'}`;
    if (signature === lastDataSignatureRef.current) {
      if (hasViewRanges(customViewRangesRef.current)) {
        applyViewRanges(chartRef.current, customViewRangesRef.current);
      } else {
        applyDataUpdateScales(chartRef.current, alignedData, { xRange: spec.xRange, yRange: spec.yRange });
      }
      if (overlayRef.current) {
        renderTagOverlay(chartRef.current, overlayRef.current, tagMarkers, maxLabels);
      }
      return;
    }
    lastDataSignatureRef.current = signature;
    const shouldAutoscale = shouldAutoscaleOnDataUpdate(
      { xRange: spec.xRange, yRange: spec.yRange },
      hasViewRanges(customViewRangesRef.current),
    );
    chartRef.current.setData(alignedData, shouldAutoscale);
    if (hasViewRanges(customViewRangesRef.current)) {
      applyViewRanges(chartRef.current, customViewRangesRef.current);
    } else if (!shouldAutoscale) {
      applyDataUpdateScales(chartRef.current, alignedData, { xRange: spec.xRange, yRange: spec.yRange });
    }
    if (overlayRef.current) {
      renderTagOverlay(chartRef.current, overlayRef.current, tagMarkers, maxLabels);
    }
  }, [alignedData, frame.meta?.sequence, frame.meta?.state, maxLabels, spec.xRange, spec.yRange, tagMarkers]);

  useEffect(() => {
    if (!chartRef.current) {
      return;
    }
    customViewRangesRef.current = {};
    chartRef.current.setData(alignedDataRef.current, true);
    applyDataUpdateScales(chartRef.current, alignedDataRef.current, { xRange: spec.xRange, yRange: spec.yRange });
    if (overlayRef.current) {
      renderTagOverlay(chartRef.current, overlayRef.current, tagMarkersRef.current, maxLabelsRef.current);
    }
  }, [spec.xRange, spec.yRange, viewResetKey]);

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden rounded border border-slate-800 bg-slate-950">
      <div ref={plotHostRef} className="h-full min-h-0 w-full" />
      <div ref={overlayRef} className="pointer-events-none absolute inset-0 overflow-hidden" />
    </div>
  );
}
