import { darkTokens } from '../../../themes/tokens';
import { useTheme } from '../../../themes/theme-store';
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import type { PlotAdapterProps } from '../model/types';
import {
  assertTimeseriesAdapterShape,
  buildEmptyAlignedData,
  normalizeSeriesData,
} from './timeseries-uplot-adapter';
import {
  buildPhosphorSpectrumRaster,
  DEFAULT_PHOSPHOR_SPECTRUM_TUNING,
  type PhosphorSpectrumBuffer,
  type PhosphorSpectrumRaster,
  updatePhosphorSpectrumBuffer,
} from './phosphor-spectrum-rendering';

const PHOSPHOR_BUFFER_HEIGHT = 128;

function toNumberArray(values: number[] | Float32Array | Float64Array): number[] {
  return Array.isArray(values) ? values : Array.from(values);
}

function resolveValueRange(values: readonly number[], manualRange?: { min?: number; max?: number; auto?: boolean }): { min: number; max: number } {
  if (
    manualRange?.auto === false &&
    Number.isFinite(manualRange.min) &&
    Number.isFinite(manualRange.max) &&
    (manualRange.max as number) > (manualRange.min as number)
  ) {
    return {
      min: manualRange.min as number,
      max: manualRange.max as number,
    };
  }

  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) {
    return { min: 0, max: 1 };
  }

  return {
    min: Math.min(...finite),
    max: Math.max(...finite),
  };
}

function shouldResetScalesForDataUpdate(ranges: Pick<PlotAdapterProps['spec'], 'xRange' | 'yRange'>): boolean {
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

function applyExplicitScales(chart: uPlot, ranges: Pick<PlotAdapterProps['spec'], 'xRange' | 'yRange'>): void {
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
  ranges: Pick<PlotAdapterProps['spec'], 'xRange' | 'yRange'>,
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

export function drawPhosphorSpectrumRaster(params: {
  ctx: CanvasRenderingContext2D;
  bbox: uPlot.BBox;
  raster: PhosphorSpectrumRaster | null;
  background?: string;
  offscreenCanvasRef: MutableRefObject<HTMLCanvasElement | null>;
}): void {
  const { ctx, bbox, raster, offscreenCanvasRef } = params;
  ctx.save();
  ctx.beginPath();
  ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height);
  ctx.clip();
  ctx.fillStyle = params.background ?? darkTokens['canvas.background'];
  ctx.fillRect(bbox.left, bbox.top, bbox.width, bbox.height);

  if (raster && raster.width > 0 && raster.height > 0) {
    if (
      !offscreenCanvasRef.current ||
      offscreenCanvasRef.current.width !== raster.width ||
      offscreenCanvasRef.current.height !== raster.height
    ) {
      offscreenCanvasRef.current = document.createElement('canvas');
    }

    const sourceCanvas = offscreenCanvasRef.current;
    sourceCanvas.width = raster.width;
    sourceCanvas.height = raster.height;
    const sourceContext = sourceCanvas.getContext('2d');
    if (sourceContext) {
      const imageData = sourceContext.createImageData(raster.width, raster.height);
      imageData.data.set(raster.pixels);
      sourceContext.putImageData(imageData, 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(sourceCanvas, bbox.left, bbox.top, bbox.width, bbox.height);
    }
  }

  ctx.restore();
}

export function PhosphorSpectrumUplotAdapter({ spec, frame, width, height }: PlotAdapterProps) {
  const theme = useTheme();
  const minWidth = 180;
  const minHeight = 120;
  const canRender = width >= minWidth && height >= minHeight;
  const showLegend = (spec.legend ?? true) && width >= 420 && height >= 220;
  const plotHostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<uPlot | null>(null);
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const phosphorBufferRef = useRef<PhosphorSpectrumBuffer | null>(null);
  const lastDataSignatureRef = useRef<string>('');
  const lastSequenceRef = useRef<number>(-1);
  const lastUpdateMsRef = useRef<number>(0);
  const rasterRef = useRef<PhosphorSpectrumRaster | null>(null);
  const normalized = useMemo(
    () => normalizeSeriesData(frame.series, spec.xMode, spec.windowSize, 'line'),
    [frame.series, spec.windowSize, spec.xMode],
  );
  if (import.meta.env.DEV) {
    assertTimeseriesAdapterShape(normalized);
  }

  const currentSpectrum = normalized.yBySeries[0] ?? [];
  const valueRange = resolveValueRange(toNumberArray(currentSpectrum), spec.yRange);
  const phosphorTuning = spec.phosphor ?? DEFAULT_PHOSPHOR_SPECTRUM_TUNING;
  const seriesLabelSignature = useMemo(() => normalized.labels.join('|'), [normalized.labels]);
  const alignedData = useMemo<uPlot.AlignedData>(
    () => [normalized.x, ...normalized.yBySeries],
    [normalized.x, normalized.yBySeries],
  );
  const seriesOptions = useMemo(
    () => [
      {},
      ...(
        seriesLabelSignature.length > 0 ? seriesLabelSignature.split('|') : ['Phosphor Spectrum']
      ).map((label) => ({
        label,
        stroke: theme.tokens['app.text'],
        width: 1,
        points: {
          show: false,
        },
      })),
    ],
    [seriesLabelSignature, theme],
  );

  useEffect(() => {
    phosphorBufferRef.current = null;
    rasterRef.current = null;
    lastSequenceRef.current = -1;
    lastDataSignatureRef.current = '';
    lastUpdateMsRef.current = 0;
  }, [spec.kind, phosphorTuning]);

  useEffect(() => {
    if ((frame.meta?.state ?? 'no-data') !== 'ready' || currentSpectrum.length === 0) {
      return;
    }

    const sequence = frame.meta?.sequence ?? -1;
    if (sequence !== lastSequenceRef.current) {
      lastSequenceRef.current = sequence;
      const nowMs = frame.meta?.emittedAtMs ?? performance.now();
      const elapsedMs = lastUpdateMsRef.current > 0 ? Math.max(16, nowMs - lastUpdateMsRef.current) : 16;
      phosphorBufferRef.current = updatePhosphorSpectrumBuffer({
        previous: phosphorBufferRef.current,
        spectrum: currentSpectrum,
        minValue: valueRange.min,
        maxValue: valueRange.max,
        height: PHOSPHOR_BUFFER_HEIGHT,
        elapsedMs,
        tuning: phosphorTuning,
      });
      lastUpdateMsRef.current = nowMs;
    }

    rasterRef.current = buildPhosphorSpectrumRaster({
      buffer: phosphorBufferRef.current,
      colorMap: phosphorTuning.colorMap,
    });
  }, [
    currentSpectrum,
    frame.meta?.sequence,
    frame.meta?.state,
    phosphorTuning,
    valueRange.max,
    valueRange.min,
  ]);

  useEffect(() => {
    const host = plotHostRef.current;
    if (!host) {
      return;
    }

    if (!canRender) {
      chartRef.current?.destroy();
      chartRef.current = null;
      return;
    }

    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

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
                  range: [spec.xRange.min ?? 0, spec.xRange.max ?? 1],
                }
              : {
                  time: spec.xMode === 'time',
                },
          y:
            spec.yRange?.auto === false
              ? {
                  auto: false,
                  range: [spec.yRange.min ?? valueRange.min, spec.yRange.max ?? valueRange.max],
                }
              : {},
        },
        axes: [
          {
            label: spec.xLabel ?? 'Frequency',
            stroke: theme.tokens['app.textSecondary'],
            grid: {
              stroke: theme.tokens['canvas.grid'],
              width: 1,
            },
          },
          {
            label: spec.yLabel ?? 'Power',
            stroke: theme.tokens['app.textSecondary'],
            grid: {
              stroke: theme.tokens['canvas.grid'],
              width: 1,
            },
          },
        ],
        hooks: {
          drawClear: [
            (self: uPlot) => {
              drawPhosphorSpectrumRaster({
                ctx: self.ctx,
                bbox: self.bbox,
                raster: rasterRef.current,
                offscreenCanvasRef,
                background: theme.tokens['canvas.background'],
              });
            },
          ],
        },
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
    };
  }, [
    theme,
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
    valueRange.max,
    valueRange.min,
  ]);

  useEffect(() => {
    if (!chartRef.current || !canRender) {
      return;
    }
    const nextWidth = Math.max(minWidth, Math.floor(width));
    const nextHeight = Math.max(minHeight, Math.floor(height));
    chartRef.current.setSize({ width: nextWidth, height: nextHeight });
  }, [canRender, height, minHeight, minWidth, width]);

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
      return;
    }
    lastDataSignatureRef.current = signature;
    chartRef.current.setData(alignedData, shouldResetScalesForDataUpdate({ xRange: spec.xRange, yRange: spec.yRange }));
    if (!shouldResetScalesForDataUpdate({ xRange: spec.xRange, yRange: spec.yRange })) {
      applyDataUpdateScales(chartRef.current, alignedData, { xRange: spec.xRange, yRange: spec.yRange });
    }
  }, [alignedData, frame.meta?.sequence, frame.meta?.state, spec.xRange, spec.yRange]);

  return <div ref={plotHostRef} className="h-full min-h-0 w-full overflow-hidden rounded border border-slate-800 bg-slate-950" />;
}
