import { describe, expect, it } from 'vitest';
import {
  STUDIO_KNOWN_BLOCK_BINDINGS,
  STUDIO_PHASE1_SUPPORTED_TRANSPORTS,
  buildStudioBindingView,
  lookupStudioKnownBlockBinding,
  resolveStudioBindingFromParameters,
} from './known-block-bindings';

describe('known Studio block bindings', () => {
  it('uses exact reflected block ID lookup only', () => {
    const known = STUDIO_KNOWN_BLOCK_BINDINGS[0];

    expect(lookupStudioKnownBlockBinding(known.blockTypeId)).not.toBeNull();
    expect(lookupStudioKnownBlockBinding(`${known.blockTypeId} `)).toBeNull();
    expect(lookupStudioKnownBlockBinding('StudioSeriesSink')).toBeNull();
    expect(lookupStudioKnownBlockBinding('gr::studio::StudioSpectrumHistorySink<float32>')).toBeNull();
    expect(lookupStudioKnownBlockBinding('gr::studio::StudioPhosphorSpectrumSink<float32>')).toBeNull();
  });

  it('contains placeholder entries for the registered Studio families', () => {
    const counts = STUDIO_KNOWN_BLOCK_BINDINGS.reduce<Record<string, number>>((acc, binding) => {
      acc[binding.family] = (acc[binding.family] ?? 0) + 1;
      return acc;
    }, {});

    expect(counts).toEqual({
      audio: 2,
      image: 3,
      scalar: 2,
      series: 4,
      series2d: 12,
      status: 2,
      waterfall: 4,
    });
  });

  it('uses a consistent phase-1 transport contract across all known blocks', () => {
    for (const binding of STUDIO_KNOWN_BLOCK_BINDINGS) {
      if (binding.blockTypeId.startsWith('gr::studio::StudioSeriesSink<')) {
        expect(binding.supportedTransports).toEqual([
          'http_snapshot',
          'http_poll',
          'websocket',
        ]);
        continue;
      }

      if (binding.blockTypeId.startsWith('gr::studio::Studio2DSeriesSink<')) {
        expect(binding.supportedTransports).toEqual([
          'http_snapshot',
          'http_poll',
          'websocket',
        ]);
        continue;
      }

      if (
        binding.blockTypeId.startsWith('gr::studio::StudioScalarSink<') ||
        binding.blockTypeId.startsWith('gr::studio::StudioStatusSink<')
      ) {
        expect(binding.supportedTransports).toEqual(['http_poll', 'websocket']);
        continue;
      }

      if (binding.blockTypeId.startsWith('gr::studio::StudioPowerSpectrumSink<')) {
        expect(binding.supportedTransports).toEqual([
          'http_poll',
          'websocket',
        ]);
        continue;
      }

      if (binding.blockTypeId.startsWith('gr::studio::StudioWaterfallSink<')) {
        expect(binding.supportedTransports).toEqual(['http_poll', 'websocket']);
        continue;
      }

      if (binding.blockTypeId.startsWith('gr::studio::StudioAudioSink<')) {
        expect(binding.supportedTransports).toEqual(['websocket']);
        continue;
      }

      expect(binding.supportedTransports).toEqual(STUDIO_PHASE1_SUPPORTED_TRANSPORTS);
    }
  });

  it('resolves explicit transport + endpoint parameters', () => {
    const series = STUDIO_KNOWN_BLOCK_BINDINGS.find((binding) => binding.family === 'series');
    expect(series).toBeDefined();

    const result = resolveStudioBindingFromParameters(series!, {
      transport: 'websocket',
      endpoint: 'http://127.0.0.1:18080/snapshot',
      update_ms: '250',
      n_inputs: '2',
      topic: 'demo',
    });

    expect(result).toEqual({
      ok: true,
      transport: 'websocket',
      endpoint: 'http://127.0.0.1:18080/snapshot',
      updateMs: 250,
      channels: undefined,
      topic: 'demo',
      sampleRate: undefined,
    });
  });

  it('rejects invalid transport or missing endpoint', () => {
    const audio = STUDIO_KNOWN_BLOCK_BINDINGS.find((binding) => binding.family === 'audio');
    expect(audio).toBeDefined();

    const missingEndpoint = resolveStudioBindingFromParameters(audio!, {
      transport: 'websocket',
    });
    expect(missingEndpoint.ok).toBe(false);

    const invalidTransport = resolveStudioBindingFromParameters(audio!, {
      transport: 'sse',
      endpoint: 'ws://127.0.0.1:9000/stream',
    });
    expect(invalidTransport).toEqual({
      ok: false,
      reason: 'Unsupported transport mode: sse',
    });
  });

  it('exposes normalized inspector binding states', () => {
    const knownSeriesId = 'gr::studio::StudioSeriesSink<float32>';

    const unsupported = buildStudioBindingView('gr::blocks::NullSink<float>', {});
    expect(unsupported.status).toBe('unsupported');

    const unconfigured = buildStudioBindingView(knownSeriesId, {
      transport: 'http_snapshot',
    });
    expect(unconfigured.status).toBe('unconfigured');

    const websocketConfigured = buildStudioBindingView(knownSeriesId, {
      transport: 'websocket',
      endpoint: 'ws://127.0.0.1:9999',
    });
    expect(websocketConfigured).toMatchObject({
      status: 'configured',
      transport: 'websocket',
      endpoint: 'ws://127.0.0.1:9999',
    });

    const configured = buildStudioBindingView(knownSeriesId, {
      transport: 'websocket',
      endpoint: 'http://127.0.0.1:18080/snapshot',
      update_ms: '200',
    });
    expect(configured).toMatchObject({
      status: 'configured',
      transport: 'websocket',
      endpoint: 'http://127.0.0.1:18080/snapshot',
      updateMs: 200,
    });

    const complexSeriesConfigured = buildStudioBindingView('gr::studio::StudioSeriesSink<complex<float32>>', {
      transport: 'http_snapshot',
      endpoint: 'http://127.0.0.1:18080/snapshot',
    });
    expect(complexSeriesConfigured).toMatchObject({
      status: 'configured',
      family: 'series',
      transport: 'http_snapshot',
    });

    const known2DId = 'gr::studio::Studio2DSeriesSink<float32>';
    const series2DConfigured = buildStudioBindingView(known2DId, {
      transport: 'http_snapshot',
      endpoint: 'http://127.0.0.1:18081/snapshot',
      update_ms: '250',
    });
    expect(series2DConfigured).toMatchObject({
      status: 'configured',
      family: 'series2d',
      transport: 'http_snapshot',
      endpoint: 'http://127.0.0.1:18081/snapshot',
    });

    const series2DWebsocketConfigured = buildStudioBindingView(known2DId, {
      transport: 'websocket',
      endpoint: 'http://127.0.0.1:18081/snapshot',
      update_ms: '90',
    });
    expect(series2DWebsocketConfigured).toMatchObject({
      status: 'configured',
      family: 'series2d',
      payloadFormat: 'series2d-xy-json-v1',
      transport: 'websocket',
      endpoint: 'http://127.0.0.1:18081/snapshot',
      updateMs: 90,
    });

    const knownDataSetId = 'gr::studio::StudioDataSetSink<float32>';
    const dataSetConfigured = buildStudioBindingView(knownDataSetId, {
      transport: 'http_poll',
      endpoint: 'http://127.0.0.1:18084/snapshot',
      poll_ms: '100',
    });
    expect(dataSetConfigured).toMatchObject({
      status: 'configured',
      family: 'series2d',
      payloadFormat: 'dataset-xy-json-v1',
      transport: 'http_poll',
      endpoint: 'http://127.0.0.1:18084/snapshot',
      updateMs: 100,
    });

    const powerSpectrumConfigured = buildStudioBindingView('gr::studio::StudioPowerSpectrumSink<float32>', {
      transport: 'websocket',
      endpoint: 'http://127.0.0.1:18086/snapshot',
      update_ms: '150',
      sample_rate: '48000',
      topic: 'spectrum',
    });

    expect(powerSpectrumConfigured).toMatchObject({
      status: 'configured',
      family: 'series2d',
      payloadFormat: 'dataset-xy-json-v1',
      transport: 'websocket',
      endpoint: 'http://127.0.0.1:18086/snapshot',
      sampleRate: 48000,
      topic: 'spectrum',
    });

    const waterfallConfigured = buildStudioBindingView('gr::studio::StudioWaterfallSink<float32>', {
      transport: 'http_poll',
      endpoint: 'http://127.0.0.1:18087/snapshot',
      update_ms: '200',
      sample_rate: '48000',
      topic: 'waterfall',
    });
    expect(waterfallConfigured).toMatchObject({
      status: 'configured',
      family: 'waterfall',
      payloadFormat: 'waterfall-spectrum-json-v1',
      transport: 'http_poll',
      endpoint: 'http://127.0.0.1:18087/snapshot',
      updateMs: 200,
      sampleRate: 48000,
      topic: 'waterfall',
    });

    const waterfallWebsocketConfigured = buildStudioBindingView('gr::studio::StudioWaterfallSink<float32>', {
      transport: 'websocket',
      endpoint: 'http://127.0.0.1:18087/snapshot',
      update_ms: '240',
      sample_rate: '96000',
    });
    expect(waterfallWebsocketConfigured).toMatchObject({
      status: 'configured',
      family: 'waterfall',
      transport: 'websocket',
      endpoint: 'http://127.0.0.1:18087/snapshot',
      updateMs: 240,
      sampleRate: 96000,
    });

    const imageConfigured = buildStudioBindingView('gr::studio::StudioImageSink<uint8>', {
      transport: 'http_snapshot',
      endpoint: 'http://127.0.0.1:18082/snapshot',
      poll_ms: '300',
      channels: '1',
    });
    expect(imageConfigured).toMatchObject({
      status: 'configured',
      family: 'image',
      transport: 'http_snapshot',
      endpoint: 'http://127.0.0.1:18082/snapshot',
      channels: 1,
    });

    const audioSinkConfigured = buildStudioBindingView('gr::studio::StudioAudioSink<float32>', {
      transport: 'websocket',
      endpoint: 'ws://127.0.0.1:18084/audio',
      sample_rate: '48000',
      channels: '1',
    });
    expect(audioSinkConfigured).toMatchObject({
      status: 'configured',
      family: 'audio',
      payloadFormat: 'audio-float32-binary-v1',
      transport: 'websocket',
      endpoint: 'ws://127.0.0.1:18084/audio',
      sampleRate: 48000,
      channels: 1,
    });

    const scalarSinkConfigured = buildStudioBindingView('gr::studio::StudioScalarSink<float32>', {
      transport: 'http_poll',
      endpoint: 'http://127.0.0.1:18088/scalars',
      update_ms: '200',
      channels: '2',
    });
    expect(scalarSinkConfigured).toMatchObject({
      status: 'configured',
      family: 'scalar',
      payloadFormat: 'scalar-status-json-v1',
      transport: 'http_poll',
      endpoint: 'http://127.0.0.1:18088/scalars',
      updateMs: 200,
      channels: 2,
    });

    const scalarSnapshotConfigured = buildStudioBindingView('gr::studio::StudioScalarSink<float32>', {
      transport: 'http_snapshot',
      endpoint: 'http://127.0.0.1:18088/scalars',
    });
    expect(scalarSnapshotConfigured).toMatchObject({
      status: 'invalid',
      family: 'scalar',
      transport: 'http_snapshot',
      reason: 'Transport http_snapshot is not allowed for gr::studio::StudioScalarSink<float32>.',
    });

    const statusSinkConfigured = buildStudioBindingView('gr::studio::StudioStatusSink<float32>', {
      transport: 'websocket',
      endpoint: 'ws://127.0.0.1:18089/status',
      update_ms: '300',
      channels: '3',
    });
    expect(statusSinkConfigured).toMatchObject({
      status: 'configured',
      family: 'status',
      payloadFormat: 'scalar-status-json-v1',
      transport: 'websocket',
      endpoint: 'ws://127.0.0.1:18089/status',
      updateMs: 300,
      channels: 3,
    });
  });
});
