import { describe, expect, it } from 'vitest';
import { assertTimeseriesAdapterShape, buildSeriesOptions, normalizeSeriesData } from './timeseries-uplot-adapter';

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
    const options = buildSeriesOptions(['Measured target'], ['#22c55e'], 'line');

    expect(options[1]).toMatchObject({
      label: 'Measured target',
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
    const options = buildSeriesOptions(['Measured target'], ['#22c55e'], 'scatter', 6, 0.5);

    expect(options[1]).toMatchObject({
      label: 'Measured target',
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
});
