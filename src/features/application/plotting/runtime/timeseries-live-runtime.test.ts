import { describe, expect, it } from 'vitest';
import type { PlotDataFrame } from '../model/types';
import { WATERFALL_NORMAL_FIXTURE } from './fixtures/waterfall-contract-fixtures';
import {
  deriveWebSocketIngressFps,
  inactiveExecutionStateMessage,
  parseLiveFrameFromPayload,
  resolveLiveTransportMode,
  shouldRetainPreviousLiveFrame,
  shouldTreatBindingFailureAsInactiveState,
} from './timeseries-live-runtime';

function frame(state: NonNullable<PlotDataFrame['meta']>['state'], points: number[]): PlotDataFrame {
  return {
    kind: 'timeseries',
    series: [{ id: 'ch0', label: 'ch0', y: points }],
    meta: {
      state,
      domain: 'time',
    },
  };
}

describe('timeseries live runtime retention', () => {
  it('derives websocket ingress fps from arrival cadence', () => {
    expect(
      deriveWebSocketIngressFps({
        previousArrivalMs: null,
        previousFpsHz: null,
        nowMs: 1000,
      }),
    ).toBeNull();

    expect(
      deriveWebSocketIngressFps({
        previousArrivalMs: 0,
        previousFpsHz: null,
        nowMs: 1000,
      }),
    ).toBe(1);
  });

  it('keeps the previous live frame during transient loading/no-data transitions', () => {
    expect(
      shouldRetainPreviousLiveFrame({
        currentFrame: frame('ready', [1, 2, 3]),
        nextFrame: frame('loading', []),
      }),
    ).toBe(true);

    expect(
      shouldRetainPreviousLiveFrame({
        currentFrame: frame('ready', [1, 2, 3]),
        nextFrame: frame('no-data', []),
      }),
    ).toBe(true);
  });

  it('does not retain when there is no prior live frame', () => {
    expect(
      shouldRetainPreviousLiveFrame({
        currentFrame: frame('no-data', []),
        nextFrame: frame('no-data', []),
      }),
    ).toBe(false);
  });

  it('retains prior waterfall frames during transient loading/no-data transitions', () => {
    expect(
      shouldRetainPreviousLiveFrame({
        currentFrame: {
          kind: 'waterfall',
          image: {
            width: 2,
            height: 2,
            values: [1, 2, 3, 4],
          },
          meta: {
            state: 'ready',
            domain: 'frequency',
          },
        },
        nextFrame: {
          kind: 'waterfall',
          image: {
            width: 0,
            height: 0,
            values: [],
          },
          meta: {
            state: 'loading',
            domain: 'frequency',
          },
        },
      }),
    ).toBe(true);
  });

  it('parses series websocket payloads through the scalar timeseries route', () => {
    const parsed = parseLiveFrameFromPayload({
      payloadFormat: 'series-window-json-v1',
      seriesLabels: ['A'],
      payload: {
        sample_type: 'float32',
        layout: 'channels_first',
        data: [[1, 2, 3]],
        channels: 1,
        samples_per_channel: 3,
        tags: [
          {
            offset: 1,
            key: 'generic_event',
            value: true,
          },
        ],
      },
    });

    expect(parsed.kind).toBe('series');
    if (parsed.kind !== 'series') {
      return;
    }
    expect(parsed.series).toHaveLength(1);
    expect(parsed.series[0]?.label).toBe('A');
    expect(parsed.series[0]?.y).toEqual([1, 2, 3]);
    expect(parsed.tags).toEqual([
      {
        offset: 1,
        key: 'generic_event',
        label: 'generic_event',
        value: true,
      },
    ]);
  });

  it('parses dataset payloads through the power spectrum live route unchanged', () => {
    const parsed = parseLiveFrameFromPayload({
      payloadFormat: 'dataset-xy-json-v1',
      seriesLabels: ['Spectrum'],
      payload: {
        payload_format: 'dataset-xy-json-v1',
        layout: 'pairs_xy',
        points: 3,
        signal_name: 'Legacy Spectrum',
        data: [
          [10, -20],
          [20, -15],
          [30, -10],
        ],
      },
    });

    expect(parsed.kind).toBe('series');
    if (parsed.kind !== 'series') {
      return;
    }
    expect(parsed.xyRenderMode).toBe('line');
    expect(parsed.series).toHaveLength(1);
    expect(parsed.series[0]?.label).toBe('Spectrum');
    expect(parsed.series[0]?.x).toEqual([10, 20, 30]);
    expect(parsed.series[0]?.y).toEqual([-20, -15, -10]);
  });

  it('parses 2D series payloads through the XY live route unchanged', () => {
    const parsed = parseLiveFrameFromPayload({
      payloadFormat: 'series2d-xy-json-v1',
      seriesLabels: ['Constellation'],
      payload: {
        payload_format: 'series2d-xy-json-v1',
        layout: 'pairs_xy',
        points: 3,
        render_mode: 'scatter',
        data: [
          [-1, 1],
          [0, 0],
          [1, -1],
        ],
        tags: [
          {
            x: 1,
            y: -1,
            key: 'xy_event',
            metadata: {
              score: 0.5,
            },
          },
        ],
      },
    });

    expect(parsed.kind).toBe('series');
    if (parsed.kind !== 'series') {
      return;
    }
    expect(parsed.xyRenderMode).toBe('scatter');
    expect(parsed.series).toHaveLength(1);
    expect(parsed.series[0]?.label).toBe('Constellation');
    expect(parsed.series[0]?.x).toEqual([-1, 0, 1]);
    expect(parsed.series[0]?.y).toEqual([1, 0, -1]);
    expect(parsed.tags).toEqual([
      {
        x: 1,
        y: -1,
        key: 'xy_event',
        label: 'xy_event',
        metadata: {
          score: 0.5,
        },
      },
    ]);
  });

  it('parses waterfall payloads through the existing waterfall live route unchanged', () => {
    const parsed = parseLiveFrameFromPayload({
      payloadFormat: 'waterfall-spectrum-json-v1',
      seriesLabels: ['Waterfall'],
      payload: WATERFALL_NORMAL_FIXTURE,
    });

    expect(parsed.kind).toBe('image');
    if (parsed.kind !== 'image') {
      return;
    }
    expect(parsed.image.width).toBe(3);
    expect(parsed.image.height).toBe(2);
    expect(Array.from(parsed.image.values)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(parsed.image.timeSpan).toBe(0.012);
    expect(parsed.image.signalName).toBe('Waterfall');
  });

  it('treats configured Waterfall websocket bindings as live websocket runtime', () => {
    expect(
      resolveLiveTransportMode({
        status: 'configured',
        transport: 'websocket',
        endpoint: '/sessions/sess-1/streams/waterfall0/ws',
      }),
    ).toBe('websocket');
  });

  it('treats configured 2D series websocket bindings as live websocket runtime', () => {
    expect(
      resolveLiveTransportMode({
        status: 'configured',
        transport: 'websocket',
        endpoint: '/sessions/sess-1/streams/xy0/ws',
      }),
    ).toBe('websocket');
  });

  it('treats stopped-session managed binding failures as inactive lifecycle state instead of hard errors', () => {
    expect(
      shouldTreatBindingFailureAsInactiveState({
        executionState: 'stopped',
        status: 'invalid',
        reason: 'Linked session is not running.',
      }),
    ).toBe(true);

    expect(
      shouldTreatBindingFailureAsInactiveState({
        executionState: 'stopped',
        status: 'invalid',
        reason: 'Runtime stream "spectrum0" advertised unsupported transport "zmq_sub" for gr::studio::StudioPowerSpectrumSink<float32>.',
      }),
    ).toBe(false);

    expect(inactiveExecutionStateMessage('stopped')).toBe(
      'Linked session is stopped. Start or rerun the session to resume this plot.',
    );
    expect(inactiveExecutionStateMessage('ready')).toBe(
      'Linked session is ready but not running. Start the session to resume this plot.',
    );
    expect(inactiveExecutionStateMessage('error')).toBe(
      'Linked session is in an error state. Clear the session error or rerun to resume this plot.',
    );
    expect(inactiveExecutionStateMessage('idle')).toBe(
      'No linked session is running. Run the graph to resume this plot.',
    );
  });
});
