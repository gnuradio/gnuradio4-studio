import type { PlotImageFrame } from '../model/types';

export type WaterfallColorStop = {
  position: number;
  color: [number, number, number];
};

export const TURBO_WATERFALL_COLOR_STOPS: readonly WaterfallColorStop[] = [
  { position: 0.0, color: [8, 17, 32] },
  { position: 0.12, color: [24, 30, 84] },
  { position: 0.28, color: [56, 76, 172] },
  { position: 0.45, color: [19, 145, 168] },
  { position: 0.62, color: [42, 183, 117] },
  { position: 0.78, color: [240, 188, 57] },
  { position: 0.9, color: [242, 124, 34] },
  { position: 1.0, color: [238, 70, 61] },
] as const;

export const GRAYSCALE_WATERFALL_COLOR_STOPS: readonly WaterfallColorStop[] = [
  { position: 0.0, color: [0, 0, 0] },
  { position: 1.0, color: [255, 255, 255] },
] as const;

export const VIRIDIS_WATERFALL_COLOR_STOPS: readonly WaterfallColorStop[] = [
  { position: 0.0, color: [68, 1, 84] },
  { position: 0.13, color: [72, 35, 116] },
  { position: 0.28, color: [64, 67, 135] },
  { position: 0.43, color: [52, 94, 141] },
  { position: 0.58, color: [41, 120, 142] },
  { position: 0.72, color: [32, 144, 140] },
  { position: 0.86, color: [34, 168, 132] },
  { position: 1.0, color: [253, 231, 37] },
] as const;

export function resolveWaterfallColorStops(colorMap?: string): readonly WaterfallColorStop[] {
  const normalized = colorMap?.trim().toLowerCase();
  if (normalized === 'grayscale' || normalized === 'grey' || normalized === 'gray') {
    return GRAYSCALE_WATERFALL_COLOR_STOPS;
  }
  if (normalized === 'viridis') {
    return VIRIDIS_WATERFALL_COLOR_STOPS;
  }
  return TURBO_WATERFALL_COLOR_STOPS;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(1, Math.max(0, value));
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function interpolateColor(left: [number, number, number], right: [number, number, number], amount: number): [number, number, number] {
  return [
    Math.round(lerp(left[0], right[0], amount)),
    Math.round(lerp(left[1], right[1], amount)),
    Math.round(lerp(left[2], right[2], amount)),
  ];
}

export function sampleWaterfallColor(
  value: number,
  minValue: number,
  maxValue: number,
  colorMap?: string,
): [number, number, number] {
  if (!Number.isFinite(value)) {
    return [6, 10, 20];
  }

  const normalized =
    maxValue > minValue ? clamp01((value - minValue) / (maxValue - minValue)) : 0.5;
  const stops = resolveWaterfallColorStops(colorMap);

  for (let index = 0; index < stops.length - 1; index += 1) {
    const left = stops[index];
    const right = stops[index + 1];
    if (normalized >= left.position && normalized <= right.position) {
      const segment = right.position - left.position || 1;
      return interpolateColor(left.color, right.color, (normalized - left.position) / segment);
    }
  }

  return stops[stops.length - 1].color;
}

export type WaterfallRaster = {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  minValue: number;
  maxValue: number;
};

function toNumberArray(values: number[] | Float32Array | Float64Array | Uint8Array): number[] {
  return Array.isArray(values) ? values : Array.from(values);
}

export function buildWaterfallRaster(image: PlotImageFrame): WaterfallRaster {
  const width = Math.max(0, Math.floor(image.width));
  const height = Math.max(0, Math.floor(image.height));
  const values = toNumberArray(image.values);
  if (width === 0 || height === 0 || values.length === 0) {
    return {
      width,
      height,
      pixels: new Uint8ClampedArray(0),
      minValue: image.minValue ?? 0,
      maxValue: image.maxValue ?? 1,
    };
  }

  if (values.length !== width * height) {
    throw new Error(`Waterfall raster shape mismatch: width=${width}, height=${height}, values=${values.length}`);
  }

  const minValue = Number.isFinite(image.minValue as number)
    ? (image.minValue as number)
    : values.reduce((min, value) => Math.min(min, value), Number.POSITIVE_INFINITY);
  const maxValue = Number.isFinite(image.maxValue as number)
    ? (image.maxValue as number)
    : values.reduce((max, value) => Math.max(max, value), Number.NEGATIVE_INFINITY);
  const resolvedMin = Number.isFinite(minValue) ? minValue : 0;
  const resolvedMax = Number.isFinite(maxValue) ? maxValue : 1;

  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < values.length; index += 1) {
    const [r, g, b] = sampleWaterfallColor(values[index], resolvedMin, resolvedMax, image.colorMap);
    const offset = index * 4;
    pixels[offset] = r;
    pixels[offset + 1] = g;
    pixels[offset + 2] = b;
    pixels[offset + 3] = 255;
  }

  return {
    width,
    height,
    pixels,
    minValue: resolvedMin,
    maxValue: resolvedMax,
  };
}
