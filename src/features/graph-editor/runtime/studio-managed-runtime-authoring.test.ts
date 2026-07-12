import { describe, expect, it } from 'vitest';
import {
  buildStudioDescriptorAuthoringView,
  buildStudioAuthoringBindingView,
  getAuthoringParameterLabel,
  getDescriptorBindingAuthoringMessage,
  isDescriptorBindingHiddenParameter,
  isDescriptorBasedBindingFamily,
} from './studio-managed-runtime-authoring';

describe('descriptor-based authoring helpers', () => {
  it('keeps StudioSeriesSink transport-authored while hiding endpoint from descriptor authoring UX', () => {
    expect(isDescriptorBasedBindingFamily('gr::studio::StudioSeriesSink<float32>')).toBe(true);
    expect(isDescriptorBindingHiddenParameter('gr::studio::StudioSeriesSink<float32>', 'endpoint')).toBe(true);
    expect(getAuthoringParameterLabel('gr::studio::StudioSeriesSink<float32>', 'endpoint', 'Endpoint')).toBe('Endpoint');

    expect(
      buildStudioAuthoringBindingView('gr::studio::StudioSeriesSink<float32>', {
        transport: 'websocket',
        endpoint: 'http://legacy-host:18080/legacy-series',
      }),
    ).toMatchObject({
      status: 'configured',
      transport: 'websocket',
      reason:
        'Descriptor-based session routes come from the linked session. Transport stays authored. Endpoint is persisted only for older documents and is not used by Studio runtime.',
    });
    expect(
      buildStudioAuthoringBindingView('gr::studio::StudioSeriesSink<float32>', {
        transport: 'websocket',
        endpoint: 'http://legacy-host:18080/legacy-series',
      }).endpoint,
    ).toBeUndefined();
  });

  it('keeps StudioPowerSpectrumSink transport-authored while ignoring authored endpoint in the descriptor view', () => {
    expect(isDescriptorBasedBindingFamily('gr::studio::StudioPowerSpectrumSink<float32>')).toBe(true);
    expect(isDescriptorBindingHiddenParameter('gr::studio::StudioPowerSpectrumSink<float32>', 'endpoint')).toBe(true);

    expect(
      buildStudioAuthoringBindingView('gr::studio::StudioPowerSpectrumSink<float32>', {
        transport: 'http_poll',
        endpoint: 'http://legacy-host:18080/legacy-spectrum',
        update_ms: '150',
      }),
    ).toMatchObject({
      status: 'configured',
      transport: 'http_poll',
      updateMs: 150,
    });
    expect(
      buildStudioAuthoringBindingView('gr::studio::StudioPowerSpectrumSink<float32>', {
        transport: 'http_poll',
        endpoint: 'http://legacy-host:18080/legacy-spectrum',
        update_ms: '150',
      }).endpoint,
    ).toBeUndefined();
  });

  it('keeps Studio2DSeriesSink transport-authored while ignoring authored endpoint in the descriptor view', () => {
    expect(isDescriptorBasedBindingFamily('gr::studio::Studio2DSeriesSink<float32>')).toBe(true);
    expect(isDescriptorBindingHiddenParameter('gr::studio::Studio2DSeriesSink<float32>', 'endpoint')).toBe(true);

    expect(
      buildStudioAuthoringBindingView('gr::studio::Studio2DSeriesSink<float32>', {
        transport: 'websocket',
        endpoint: 'http://legacy-host:18080/legacy-xy',
        update_ms: '90',
      }),
    ).toMatchObject({
      status: 'configured',
      transport: 'websocket',
      updateMs: 90,
      payloadFormat: 'series2d-xy-json-v1',
    });
    expect(
      buildStudioAuthoringBindingView('gr::studio::Studio2DSeriesSink<float32>', {
        transport: 'websocket',
        endpoint: 'http://legacy-host:18080/legacy-xy',
      }).endpoint,
    ).toBeUndefined();
  });

  it('keeps StudioWaterfallSink transport-authored while ignoring authored endpoint in the descriptor view', () => {
    expect(isDescriptorBasedBindingFamily('gr::studio::StudioWaterfallSink<float32>')).toBe(true);
    expect(isDescriptorBindingHiddenParameter('gr::studio::StudioWaterfallSink<float32>', 'endpoint')).toBe(true);
    expect(getDescriptorBindingAuthoringMessage('gr::studio::StudioWaterfallSink<float32>')).toBe(
      'Descriptor-based session routes come from the linked session. Transport stays authored. Endpoint is persisted only for older documents and is not used by Studio runtime.',
    );

    expect(
      buildStudioAuthoringBindingView('gr::studio::StudioWaterfallSink<float32>', {
        transport: 'http_poll',
        endpoint: 'http://legacy-host:18080/legacy-waterfall',
        update_ms: '175',
        sample_rate: '48000',
      }),
    ).toMatchObject({
      status: 'configured',
      transport: 'http_poll',
      updateMs: 175,
      sampleRate: 48000,
      reason:
        'Descriptor-based session routes come from the linked session. Transport stays authored. Endpoint is persisted only for older documents and is not used by Studio runtime.',
    });
    expect(
      buildStudioAuthoringBindingView('gr::studio::StudioWaterfallSink<float32>', {
        transport: 'http_poll',
        endpoint: 'http://legacy-host:18080/legacy-waterfall',
      }).endpoint,
    ).toBeUndefined();
  });

  it('keeps StudioWaterfallSink websocket transport authored while still ignoring authored endpoint in the descriptor view', () => {
    expect(
      buildStudioAuthoringBindingView('gr::studio::StudioWaterfallSink<float32>', {
        transport: 'websocket',
        endpoint: 'http://legacy-host:18080/legacy-waterfall',
        update_ms: '210',
        sample_rate: '96000',
      }),
    ).toMatchObject({
      status: 'configured',
      transport: 'websocket',
      updateMs: 210,
      sampleRate: 96000,
      reason:
        'Descriptor-based session routes come from the linked session. Transport stays authored. Endpoint is persisted only for older documents and is not used by Studio runtime.',
    });
  });

  it('keeps StudioAudioSink transport-authored while ignoring authored endpoint in the descriptor view', () => {
    expect(isDescriptorBasedBindingFamily('gr::studio::StudioAudioSink<float32>')).toBe(true);
    expect(isDescriptorBindingHiddenParameter('gr::studio::StudioAudioSink<float32>', 'endpoint')).toBe(true);

    expect(
      buildStudioAuthoringBindingView('gr::studio::StudioAudioSink<float32>', {
        transport: 'websocket',
        endpoint: 'ws://legacy-host:18084/legacy-audio',
        sample_rate: '48000',
        channels: '1',
      }),
    ).toMatchObject({
      status: 'configured',
      family: 'audio',
      payloadFormat: 'audio-float32-binary-v1',
      transport: 'websocket',
      sampleRate: 48000,
      channels: 1,
      reason:
        'Descriptor-based session routes come from the linked session. Transport stays authored. Endpoint is persisted only for older documents and is not used by Studio runtime.',
    });
    expect(
      buildStudioAuthoringBindingView('gr::studio::StudioAudioSink<float32>', {
        transport: 'websocket',
        endpoint: 'ws://legacy-host:18084/legacy-audio',
      }).endpoint,
    ).toBeUndefined();
  });

  it('keeps scalar/status sink transport-authored while ignoring authored endpoints', () => {
    expect(isDescriptorBasedBindingFamily('gr::studio::StudioScalarSink<float32>')).toBe(true);
    expect(isDescriptorBasedBindingFamily('gr::studio::StudioStatusSink<float32>')).toBe(true);
    expect(isDescriptorBindingHiddenParameter('gr::studio::StudioScalarSink<float32>', 'endpoint')).toBe(true);
    expect(isDescriptorBindingHiddenParameter('gr::studio::StudioStatusSink<float32>', 'endpoint')).toBe(true);

    const scalar = buildStudioAuthoringBindingView('gr::studio::StudioScalarSink<float32>', {
      transport: 'http_poll',
      endpoint: 'http://legacy-host:18088/scalars',
      update_ms: '200',
      channels: '2',
    });
    expect(scalar).toMatchObject({
      status: 'configured',
      family: 'scalar',
      payloadFormat: 'scalar-status-json-v1',
      transport: 'http_poll',
      updateMs: 200,
      channels: 2,
      reason:
        'Descriptor-based session routes come from the linked session. Transport stays authored. Endpoint is persisted only for older documents and is not used by Studio runtime.',
    });
    expect(scalar.endpoint).toBeUndefined();

    const status = buildStudioAuthoringBindingView('gr::studio::StudioStatusSink<float32>', {
      transport: 'websocket',
      endpoint: 'ws://legacy-host:18089/status',
      update_ms: '300',
    });
    expect(status).toMatchObject({
      status: 'configured',
      family: 'status',
      payloadFormat: 'scalar-status-json-v1',
      transport: 'websocket',
      updateMs: 300,
    });
    expect(status.endpoint).toBeUndefined();
  });

  it('extracts descriptor-based transport settings for known Studio blocks outside the hidden-endpoint list', () => {
    expect(
      buildStudioDescriptorAuthoringView('gr::studio::StudioDataSetSink<float32>', {
        transport: 'http_poll',
        poll_ms: '220',
        topic: 'dataset',
      }),
    ).toMatchObject({
      status: 'configured',
      family: 'series2d',
      transport: 'http_poll',
      updateMs: 220,
      topic: 'dataset',
    });
  });
});
