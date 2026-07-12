import type { PlotTagAnnotation, PlotTagValue } from '../../application/plotting/model/types';

const MAX_PLOT_TAGS = 64;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isTagValue(value: unknown): value is PlotTagValue {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function parseTagMetadata(value: unknown): Record<string, PlotTagValue> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Plot tag metadata must be an object when present.');
  }

  const metadata: Record<string, PlotTagValue> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!isTagValue(item)) {
      throw new Error('Plot tag metadata values must be string, number, boolean, or null.');
    }
    metadata[key] = item;
  }
  return metadata;
}

export function parsePlotTags(record: Record<string, unknown>): PlotTagAnnotation[] | undefined {
  const rawTags = record.tags;
  if (rawTags === undefined) {
    return undefined;
  }
  if (!Array.isArray(rawTags)) {
    throw new Error('Plot tags must be an array when present.');
  }

  const tags: PlotTagAnnotation[] = [];
  for (const rawTag of rawTags.slice(0, MAX_PLOT_TAGS)) {
    if (!rawTag || typeof rawTag !== 'object' || Array.isArray(rawTag)) {
      throw new Error('Plot tag entries must be objects.');
    }

    const tagRecord = rawTag as Record<string, unknown>;
    const key = typeof tagRecord.key === 'string' ? tagRecord.key.trim() : '';
    if (!key) {
      throw new Error('Plot tag key must be a non-empty string.');
    }

    const offset = tagRecord.offset === undefined ? undefined : tagRecord.offset;
    const x = tagRecord.x === undefined ? undefined : tagRecord.x;
    const y = tagRecord.y === undefined ? undefined : tagRecord.y;
    if (offset !== undefined && !isFiniteNumber(offset)) {
      throw new Error('Plot tag offset must be a finite number when present.');
    }
    if (x !== undefined && !isFiniteNumber(x)) {
      throw new Error('Plot tag x must be a finite number when present.');
    }
    if (y !== undefined && !isFiniteNumber(y)) {
      throw new Error('Plot tag y must be a finite number when present.');
    }
    if (offset === undefined && x === undefined) {
      throw new Error('Plot tag requires a finite offset or x coordinate.');
    }

    const value = tagRecord.value;
    if (value !== undefined && !isTagValue(value)) {
      throw new Error('Plot tag value must be string, number, boolean, or null when present.');
    }

    const metadata = parseTagMetadata(tagRecord.metadata);
    tags.push({
      key,
      label: typeof tagRecord.label === 'string' && tagRecord.label.trim() ? tagRecord.label.trim() : key,
      ...(offset !== undefined ? { offset } : {}),
      ...(x !== undefined ? { x } : {}),
      ...(y !== undefined ? { y } : {}),
      ...(value !== undefined ? { value } : {}),
      ...(metadata !== undefined ? { metadata } : {}),
    });
  }

  return tags;
}
