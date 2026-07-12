import { describe, expect, it } from 'vitest';
import { derivePlotPanelSpec } from './panel-spec';
import type { WorkspacePanelViewModel } from '../../../workspace/workspace-view';

function makeSeriesEntry(overrides: Partial<WorkspacePanelViewModel> = {}): WorkspacePanelViewModel {
  return {
    panel: {
      id: 'studio-panel:node-a',
      nodeId: 'node-a',
      kind: 'series',
      title: 'Panel Title',
      visible: true,
      previewOnCanvas: false,
    },
    nodeDisplayName: 'Node Display',
    nodeBlockTypeId: 'gr::studio::StudioSeriesSink<float32>',
    ...overrides,
  };
}

describe('derivePlotPanelSpec', () => {
  it('prefers graph-side semantic metadata when available', () => {
    const spec = derivePlotPanelSpec(
      makeSeriesEntry({
        nodeParameters: {
          plot_title: 'Semantic Plot',
          x_label: 'time (s)',
          y_label: 'amplitude',
          series_labels: 'left,right',
        },
      }),
    );

    expect(spec?.view.title).toBe('Semantic Plot');
    expect(spec?.view.xLabel).toBe('time (s)');
    expect(spec?.view.yLabel).toBe('amplitude');
    expect(spec?.view.seriesLabels).toEqual(['left', 'right']);
  });

  it('falls back to sensible defaults when semantic metadata is missing', () => {
    const spec = derivePlotPanelSpec(
      makeSeriesEntry({
        nodeParameters: {
          n_inputs: '2',
        },
      }),
    );

    expect(spec?.view.title).toBe('Node Display');
    expect(spec?.view.xLabel).toBe('sample');
    expect(spec?.view.yLabel).toBe('value');
    expect(spec?.view.seriesLabels).toEqual(['ch0', 'ch1']);
    expect(spec?.view.colorAssignmentMode).toBe('byIndex');
    expect(spec?.view.plotColors?.length).toBeGreaterThan(0);
    expect(spec?.view.maxLabels).toBe(100);
  });

  it('honors max_labels as the tag label display cap', () => {
    const spec = derivePlotPanelSpec(
      makeSeriesEntry({
        nodeParameters: {
          max_labels: '12',
        },
      }),
    );

    expect(spec?.view.maxLabels).toBe(12);
  });

  it('allows max_labels to hide tag labels while keeping markers renderable', () => {
    const spec = derivePlotPanelSpec(
      makeSeriesEntry({
        nodeParameters: {
          max_labels: '0',
        },
      }),
    );

    expect(spec?.view.maxLabels).toBe(0);
  });

  it('uses panel plot style override when present', () => {
    const spec = derivePlotPanelSpec(
      makeSeriesEntry({
        panel: {
          id: 'studio-panel:node-a',
          nodeId: 'node-a',
          kind: 'series',
          title: 'Panel Title',
          visible: true,
          previewOnCanvas: false,
          plotStyle: {
            palette: {
              kind: 'custom',
              colors: ['#111111', '#222222', '#333333'],
            },
            assignmentMode: 'byIndex',
          },
        },
      }),
    );

    expect(spec?.view.plotColors).toEqual(['#111111', '#222222', '#333333']);
    expect(spec?.view.colorAssignmentMode).toBe('byIndex');
  });

  it('resolves studio palette references via workspace palette definitions', () => {
    const spec = derivePlotPanelSpec(
      makeSeriesEntry({
        studioPlotPalettes: [
          {
            id: 'operations',
            colors: ['#101010', '#202020', '#303030'],
          },
        ],
        panel: {
          id: 'studio-panel:node-a',
          nodeId: 'node-a',
          kind: 'series',
          title: 'Panel Title',
          visible: true,
          previewOnCanvas: false,
          plotStyle: {
            assignmentMode: 'byIndex',
            palette: {
              kind: 'studio',
              id: 'operations',
            },
          },
        },
      }),
    );

    expect(spec?.view.plotColors).toEqual(['#101010', '#202020', '#303030']);
  });

  it('returns null for non-series panels', () => {
    const entry: WorkspacePanelViewModel = {
      ...makeSeriesEntry(),
      panel: {
        id: 'studio-panel:image-1',
        nodeId: 'image-1',
        kind: 'image',
        visible: true,
        previewOnCanvas: false,
      },
    };
    expect(derivePlotPanelSpec(entry)).toBeNull();
  });

  it('reuses cached plot specs when semantic inputs are unchanged', () => {
    const first = derivePlotPanelSpec(
      makeSeriesEntry({
        nodeParameters: {
          n_inputs: '2',
        },
      }),
    );
    const second = derivePlotPanelSpec(
      makeSeriesEntry({
        nodeParameters: {
          n_inputs: '2',
        },
      }),
    );

    expect(first).toBe(second);
  });

  it('derives vector sink plotting spec from series2d panels', () => {
    const spec = derivePlotPanelSpec(
      makeSeriesEntry({
        panel: {
          id: 'studio-panel:node-2d',
          nodeId: 'node-2d',
          kind: 'series2d',
          title: '2D Sink',
          visible: true,
          previewOnCanvas: false,
        },
        nodeBlockTypeId: 'gr::studio::Studio2DSeriesSink<float32>',
        nodeParameters: {
          window_size: '512',
          x_label: 'bin',
          y_label: 'value',
          series_labels: 'spectrum',
        },
      }),
    );

    expect(spec?.kind).toBe('timeseries');
    expect(spec?.source.payloadFormat).toBe('series2d-xy-json-v1');
    expect(spec?.view.xMode).toBe('frequency');
    expect(spec?.view.windowSize).toBe(512);
    expect(spec?.view.seriesLabels).toEqual(['spectrum']);
    expect(spec?.view.xLabel).toBe('bin');
  });

  it('uses generic XY defaults for series2d panels without explicit labels', () => {
    const spec = derivePlotPanelSpec(
      makeSeriesEntry({
        panel: {
          id: 'studio-panel:node-2d',
          nodeId: 'node-2d',
          kind: 'series2d',
          title: '2D Sink',
          visible: true,
          previewOnCanvas: false,
        },
        nodeBlockTypeId: 'gr::studio::Studio2DSeriesSink<float32>',
      }),
    );

    expect(spec?.source.payloadFormat).toBe('series2d-xy-json-v1');
    expect(spec?.view.xLabel).toBe('x');
    expect(spec?.view.yLabel).toBe('y');
    expect(spec?.view.seriesLabels).toBeUndefined();
  });

  it('honors explicit XY labels, ranges, and plot colors for series2d panels', () => {
    const spec = derivePlotPanelSpec(
      makeSeriesEntry({
        panel: {
          id: 'studio-panel:node-xy',
          nodeId: 'node-xy',
          kind: 'series2d',
          title: 'XY Sink',
          visible: true,
          previewOnCanvas: false,
          plotStyle: {
            palette: {
              kind: 'custom',
              colors: ['#22c55e', '#0ea5e9'],
            },
            assignmentMode: 'byIndex',
          },
        },
        nodeBlockTypeId: 'gr::studio::Studio2DSeriesSink<float32>',
        nodeParameters: {
          autoscale: 'false',
          x_label: 'Horizontal position',
          y_label: 'Vertical position',
          series_labels: 'Observed point',
          x_min: '0',
          x_max: '1000',
          y_min: '-120',
          y_max: '120',
        },
      }),
    );

    expect(spec?.source.payloadFormat).toBe('series2d-xy-json-v1');
    expect(spec?.view.xLabel).toBe('Horizontal position');
    expect(spec?.view.yLabel).toBe('Vertical position');
    expect(spec?.view.seriesLabels).toEqual(['Observed point']);
    expect(spec?.view.xRange).toEqual({
      auto: false,
      min: 0,
      max: 1000,
    });
    expect(spec?.view.yRange).toEqual({
      auto: false,
      min: -120,
      max: 120,
    });
    expect(spec?.view.plotColors).toEqual(['#22c55e', '#0ea5e9']);
  });

  it('derives dataset-xy payload format from StudioDataSetSink IDs', () => {
    const spec = derivePlotPanelSpec(
      makeSeriesEntry({
        panel: {
          id: 'studio-panel:node-dataset',
          nodeId: 'node-dataset',
          kind: 'series2d',
          title: 'DataSet Sink',
          visible: true,
          previewOnCanvas: false,
        },
        nodeBlockTypeId: 'gr::studio::StudioDataSetSink<float32>',
      }),
    );

    expect(spec?.source.payloadFormat).toBe('dataset-xy-json-v1');
    expect(spec?.view.xMode).toBe('frequency');
  });

  it('derives dataset-xy payload format from StudioPowerSpectrumSink IDs', () => {
    const spec = derivePlotPanelSpec(
      makeSeriesEntry({
        panel: {
          id: 'studio-panel:node-spectrum',
          nodeId: 'node-spectrum',
          kind: 'series2d',
          title: 'Spectrum',
          visible: true,
          previewOnCanvas: false,
        },
        nodeBlockTypeId: 'gr::studio::StudioPowerSpectrumSink<float32>',
      }),
    );

    expect(spec?.kind).toBe('timeseries');
    expect(spec?.source.payloadFormat).toBe('dataset-xy-json-v1');
    expect(spec?.view.xMode).toBe('frequency');
  });

  it('derives phosphor panel kind from StudioPowerSpectrumSink persistence mode', () => {
    const spec = derivePlotPanelSpec(
      makeSeriesEntry({
        panel: {
          id: 'studio-panel:node-history',
          nodeId: 'node-history',
          kind: 'series2d',
          title: 'Phosphor Spectrum',
          visible: true,
          previewOnCanvas: false,
        },
        nodeBlockTypeId: 'gr::studio::StudioPowerSpectrumSink<float32>',
        nodeParameters: {
          persistence: 'true',
          plot_title: 'Phosphor Spectrum',
          x_label: 'Frequency',
          y_label: 'Power',
          sample_rate: '48000',
        },
      }),
    );

    expect(spec?.kind).toBe('histogram');
    expect(spec?.source.payloadFormat).toBe('dataset-xy-json-v1');
    expect(spec?.view.kind).toBe('histogram');
    expect(spec?.view.xMode).toBe('frequency');
    expect(spec?.view.legend).toBe(true);
    expect(spec?.view.phosphor).toEqual({
      intensity: 1.1,
      decayMs: 1024,
      colorMap: 'gqrx',
    });
  });

  it('derives waterfall payload format and panel kind from StudioWaterfallSink IDs', () => {
    const spec = derivePlotPanelSpec(
      makeSeriesEntry({
        panel: {
          id: 'studio-panel:node-waterfall',
          nodeId: 'node-waterfall',
          kind: 'waterfall',
          title: 'Waterfall',
          visible: true,
          previewOnCanvas: false,
        },
        nodeBlockTypeId: 'gr::studio::StudioWaterfallSink<float32>',
        nodeParameters: {
          plot_title: 'Spectrum Waterfall',
          x_label: 'Frequency',
          y_label: 'Power',
          x_min: '-5',
          x_max: '5',
          y_min: '-10',
          y_max: '10',
        },
      }),
    );

    expect(spec?.kind).toBe('waterfall');
    expect(spec?.source.payloadFormat).toBe('waterfall-spectrum-json-v1');
    expect(spec?.view.title).toBe('Spectrum Waterfall');
    expect(spec?.view.xMode).toBe('frequency');
    expect(spec?.view.legend).toBe(false);
    expect(spec?.view.xRange).toBeUndefined();
    expect(spec?.view.yRange).toBeUndefined();
  });

  it('keeps the scalar series x range fixed to window_size when autoscale is disabled', () => {
    const spec = derivePlotPanelSpec(
      makeSeriesEntry({
        nodeParameters: {
          autoscale: 'false',
          window_size: '64',
          x_min: '-2',
          x_max: '2',
          y_min: '-1.5',
          y_max: '1.5',
        },
      }),
    );

    expect(spec?.view.xRange).toEqual({
      auto: false,
      min: 0,
      max: 63,
    });
    expect(spec?.view.yRange).toEqual({
      auto: false,
      min: -1.5,
      max: 1.5,
    });
  });

  it('accepts compact ymin and ymax aliases for scalar series manual y ranges', () => {
    const spec = derivePlotPanelSpec(
      makeSeriesEntry({
        nodeParameters: {
          autoscale: 'false',
          ymin: '-1',
          ymax: '10',
        },
      }),
    );

    expect(spec?.view.yRange).toEqual({
      auto: false,
      min: -1,
      max: 10,
    });
  });

  it('keeps manual x ranges available for xy series sinks', () => {
    const spec = derivePlotPanelSpec(
      makeSeriesEntry({
        panel: {
          id: 'studio-panel:node-2d',
          nodeId: 'node-2d',
          kind: 'series2d',
          title: '2D Sink',
          visible: true,
          previewOnCanvas: false,
        },
        nodeBlockTypeId: 'gr::studio::Studio2DSeriesSink<float32>',
        nodeParameters: {
          autoscale: 'false',
          x_min: '-2',
          x_max: '2',
          y_min: '-1.5',
          y_max: '1.5',
        },
      }),
    );

    expect(spec?.view.xRange).toEqual({
      auto: false,
      min: -2,
      max: 2,
    });
    expect(spec?.view.yRange).toEqual({
      auto: false,
      min: -1.5,
      max: 1.5,
    });
  });

  it('keeps PowerSpectrumSink x range automatic when autoscale is disabled', () => {
    const spec = derivePlotPanelSpec(
      makeSeriesEntry({
        panel: {
          id: 'studio-panel:node-spectrum',
          nodeId: 'node-spectrum',
          kind: 'series2d',
          title: 'Power Spectrum',
          visible: true,
          previewOnCanvas: false,
        },
        nodeBlockTypeId: 'gr::studio::StudioPowerSpectrumSink<float32>',
        nodeParameters: {
          autoscale: false,
          x_min: '-2400000',
          x_max: '2400000',
          y_min: '-120',
          y_max: '-20',
        },
      }),
    );

    expect(spec?.view.xRange).toEqual({
      auto: true,
    });
    expect(spec?.view.yRange).toEqual({
      auto: false,
      min: -120,
      max: -20,
    });
  });

  it('normalizes reversed PowerSpectrumSink manual ranges when autoscale is disabled', () => {
    const spec = derivePlotPanelSpec(
      makeSeriesEntry({
        panel: {
          id: 'studio-panel:node-spectrum',
          nodeId: 'node-spectrum',
          kind: 'series2d',
          title: 'Power Spectrum',
          visible: true,
          previewOnCanvas: false,
        },
        nodeBlockTypeId: 'gr::studio::StudioPowerSpectrumSink<complex<float32>>',
        nodeParameters: {
          autoscale: false,
          y_min: 20,
          y_max: -100,
        },
      }),
    );

    expect(spec?.view.yRange).toEqual({
      auto: false,
      min: -100,
      max: 20,
    });
  });

  it('falls back to auto y scaling when the manual y range is invalid', () => {
    const spec = derivePlotPanelSpec(
      makeSeriesEntry({
        nodeParameters: {
          autoscale: 'false',
          x_min: '0',
          x_max: '0',
          y_min: '2',
          y_max: '2',
        },
      }),
    );

    expect(spec?.view.xRange).toEqual({
      auto: false,
      min: 0,
      max: 1023,
    });
    expect(spec?.view.yRange).toEqual({
      auto: true,
      min: undefined,
      max: undefined,
    });
  });
});
