import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createJsonWebSocketSubscription,
  normalizeJsonWebSocketEndpoint,
} from '../../application/plotting/runtime/json-websocket-runtime';
import { fetchRuntimeJsonPayload } from '../../../lib/api/runtime-http-fetch';
import type { WorkspaceLiveRendererContext } from './live-renderer-contract';
import {
  createSeriesPollSubscription,
  normalizeSeriesPollMs,
  type SeriesLiveLoadState,
} from './series-live-renderer-model';

type ScalarStatusSnapshot = {
  payloadFormat: 'scalar-status-json-v1';
  presentation?: string;
  channels: number;
  labels: string[];
  units: string[];
  values: number[];
  sequence?: number;
  hasValue: boolean;
};

type ScalarStatusLiveRendererProps = {
  liveContext: WorkspaceLiveRendererContext;
  presentation: 'scalar' | 'status';
};

function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item : String(item ?? ''))) : [];
}

function readNumberArray(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => {
    const parsed = typeof item === 'number' ? item : Number(item);
    return Number.isFinite(parsed) ? parsed : 0;
  });
}

function parseScalarStatusSnapshot(payload: unknown): ScalarStatusSnapshot {
  if (!payload || typeof payload !== 'object') {
    throw new Error('Scalar/status payload must be a JSON object.');
  }

  const record = payload as Record<string, unknown>;
  if (record.payload_format !== 'scalar-status-json-v1') {
    throw new Error('Expected scalar-status-json-v1 payload.');
  }

  const values = readNumberArray(record.values);
  const requestedChannels = typeof record.channels === 'number' && Number.isFinite(record.channels)
    ? Math.max(1, Math.floor(record.channels))
    : values.length;
  const channels = Math.max(1, requestedChannels);
  const labels = readStringArray(record.labels);
  const units = readStringArray(record.units);

  return {
    payloadFormat: 'scalar-status-json-v1',
    presentation: typeof record.presentation === 'string' ? record.presentation : undefined,
    channels,
    labels,
    units,
    values,
    sequence: typeof record.sequence === 'number' && Number.isFinite(record.sequence) ? record.sequence : undefined,
    hasValue: record.has_value === true,
  };
}

function isSupportedScalarStatusBinding(binding: WorkspaceLiveRendererContext['binding']): {
  supported: boolean;
  reason?: string;
} {
  const endpoint = binding.endpoint?.trim();
  const transport = binding.transport;
  if (binding.status !== 'configured') {
    return { supported: false, reason: 'not-configured' };
  }
  if (!endpoint) {
    return { supported: false, reason: 'missing-endpoint' };
  }
  if (transport !== 'http_snapshot' && transport !== 'http_poll' && transport !== 'websocket') {
    return { supported: false, reason: 'unsupported-transport' };
  }
  return { supported: true };
}

function formatValue(value: number, unit: string): string {
  const absValue = Math.abs(value);
  const formatted = absValue >= 1000 || (absValue > 0 && absValue < 0.01)
    ? value.toExponential(3)
    : value.toLocaleString(undefined, { maximumFractionDigits: 3 });
  return unit ? `${formatted} ${unit}` : formatted;
}

function deriveLoadState(snapshot: ScalarStatusSnapshot): SeriesLiveLoadState {
  return snapshot.hasValue ? 'ready' : 'no-data';
}

export function ScalarStatusLiveRenderer({ liveContext, presentation }: ScalarStatusLiveRendererProps) {
  const [state, setState] = useState<SeriesLiveLoadState>('no-data');
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ScalarStatusSnapshot | null>(null);
  const isFetchingRef = useRef(false);
  const hasSnapshotRef = useRef(false);

  const endpoint = liveContext.binding.endpoint?.trim() ?? '';
  const transport = liveContext.binding.transport;
  const runtimeActive = liveContext.executionState === 'running';
  const bindingGate = isSupportedScalarStatusBinding(liveContext.binding);
  const supportsHttpLivePath =
    bindingGate.supported && runtimeActive && (transport === 'http_snapshot' || transport === 'http_poll');
  const supportsWebSocketLivePath = bindingGate.supported && runtimeActive && transport === 'websocket';
  const supportsLivePath = supportsHttpLivePath || supportsWebSocketLivePath;
  const updateMs = normalizeSeriesPollMs(liveContext.binding.updateMs);
  const websocketEndpoint = normalizeJsonWebSocketEndpoint(endpoint);

  const refresh = useCallback(async () => {
    if (!supportsHttpLivePath || !endpoint || isFetchingRef.current) {
      return;
    }

    isFetchingRef.current = true;
    setError(null);
    try {
      const payload = await fetchRuntimeJsonPayload(endpoint);
      const parsed = parseScalarStatusSnapshot(payload);
      setSnapshot(parsed);
      hasSnapshotRef.current = true;
      setState(deriveLoadState(parsed));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load scalar/status snapshot.');
      if (!hasSnapshotRef.current) {
        setState('error');
      }
    } finally {
      isFetchingRef.current = false;
    }
  }, [endpoint, supportsHttpLivePath]);

  useEffect(() => {
    if (!supportsLivePath) {
      setSnapshot(null);
      hasSnapshotRef.current = false;
      if (!runtimeActive && liveContext.binding.status === 'configured' && bindingGate.reason === undefined) {
        setError(null);
        setState('no-data');
        return;
      }
      const fallbackError =
        bindingGate.reason === 'unsupported-transport'
          ? 'Only http_snapshot/http_poll/websocket is supported for scalar/status panels.'
          : null;
      setError(fallbackError);
      setState(liveContext.binding.status === 'invalid' || bindingGate.reason === 'unsupported-transport' ? 'error' : 'no-data');
      return;
    }

    void refresh();
  }, [bindingGate.reason, liveContext.binding.status, refresh, runtimeActive, supportsLivePath]);

  useEffect(() => {
    if (!supportsHttpLivePath) {
      return undefined;
    }

    return createSeriesPollSubscription(transport, updateMs, () => {
      void refresh();
    });
  }, [refresh, supportsHttpLivePath, transport, updateMs]);

  useEffect(() => {
    if (!supportsWebSocketLivePath) {
      return undefined;
    }

    setError(null);
    return createJsonWebSocketSubscription({
      endpoint: websocketEndpoint,
      onMessage: (payload) => {
        const parsed = parseScalarStatusSnapshot(payload);
        setSnapshot(parsed);
        hasSnapshotRef.current = true;
        setState(deriveLoadState(parsed));
      },
      onConnectionState: (state, message) => {
        if (state === 'connecting' || state === 'reconnecting') {
          return;
        }
        if (state === 'open') {
          setError(null);
          return;
        }
        if (state === 'error') {
          setError(message ?? 'Scalar/status websocket connection failed.');
          if (!hasSnapshotRef.current) {
            setState('error');
          }
        }
      },
    });
  }, [supportsWebSocketLivePath, websocketEndpoint]);

  const rows = useMemo(() => {
    if (!snapshot) {
      return [];
    }
    return Array.from({ length: snapshot.channels }, (_, index) => {
      const label = snapshot.labels[index]?.trim() || `Channel ${index + 1}`;
      const unit = snapshot.units[index]?.trim() ?? '';
      const value = snapshot.values[index] ?? 0;
      return { label, unit, value };
    });
  }, [snapshot]);

  const title = presentation === 'status' ? 'Status' : 'Scalars';
  const hasDisplayValues = snapshot?.hasValue === true && rows.length > 0;

  return (
    <div className="h-full min-h-0 overflow-auto rounded border border-slate-700 bg-slate-950/70 p-3">
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold text-slate-100">{title}</p>
      </div>

      {!supportsLivePath && (
        <p className="mt-2 text-[11px] text-slate-400">
          {liveContext.binding.status === 'configured'
            ? 'Scalar/status renderer supports http_snapshot/http_poll/websocket.'
            : 'Configure binding transport to enable live scalar/status rendering.'}
        </p>
      )}

      {supportsLivePath && state === 'error' && !snapshot && (
        <p className="mt-2 break-words text-[11px] text-rose-300">
          Error: {error ?? 'Scalar/status live request failed.'}
        </p>
      )}

      {supportsLivePath && state === 'no-data' && !hasDisplayValues && (
        <p className="mt-2 text-[11px] text-slate-400">No scalar values have arrived yet.</p>
      )}

      {supportsLivePath && hasDisplayValues && (
        presentation === 'status' ? (
          <div className="mt-3 overflow-hidden rounded border border-slate-800">
            {rows.map((row) => (
              <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 border-b border-slate-800 px-3 py-2 last:border-b-0">
                <span className="truncate text-[11px] font-medium text-slate-300" title={row.label}>
                  {row.label}
                </span>
                <span className="font-mono text-[11px] text-cyan-200">{formatValue(row.value, row.unit)}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {rows.map((row) => (
              <div key={row.label} className="min-w-0 rounded border border-slate-800 bg-slate-900/45 px-3 py-2">
                <p className="truncate text-[10px] font-medium uppercase tracking-normal text-slate-400" title={row.label}>
                  {row.label}
                </p>
                <p className="mt-1 truncate font-mono text-lg text-cyan-200" title={formatValue(row.value, row.unit)}>
                  {formatValue(row.value, row.unit)}
                </p>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
