import type { PlotTagAnnotation } from '../../application/plotting/model/types';
import { parsePlotTags } from './plot-tags';

export type ComplexViewMode = 'magnitude' | 'real' | 'imag';

export type HttpTimeSeriesSnapshot = {
  sampleType: string;
  channelCount: number;
  samplesPerChannel: number;
  layout: string;
  seriesByChannel: number[][];
  tags?: PlotTagAnnotation[];
};

const HTTP_TIME_SERIES_BLOCK_NAME = 'HttpTimeSeriesSink';

function coerceString(value?: string): string {
  if (!value) {
    return '';
  }

  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function coerceInteger(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isHttpTimeSeriesSink(blockTypeId: string): boolean {
  return blockTypeId.includes(HTTP_TIME_SERIES_BLOCK_NAME);
}

export function buildHttpTimeSeriesSnapshotUrl(
  parameterValues: Record<string, string>,
  fallbackHost?: string,
): string {
  const configuredHost = coerceString(parameterValues.bind_host) || '127.0.0.1';
  const host =
    configuredHost === '0.0.0.0' || configuredHost === '::'
      ? fallbackHost || '127.0.0.1'
      : configuredHost;
  const port = coerceInteger(coerceString(parameterValues.bind_port), 8080);
  const rawPath = coerceString(parameterValues.snapshot_path) || '/snapshot';
  const path = rawPath.startsWith('/') ? rawPath : `/${rawPath}`;

  return `http://${host}:${port}${path}`;
}

function toSeriesFromComplexChannel(values: unknown[], viewMode: ComplexViewMode): number[] {
  const numeric = values.filter((value) => typeof value === 'number') as number[];
  const series: number[] = [];

  for (let index = 0; index < numeric.length; index += 2) {
    const real = numeric[index] ?? 0;
    const imag = numeric[index + 1] ?? 0;

    if (viewMode === 'real') {
      series.push(real);
      continue;
    }
    if (viewMode === 'imag') {
      series.push(imag);
      continue;
    }

    series.push(Math.sqrt(real * real + imag * imag));
  }

  return series;
}

export function parseHttpTimeSeriesSnapshot(
  payload: unknown,
  complexViewMode: ComplexViewMode,
): HttpTimeSeriesSnapshot {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Snapshot payload is not an object.');
  }

  const record = payload as Record<string, unknown>;
  const sampleType = typeof record.sample_type === 'string' ? record.sample_type : null;
  const layout = typeof record.layout === 'string' ? record.layout : null;
  const data = Array.isArray(record.data) ? record.data : null;

  if (!sampleType) {
    throw new Error('Snapshot sample_type is missing.');
  }
  if (!layout) {
    throw new Error('Snapshot layout is missing.');
  }
  if (!data) {
    throw new Error('Snapshot data is missing.');
  }

  const isComplex = sampleType.includes('complex') || layout.includes('complex');
  const seriesByChannel = data.map((channelValues, channelIndex) => {
    if (!Array.isArray(channelValues)) {
      throw new Error(`Snapshot channel ${channelIndex} is not an array.`);
    }
    if (!channelValues.every((value) => typeof value === 'number' && Number.isFinite(value))) {
      throw new Error(`Snapshot channel ${channelIndex} contains non-numeric values.`);
    }

    if (isComplex) {
      if (channelValues.length % 2 !== 0) {
        throw new Error(`Snapshot channel ${channelIndex} has odd interleaved complex value count.`);
      }
      return toSeriesFromComplexChannel(channelValues, complexViewMode);
    }

    return channelValues as number[];
  });

  const channelCount =
    typeof record.channels === 'number'
      ? record.channels
      : seriesByChannel.length;
  const samplesPerChannel =
    typeof record.samples_per_channel === 'number'
      ? record.samples_per_channel
      : Math.max(0, ...seriesByChannel.map((series) => series.length));

  const tags = parsePlotTags(record);
  return {
    sampleType,
    channelCount,
    samplesPerChannel,
    layout,
    seriesByChannel,
    ...(tags ? { tags } : {}),
  };
}
