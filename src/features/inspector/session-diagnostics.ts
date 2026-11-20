import type { RuntimeActivity } from '../runtime-session/store/runtimeSessionStore';

type JsonObject = Record<string, unknown>;
const object = (value: unknown): JsonObject | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : undefined;
const text = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;
const compact = (value: string, limit = 180): string => {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > limit ? `${normalized.slice(0, limit - 1)}…` : normalized;
};

function parseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return undefined; }
}

function payloadFromMessage(raw: string): { payload?: unknown; prefix: string } {
  const marker = raw.indexOf(' upstream=');
  const prefix = marker >= 0 ? raw.slice(0, marker + ' upstream='.length) : '';
  const candidate = marker >= 0 ? raw.slice(prefix.length) : raw;
  let payload = parseJson(candidate);
  // Some responses contain an additional JSON string envelope. Never scan arbitrary braces.
  if (typeof payload === 'string') payload = parseJson(payload);
  return { payload, prefix };
}

const operationTitles: Record<string, string> = {
  start: 'Runtime start failed', stop: 'Runtime stop failed', restart: 'Runtime restart failed',
  prepare: 'Runtime preparation failed', create: 'Session creation failed', delete: 'Session deletion failed',
  refresh: 'Session refresh failed',
};
const operationTitle = (operation: string): string | undefined =>
  Object.prototype.hasOwnProperty.call(operationTitles, operation) ? operationTitles[operation] : undefined;

export type SessionErrorPresentation = {
  title: string;
  explanation: string;
  block?: string;
  setting?: string;
  original: string;
  diagnostics: string;
};

export function presentSessionError(original: string, operationHint?: string | null): SessionErrorPresentation {
  const { payload, prefix } = payloadFromMessage(original);
  const root = object(payload);
  const error = object(root?.error);
  // Only inspect recognized error containers, not arbitrary diagnostic object properties.
  const containers = [object(error?.details), error, object(root?.details), root].filter((entry): entry is JsonObject => Boolean(entry));
  const field = (...names: string[]): string | undefined => {
    for (const container of containers) {
      for (const name of names) {
        const value = text(container[name]);
        if (value) return value;
      }
    }
    return undefined;
  };
  const message = text(error?.message) ?? text(root?.error_message) ?? text(root?.message) ?? text(root?.error);
  const readableOriginal = original.split(/\sroute=\S+\s+url=/)[0];
  const source = message ?? (root || Array.isArray(payload) || /^[\s]*[\[{]/.test(original) ? '' : readableOriginal);
  const code = text(error?.code) ?? text(root?.error_code) ?? text(root?.code);
  const explicitOperation = field('operation')?.toLowerCase();
  const messageOperation = (/\b(start|stop|restart|prepare|create|delete|refresh)\s+failed\b/i.exec(source)?.[1] ??
    /\bfailed to (start|stop|restart|prepare|create|delete|refresh)\b/i.exec(source)?.[1])?.toLowerCase();
  const codeOperation = /^(?:runtime|session)_(start|stop|restart|prepare|create|delete|refresh)_failed$/i.exec(code ?? '')?.[1]?.toLowerCase();
  const operation = explicitOperation && operationTitle(explicitOperation) ? explicitOperation :
    messageOperation ?? codeOperation ?? operationHint ?? '';
  const block = field('block_instance_name', 'block_name', 'block') ?? /\bblock\s+['"`]([^'"`]+)['"`]/i.exec(source)?.[1];
  const settingMatch = /(?:declares no setting(?: named)?|unknown (?:setting|parameter))\s*:?\s*['"`]([^'"`]+)['"`]/i.exec(source);
  const setting = field('setting', 'parameter') ?? settingMatch?.[1];
  const reason = field('reason');
  const unknownSetting = Boolean(settingMatch) || /^(?:unknown|unrecognized)[ _](?:setting|parameter)$/i.test(reason ?? code ?? '');
  const explanation = unknownSetting ? (block ? 'The block does not recognize this setting.' : 'The setting is not recognized.') :
    compact(reason ?? source) || 'See technical details for the complete error response.';

  return {
    title: operationTitle(operation) ?? 'Runtime error', explanation,
    block, setting, original,
    diagnostics: payload !== undefined ? `${prefix}${JSON.stringify(payload, null, 2)}` : original,
  };
}

export function activitySummary(entry: RuntimeActivity): string {
  if (entry.level === 'error') {
    return presentSessionError(entry.message, entry.action).title;
  }
  if (/^Created session\s/.test(entry.message)) return 'Session created';
  if (/^Replaced linked session\s/.test(entry.message)) return 'Linked session replaced';
  if (/^Deleted session\s/.test(entry.message)) return 'Session deleted';
  // Keep informational messages informational; a known action alone does not imply success.
  if (/^[\s]*[\[{]/.test(entry.message) || /\supstream=/.test(entry.message)) return 'Session activity';
  return compact(entry.message, 100) || 'Session activity';
}

export function activityTone(entry: RuntimeActivity): 'error' | 'success' | 'info' {
  if (entry.level === 'error') return 'error';
  return /^(?:Created session |Replaced linked session |Deleted session |Session (?:running|started|stopped|restarted|refreshed)\.)/.test(entry.message) ? 'success' : 'info';
}
