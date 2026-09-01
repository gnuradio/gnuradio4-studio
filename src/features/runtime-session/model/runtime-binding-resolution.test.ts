import { describe, expect, it } from 'vitest';
import type { SessionRecord } from '../../../lib/api/sessionsApi';
import { resolveCurrentSessionStudioBindingView } from './runtime-binding-resolution';

const runningSession = (streams?: NonNullable<SessionRecord['streams']>): SessionRecord => ({
  id: 'sess-1',
  name: 'demo',
  state: 'running',
  createdAt: '2026-04-20T00:00:00Z',
  updatedAt: '2026-04-20T00:00:01Z',
  lastError: null,
  streams,
});

const stoppedSession = (): SessionRecord => ({
  id: 'sess-1',
  name: 'demo',
  state: 'stopped',
  createdAt: '2026-04-20T00:00:00Z',
  updatedAt: '2026-04-20T00:00:01Z',
  lastError: null,
});

describe('descriptor-based runtime binding resolution', () => {
  it('resolves a series descriptor when the stream descriptor is present', () => {
    expect(
      resolveCurrentSessionStudioBindingView({
        blockTypeId: 'gr::studio::StudioSeriesSink<float32>',
        nodeInstanceId: 'series0',
        parameterValues: {
          transport: 'websocket',
          endpoint: 'http://legacy-host:18080/legacy-series',
          update_ms: '125',
        },
        session: runningSession([
          {
            id: 'series0',
            blockInstanceName: 'series0',
            transport: 'websocket',
            payloadFormat: 'series-window-json-v1',
            path: '/sessions/sess-1/streams/series0/ws',
            ready: true,
          },
        ]),
      }),
    ).toMatchObject({
      status: 'configured',
      transport: 'websocket',
      endpoint: '/api/sessions/sess-1/streams/series0/ws',
      updateMs: 125,
      payloadFormat: 'series-window-json-v1',
    });
  });

  it('resolves a power-spectrum descriptor when the stream descriptor is present', () => {
    expect(
      resolveCurrentSessionStudioBindingView({
        blockTypeId: 'gr::studio::StudioPowerSpectrumSink<float32>',
        nodeInstanceId: 'spectrum0',
        parameterValues: {
          transport: 'websocket',
          endpoint: 'http://legacy-host:18080/legacy-spectrum',
          update_ms: '200',
        },
        session: runningSession([
          {
            id: 'spectrum0',
            blockInstanceName: 'spectrum0',
            transport: 'websocket',
            payloadFormat: 'dataset-xy-json-v1',
            path: '/sessions/sess-1/streams/spectrum0/ws',
            ready: true,
          },
        ]),
      }),
    ).toMatchObject({
      status: 'configured',
      transport: 'websocket',
      endpoint: '/api/sessions/sess-1/streams/spectrum0/ws',
      updateMs: 200,
      payloadFormat: 'dataset-xy-json-v1',
    });
  });

  it('resolves a waterfall descriptor when the stream descriptor is present', () => {
    expect(
      resolveCurrentSessionStudioBindingView({
        blockTypeId: 'gr::studio::StudioWaterfallSink<float32>',
        nodeInstanceId: 'waterfall0',
        parameterValues: {
          transport: 'websocket',
          endpoint: 'http://legacy-host:18080/legacy-waterfall',
          update_ms: '210',
          sample_rate: '48000',
        },
        session: runningSession([
          {
            id: 'waterfall0',
            blockInstanceName: 'waterfall0',
            transport: 'websocket',
            payloadFormat: 'waterfall-spectrum-json-v1',
            path: '/sessions/sess-1/streams/waterfall0/ws',
            ready: true,
          },
        ]),
      }),
    ).toMatchObject({
      status: 'configured',
      transport: 'websocket',
      endpoint: '/api/sessions/sess-1/streams/waterfall0/ws',
      updateMs: 210,
      sampleRate: 48000,
      payloadFormat: 'waterfall-spectrum-json-v1',
    });
  });

  it('resolves a 2D series websocket descriptor when the stream descriptor is present', () => {
    expect(
      resolveCurrentSessionStudioBindingView({
        blockTypeId: 'gr::studio::Studio2DSeriesSink<float32>',
        nodeInstanceId: 'xy0',
        parameterValues: {
          transport: 'websocket',
          endpoint: 'http://legacy-host:18080/legacy-xy',
          update_ms: '90',
        },
        session: runningSession([
          {
            id: 'xy0',
            blockInstanceName: 'xy0',
            transport: 'websocket',
            payloadFormat: 'series2d-xy-json-v1',
            path: '/sessions/sess-1/streams/xy0/ws',
            ready: true,
          },
        ]),
      }),
    ).toMatchObject({
      status: 'configured',
      transport: 'websocket',
      endpoint: '/api/sessions/sess-1/streams/xy0/ws',
      updateMs: 90,
      payloadFormat: 'series2d-xy-json-v1',
    });
  });

  it('resolves an HTTP descriptor for a known Studio block when the stream descriptor is present', () => {
    expect(
      resolveCurrentSessionStudioBindingView({
        blockTypeId: 'gr::studio::StudioSeriesSink<float32>',
        nodeInstanceId: 'series0',
        parameterValues: {
          transport: 'http_poll',
          endpoint: 'http://legacy-host:18080/legacy-series',
          update_ms: '300',
        },
        session: runningSession([
          {
            id: 'series0',
            blockInstanceName: 'series0',
            transport: 'http_poll',
            payloadFormat: 'series-window-json-v1',
            path: '/sessions/sess-1/streams/series0/http',
            ready: true,
          },
        ]),
      }),
    ).toMatchObject({
      status: 'configured',
      transport: 'http_poll',
      endpoint: '/api/sessions/sess-1/streams/series0/http',
      updateMs: 300,
    });
  });

  it('resolves a waterfall HTTP descriptor when the stream descriptor is present', () => {
    expect(
      resolveCurrentSessionStudioBindingView({
        blockTypeId: 'gr::studio::StudioWaterfallSink<float32>',
        nodeInstanceId: 'waterfall0',
        parameterValues: {
          transport: 'http_poll',
          endpoint: 'http://legacy-host:18080/legacy-waterfall',
          update_ms: '320',
          sample_rate: '48000',
        },
        session: runningSession([
          {
            id: 'waterfall0',
            blockInstanceName: 'waterfall0',
            transport: 'http_poll',
            payloadFormat: 'waterfall-spectrum-json-v1',
            path: '/sessions/sess-1/streams/waterfall0/http',
            ready: true,
          },
        ]),
      }),
    ).toMatchObject({
      status: 'configured',
      transport: 'http_poll',
      endpoint: '/api/sessions/sess-1/streams/waterfall0/http',
      updateMs: 320,
      sampleRate: 48000,
      payloadFormat: 'waterfall-spectrum-json-v1',
    });
  });

  it('falls back to authored endpoint binding when session streams are absent', () => {
    expect(
      resolveCurrentSessionStudioBindingView({
        blockTypeId: 'gr::studio::StudioSeriesSink<float32>',
        nodeInstanceId: 'series0',
        parameterValues: {
          transport: 'http_poll',
          endpoint: 'http://legacy-host:18080/legacy-series',
          update_ms: '250',
        },
        session: runningSession(undefined),
      }),
    ).toMatchObject({
      status: 'configured',
      transport: 'http_poll',
      endpoint: 'http://legacy-host:18080/legacy-series',
    });
  });

  it('falls back to authored endpoint binding for legacy waterfall bindings when session streams are absent', () => {
    expect(
      resolveCurrentSessionStudioBindingView({
        blockTypeId: 'gr::studio::StudioWaterfallSink<float32>',
        nodeInstanceId: 'waterfall0',
        parameterValues: {
          transport: 'websocket',
          endpoint: 'http://legacy-host:18080/legacy-waterfall',
          update_ms: '250',
          sample_rate: '48000',
        },
        session: runningSession(undefined),
      }),
    ).toMatchObject({
      status: 'configured',
      transport: 'websocket',
      endpoint: 'http://legacy-host:18080/legacy-waterfall',
    });
  });

  it('marks descriptor-based binding unavailable when no linked session is available', () => {
    expect(
      resolveCurrentSessionStudioBindingView({
        blockTypeId: 'gr::studio::StudioSeriesSink<float32>',
        nodeInstanceId: 'series0',
        parameterValues: {
          transport: 'http_poll',
          endpoint: 'http://legacy-host:18080/legacy-series',
          update_ms: '250',
        },
        session: null,
      }),
    ).toMatchObject({
      status: 'invalid',
      transport: 'http_poll',
      reason: 'No linked session is available for this descriptor-based Studio binding.',
    });
  });

  it('marks descriptor-based binding unavailable when the linked session is stopped', () => {
    expect(
      resolveCurrentSessionStudioBindingView({
        blockTypeId: 'gr::studio::StudioPowerSpectrumSink<float32>',
        nodeInstanceId: 'spectrum0',
        parameterValues: {
          transport: 'http_poll',
          endpoint: 'http://legacy-host:18080/legacy-spectrum',
          update_ms: '180',
        },
        session: stoppedSession(),
      }),
    ).toMatchObject({
      status: 'invalid',
      transport: 'http_poll',
      reason: 'Linked session is not running.',
    });
  });

  it('adapts generic descriptors for known Studio blocks outside the descriptor-managed list', () => {
    expect(
      resolveCurrentSessionStudioBindingView({
        blockTypeId: 'gr::studio::StudioDataSetSink<float32>',
        nodeInstanceId: 'dataset0',
        parameterValues: {
          transport: 'http_poll',
          endpoint: 'http://legacy-host:18080/legacy-dataset',
          poll_ms: '200',
        },
        session: runningSession([
          {
            id: 'dataset-stream',
            blockInstanceName: 'dataset0',
            transport: 'http_poll',
            payloadFormat: 'dataset-xy-json-v1',
            path: '/sessions/sess-1/streams/dataset-stream/http',
            ready: true,
          },
        ]),
      }),
    ).toMatchObject({
      status: 'configured',
      transport: 'http_poll',
      endpoint: '/api/sessions/sess-1/streams/dataset-stream/http',
      payloadFormat: 'dataset-xy-json-v1',
    });
  });

  it('resolves a StudioAudioSink websocket descriptor from the linked session route', () => {
    expect(
      resolveCurrentSessionStudioBindingView({
        blockTypeId: 'gr::studio::StudioAudioSink<float32>',
        nodeInstanceId: 'audio_sink0',
        parameterValues: {
          transport: 'websocket',
          endpoint: 'ws://legacy-host:18084/legacy-audio',
          channels: '1',
          sample_rate: '48000',
          buffer_ms: '140',
        },
        session: runningSession([
          {
            id: 'audio-playback',
            blockInstanceName: 'audio_sink0',
            transport: 'websocket',
            payloadFormat: 'audio-float32-binary-v1',
            path: '/sessions/sess-1/streams/audio-playback/ws',
            ready: true,
          },
        ]),
      }),
    ).toMatchObject({
      status: 'configured',
      family: 'audio',
      transport: 'websocket',
      endpoint: '/api/sessions/sess-1/streams/audio-playback/ws',
      sampleRate: 48000,
      channels: 1,
      bufferMs: 140,
      payloadFormat: 'audio-float32-binary-v1',
    });
  });

  it('does not silently fall back when streams are present but unusable', () => {
    expect(
      resolveCurrentSessionStudioBindingView({
        blockTypeId: 'gr::studio::StudioSeriesSink<float32>',
        nodeInstanceId: 'series0',
        parameterValues: {
          transport: 'http_poll',
          endpoint: 'http://legacy-host:18080/legacy-series',
        },
        session: runningSession([
          {
            id: 'other-series',
            blockInstanceName: 'other-series',
            transport: 'http_poll',
            payloadFormat: 'series-window-json-v1',
            path: '/sessions/sess-1/streams/other-series/http',
            ready: true,
          },
        ]),
      }),
    ).toMatchObject({
      status: 'invalid',
      reason: 'Running session advertised streams, but none matched block instance "series0".',
    });
  });

  it('rejects descriptor transport mismatches against authored transport', () => {
    expect(
      resolveCurrentSessionStudioBindingView({
        blockTypeId: 'gr::studio::StudioPowerSpectrumSink<float32>',
        nodeInstanceId: 'spectrum0',
        parameterValues: {
          transport: 'websocket',
          endpoint: 'http://legacy-host:18080/legacy-spectrum',
          update_ms: '150',
        },
        session: runningSession([
          {
            id: 'spectrum0',
            blockInstanceName: 'spectrum0',
            transport: 'http_poll',
            payloadFormat: 'dataset-xy-json-v1',
            path: '/sessions/sess-1/streams/spectrum0/http',
            ready: true,
          },
        ]),
      }),
    ).toMatchObject({
      status: 'invalid',
      transport: 'websocket',
      reason:
        'Runtime stream "spectrum0" advertised transport "http_poll" but Studio authored transport "websocket" for "spectrum0".',
    });
  });

  it('rejects a power-spectrum descriptor when the payload format is incompatible', () => {
    expect(
      resolveCurrentSessionStudioBindingView({
        blockTypeId: 'gr::studio::StudioPowerSpectrumSink<float32>',
        nodeInstanceId: 'spectrum0',
        parameterValues: {
          transport: 'http_poll',
          endpoint: 'http://legacy-host:18080/legacy-spectrum',
          update_ms: '180',
        },
        session: runningSession([
          {
            id: 'spectrum0',
            blockInstanceName: 'spectrum0',
            transport: 'http_poll',
            payloadFormat: 'series-window-json-v1',
            path: '/sessions/sess-1/streams/spectrum0/http',
            ready: true,
          },
        ]),
      }),
    ).toMatchObject({
      status: 'invalid',
      transport: 'http_poll',
      reason:
        'Runtime stream "spectrum0" advertised payload "series-window-json-v1" but gr::studio::StudioPowerSpectrumSink<float32> expects "dataset-xy-json-v1".',
    });
  });

  it('rejects a 2D series descriptor when the payload format is incompatible', () => {
    expect(
      resolveCurrentSessionStudioBindingView({
        blockTypeId: 'gr::studio::Studio2DSeriesSink<float32>',
        nodeInstanceId: 'xy0',
        parameterValues: {
          transport: 'websocket',
          endpoint: 'http://legacy-host:18080/legacy-xy',
          update_ms: '90',
        },
        session: runningSession([
          {
            id: 'xy0',
            blockInstanceName: 'xy0',
            transport: 'websocket',
            payloadFormat: 'series-window-json-v1',
            path: '/sessions/sess-1/streams/xy0/ws',
            ready: true,
          },
        ]),
      }),
    ).toMatchObject({
      status: 'invalid',
      transport: 'websocket',
      reason:
        'Runtime stream "xy0" advertised payload "series-window-json-v1" but gr::studio::Studio2DSeriesSink<float32> expects "series2d-xy-json-v1".',
    });
  });

  it('rejects a waterfall descriptor when the payload format is incompatible', () => {
    expect(
      resolveCurrentSessionStudioBindingView({
        blockTypeId: 'gr::studio::StudioWaterfallSink<float32>',
        nodeInstanceId: 'waterfall0',
        parameterValues: {
          transport: 'websocket',
          endpoint: 'http://legacy-host:18080/legacy-waterfall',
          update_ms: '180',
          sample_rate: '48000',
        },
        session: runningSession([
          {
            id: 'waterfall0',
            blockInstanceName: 'waterfall0',
            transport: 'websocket',
            payloadFormat: 'dataset-xy-json-v1',
            path: '/sessions/sess-1/streams/waterfall0/ws',
            ready: true,
          },
        ]),
      }),
    ).toMatchObject({
      status: 'invalid',
      transport: 'websocket',
      reason:
        'Runtime stream "waterfall0" advertised payload "dataset-xy-json-v1" but gr::studio::StudioWaterfallSink<float32> expects "waterfall-spectrum-json-v1".',
    });
  });

  it('rejects a waterfall descriptor when it is not ready', () => {
    expect(
      resolveCurrentSessionStudioBindingView({
        blockTypeId: 'gr::studio::StudioWaterfallSink<float32>',
        nodeInstanceId: 'waterfall0',
        parameterValues: {
          transport: 'websocket',
          endpoint: 'http://legacy-host:18080/legacy-waterfall',
          update_ms: '180',
          sample_rate: '48000',
        },
        session: runningSession([
          {
            id: 'waterfall0',
            blockInstanceName: 'waterfall0',
            transport: 'websocket',
            payloadFormat: 'waterfall-spectrum-json-v1',
            path: '/sessions/sess-1/streams/waterfall0/ws',
            ready: false,
          },
        ]),
      }),
    ).toMatchObject({
      status: 'invalid',
      transport: 'websocket',
      reason: 'Runtime stream "waterfall0" for "waterfall0" is not ready.',
    });
  });

  it('marks descriptor-based runtime unavailable when the descriptor path is empty', () => {
    expect(
      resolveCurrentSessionStudioBindingView({
        blockTypeId: 'gr::studio::StudioSeriesSink<float32>',
        nodeInstanceId: 'series0',
        parameterValues: {
          transport: 'http_poll',
          endpoint: 'http://legacy-host:18080/legacy-series',
        },
        session: runningSession([
          {
            id: 'series0',
            blockInstanceName: 'series0',
            transport: 'http_poll',
            payloadFormat: 'series-window-json-v1',
            path: '   ',
            ready: true,
          },
        ]),
      }),
    ).toMatchObject({
      status: 'invalid',
      transport: 'http_poll',
      reason: 'Runtime stream "series0" for "series0" did not advertise a usable path.',
    });
  });

  it('rejects a waterfall websocket descriptor when its transport does not match the authored transport', () => {
    expect(
      resolveCurrentSessionStudioBindingView({
        blockTypeId: 'gr::studio::StudioWaterfallSink<float32>',
        nodeInstanceId: 'waterfall0',
        parameterValues: {
          transport: 'websocket',
          endpoint: 'http://legacy-host:18080/legacy-waterfall',
          update_ms: '180',
          sample_rate: '48000',
        },
        session: runningSession([
          {
            id: 'waterfall0',
            blockInstanceName: 'waterfall0',
            transport: 'http_poll',
            payloadFormat: 'waterfall-spectrum-json-v1',
            path: '/sessions/sess-1/streams/waterfall0/http',
            ready: true,
          },
        ]),
      }),
    ).toMatchObject({
      status: 'invalid',
      transport: 'websocket',
      reason:
        'Runtime stream "waterfall0" advertised transport "http_poll" but Studio authored transport "websocket" for "waterfall0".',
    });
  });
});
