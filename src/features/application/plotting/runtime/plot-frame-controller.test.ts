import { describe, expect, it } from 'vitest';
import { createPlotFrameController } from './plot-frame-controller';

describe('plot frame controller', () => {
  it('retains large complete spectra with a -1 window and replaces the previous sweep', () => {
    const controller = createPlotFrameController({
      panelId: 'all-bins', kind: 'timeseries', source: { sinkId: 'dataset' },
      view: { kind: 'timeseries', windowSize: -1, xMode: 'frequency' },
    });
    const x = Array.from({ length: 150000 }, (_, i) => 2e9 + i);
    const y = x.map((_, i) => -100 - i / 1000);
    controller.ingestSeries([{ id: 'rf', label: 'Spectrum', x, y }], 0, 'replace');
    expect(controller.getFrame().series?.[0].x).toEqual(x);
    expect(controller.getFrame().series?.[0].y).toEqual(y);
    controller.ingestSeries([{ id: 'rf', label: 'Spectrum', x: [1, 2], y: [-10, -20] }], 1, 'replace');
    expect(controller.getFrame().series?.[0].y).toEqual([-10, -20]);
  });

  it('starts as no-data and empty image for waterfall panels', () => {
    const controller = createPlotFrameController({
      panelId: 'panel-waterfall',
      kind: 'waterfall',
      source: { sinkId: 'sink-waterfall' },
      view: { kind: 'waterfall', title: 'Waterfall' },
    });

    expect(controller.getFrame()).toEqual({
      kind: 'waterfall',
      series: [],
      meta: {
        state: 'no-data',
        domain: 'frequency',
      },
    });
  });

  it('starts as no-data and empty series for histogram panels', () => {
    const controller = createPlotFrameController({
      panelId: 'panel-histogram',
      kind: 'histogram',
      source: { sinkId: 'sink-histogram' },
      view: { kind: 'histogram', title: 'History' },
    });

    expect(controller.getFrame()).toEqual({
      kind: 'histogram',
      series: [],
      meta: {
        state: 'no-data',
        domain: 'frequency',
      },
    });
  });

  it('ingests waterfall image frames with bounded shape metadata', () => {
    const controller = createPlotFrameController({
      panelId: 'panel-waterfall',
      kind: 'waterfall',
      source: { sinkId: 'sink-waterfall' },
      view: { kind: 'waterfall', title: 'Waterfall' },
    });

    controller.ingestImage(
      {
        width: 2,
        height: 2,
        values: [1, 2, 3, 4],
        xAxis: [100, 200],
        signalName: 'Spectrum',
        signalUnit: 'dB',
        axisName: 'Frequency',
        axisUnit: 'Hz',
      },
      1234,
      {
        statusMessage: 'WebSocket connected · waterfall frame',
        liveIngressFpsHz: 8.5,
      },
    );

    expect(controller.getFrame().kind).toBe('waterfall');
    expect(controller.getFrame().meta?.state).toBe('ready');
    expect(controller.getFrame().meta?.sequence).toBe(1);
    expect(controller.getFrame().meta?.emittedAtMs).toBe(1234);
    expect(controller.getFrame().meta?.statusMessage).toBe('WebSocket connected · waterfall frame');
    expect(controller.getFrame().meta?.liveIngressFpsHz).toBe(8.5);
    expect(controller.getFrame().image).toEqual({
      width: 2,
      height: 2,
      values: [1, 2, 3, 4],
      xAxis: [100, 200],
      signalName: 'Spectrum',
      signalUnit: 'dB',
      axisName: 'Frequency',
      axisUnit: 'Hz',
    });
  });

  it('starts as no-data and empty series', () => {
    const controller = createPlotFrameController({
      panelId: 'panel-1',
      kind: 'timeseries',
      source: { sinkId: 'sink-1' },
      view: { kind: 'timeseries', windowSize: 4 },
    });

    expect(controller.getFrame()).toEqual({
      kind: 'timeseries',
      series: [],
      meta: {
        state: 'no-data',
        domain: 'time',
      },
    });
  });

  it('applies rolling window when ingesting series updates', () => {
    const controller = createPlotFrameController({
      panelId: 'panel-1',
      kind: 'timeseries',
      source: { sinkId: 'sink-1' },
      view: { kind: 'timeseries', windowSize: 3 },
    });

    controller.ingestSeries([{ id: 'ch0', label: 'ch0', y: [1, 2] }], 1000);
    controller.ingestSeries([{ id: 'ch0', label: 'ch0', y: [3, 4] }], 1100);
    const frame = controller.getFrame();

    expect(frame.kind).toBe('timeseries');
    expect(frame.meta?.state).toBe('ready');
    expect(frame.meta?.sequence).toBe(2);
    expect(frame.meta?.emittedAtMs).toBe(1100);
    expect(frame.series).toEqual([
      {
        id: 'ch0',
        label: 'ch0',
        y: [2, 3, 4],
      },
    ]);
    expect(controller.getVersion()).toBe(2);
  });

  it('increments version only when state actually changes', () => {
    const controller = createPlotFrameController({
      panelId: 'panel-1',
      kind: 'timeseries',
      source: { sinkId: 'sink-1' },
      view: { kind: 'timeseries', windowSize: 8 },
    });

    expect(controller.getVersion()).toBe(0);
    controller.setError('boom', 'runtime');
    expect(controller.getVersion()).toBe(1);
    controller.setError('boom', 'runtime');
    expect(controller.getVersion()).toBe(1);
    controller.setError('boom', 'invalid-binding');
    expect(controller.getVersion()).toBe(2);
    controller.reset();
    expect(controller.getVersion()).toBe(3);
  });

  it('supports explicit loading and no-data transitions without extra churn', () => {
    const controller = createPlotFrameController({
      panelId: 'panel-1',
      kind: 'timeseries',
      source: { sinkId: 'sink-1' },
      view: { kind: 'timeseries', windowSize: 8 },
    });

    expect(controller.getVersion()).toBe(0);
    controller.setLoading();
    expect(controller.getFrame().meta?.state).toBe('loading');
    expect(controller.getVersion()).toBe(1);
    controller.setLoading();
    expect(controller.getVersion()).toBe(1);

    controller.setNoData();
    expect(controller.getFrame().meta?.state).toBe('no-data');
    expect(controller.getVersion()).toBe(2);
    controller.setNoData();
    expect(controller.getVersion()).toBe(2);
  });

  it('carries diagnostic status messages through live updates', () => {
    const controller = createPlotFrameController({
      panelId: 'panel-1',
      kind: 'timeseries',
      source: { sinkId: 'sink-1' },
      view: { kind: 'timeseries', windowSize: 8 },
    });

    controller.setLoading('Connecting websocket to ws://127.0.0.1:18080/spectrum…');
    expect(controller.getFrame().meta?.statusMessage).toContain('Connecting websocket');

    controller.ingestSeries([{ id: 'ch0', label: 'ch0', y: [1, 2, 3] }], 1000, 'replace', {
      statusMessage: 'WebSocket connected · seq 1',
    });

    expect(controller.getFrame().meta?.state).toBe('ready');
    expect(controller.getFrame().meta?.statusMessage).toBe('WebSocket connected · seq 1');
  });

  it('keeps no-data state when ingested series are empty', () => {
    const controller = createPlotFrameController({
      panelId: 'panel-1',
      kind: 'timeseries',
      source: { sinkId: 'sink-1' },
      view: { kind: 'timeseries', windowSize: 4 },
    });

    controller.setLoading();
    controller.ingestSeries([{ id: 'ch0', label: 'ch0', y: [] }], 1000);
    expect(controller.getFrame().meta?.state).toBe('no-data');
    expect(controller.getFrame().series).toEqual([{ id: 'ch0', label: 'ch0', y: [] }]);
  });

  it('supports authoritative replacement mode for snapshot-style payloads', () => {
    const controller = createPlotFrameController({
      panelId: 'panel-1',
      kind: 'timeseries',
      source: { sinkId: 'sink-1' },
      view: { kind: 'timeseries', windowSize: 8 },
    });

    controller.ingestSeries([{ id: 'ch0', label: 'ch0', y: [1, 2, 3, 4] }], 1000, 'replace');
    controller.ingestSeries([{ id: 'ch0', label: 'ch0', y: [10, 11, 12, 13] }], 1100, 'replace');

    expect(controller.getFrame().series).toEqual([
      {
        id: 'ch0',
        label: 'ch0',
        y: [10, 11, 12, 13],
      },
    ]);
    expect(controller.getFrame().meta?.sequence).toBe(2);
    expect(controller.getFrame().meta?.state).toBe('ready');
  });

  it('preserves x arrays and xy render metadata for XY replace snapshots', () => {
    const controller = createPlotFrameController({
      panelId: 'panel-xy',
      kind: 'timeseries',
      source: { sinkId: 'sink-xy' },
      view: { kind: 'timeseries', windowSize: 8, xMode: 'frequency' },
    });

    controller.ingestSeries(
      [{ id: 'vector', label: 'vector', x: [10, 20, 30], y: [1, 2, 3] }],
      1000,
      'replace',
      { xyRenderMode: 'scatter', xyPointSize: 6, xyPointAlpha: 0.5 },
    );

    expect(controller.getFrame().series).toEqual([
      {
        id: 'vector',
        label: 'vector',
        x: [10, 20, 30],
        y: [1, 2, 3],
      },
    ]);
    expect(controller.getFrame().meta?.xyRenderMode).toBe('scatter');
    expect(controller.getFrame().meta?.xyPointSize).toBe(6);
    expect(controller.getFrame().meta?.xyPointAlpha).toBe(0.5);
  });

  it('preserves split complex real/imag series shape across ingest and readback', () => {
    const controller = createPlotFrameController({
      panelId: 'panel-complex',
      kind: 'timeseries',
      source: { sinkId: 'sink-complex' },
      view: { kind: 'timeseries', windowSize: 32 },
    });

    controller.ingestSeries(
      [
        { id: 'ch0.real', label: 'ch0 (real)', y: [1, 2, 3, 4] },
        { id: 'ch0.imag', label: 'ch0 (imag)', y: [5, 6, 7, 8] },
      ],
      1000,
      'replace',
    );
    const frame = controller.getFrame();
    expect(frame.meta?.state).toBe('ready');
    expect(frame.series).toEqual([
      { id: 'ch0.real', label: 'ch0 (real)', y: [1, 2, 3, 4] },
      { id: 'ch0.imag', label: 'ch0 (imag)', y: [5, 6, 7, 8] },
    ]);
  });
});
