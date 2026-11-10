import { isRuntimeSettingsValue, type RuntimeSettingsValue } from '../../lib/api/block-settings';
import { ApiClientError } from '../../lib/api/client';
import type { SessionRecord } from '../../lib/api/sessionsApi';
import type { GraphDriftState } from '../runtime-session/store/runtimeSessionStore';

export type RuntimeSettingsAvailability =
  | {
      state: 'ready';
      sessionId: string;
      uniqueName: string;
    }
  | {
      state: 'unavailable';
      reason: string;
    };

export function resolveRuntimeSettingsAvailability(params: {
  session: SessionRecord | null | undefined;
  sessionId: string | null | undefined;
  selectedNodeRuntimeName: string | null | undefined;
  graphDriftState: GraphDriftState | null | undefined;
}): RuntimeSettingsAvailability {
  if (!params.selectedNodeRuntimeName) {
    return { state: 'unavailable', reason: 'Select a block to inspect runtime settings.' };
  }

  if (!params.sessionId) {
    return { state: 'unavailable', reason: 'No session linked to this tab.' };
  }

  if (!params.session || params.session.state !== 'running') {
    return { state: 'unavailable', reason: 'Linked session is not running.' };
  }

  if (params.graphDriftState === 'out-of-sync') {
    return {
      state: 'unavailable',
      reason: 'Graph changed since the linked runtime snapshot; refresh or rerun before editing runtime settings.',
    };
  }

  return {
    state: 'ready',
    sessionId: params.sessionId,
    uniqueName: params.selectedNodeRuntimeName,
  };
}

const LIVE_UPDATABLE_SETTING_NAMES = new Set([
  'autoscale',
  'poll_ms',
  'update_ms',
  'persistence',
  'phosphor_intensity',
  'phosphor_decay_ms',
  'x_min',
  'x_max',
  'y_min',
  'y_max',
  'z_min',
  'z_max',
]);

export function shouldApplyRuntimeSettingImmediately(name: string): boolean {
  return LIVE_UPDATABLE_SETTING_NAMES.has(name.trim().toLowerCase());
}

export function shouldPropagateResolvedRuntimeSetting(params: {
  name: string;
  bindingKind: 'literal' | 'expression';
}): boolean {
  return params.bindingKind === 'expression' || shouldApplyRuntimeSettingImmediately(params.name);
}

export function toRuntimeSettingsErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === 'NETWORK') {
      return 'Failed to reach control plane.';
    }

    if (error.code === 'PARSE') {
      return 'Control plane returned an unexpected runtime settings payload.';
    }

    if (error.status === 409) {
      return 'Linked session is not running.';
    }

    if (error.status === 404) {
      return 'Runtime block was not found in the linked session.';
    }

    if (error.status === 400) {
      const details = `${error.details ?? ''} ${error.message}`.toLowerCase();
      if (details.includes('array')) {
        return error.details || error.message;
      }
      if (details.includes('payload') || details.includes('json') || details.includes('shape')) {
        return 'Runtime settings payload was rejected by the backend.';
      }
      return error.message;
    }

    if (error.status === 408 || error.status === 504) {
      return 'Timed out while waiting for the runtime settings reply.';
    }

    const details = `${error.details ?? ''} ${error.message}`.toLowerCase();
    if (details.includes('timeout')) {
      return 'Timed out while waiting for the runtime settings reply.';
    }
    if (details.includes('not running')) {
      return 'Linked session is not running.';
    }
    if (details.includes('block not found')) {
      return 'Runtime block was not found in the linked session.';
    }
    if (details.includes('unsupported')) {
      return 'Runtime settings payload was rejected by the backend.';
    }

    return error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown runtime settings error.';
}

export function parseRuntimeSettingsArray(text: string): RuntimeSettingsValue[] {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Enter a JSON list, for example [107000000, 108000000].');
  }
  if (!Array.isArray(value) || !isRuntimeSettingsValue(value)) {
    throw new Error('Enter a JSON list with valid finite values.');
  }
  return value;
}

// Graph literals still store collection syntax as text. Objects and nested lists
// need a richer graph value contract before they can be copied without loss.
export function runtimeSettingToGraphLiteral(value: RuntimeSettingsValue): string | undefined {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value) && value.every((element) => element !== null && typeof element !== 'object')) {
    return JSON.stringify(value);
  }
  return undefined;
}
