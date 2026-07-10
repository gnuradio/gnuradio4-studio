import { useEffect, useMemo, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { PlotAdapterProps, PlotSeriesFrame, PlotTagAnnotation, PlotViewSpec } from '../model/types';
import { STUDIO_BUILTIN_PLOT_PALETTES } from '../model/plot-style';
import { buildPlotTagMarkers, type PlotTagMarker } from './timeseries-tag-markers';

const AXIS_STROKE = '#94a3b8';
const GRID_STROKE = '#334155';

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

function shouldResetScalesForDataUpdate(ranges: Pick<PlotViewSpec, 'xRange' | 'yRange'>): boolean {
  return ranges.xRange?.auto !== false && ranges.yRange?.auto !== false;
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
    chart.setScale('x', {
      min: ranges.xRange.min ?? 0,
      max: ranges.xRange.max ?? 1,
    });
  }
  if (ranges.yRange?.auto === false) {
    chart.setScale('y', {
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
    chart.setScale('x', {
      min: ranges.xRange.min ?? 0,
      max: ranges.xRange.max ?? 1,
    });
  } else {
    const xExtent = finiteExtent((data[0] ?? []) as readonly number[]);
    if (xExtent) {
      chart.setScale('x', xExtent);
    }
  }

  if (ranges.yRange?.auto === false) {
    chart.setScale('y', {
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
      chart.setScale('y', yExtent);
    }
  }
}

export function TimeseriesUplotAdapter({ spec, frame, width, height }: PlotAdapterProps) {
  const minWidth = 180;
  const minHeight = 120;
  const canRender = width >= minWidth && height >= minHeight;
  const showLegend = (spec.legend ?? true) && width >= 420 && height >= 220;
  const plotHostRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<uPlot | null>(null);
  const lastDataSignatureRef = useRef<string>('');
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
        scales: {
          x:
            spec.xRange?.auto === false
              ? {
                  time: spec.xMode === 'time',
                  auto: false,
                  range: [
                    spec.xRange.min ?? 0,
                    spec.xRange.max ?? 1,
                  ],
                }
              : {
                  time: spec.xMode === 'time',
                },
          y:
            spec.yRange?.auto === false
              ? {
                  auto: false,
                  range: [
                    spec.yRange.min ?? 0,
                    spec.yRange.max ?? 1,
                  ],
                }
              : {},
        },
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
      },
      buildEmptyAlignedData(seriesOptions.length - 1),
      host,
    );
    applyExplicitScales(chart, { xRange: spec.xRange, yRange: spec.yRange });
    chartRef.current = chart;
    lastDataSignatureRef.current = '';

    return () => {
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
      applyDataUpdateScales(chartRef.current, alignedData, { xRange: spec.xRange, yRange: spec.yRange });
      if (overlayRef.current) {
        renderTagOverlay(chartRef.current, overlayRef.current, tagMarkers, maxLabels);
      }
      return;
    }
    lastDataSignatureRef.current = signature;
    chartRef.current.setData(alignedData, shouldResetScalesForDataUpdate({ xRange: spec.xRange, yRange: spec.yRange }));
    if (!shouldResetScalesForDataUpdate({ xRange: spec.xRange, yRange: spec.yRange })) {
      applyDataUpdateScales(chartRef.current, alignedData, { xRange: spec.xRange, yRange: spec.yRange });
    }
    if (overlayRef.current) {
      renderTagOverlay(chartRef.current, overlayRef.current, tagMarkers, maxLabels);
    }
  }, [alignedData, frame.meta?.sequence, frame.meta?.state, maxLabels, spec.xRange, spec.yRange, tagMarkers]);

  return (
    <div className="relative h-full min-h-0 w-full overflow-hidden rounded border border-slate-800 bg-slate-950">
      <div ref={plotHostRef} className="h-full min-h-0 w-full" />
      <div ref={overlayRef} className="pointer-events-none absolute inset-0 overflow-hidden" />
    </div>
  );
}
