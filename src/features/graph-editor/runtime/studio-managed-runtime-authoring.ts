import {
  buildStudioBindingView,
  lookupStudioKnownBlockBinding,
  type StudioBindingView,
  type StudioKnownBlockBinding,
  type StudioTransportMode,
} from './known-block-bindings';

function normalizeString(value: string | undefined): string {
  return (value ?? '').trim();
}

function parseSampleRate(value: string | undefined): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function parseInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function isSupportedTransport(value: string): value is StudioTransportMode {
  return value === 'http_snapshot' || value === 'http_poll' || value === 'zmq_sub' || value === 'websocket';
}

export function isDescriptorBasedBindingFamily(blockTypeId: string): boolean {
  const binding = lookupStudioKnownBlockBinding(blockTypeId);
  return Boolean(binding && binding.family !== 'image' &&
    !(binding.family === 'series2d' && binding.payloadFormat === 'dataset-xy-json-v1' && !binding.parameters.sampleRate));
}

export function isDescriptorBindingHiddenParameter(blockTypeId: string, parameterName: string): boolean {
  const binding = lookupStudioKnownBlockBinding(blockTypeId);
  if (!binding) return false;
  if (parameterName === 'topic') return true;
  if (binding.family === 'waterfall' &&
      ['x_min', 'x_max', 'y_min', 'y_max', 'x_label', 'y_label', 'series_labels'].includes(parameterName)) return true;
  return isDescriptorBasedBindingFamily(blockTypeId) && parameterName === 'endpoint';
}

export function getAuthoringParameterLabel(blockTypeId: string, parameterName: string, label: string): string {
  const binding = lookupStudioKnownBlockBinding(blockTypeId);
  if (!binding) return label;
  const labels: Record<string, string> = {
    transport: 'Connection', endpoint: 'Address', update_ms: 'Update interval (ms)',
    poll_ms: 'Poll interval (ms)', sample_rate: 'Sample rate (Hz)',
    fft_size: 'FFT size', num_averages: 'Average frames', window: 'FFT window',
    time_span: 'History duration (s)', center_freq: 'Center frequency (Hz)',
    output_in_db: 'Decibels', autoscale: binding.family === 'waterfall' ? 'Auto intensity' : 'Autoscale',
    z_min: 'Intensity min', z_max: 'Intensity max',
    x_min: 'X min', x_max: 'X max', y_min: 'Y min', y_max: 'Y max',
    x_label: 'X axis label', y_label: 'Y axis label', plot_title: 'Plot title', title: 'Panel title',
    series_labels: 'Series labels', labels: 'Channel labels', units: 'Channel units',
    n_inputs: 'Input ports', channels: binding.family === 'image' ? 'Pixel format' : 'Interleaved channels',
    window_size: binding.payloadFormat === 'dataset-xy-json-v1' ? 'Maximum points (−1 = all)' :
      binding.family === 'series' ? 'Samples per input' : 'Points',
    window_mode: 'Window mode', render_mode: 'Plot style', point_size: 'Point size (px)',
    point_alpha: 'Point opacity', max_labels: 'Tag labels', persistence: 'Persistence',
    phosphor_intensity: 'Trail intensity', phosphor_decay_ms: 'Trail decay (ms)',
    signal_index: 'Signal index', axis_index: 'Axis index', frame_ms: 'Packet duration (ms)',
    buffer_ms: 'Playback buffer (ms)', gain: 'Gain', clip: 'Clip to ±1',
    width: 'Width (px)', height: 'Height (px)',
  };
  return labels[parameterName] ?? label;
}

export function getDescriptorBindingAuthoringMessage(blockTypeId: string): string | null {
  if (!isDescriptorBasedBindingFamily(blockTypeId)) {
    return null;
  }

  return 'The running session provides the connection address.';
}

export function buildStudioAuthoringBindingView(
  blockTypeId: string,
  parameterValues: Record<string, string>,
): StudioBindingView {
  if (!isDescriptorBasedBindingFamily(blockTypeId)) {
    return buildStudioBindingView(blockTypeId, parameterValues);
  }

  const binding = lookupStudioKnownBlockBinding(blockTypeId);
  if (!binding) {
    return buildStudioBindingView(blockTypeId, parameterValues);
  }

  const transportRaw = normalizeString(parameterValues[binding.parameters.transport]);
  const authoringMessage = getDescriptorBindingAuthoringMessage(blockTypeId) as string;

  if (!transportRaw) {
    return {
      status: 'unconfigured',
      blockTypeId,
      family: binding.family,
      payloadFormat: binding.payloadFormat,
      reason: `Set transport. ${authoringMessage}`,
    };
  }

  if (!isSupportedTransport(transportRaw)) {
    return {
      status: 'invalid',
      blockTypeId,
      family: binding.family,
      payloadFormat: binding.payloadFormat,
      transport: transportRaw,
      reason: `Unsupported transport mode: ${transportRaw}`,
    };
  }

  if (!binding.supportedTransports.includes(transportRaw)) {
    return {
      status: 'invalid',
      blockTypeId,
      family: binding.family,
      payloadFormat: binding.payloadFormat,
      transport: transportRaw,
      reason: `Transport ${transportRaw} is not allowed for ${binding.blockTypeId}.`,
    };
  }

  const cadenceParameter = binding.parameters.updateMs ?? binding.parameters.pollMs;

  return {
    status: 'configured',
    blockTypeId,
    family: binding.family,
    payloadFormat: binding.payloadFormat,
    transport: transportRaw,
    updateMs: cadenceParameter ? parseInteger(parameterValues[cadenceParameter]) : undefined,
    sampleRate: binding.parameters.sampleRate ? parseSampleRate(parameterValues[binding.parameters.sampleRate]) : undefined,
    channels: binding.parameters.channels ? parseInteger(parameterValues[binding.parameters.channels]) : undefined,
    bufferMs: binding.parameters.bufferMs ? parseInteger(parameterValues[binding.parameters.bufferMs]) : undefined,
    topic: binding.parameters.topic ? normalizeString(parameterValues[binding.parameters.topic]) || undefined : undefined,
    reason: authoringMessage,
  };
}

export function buildStudioDescriptorAuthoringView(
  blockTypeId: string,
  parameterValues: Record<string, string>,
): StudioBindingView {
  const binding = lookupStudioKnownBlockBinding(blockTypeId);
  if (!binding) {
    return buildStudioBindingView(blockTypeId, parameterValues);
  }

  return buildDescriptorAuthoringView(binding, blockTypeId, parameterValues);
}

function buildDescriptorAuthoringView(
  binding: StudioKnownBlockBinding,
  blockTypeId: string,
  parameterValues: Record<string, string>,
): StudioBindingView {
  const transportRaw = normalizeString(parameterValues[binding.parameters.transport]);
  const authoringMessage = getDescriptorBindingAuthoringMessage(blockTypeId) ?? undefined;

  if (!transportRaw) {
    return {
      status: 'unconfigured',
      blockTypeId,
      family: binding.family,
      payloadFormat: binding.payloadFormat,
      reason: authoringMessage ? `Set transport. ${authoringMessage}` : 'Set transport.',
    };
  }

  if (!isSupportedTransport(transportRaw)) {
    return {
      status: 'invalid',
      blockTypeId,
      family: binding.family,
      payloadFormat: binding.payloadFormat,
      transport: transportRaw,
      reason: `Unsupported transport mode: ${transportRaw}`,
    };
  }

  if (!binding.supportedTransports.includes(transportRaw)) {
    return {
      status: 'invalid',
      blockTypeId,
      family: binding.family,
      payloadFormat: binding.payloadFormat,
      transport: transportRaw,
      reason: `Transport ${transportRaw} is not allowed for ${binding.blockTypeId}.`,
    };
  }

  const cadenceParameter = binding.parameters.updateMs ?? binding.parameters.pollMs;

  return {
    status: 'configured',
    blockTypeId,
    family: binding.family,
    payloadFormat: binding.payloadFormat,
    transport: transportRaw,
    updateMs: cadenceParameter ? parseInteger(parameterValues[cadenceParameter]) : undefined,
    sampleRate: binding.parameters.sampleRate ? parseSampleRate(parameterValues[binding.parameters.sampleRate]) : undefined,
    channels: binding.parameters.channels ? parseInteger(parameterValues[binding.parameters.channels]) : undefined,
    bufferMs: binding.parameters.bufferMs ? parseInteger(parameterValues[binding.parameters.bufferMs]) : undefined,
    topic: binding.parameters.topic ? normalizeString(parameterValues[binding.parameters.topic]) || undefined : undefined,
    reason: authoringMessage,
  };
}
