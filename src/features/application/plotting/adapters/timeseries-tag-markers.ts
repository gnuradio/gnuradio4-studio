import type { PlotTagAnnotation } from '../model/types';
import type { NormalizedTimeseriesData } from './timeseries-uplot-adapter';

export type PlotTagMarker = {
  kind: 'vertical' | 'point';
  tag: PlotTagAnnotation;
  x: number;
  y?: number;
};

function tagXCoordinate(tag: PlotTagAnnotation): number | undefined {
  if (typeof tag.x === 'number' && Number.isFinite(tag.x)) {
    return tag.x;
  }
  if (typeof tag.offset === 'number' && Number.isFinite(tag.offset)) {
    return tag.offset;
  }
  return undefined;
}

function finiteExtent(values: readonly number[]): { min: number; max: number } | null {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const value of values) {
    if (!Number.isFinite(value)) {
      continue;
    }
    min = Math.min(min, value);
    max = Math.max(max, value);
  }
  return Number.isFinite(min) && Number.isFinite(max) ? { min, max } : null;
}

export function buildPlotTagMarkers(
  tags: readonly PlotTagAnnotation[] | undefined,
  normalized: NormalizedTimeseriesData,
  xyRenderMode: 'line' | 'scatter',
): PlotTagMarker[] {
  if (!tags || tags.length === 0 || normalized.x.length === 0) {
    return [];
  }

  const xExtent = finiteExtent(normalized.x);
  const markers: PlotTagMarker[] = [];
  for (const tag of tags) {
    const explicitX = tagXCoordinate(tag);
    if (explicitX === undefined || !Number.isFinite(explicitX)) {
      continue;
    }
    if (xExtent && (explicitX < xExtent.min || explicitX > xExtent.max)) {
      continue;
    }

    if (typeof tag.y === 'number' && Number.isFinite(tag.y)) {
      markers.push({
        kind: 'point',
        tag,
        x: explicitX,
        y: tag.y,
      });
      continue;
    }

    if (xyRenderMode === 'scatter' && typeof tag.offset === 'number') {
      const index = Math.round(tag.offset);
      const y = normalized.yBySeries[0]?.[index];
      const x = normalized.x[index];
      if (Number.isFinite(x) && Number.isFinite(y)) {
        markers.push({
          kind: 'point',
          tag,
          x: x as number,
          y: y as number,
        });
        continue;
      }
    }

    markers.push({
      kind: 'vertical',
      tag,
      x: explicitX,
    });
  }

  return markers;
}
