import { describe, expect, it } from 'vitest';
import { mapSnapshotToVectorPlotSeriesFrames, parseHttpDatasetXySnapshot, parseHttpVectorSnapshot } from './vector-frame';

describe('vector frame parsing', () => {
  it('parses pairs_xy vector payload', () => {
    const parsed = parseHttpVectorSnapshot({
      sample_type: 'float32',
      points: 3,
      layout: 'pairs_xy',
      data: [
        [0, 1],
        [1, 3],
        [2, 5],
      ],
    });

    expect(parsed.layout).toBe('pairs_xy');
    expect(parsed.points).toBe(3);
    expect(parsed.renderMode).toBe('line');
    expect(parsed.data).toEqual([
      [0, 1],
      [1, 3],
      [2, 5],
    ]);
  });

  it('maps vector payload to one renderable series with x/y arrays', () => {
    const mapped = mapSnapshotToVectorPlotSeriesFrames(
      {
        layout: 'pairs_xy',
        points: 3,
        renderMode: 'line',
        data: [
          [10, 1],
          [20, 2],
          [30, 3],
        ],
      },
      'spectrum',
    );

    expect(mapped).toEqual([
      {
        id: 'vector',
        label: 'spectrum',
        x: [10, 20, 30],
        y: [1, 2, 3],
      },
    ]);
  });

  it('parses dataset-xy payload format and metadata', () => {
    const parsed = parseHttpDatasetXySnapshot({
      payload_format: 'dataset-xy-json-v1',
      layout: 'pairs_xy',
      points: 2,
      signal_name: 'Magnitude',
      signal_unit: 'dB',
      axis_name: 'Frequency',
      axis_unit: 'Hz',
      data: [
        [10, 1],
        [20, 2],
      ],
    });

    expect(parsed.signalName).toBe('Magnitude');
    expect(parsed.renderMode).toBe('line');
    expect(parsed.signalUnit).toBe('dB');
    expect(parsed.axisName).toBe('Frequency');
    expect(parsed.axisUnit).toBe('Hz');
    expect(mapSnapshotToVectorPlotSeriesFrames(parsed)[0].label).toBe('Magnitude');
  });

  it('rejects malformed dataset payload format', () => {
    expect(() =>
      parseHttpDatasetXySnapshot({
        payload_format: 'series2d-xy-json-v1',
        layout: 'pairs_xy',
        points: 1,
        data: [[0, 0]],
      }),
    ).toThrow('Dataset payload format must be dataset-xy-json-v1.');
  });

  it('fails explicitly for malformed vector payload shape', () => {
    expect(() =>
      parseHttpVectorSnapshot({
        layout: 'pairs_xy',
        data: [[0, 0]],
      }),
    ).toThrow('Vector snapshot payload points must be a non-negative integer.');

    expect(() =>
      parseHttpVectorSnapshot({
        layout: 'pairs_xy',
        points: 2,
        data: [[0, 0]],
      }),
    ).toThrow('Vector snapshot payload points must match data length.');
  });

  it('parses scatter render_mode and style hints', () => {
    const parsed = parseHttpVectorSnapshot({
      layout: 'pairs_xy',
      points: 2,
      render_mode: 'scatter',
      point_size: 5.5,
      point_alpha: 0.6,
      data: [
        [-1, 1],
        [1, -1],
      ],
    });

    expect(parsed.renderMode).toBe('scatter');
    expect(parsed.pointSize).toBe(5.5);
    expect(parsed.pointAlpha).toBe(0.6);
  });

  it('parses optional generic XY plot tags', () => {
    const parsed = parseHttpVectorSnapshot({
      layout: 'pairs_xy',
      points: 2,
      data: [
        [-1, 1],
        [1, -1],
      ],
      tags: [
        {
          x: 1,
          y: -1,
          key: 'selected_point',
          label: 'Selected',
          value: 'candidate',
          metadata: {
            score: 0.75,
          },
        },
      ],
    });

    expect(parsed.tags).toEqual([
      {
        x: 1,
        y: -1,
        key: 'selected_point',
        label: 'Selected',
        value: 'candidate',
        metadata: {
          score: 0.75,
        },
      },
    ]);
  });

  it('fails explicitly for invalid render_mode', () => {
    expect(() =>
      parseHttpVectorSnapshot({
        layout: 'pairs_xy',
        points: 1,
        render_mode: 'constellation',
        data: [[0, 0]],
      }),
    ).toThrow('Vector snapshot payload render_mode must be "line" or "scatter".');
  });

  it('fails explicitly for malformed plot tags', () => {
    expect(() =>
      parseHttpVectorSnapshot({
        layout: 'pairs_xy',
        points: 1,
        data: [[0, 0]],
        tags: 'not-tags',
      }),
    ).toThrow('Plot tags must be an array when present.');
  });
});
