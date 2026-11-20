import { useTheme } from '../../../themes/theme-store';
import { useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import type { PlotAdapterProps } from '../model/types';
import type { WaterfallRaster } from './waterfall-rendering';
import { buildWaterfallRaster, resolveWaterfallColorStops } from './waterfall-rendering';

type HoverSample = {
  row: number;
  column: number;
  frequency?: number;
  value: number;
};

function toNumberArray(values: number[] | Float32Array | Float64Array | Uint8Array): number[] {
  return Array.isArray(values) ? values : Array.from(values);
}

function formatValue(value: number): string {
  if (!Number.isFinite(value)) {
    return 'n/a';
  }
  if (Math.abs(value) >= 1000 || Math.abs(value) < 0.01) {
    return value.toExponential(2);
  }
  return value.toFixed(2);
}

function formatAxisValue(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) {
    return 'n/a';
  }
  if (Math.abs(value) >= 1000 || Math.abs(value) < 0.01) {
    return value.toExponential(2);
  }
  return value.toFixed(2);
}

export function calculateWaterfallCanvasDimensions(params: {
  width: number;
  height: number;
  devicePixelRatio: number;
}): { pixelWidth: number; pixelHeight: number } {
  return {
    pixelWidth: Math.max(1, Math.floor(params.width * params.devicePixelRatio)),
    pixelHeight: Math.max(1, Math.floor(params.height * params.devicePixelRatio)),
  };
}

export function resolveWaterfallHoverSample(params: {
  raster: WaterfallRaster | null;
  sourceValues: readonly number[];
  frequencyBins?: readonly number[];
  rect: { width: number; height: number };
  clientX: number;
  clientY: number;
}): HoverSample | null {
  const { raster, sourceValues, frequencyBins, rect, clientX, clientY } = params;
  if (!raster || raster.width === 0 || raster.height === 0 || sourceValues.length === 0) {
    return null;
  }
  if (rect.width <= 0 || rect.height <= 0) {
    return null;
  }

  const localX = Math.max(0, Math.min(rect.width, clientX));
  const localY = Math.max(0, Math.min(rect.height, clientY));
  const column = Math.min(raster.width - 1, Math.max(0, Math.floor((localX / rect.width) * raster.width)));
  const row = Math.min(raster.height - 1, Math.max(0, Math.floor((localY / rect.height) * raster.height)));
  const value = sourceValues[row * raster.width + column] ?? Number.NaN;
  return {
    row,
    column,
    frequency: frequencyBins?.[column],
    value,
  };
}

export function WaterfallCanvasAdapter({ frame, width, height }: PlotAdapterProps) {
  const theme = useTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);

  const image = frame.image;
  const raster = useMemo(() => (image ? buildWaterfallRaster(image) : null), [image]);
  const sourceValues = useMemo(
    () => (image ? toNumberArray(image.values) : []),
    [image],
  );
  const frequencyBins = useMemo(
    () => (image?.xAxis ? toNumberArray(image.xAxis) : undefined),
    [image],
  );
  const hover = useMemo(() => pointer ? resolveWaterfallHoverSample({
    raster, sourceValues, frequencyBins,
    rect: { width: 1, height: 1 }, clientX: pointer.x, clientY: pointer.y,
  }) : null, [pointer, raster, sourceValues, frequencyBins]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !raster || width <= 0 || height <= 0) {
      return;
    }

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const canvasSize = calculateWaterfallCanvasDimensions({
      width,
      height,
      devicePixelRatio: dpr,
    });
    canvas.width = canvasSize.pixelWidth;
    canvas.height = canvasSize.pixelHeight;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const context = canvas.getContext('2d');
    if (!context) {
      return;
    }

    context.save();
    context.scale(dpr, dpr);
    context.clearRect(0, 0, width, height);
    context.fillStyle = theme.tokens['canvas.background'];
    context.fillRect(0, 0, width, height);

    if (raster.width > 0 && raster.height > 0) {
      if (!offscreenRef.current || offscreenRef.current.width !== raster.width || offscreenRef.current.height !== raster.height) {
        offscreenRef.current = document.createElement('canvas');
      }

      const sourceCanvas = offscreenRef.current;
      sourceCanvas.width = raster.width;
      sourceCanvas.height = raster.height;
      const sourceContext = sourceCanvas.getContext('2d');
      if (sourceContext) {
        const imageData = sourceContext.createImageData(raster.width, raster.height);
        imageData.data.set(raster.pixels);
        sourceContext.putImageData(imageData, 0, 0);
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';
        context.drawImage(sourceCanvas, 0, 0, width, height);
      }
    }

    context.restore();
  }, [height, raster, width, theme]);

  const onPointerMove = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    setPointer({
      x: (event.clientX - rect.left) / rect.width,
      y: (event.clientY - rect.top) / rect.height,
    });
  };

  const onPointerLeave = () => {
    setPointer(null);
  };

  return (
    <div className="relative h-full w-full overflow-hidden rounded border border-slate-800 bg-slate-950 shadow-sm">
      <canvas
        ref={canvasRef}
        className="block h-full w-full"
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
      />

      {raster ? (
        <div
          className="pointer-events-none absolute bottom-2 right-2 w-32 max-w-[calc(100%-1rem)] rounded border border-slate-700/80 bg-slate-950/80 px-2 py-1 text-xs text-slate-300"
          role="img"
          aria-label={`Intensity: ${formatValue(raster.minValue)} to ${formatValue(raster.maxValue)} ${image?.signalUnit ?? ''}`}
        >
          <div
            className="h-1.5 rounded-sm"
            style={{
              background: `linear-gradient(to right, ${resolveWaterfallColorStops(image?.colorMap)
                .map(({ position, color }) => `rgb(${color.join(', ')}) ${position * 100}%`).join(', ')})`,
            }}
          />
          <div className="mt-0.5 flex justify-between gap-1 font-mono">
            <span>{formatValue(raster.minValue)}</span>
            <span className="text-slate-400">{image?.signalUnit || 'Intensity'}</span>
            <span>{formatValue(raster.maxValue)}</span>
          </div>
        </div>
      ) : null}

      {hover ? (
        <div className="pointer-events-none absolute right-3 top-3 max-w-[16rem] rounded-md border border-cyan-500/30 bg-slate-950/90 px-2 py-1 text-xs shadow-xl backdrop-blur">
          <div className="font-mono text-slate-200">
            f={formatAxisValue(hover.frequency)} {image?.axisUnit ?? ''} · {formatValue(hover.value)} {image?.signalUnit ?? ''}
          </div>
          <div className="mt-0.5 text-slate-400">
            row {hover.row + 1}/{raster?.height ?? 0} · bin {hover.column + 1}/{raster?.width ?? 0}
            {image?.timeSpan ? ` · ${formatValue(image.timeSpan)} s` : ''}
          </div>
        </div>
      ) : null}
    </div>
  );
}
