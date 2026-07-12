export type StudioBindingFamily = 'series' | 'series2d' | 'histogram' | 'waterfall' | 'audio' | 'image' | 'scalar' | 'status';

export type StudioTransportMode = 'http_snapshot' | 'http_poll' | 'zmq_sub' | 'websocket';
export const STUDIO_PHASE1_SUPPORTED_TRANSPORTS = ['http_snapshot', 'http_poll'] as const;

export type StudioBindingParameterMap = {
  transport: 'transport';
  endpoint: 'endpoint';
  pollMs?: 'poll_ms';
  updateMs?: 'update_ms';
  sampleRate?: 'sample_rate';
  channels?: 'channels';
  topic?: 'topic';
};

export type StudioKnownBlockBinding = {
  blockTypeId: string;
  family: StudioBindingFamily;
  supportedTransports: readonly StudioTransportMode[];
  parameters: StudioBindingParameterMap;
  payloadFormat: string;
  notes?: string;
};

export type StudioBindingResolution =
  | {
      ok: true;
      transport: StudioTransportMode;
      endpoint: string;
      topic?: string;
      updateMs?: number;
      sampleRate?: number;
      channels?: number;
    }
  | {
      ok: false;
      reason: string;
    };

export type StudioBindingStatus = 'unsupported' | 'unconfigured' | 'configured' | 'invalid';

export type StudioBindingView = {
  status: StudioBindingStatus;
  blockTypeId: string;
  family?: StudioBindingFamily;
  payloadFormat?: string;
  transport?: string;
  endpoint?: string;
  updateMs?: number;
  sampleRate?: number;
  channels?: number;
  topic?: string;
  reason?: string;
};

function parseInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizeString(value: string | undefined): string {
  return (value ?? '').trim();
}

function isSupportedTransport(value: string): value is StudioTransportMode {
  return value === 'http_snapshot' || value === 'http_poll' || value === 'zmq_sub' || value === 'websocket';
}

// TODO: Replace these placeholder IDs with final reflected fully qualified IDs
// from the first-party blocks once block registration is finalized.
const STUDIO_SERIES_SUPPORTED_TRANSPORTS = ['http_snapshot', 'http_poll', 'websocket'] as const;
const STUDIO_2D_SERIES_SUPPORTED_TRANSPORTS = ['http_snapshot', 'http_poll', 'websocket'] as const;
const STUDIO_POWER_SPECTRUM_SUPPORTED_TRANSPORTS = ['http_poll', 'websocket'] as const;
const STUDIO_WATERFALL_SUPPORTED_TRANSPORTS = ['http_poll', 'websocket'] as const;
const STUDIO_AUDIO_PLAYBACK_SUPPORTED_TRANSPORTS = ['websocket'] as const;
const STUDIO_SCALAR_STATUS_SUPPORTED_TRANSPORTS = ['http_poll', 'websocket'] as const;
export const STUDIO_KNOWN_BLOCK_BINDINGS: readonly StudioKnownBlockBinding[] = [
  {
    blockTypeId: 'gr::studio::StudioSeriesSink<float32>',
    family: 'series',
    supportedTransports: STUDIO_SERIES_SUPPORTED_TRANSPORTS,
    parameters: {
      transport: 'transport',
      endpoint: 'endpoint',
      updateMs: 'update_ms',
      topic: 'topic',
    },
    payloadFormat: 'series-window-json-v1',
    // Where applicable, HTTP snapshot/poll semantics should follow
    // gr4-incubator HttpTimeSeriesSink behavior.
    notes: 'Series sink supports http_snapshot/http_poll/websocket. Update cadence uses update_ms.',
  },
  {
    blockTypeId: 'gr::studio::StudioSeriesSink<complex64>',
    family: 'series',
    supportedTransports: STUDIO_SERIES_SUPPORTED_TRANSPORTS,
    parameters: {
      transport: 'transport',
      endpoint: 'endpoint',
      updateMs: 'update_ms',
      topic: 'topic',
    },
    payloadFormat: 'series-window-json-v1',
    notes: 'Series sink supports http_snapshot/http_poll/websocket. Update cadence uses update_ms.',
  },
  {
    blockTypeId: 'gr::studio::StudioSeriesSink<complex<float32>>',
    family: 'series',
    supportedTransports: STUDIO_SERIES_SUPPORTED_TRANSPORTS,
    parameters: {
      transport: 'transport',
      endpoint: 'endpoint',
      updateMs: 'update_ms',
      topic: 'topic',
    },
    payloadFormat: 'series-window-json-v1',
    notes: 'Series sink supports http_snapshot/http_poll/websocket. Update cadence uses update_ms.',
  },
  {
    blockTypeId: 'gr::studio::StudioSeriesSink<std::complex<float32>>',
    family: 'series',
    supportedTransports: STUDIO_SERIES_SUPPORTED_TRANSPORTS,
    parameters: {
      transport: 'transport',
      endpoint: 'endpoint',
      updateMs: 'update_ms',
      topic: 'topic',
    },
    payloadFormat: 'series-window-json-v1',
    notes: 'Series sink supports http_snapshot/http_poll/websocket. Update cadence uses update_ms.',
  },
  {
    blockTypeId: 'gr::studio::Studio2DSeriesSink<float32>',
    family: 'series2d',
    supportedTransports: STUDIO_2D_SERIES_SUPPORTED_TRANSPORTS,
    parameters: {
      transport: 'transport',
      endpoint: 'endpoint',
      updateMs: 'update_ms',
      topic: 'topic',
    },
    payloadFormat: 'series2d-xy-json-v1',
    notes: '2D XY sink supports http_snapshot/http_poll/websocket. Live cadence uses update_ms.',
  },
  {
    blockTypeId: 'gr::studio::Studio2DSeriesSink<complex64>',
    family: 'series2d',
    supportedTransports: STUDIO_2D_SERIES_SUPPORTED_TRANSPORTS,
    parameters: {
      transport: 'transport',
      endpoint: 'endpoint',
      updateMs: 'update_ms',
      topic: 'topic',
    },
    payloadFormat: 'series2d-xy-json-v1',
    notes: '2D XY sink supports http_snapshot/http_poll/websocket. Live cadence uses update_ms.',
  },
  {
    blockTypeId: 'gr::studio::Studio2DSeriesSink<complex<float32>>',
    family: 'series2d',
    supportedTransports: STUDIO_2D_SERIES_SUPPORTED_TRANSPORTS,
    parameters: {
      transport: 'transport',
      endpoint: 'endpoint',
      updateMs: 'update_ms',
      topic: 'topic',
    },
    payloadFormat: 'series2d-xy-json-v1',
    notes: '2D XY sink supports http_snapshot/http_poll/websocket. Live cadence uses update_ms.',
  },
  {
    blockTypeId: 'gr::studio::Studio2DSeriesSink<std::complex<float32>>',
    family: 'series2d',
    supportedTransports: STUDIO_2D_SERIES_SUPPORTED_TRANSPORTS,
    parameters: {
      transport: 'transport',
      endpoint: 'endpoint',
      updateMs: 'update_ms',
      topic: 'topic',
    },
    payloadFormat: 'series2d-xy-json-v1',
    notes: '2D XY sink supports http_snapshot/http_poll/websocket. Live cadence uses update_ms.',
  },
  {
    blockTypeId: 'gr::studio::StudioScalarSink<float32>',
    family: 'scalar',
    supportedTransports: STUDIO_SCALAR_STATUS_SUPPORTED_TRANSPORTS,
    parameters: {
      transport: 'transport',
      endpoint: 'endpoint',
      updateMs: 'update_ms',
      channels: 'channels',
      topic: 'topic',
    },
    payloadFormat: 'scalar-status-json-v1',
    notes: 'Latest scalar dashboard sink supports http_snapshot/http_poll/websocket. Update cadence uses update_ms.',
  },
  {
    blockTypeId: 'gr::studio::StudioScalarSink<float>',
    family: 'scalar',
    supportedTransports: STUDIO_SCALAR_STATUS_SUPPORTED_TRANSPORTS,
    parameters: {
      transport: 'transport',
      endpoint: 'endpoint',
      updateMs: 'update_ms',
      channels: 'channels',
      topic: 'topic',
    },
    payloadFormat: 'scalar-status-json-v1',
    notes: 'Latest scalar dashboard sink supports http_snapshot/http_poll/websocket. Update cadence uses update_ms.',
  },
  {
    blockTypeId: 'gr::studio::StudioStatusSink<float32>',
    family: 'status',
    supportedTransports: STUDIO_SCALAR_STATUS_SUPPORTED_TRANSPORTS,
    parameters: {
      transport: 'transport',
      endpoint: 'endpoint',
      updateMs: 'update_ms',
      channels: 'channels',
      topic: 'topic',
    },
    payloadFormat: 'scalar-status-json-v1',
    notes: 'Latest status dashboard sink supports http_snapshot/http_poll/websocket. Update cadence uses update_ms.',
  },
  {
    blockTypeId: 'gr::studio::StudioStatusSink<float>',
    family: 'status',
    supportedTransports: STUDIO_SCALAR_STATUS_SUPPORTED_TRANSPORTS,
    parameters: {
      transport: 'transport',
      endpoint: 'endpoint',
      updateMs: 'update_ms',
      channels: 'channels',
      topic: 'topic',
    },
    payloadFormat: 'scalar-status-json-v1',
    notes: 'Latest status dashboard sink supports http_snapshot/http_poll/websocket. Update cadence uses update_ms.',
  },
  {
    blockTypeId: 'gr::studio::StudioDataSetSink<float32>',
    family: 'series2d',
    supportedTransports: STUDIO_PHASE1_SUPPORTED_TRANSPORTS,
    parameters: {
      transport: 'transport',
      endpoint: 'endpoint',
      pollMs: 'poll_ms',
      topic: 'topic',
    },
    payloadFormat: 'dataset-xy-json-v1',
    notes: 'DataSet-backed XY sink payload. Phase 1 supports only http_snapshot/http_poll.',
  },
  {
    blockTypeId: 'gr::studio::StudioDataSetSink<float64>',
    family: 'series2d',
    supportedTransports: STUDIO_PHASE1_SUPPORTED_TRANSPORTS,
    parameters: {
      transport: 'transport',
      endpoint: 'endpoint',
      pollMs: 'poll_ms',
      topic: 'topic',
    },
    payloadFormat: 'dataset-xy-json-v1',
    notes: 'DataSet-backed XY sink payload. Phase 1 supports only http_snapshot/http_poll.',
  },
  {
    blockTypeId: 'gr::studio::StudioDataSetSink<float>',
    family: 'series2d',
    supportedTransports: STUDIO_PHASE1_SUPPORTED_TRANSPORTS,
    parameters: {
      transport: 'transport',
      endpoint: 'endpoint',
      pollMs: 'poll_ms',
      topic: 'topic',
    },
    payloadFormat: 'dataset-xy-json-v1',
    notes: 'DataSet-backed XY sink payload. Phase 1 supports only http_snapshot/http_poll.',
  },
  {
    blockTypeId: 'gr::studio::StudioDataSetSink<double>',
    family: 'series2d',
    supportedTransports: STUDIO_PHASE1_SUPPORTED_TRANSPORTS,
    parameters: {
      transport: 'transport',
      endpoint: 'endpoint',
      pollMs: 'poll_ms',
      topic: 'topic',
    },
    payloadFormat: 'dataset-xy-json-v1',
    notes: 'DataSet-backed XY sink payload. Phase 1 supports only http_snapshot/http_poll.',
  },
  {
    blockTypeId: 'gr::studio::StudioPowerSpectrumSink<float32>',
    family: 'series2d',
    supportedTransports: STUDIO_POWER_SPECTRUM_SUPPORTED_TRANSPORTS,
    parameters: {
      transport: 'transport',
      endpoint: 'endpoint',
      updateMs: 'update_ms',
      sampleRate: 'sample_rate',
      topic: 'topic',
    },
    payloadFormat: 'dataset-xy-json-v1',
    notes: 'Frequency-domain dataset payload. Supports http_poll/websocket.',
  },
  {
    blockTypeId: 'gr::studio::StudioPowerSpectrumSink<complex64>',
    family: 'series2d',
    supportedTransports: STUDIO_POWER_SPECTRUM_SUPPORTED_TRANSPORTS,
    parameters: {
      transport: 'transport',
      endpoint: 'endpoint',
      updateMs: 'update_ms',
      sampleRate: 'sample_rate',
      topic: 'topic',
    },
    payloadFormat: 'dataset-xy-json-v1',
    notes: 'Frequency-domain dataset payload. Supports http_poll/websocket.',
  },
  {
    blockTypeId: 'gr::studio::StudioPowerSpectrumSink<complex<float32>>',
    family: 'series2d',
    supportedTransports: STUDIO_POWER_SPECTRUM_SUPPORTED_TRANSPORTS,
    parameters: {
      transport: 'transport',
      endpoint: 'endpoint',
      updateMs: 'update_ms',
      sampleRate: 'sample_rate',
      topic: 'topic',
    },
    payloadFormat: 'dataset-xy-json-v1',
    notes: 'Frequency-domain dataset payload. Supports http_poll/websocket.',
  },
  {
    blockTypeId: 'gr::studio::StudioPowerSpectrumSink<std::complex<float32>>',
    family: 'series2d',
    supportedTransports: STUDIO_POWER_SPECTRUM_SUPPORTED_TRANSPORTS,
    parameters: {
      transport: 'transport',
      endpoint: 'endpoint',
      updateMs: 'update_ms',
      sampleRate: 'sample_rate',
      topic: 'topic',
    },
    payloadFormat: 'dataset-xy-json-v1',
    notes: 'Frequency-domain dataset payload. Supports http_poll/websocket.',
  },
  {
    blockTypeId: 'gr::studio::StudioWaterfallSink<float32>',
    family: 'waterfall',
    supportedTransports: STUDIO_WATERFALL_SUPPORTED_TRANSPORTS,
    parameters: {
      transport: 'transport',
      endpoint: 'endpoint',
      updateMs: 'update_ms',
      sampleRate: 'sample_rate',
      topic: 'topic',
    },
    payloadFormat: 'waterfall-spectrum-json-v1',
    notes: 'Waterfall history payload backed by a bounded matrix snapshot. Supports http_poll/websocket.',
  },
  {
    blockTypeId: 'gr::studio::StudioWaterfallSink<complex64>',
    family: 'waterfall',
    supportedTransports: STUDIO_WATERFALL_SUPPORTED_TRANSPORTS,
    parameters: {
      transport: 'transport',
      endpoint: 'endpoint',
      updateMs: 'update_ms',
      sampleRate: 'sample_rate',
      topic: 'topic',
    },
    payloadFormat: 'waterfall-spectrum-json-v1',
    notes: 'Waterfall history payload backed by a bounded matrix snapshot. Supports http_poll/websocket.',
  },
  {
    blockTypeId: 'gr::studio::StudioWaterfallSink<complex<float32>>',
    family: 'waterfall',
    supportedTransports: STUDIO_WATERFALL_SUPPORTED_TRANSPORTS,
    parameters: {
      transport: 'transport',
      endpoint: 'endpoint',
      updateMs: 'update_ms',
      sampleRate: 'sample_rate',
      topic: 'topic',
    },
    payloadFormat: 'waterfall-spectrum-json-v1',
    notes: 'Waterfall history payload backed by a bounded matrix snapshot. Supports http_poll/websocket.',
  },
  {
    blockTypeId: 'gr::studio::StudioWaterfallSink<std::complex<float32>>',
    family: 'waterfall',
    supportedTransports: STUDIO_WATERFALL_SUPPORTED_TRANSPORTS,
    parameters: {
      transport: 'transport',
      endpoint: 'endpoint',
      updateMs: 'update_ms',
      sampleRate: 'sample_rate',
      topic: 'topic',
    },
    payloadFormat: 'waterfall-spectrum-json-v1',
    notes: 'Waterfall history payload backed by a bounded matrix snapshot. Supports http_poll/websocket.',
  },
  {
    blockTypeId: 'gr::studio::StudioAudioSink<float32>',
    family: 'audio',
    supportedTransports: STUDIO_AUDIO_PLAYBACK_SUPPORTED_TRANSPORTS,
    parameters: {
      transport: 'transport',
      endpoint: 'endpoint',
      sampleRate: 'sample_rate',
      channels: 'channels',
      topic: 'topic',
    },
    payloadFormat: 'audio-float32-binary-v1',
    notes: 'WebSocket binary float32 audio frames for browser AudioWorklet playback.',
  },
  {
    blockTypeId: 'gr::studio::StudioAudioSink<float>',
    family: 'audio',
    supportedTransports: STUDIO_AUDIO_PLAYBACK_SUPPORTED_TRANSPORTS,
    parameters: {
      transport: 'transport',
      endpoint: 'endpoint',
      sampleRate: 'sample_rate',
      channels: 'channels',
      topic: 'topic',
    },
    payloadFormat: 'audio-float32-binary-v1',
    notes: 'WebSocket binary float32 audio frames for browser AudioWorklet playback.',
  },
  {
    blockTypeId: 'gr::studio::StudioImageSink<uint8>',
    family: 'image',
    supportedTransports: STUDIO_PHASE1_SUPPORTED_TRANSPORTS,
    parameters: {
      transport: 'transport',
      endpoint: 'endpoint',
      pollMs: 'poll_ms',
      channels: 'channels',
      topic: 'topic',
    },
    payloadFormat: 'image-frame-json-v1',
    notes: 'Phase 1 supports only http_snapshot/http_poll. Unsupported for now: zmq_sub, websocket. Generic frame sink can back waterfall/heatmap UX later.',
  },
  {
    blockTypeId: 'gr::studio::StudioImageSink<uint8_t>',
    family: 'image',
    supportedTransports: STUDIO_PHASE1_SUPPORTED_TRANSPORTS,
    parameters: {
      transport: 'transport',
      endpoint: 'endpoint',
      pollMs: 'poll_ms',
      channels: 'channels',
      topic: 'topic',
    },
    payloadFormat: 'image-frame-json-v1',
    notes: 'Phase 1 supports only http_snapshot/http_poll. Unsupported for now: zmq_sub, websocket. Generic frame sink can back waterfall/heatmap UX later.',
  },
  {
    blockTypeId: 'gr::studio::StudioImageSink<std::uint8_t>',
    family: 'image',
    supportedTransports: STUDIO_PHASE1_SUPPORTED_TRANSPORTS,
    parameters: {
      transport: 'transport',
      endpoint: 'endpoint',
      pollMs: 'poll_ms',
      channels: 'channels',
      topic: 'topic',
    },
    payloadFormat: 'image-frame-json-v1',
    notes: 'Phase 1 supports only http_snapshot/http_poll. Unsupported for now: zmq_sub, websocket. Generic frame sink can back waterfall/heatmap UX later.',
  },
] as const;

export const STUDIO_KNOWN_BLOCK_BINDINGS_BY_ID = new Map<string, StudioKnownBlockBinding>(
  STUDIO_KNOWN_BLOCK_BINDINGS.map((binding) => [binding.blockTypeId, binding]),
);

export function lookupStudioKnownBlockBinding(blockTypeId: string): StudioKnownBlockBinding | null {
  return STUDIO_KNOWN_BLOCK_BINDINGS_BY_ID.get(blockTypeId) ?? null;
}

export function resolveStudioBindingFromParameters(
  binding: StudioKnownBlockBinding,
  parameterValues: Record<string, string>,
): StudioBindingResolution {
  const transportRaw = normalizeString(parameterValues[binding.parameters.transport]);
  if (!transportRaw) {
    return {
      ok: false,
      reason: 'Missing required transport parameter.',
    };
  }

  if (!isSupportedTransport(transportRaw)) {
    return {
      ok: false,
      reason: `Unsupported transport mode: ${transportRaw}`,
    };
  }

  if (!binding.supportedTransports.includes(transportRaw)) {
    return {
      ok: false,
      reason: `Transport ${transportRaw} is not allowed for ${binding.blockTypeId}.`,
    };
  }

  const endpoint = normalizeString(parameterValues[binding.parameters.endpoint]);
  if (!endpoint) {
    return {
      ok: false,
      reason: 'Missing required endpoint parameter.',
    };
  }

  const cadenceParameter = binding.parameters.updateMs ?? binding.parameters.pollMs;
  const updateMs = cadenceParameter
    ? parseInteger(parameterValues[cadenceParameter])
    : undefined;
  const sampleRate = binding.parameters.sampleRate
    ? parseInteger(parameterValues[binding.parameters.sampleRate])
    : undefined;
  const channels = binding.parameters.channels
    ? parseInteger(parameterValues[binding.parameters.channels])
    : undefined;
  const topic = binding.parameters.topic
    ? normalizeString(parameterValues[binding.parameters.topic]) || undefined
    : undefined;

  return {
    ok: true,
    transport: transportRaw,
    endpoint,
    topic,
    updateMs,
    sampleRate,
    channels,
  };
}

export function buildStudioBindingView(
  blockTypeId: string,
  parameterValues: Record<string, string>,
): StudioBindingView {
  const binding = lookupStudioKnownBlockBinding(blockTypeId);
  if (!binding) {
    return {
      status: 'unsupported',
      blockTypeId,
      reason: 'Block type is not in the Studio known-block registry.',
    };
  }

  const transportRaw = normalizeString(parameterValues[binding.parameters.transport]);
  const endpointRaw = normalizeString(parameterValues[binding.parameters.endpoint]);
  if (!transportRaw || !endpointRaw) {
    return {
      status: 'unconfigured',
      blockTypeId,
      family: binding.family,
      payloadFormat: binding.payloadFormat,
      transport: transportRaw || undefined,
      endpoint: endpointRaw || undefined,
      reason: 'Set both transport and endpoint parameters.',
    };
  }

  const resolved = resolveStudioBindingFromParameters(binding, parameterValues);
  if (!resolved.ok) {
    return {
      status: 'invalid',
      blockTypeId,
      family: binding.family,
      payloadFormat: binding.payloadFormat,
      transport: transportRaw,
      endpoint: endpointRaw,
      reason: resolved.reason,
    };
  }

  return {
    status: 'configured',
    blockTypeId,
    family: binding.family,
    payloadFormat: binding.payloadFormat,
    transport: resolved.transport,
    endpoint: resolved.endpoint,
    updateMs: resolved.updateMs,
    sampleRate: resolved.sampleRate,
    channels: resolved.channels,
    topic: resolved.topic,
  };
}
