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

function parseInteger(value: string | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isSupportedTransport(value: string): value is StudioTransportMode {
  return value === 'http_snapshot' || value === 'http_poll' || value === 'zmq_sub' || value === 'websocket';
}

export function isDescriptorBasedBindingFamily(blockTypeId: string): boolean {
  return (
    blockTypeId.startsWith('gr::studio::StudioSeriesSink<') ||
    blockTypeId.startsWith('gr::studio::Studio2DSeriesSink<') ||
    blockTypeId.startsWith('gr::studio::StudioPowerSpectrumSink<') ||
    blockTypeId.startsWith('gr::studio::StudioWaterfallSink<') ||
    blockTypeId.startsWith('gr::studio::StudioScalarSink<') ||
    blockTypeId.startsWith('gr::studio::StudioStatusSink<') ||
    blockTypeId.startsWith('gr::studio::StudioAudioSink<')
  );
}

export function isDescriptorBindingHiddenParameter(blockTypeId: string, parameterName: string): boolean {
  return isDescriptorBasedBindingFamily(blockTypeId) && parameterName === 'endpoint';
}

export function getAuthoringParameterLabel(blockTypeId: string, parameterName: string, label: string): string {
  void blockTypeId;
  void parameterName;
  return label;
}

export function getDescriptorBindingAuthoringMessage(blockTypeId: string): string | null {
  if (!isDescriptorBasedBindingFamily(blockTypeId)) {
    return null;
  }

  return 'Descriptor-based session routes come from the linked session. Transport stays authored. Endpoint is persisted only for older documents and is not used by Studio runtime.';
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
    sampleRate: binding.parameters.sampleRate ? parseInteger(parameterValues[binding.parameters.sampleRate]) : undefined,
    channels: binding.parameters.channels ? parseInteger(parameterValues[binding.parameters.channels]) : undefined,
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
    sampleRate: binding.parameters.sampleRate ? parseInteger(parameterValues[binding.parameters.sampleRate]) : undefined,
    channels: binding.parameters.channels ? parseInteger(parameterValues[binding.parameters.channels]) : undefined,
    topic: binding.parameters.topic ? normalizeString(parameterValues[binding.parameters.topic]) || undefined : undefined,
    reason: authoringMessage,
  };
}
