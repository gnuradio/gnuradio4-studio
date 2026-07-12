import type { PlotSeriesFrame, PlotTagAnnotation, PlotXyRenderMode } from '../model/types';
import { parsePlotTags } from '../../../graph-editor/runtime/plot-tags';

export type HttpVectorSnapshot = {
  sampleType?: string;
  points: number;
  layout: 'pairs_xy';
  renderMode: PlotXyRenderMode;
  pointSize?: number;
  pointAlpha?: number;
  data: Array<[number, number]>;
  signalName?: string;
  signalUnit?: string;
  axisName?: string;
  axisUnit?: string;
  tags?: PlotTagAnnotation[];
};

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function parseRenderMode(value: unknown): PlotXyRenderMode {
  if (value === undefined) {
    return 'line';
  }
  if (value === 'line' || value === 'scatter') {
    return value;
  }
  throw new Error('Vector snapshot payload render_mode must be "line" or "scatter".');
}

function parseOptionalPositiveNumber(value: unknown, fieldName: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isFiniteNumber(value) || value <= 0) {
    throw new Error(`Vector snapshot payload ${fieldName} must be a positive number when present.`);
  }
  return value;
}

function parseOptionalAlpha(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isFiniteNumber(value) || value < 0 || value > 1) {
    throw new Error('Vector snapshot payload point_alpha must be within [0, 1] when present.');
  }
  return value;
}

export function parseHttpVectorSnapshot(payload: unknown): HttpVectorSnapshot {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Vector snapshot payload must be an object.');
  }

  const record = payload as Record<string, unknown>;
  const layout = record.layout;
  if (layout !== 'pairs_xy') {
    throw new Error('Vector snapshot payload layout must be pairs_xy.');
  }

  const rawData = record.data;
  if (!Array.isArray(rawData)) {
    throw new Error('Vector snapshot payload data must be an array.');
  }

  const rawPoints = record.points;
  if (!isFiniteNumber(rawPoints) || !Number.isInteger(rawPoints) || rawPoints < 0) {
    throw new Error('Vector snapshot payload points must be a non-negative integer.');
  }
  const points = rawPoints;

  const data: Array<[number, number]> = [];
  for (const item of rawData) {
    if (!Array.isArray(item) || item.length !== 2 || !isFiniteNumber(item[0]) || !isFiniteNumber(item[1])) {
      throw new Error('Vector snapshot payload entries must be numeric [x, y] pairs.');
    }
    data.push([item[0], item[1]]);
  }
  if (data.length !== points) {
    throw new Error('Vector snapshot payload points must match data length.');
  }

  const tags = parsePlotTags(record);
  return {
    sampleType: typeof record.sample_type === 'string' ? record.sample_type : undefined,
    points,
    layout,
    renderMode: parseRenderMode(record.render_mode),
    pointSize: parseOptionalPositiveNumber(record.point_size, 'point_size'),
    pointAlpha: parseOptionalAlpha(record.point_alpha),
    data,
    signalName: typeof record.signal_name === 'string' ? record.signal_name : undefined,
    signalUnit: typeof record.signal_unit === 'string' ? record.signal_unit : undefined,
    axisName: typeof record.axis_name === 'string' ? record.axis_name : undefined,
    axisUnit: typeof record.axis_unit === 'string' ? record.axis_unit : undefined,
    ...(tags ? { tags } : {}),
  };
}

export function parseHttpDatasetXySnapshot(payload: unknown): HttpVectorSnapshot {
  const parsed = parseHttpVectorSnapshot(payload);
  const record = payload as Record<string, unknown>;
  if (record.payload_format !== 'dataset-xy-json-v1') {
    throw new Error('Dataset payload format must be dataset-xy-json-v1.');
  }
  return parsed;
}

export function mapSnapshotToVectorPlotSeriesFrames(
  snapshot: HttpVectorSnapshot,
  seriesLabel?: string,
): PlotSeriesFrame[] {
  const x = snapshot.data.map((point) => point[0]);
  const y = snapshot.data.map((point) => point[1]);
  return [
    {
      id: 'vector',
      label: seriesLabel?.trim() || snapshot.signalName?.trim() || 'vector',
      x,
      y,
    },
  ];
}
