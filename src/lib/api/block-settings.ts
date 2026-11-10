import { ApiClientError, jsonRequest } from './client';

export type RuntimeSettingsScalar = string | number | boolean | null;
export type RuntimeSettingsValue =
  | RuntimeSettingsScalar
  | RuntimeSettingsValue[]
  | { [key: string]: RuntimeSettingsValue };

export type RuntimeSettingsObject = { [key: string]: RuntimeSettingsValue };
export type RuntimeSettingsMode = 'staged' | 'immediate';

export type SetBlockSettingsResult = {
  sessionId: string;
  block: string;
  appliedVia: string;
  accepted: boolean;
};

export function isRuntimeSettingsValue(value: unknown): value is RuntimeSettingsValue {
  if (value === null) {
    return true;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every(isRuntimeSettingsValue);
  }

  if (typeof value !== 'object') {
    return false;
  }

  return Object.values(value).every(isRuntimeSettingsValue);
}

function isRuntimeSettingsObject(value: unknown): value is RuntimeSettingsObject {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return false;
  }

  return Object.values(value).every(isRuntimeSettingsValue);
}

function parseRuntimeSettingsObject(payload: unknown, context: string): RuntimeSettingsObject {
  if (!isRuntimeSettingsObject(payload)) {
    throw new ApiClientError(`Runtime settings API schema mismatch (${context})`, 'PARSE');
  }

  return payload;
}

export async function getBlockSettings(sessionId: string, uniqueName: string): Promise<RuntimeSettingsObject> {
  const payload = await jsonRequest<unknown>({
    path: `/sessions/${encodeURIComponent(sessionId)}/blocks/${encodeURIComponent(uniqueName)}/settings`,
    method: 'GET',
  });

  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    throw new ApiClientError('Runtime settings API schema mismatch (get-block-settings)', 'PARSE');
  }

  const settings = (payload as { settings?: unknown }).settings;
  return parseRuntimeSettingsObject(settings, 'get-block-settings.settings');
}

export async function setBlockSettings(
  sessionId: string,
  uniqueName: string,
  patch: RuntimeSettingsObject,
  mode: RuntimeSettingsMode = 'staged',
): Promise<SetBlockSettingsResult> {
  const query = mode === 'immediate' ? '?mode=immediate' : '';
  const payload = await jsonRequest<unknown>({
    path: `/sessions/${encodeURIComponent(sessionId)}/blocks/${encodeURIComponent(uniqueName)}/settings${query}`,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(patch),
  });

  if (!payload || Array.isArray(payload) || typeof payload !== 'object') {
    throw new ApiClientError('Runtime settings API schema mismatch (set-block-settings)', 'PARSE');
  }

  const parsed = payload as {
    session_id?: unknown;
    block?: unknown;
    applied_via?: unknown;
    accepted?: unknown;
  };

  if (
    typeof parsed.session_id !== 'string' ||
    typeof parsed.block !== 'string' ||
    typeof parsed.applied_via !== 'string' ||
    typeof parsed.accepted !== 'boolean'
  ) {
    throw new ApiClientError('Runtime settings API schema mismatch (set-block-settings)', 'PARSE');
  }

  return {
    sessionId: parsed.session_id,
    block: parsed.block,
    appliedVia: parsed.applied_via,
    accepted: parsed.accepted,
  };
}
