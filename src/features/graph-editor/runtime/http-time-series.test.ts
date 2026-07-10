import { describe, expect, it } from 'vitest';
import {
  buildHttpTimeSeriesSnapshotUrl,
  isHttpTimeSeriesSink,
  parseHttpTimeSeriesSnapshot,
} from './http-time-series';

describe('http-time-series helpers', () => {
  it('detects HttpTimeSeriesSink by block type id', () => {
    expect(isHttpTimeSeriesSink('gr::blocks::HttpTimeSeriesSink<float32>')).toBe(true);
    expect(isHttpTimeSeriesSink('gr::blocks::NullSink<float32>')).toBe(false);
  });

  it('builds snapshot URL from parameters with bind_host fallback', () => {
    const url = buildHttpTimeSeriesSnapshotUrl(
      {
        bind_host: '"0.0.0.0"',
        bind_port: '18081',
        snapshot_path: 'snapshot',
      },
      '127.0.0.1',
    );
    expect(url).toBe('http://127.0.0.1:18081/snapshot');
  });

  it('parses float payload channel series', () => {
    const snapshot = parseHttpTimeSeriesSnapshot(
      {
        sample_type: 'float32',
        channels: 2,
        samples_per_channel: 3,
        layout: 'channels_first',
        data: [
          [0.1, 0.2, 0.3],
          [1.1, 1.2, 1.3],
        ],
      },
      'magnitude',
    );

    expect(snapshot.channelCount).toBe(2);
    expect(snapshot.samplesPerChannel).toBe(3);
    expect(snapshot.seriesByChannel[0]).toEqual([0.1, 0.2, 0.3]);
    expect(snapshot.seriesByChannel[1]).toEqual([1.1, 1.2, 1.3]);
    expect(snapshot.tags).toBeUndefined();
  });

  it('parses optional generic plot tags', () => {
    const snapshot = parseHttpTimeSeriesSnapshot(
      {
        sample_type: 'float32',
        channels: 1,
        samples_per_channel: 3,
        layout: 'channels_first',
        data: [[0.1, 0.2, 0.3]],
        tags: [
          {
            offset: 2,
            key: 'threshold_crossing',
            value: true,
            metadata: {
              confidence: 0.93,
            },
          },
        ],
      },
      'magnitude',
    );

    expect(snapshot.tags).toEqual([
      {
        offset: 2,
        key: 'threshold_crossing',
        label: 'threshold_crossing',
        value: true,
        metadata: {
          confidence: 0.93,
        },
      },
    ]);
  });

  it('parses complex payload using requested view mode', () => {
    const payload = {
      sample_type: 'complex64',
      channels: 1,
      samples_per_channel: 3,
      layout: 'channels_first_interleaved_complex',
      data: [[1, 2, 3, 4, 5, 6]],
    };

    const real = parseHttpTimeSeriesSnapshot(payload, 'real');
    const imag = parseHttpTimeSeriesSnapshot(payload, 'imag');
    const magnitude = parseHttpTimeSeriesSnapshot(payload, 'magnitude');

    expect(real.seriesByChannel[0]).toEqual([1, 3, 5]);
    expect(imag.seriesByChannel[0]).toEqual([2, 4, 6]);
    expect(magnitude.seriesByChannel[0][0]).toBeCloseTo(Math.sqrt(5), 6);
  });

  it('fails explicitly for malformed payload shape', () => {
    expect(() => parseHttpTimeSeriesSnapshot({ layout: 'channels_first', data: [] }, 'magnitude')).toThrow(
      'Snapshot sample_type is missing.',
    );
    expect(() => parseHttpTimeSeriesSnapshot({ sample_type: 'float32', data: [] }, 'magnitude')).toThrow(
      'Snapshot layout is missing.',
    );
    expect(() =>
      parseHttpTimeSeriesSnapshot(
        {
          sample_type: 'float32',
          layout: 'channels_first',
          data: [[1, 'x']],
        },
        'magnitude',
      ),
    ).toThrow('Snapshot channel 0 contains non-numeric values.');
    expect(() =>
      parseHttpTimeSeriesSnapshot(
        {
          sample_type: 'complex64',
          layout: 'channels_first_interleaved_complex',
          data: [[1, 2, 3]],
        },
        'magnitude',
      ),
    ).toThrow('Snapshot channel 0 has odd interleaved complex value count.');
    expect(() =>
      parseHttpTimeSeriesSnapshot(
        {
          sample_type: 'float32',
          layout: 'channels_first',
          data: [[1, 2]],
          tags: [{ offset: 1 }],
        },
        'magnitude',
      ),
    ).toThrow('Plot tag key must be a non-empty string.');
  });
});
