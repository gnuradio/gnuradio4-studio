import { buildApiUrl } from '../../../lib/api/client';
import type { SessionRecord, SessionStreamRecord } from '../../../lib/api/sessionsApi';
import {
  buildStudioBindingView,
  type StudioKnownBlockBinding,
  lookupStudioKnownBlockBinding,
  type StudioBindingView,
} from '../../graph-editor/runtime/known-block-bindings';
import {
  buildStudioDescriptorAuthoringView,
} from '../../graph-editor/runtime/studio-managed-runtime-authoring';

type ResolveCurrentSessionStudioBindingArgs = {
  blockTypeId: string;
  nodeInstanceId: string;
  parameterValues: Record<string, string>;
  session?: SessionRecord | null;
};

function findDescriptorForNodeInstance(
  streams: readonly SessionStreamRecord[],
  nodeInstanceId: string,
): SessionStreamRecord | null {
  // `block_instance_name` is the join key between Studio nodes and runtime streams.
  // This model is intentionally 1:1 today: one exported stream per node instance.
  return streams.find((stream) => stream.blockInstanceName === nodeInstanceId) ?? null;
}

type DescriptorLookupResult =
  | {
      kind: 'fallback';
    }
  | {
      kind: 'invalid';
      reason: string;
      transport?: string;
    }
  | {
      kind: 'resolved';
      descriptor: SessionStreamRecord;
      path: string;
    };

function invalidDescriptorBinding(params: {
  blockTypeId: string;
  family?: StudioBindingView['family'];
  payloadFormat?: string;
  transport?: string;
  reason: string;
}): StudioBindingView {
  return {
    status: 'invalid',
    blockTypeId: params.blockTypeId,
    family: params.family,
    payloadFormat: params.payloadFormat,
    transport: params.transport,
    reason: params.reason,
  };
}

function resolveSessionStreamDescriptor(params: {
  session?: SessionRecord | null;
  nodeInstanceId: string;
}): DescriptorLookupResult {
  if (!params.session) {
    return {
      kind: 'invalid',
      reason: 'No linked session is available for this descriptor-based Studio binding.',
    };
  }

  if (params.session.state !== 'running') {
    return {
      kind: 'invalid',
      reason: 'Linked session is not running.',
    };
  }

  if (!params.session.streams) {
    return {
      kind: 'fallback',
    };
  }

  const descriptor = findDescriptorForNodeInstance(params.session.streams, params.nodeInstanceId);
  if (!descriptor) {
    return {
      kind: 'invalid',
      reason: `Running session advertised streams, but none matched block instance "${params.nodeInstanceId}".`,
    };
  }

  if (!descriptor.ready) {
    return {
      kind: 'invalid',
      transport: descriptor.transport,
      reason: `Runtime stream "${descriptor.id}" for "${params.nodeInstanceId}" is not ready.`,
    };
  }

  const path = descriptor.path.trim();
  if (!path) {
    return {
      kind: 'invalid',
      transport: descriptor.transport,
      reason: `Runtime stream "${descriptor.id}" for "${params.nodeInstanceId}" did not advertise a usable path.`,
    };
  }

  return {
    kind: 'resolved',
    descriptor,
    path,
  };
}

function validateStudioDescriptorPolicy(params: {
  knownBinding: StudioKnownBlockBinding;
  blockTypeId: string;
  nodeInstanceId: string;
  authoredBinding: StudioBindingView;
  descriptor: SessionStreamRecord;
}): StudioBindingView | null {
  if (!params.knownBinding.supportedTransports.includes(params.descriptor.transport as never)) {
    return invalidDescriptorBinding({
      blockTypeId: params.blockTypeId,
      family: params.knownBinding.family,
      payloadFormat: params.knownBinding.payloadFormat,
      transport: params.authoredBinding.transport,
      reason: `Runtime stream "${params.descriptor.id}" advertised unsupported transport "${params.descriptor.transport}" for ${params.blockTypeId}.`,
    });
  }

  if (params.descriptor.transport !== params.authoredBinding.transport) {
    return invalidDescriptorBinding({
      blockTypeId: params.blockTypeId,
      family: params.knownBinding.family,
      payloadFormat: params.knownBinding.payloadFormat,
      transport: params.authoredBinding.transport,
      reason: `Runtime stream "${params.descriptor.id}" advertised transport "${params.descriptor.transport}" but Studio authored transport "${params.authoredBinding.transport}" for "${params.nodeInstanceId}".`,
    });
  }

  if (params.descriptor.payloadFormat !== params.knownBinding.payloadFormat) {
    return invalidDescriptorBinding({
      blockTypeId: params.blockTypeId,
      family: params.knownBinding.family,
      payloadFormat: params.knownBinding.payloadFormat,
      transport: params.authoredBinding.transport,
      reason: `Runtime stream "${params.descriptor.id}" advertised payload "${params.descriptor.payloadFormat}" but ${params.blockTypeId} expects "${params.knownBinding.payloadFormat}".`,
    });
  }

  return null;
}

export function resolveCurrentSessionStudioBindingView(
  args: ResolveCurrentSessionStudioBindingArgs,
): StudioBindingView {
  const fallback = buildStudioBindingView(args.blockTypeId, args.parameterValues);
  const knownBinding = lookupStudioKnownBlockBinding(args.blockTypeId);

  if (!knownBinding) {
    return fallback;
  }

  const authoredBinding = buildStudioDescriptorAuthoringView(args.blockTypeId, args.parameterValues);
  if (authoredBinding.status !== 'configured') {
    return authoredBinding;
  }

  const descriptorLookup = resolveSessionStreamDescriptor({
    session: args.session,
    nodeInstanceId: args.nodeInstanceId,
  });

  if (descriptorLookup.kind === 'fallback') {
    return fallback;
  }

  if (descriptorLookup.kind === 'invalid') {
    return invalidDescriptorBinding({
      blockTypeId: args.blockTypeId,
      family: knownBinding.family,
      payloadFormat: knownBinding.payloadFormat,
      transport: descriptorLookup.transport ?? authoredBinding.transport,
      reason: descriptorLookup.reason,
    });
  }

  const policyFailure = validateStudioDescriptorPolicy({
    knownBinding,
    blockTypeId: args.blockTypeId,
    nodeInstanceId: args.nodeInstanceId,
    authoredBinding,
    descriptor: descriptorLookup.descriptor,
  });
  if (policyFailure) {
    return policyFailure;
  }

  return {
    status: 'configured',
    blockTypeId: args.blockTypeId,
    family: knownBinding.family,
    payloadFormat: descriptorLookup.descriptor.payloadFormat,
    transport: authoredBinding.transport,
    endpoint: buildApiUrl(descriptorLookup.path),
    updateMs: authoredBinding.updateMs,
    sampleRate: authoredBinding.sampleRate,
    channels: authoredBinding.channels,
    bufferMs: authoredBinding.bufferMs,
    topic: authoredBinding.topic,
  };
}
