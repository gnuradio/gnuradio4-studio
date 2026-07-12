import { describe, expect, it } from 'vitest';
import {
  assertTimeseriesAdapterShape,
  buildSeriesOptions,
  buildTimeseriesScaleOptions,
  normalizeSeriesData,
  panRangesByPixels,
  shouldAutoscaleOnDataUpdate,
} from './timeseries-uplot-adapter';
import { buildPlotTagMarkers } from './timeseries-tag-markers';

describe('timeseries uPlot adapter shape helpers', () => {
  it('builds aligned x/y arrays for split complex real/imag series', () => {
    const normalized = normalizeSeriesData(
      [
        { id: 'ch0.real', label: 'ch0 (real)', y: [0.72, 0.71, 0.7] },
        { id: 'ch0.imag', label: 'ch0 (imag)', y: [0.69, 0.7, 0.71] },
      ],
      'sample-index',
      10,
      'line',
    );

    expect(normalized.x).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(normalized.labels).toEqual(['ch0 (real)', 'ch0 (imag)']);
    expect(normalized.yBySeries).toHaveLength(2);
    expect(normalized.yBySeries[0].length).toBe(10);
    expect(normalized.yBySeries[1].length).toBe(10);
    expect(normalized.yBySeries[0].slice(0, 3)).toEqual([0.72, 0.71, 0.7]);
    expect(normalized.yBySeries[1].slice(0, 3)).toEqual([0.69, 0.7, 0.71]);
    expect(() => assertTimeseriesAdapterShape(normalized)).not.toThrow();
  });

  it('throws when adapter labels and data series counts diverge', () => {
    expect(() =>
      assertTimeseriesAdapterShape({
        x: [0, 1],
        labels: ['a', 'b'],
        yBySeries: [[1, 2]],
      }),
    ).toThrow('Timeseries adapter shape mismatch');
  });

  it('keeps line mode as connected strokes without visible points', () => {
    const options = buildSeriesOptions(['Observed point'], ['#22c55e'], 'line');

    expect(options[1]).toMatchObject({
      label: 'Observed point',
      stroke: '#22c55e',
      width: 1.8,
      points: {
        show: false,
        stroke: '#22c55e',
        fill: '#22c55e',
      },
    });
  });

  it('renders scatter mode as visible points without a connecting stroke', () => {
    const options = buildSeriesOptions(['Observed point'], ['#22c55e'], 'scatter', 6, 0.5);

    expect(options[1]).toMatchObject({
      label: 'Observed point',
      stroke: '#22c55e00',
      width: 1,
      points: {
        show: true,
        size: 6,
        width: 2,
        stroke: '#22c55e',
        fill: '#22c55e80',
      },
    });
  });

  it('keeps user zoom scales during live data updates', () => {
    expect(
      shouldAutoscaleOnDataUpdate(
        {
          xRange: { auto: true },
          yRange: { auto: true },
        },
        true,
      ),
    ).toBe(false);
  });

  it('autoscale resets data update scales before user zoom', () => {
    expect(
      shouldAutoscaleOnDataUpdate(
        {
          xRange: { auto: true },
          yRange: { auto: true },
        },
        false,
      ),
    ).toBe(true);
  });

  it('honors explicit axis ranges by avoiding automatic scale reset', () => {
    expect(
      shouldAutoscaleOnDataUpdate(
        {
          xRange: { auto: false, min: 10, max: 20 },
          yRange: { auto: true },
        },
        false,
      ),
    ).toBe(false);
  });

  it('does not lock uPlot scales to configured ranges that would override user zoom', () => {
    expect(buildTimeseriesScaleOptions('sample-index')).toEqual({
      x: { time: false },
      y: {},
    });
  });

  it('pans the selected axes by their visible pixel-scaled ranges', () => {
    expect(
      panRangesByPixels(
        {
          x: { min: 100, max: 300 },
          y: { min: -1, max: 1 },
        },
        50,
        25,
        200,
        100,
        'xy',
      ),
    ).toEqual({
      x: { min: 50, max: 250 },
      y: { min: -0.5, max: 1.5 },
    });
  });

  it('limits panning to the active axis mode', () => {
    expect(
      panRangesByPixels(
        {
          x: { min: 0, max: 10 },
          y: { min: 0, max: 20 },
        },
        -20,
        50,
        100,
        100,
        'x',
      ),
    ).toEqual({
      x: { min: 2, max: 12 },
    });
  });

  it('builds vertical markers for time-series tag offsets', () => {
    const normalized = normalizeSeriesData(
      [{ id: 'ch0', label: 'ch0', y: [1, 2, 3] }],
      'sample-index',
      undefined,
      'line',
    );

    expect(
      buildPlotTagMarkers(
        [
          {
            key: 'event',
            label: 'event',
            offset: 1,
            value: true,
          },
        ],
        normalized,
        'line',
      ),
    ).toEqual([
      {
        kind: 'vertical',
        x: 1,
        tag: {
          key: 'event',
          label: 'event',
          offset: 1,
          value: true,
        },
      },
    ]);
  });

  it('builds markers for all visible tags instead of keeping only the oldest batch', () => {
    const normalized = normalizeSeriesData(
      [{ id: 'ch0', label: 'ch0', y: Array.from({ length: 40 }, (_, index) => index) }],
      'sample-index',
      undefined,
      'line',
    );
    const tags = Array.from({ length: 32 }, (_, index) => ({
      key: `event_${index}`,
      label: `event_${index}`,
      offset: index,
    }));

    const markers = buildPlotTagMarkers(tags, normalized, 'line');

    expect(markers).toHaveLength(32);
    expect(markers[markers.length - 1]).toMatchObject({
      kind: 'vertical',
      x: 31,
      tag: {
        key: 'event_31',
      },
    });
  });

  it('filters tag markers outside the current x extent', () => {
    const normalized = normalizeSeriesData(
      [{ id: 'ch0', label: 'ch0', y: [1, 2, 3] }],
      'sample-index',
      undefined,
      'line',
    );

    expect(
      buildPlotTagMarkers(
        [
          {
            key: 'old',
            label: 'old',
            offset: -1,
          },
          {
            key: 'visible',
            label: 'visible',
            offset: 1,
          },
          {
            key: 'future',
            label: 'future',
            offset: 3,
          },
        ],
        normalized,
        'line',
      ),
    ).toEqual([
      {
        kind: 'vertical',
        x: 1,
        tag: {
          key: 'visible',
          label: 'visible',
          offset: 1,
        },
      },
    ]);
  });

  it('builds point markers for XY tags with x/y coordinates', () => {
    const normalized = normalizeSeriesData(
      [{ id: 'xy', label: 'xy', x: [-1, 0, 1], y: [1, 0, -1] }],
      'frequency',
      undefined,
      'scatter',
    );

    expect(
      buildPlotTagMarkers(
        [
          {
            key: 'xy_event',
            label: 'XY event',
            x: 1,
            y: -1,
          },
        ],
        normalized,
        'scatter',
      ),
    ).toEqual([
      {
        kind: 'point',
        x: 1,
        y: -1,
        tag: {
          key: 'xy_event',
          label: 'XY event',
          x: 1,
          y: -1,
        },
      },
    ]);
  });
});
