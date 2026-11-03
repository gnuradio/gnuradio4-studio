import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type ComplexViewMode,
  type HttpTimeSeriesSnapshot,
  parseHttpTimeSeriesSnapshot,
} from '../../graph-editor/runtime/http-time-series';
import {
  createJsonWebSocketSubscription,
  normalizeJsonWebSocketEndpoint,
} from '../../application/plotting/runtime/json-websocket-runtime';
import type { WorkspaceLiveRendererContext } from './live-renderer-contract';
import { fetchRuntimeJsonPayload } from '../../../lib/api/runtime-http-fetch';
import {
  createSeriesPollSubscription,
  deriveSeriesLoadStateFromSnapshot,
  normalizeSeriesPollMs,
  type SeriesLiveLoadState,
  isSupportedSeriesBinding,
} from './series-live-renderer-model';

type SeriesLiveRendererProps = {
  liveContext: WorkspaceLiveRendererContext;
};

const CHANNEL_COLORS = ['#22d3ee', '#38bdf8', '#818cf8', '#a78bfa', '#f472b6', '#fb7185', '#f59e0b', '#84cc16'];

function buildSeriesPolyline(values: number[], width: number, height: number, min: number, max: number): string {
  if (values.length === 0) {
    return '';
  }

  const denominator = max - min || 1;
  return values
    .map((value, index) => {
      const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
      const y = height - ((value - min) / denominator) * height;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

export function SeriesLiveRenderer({ liveContext }: SeriesLiveRendererProps) {
  const [state, setState] = useState<SeriesLiveLoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<HttpTimeSeriesSnapshot | null>(null);
  const isFetchingRef = useRef(false);
  const complexViewMode: ComplexViewMode = 'magnitude';

  const endpoint = liveContext.binding.endpoint?.trim() ?? '';
  const transport = liveContext.binding.transport;
  const bindingGate = isSupportedSeriesBinding(liveContext.binding);
  const runtimeActive = liveContext.executionState === 'running';
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
    setState('loading');
    setError(null);
    try {
      const payload = await fetchRuntimeJsonPayload(endpoint);
      const parsed = parseHttpTimeSeriesSnapshot(payload, complexViewMode);
      setSnapshot(parsed);
      setState(deriveSeriesLoadStateFromSnapshot(parsed));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load series snapshot.');
      setState('error');
    } finally {
      isFetchingRef.current = false;
    }
  }, [complexViewMode, endpoint, supportsHttpLivePath]);

  useEffect(() => {
    if (!supportsLivePath) {
      setSnapshot(null);
      if (!runtimeActive && liveContext.binding.status === 'configured' && bindingGate.reason === undefined) {
        setError(null);
        setState('no-data');
        return;
      }
      const fallbackError =
        bindingGate.reason === 'unsupported-transport'
          ? 'Only http_snapshot/http_poll/websocket is supported for the first live series path.'
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

    setState('loading');
    setError(null);
    return createJsonWebSocketSubscription({
      endpoint: websocketEndpoint,
      onMessage: (payload) => {
        const parsed = parseHttpTimeSeriesSnapshot(payload, complexViewMode);
        setSnapshot(parsed);
        setState(deriveSeriesLoadStateFromSnapshot(parsed));
      },
      onConnectionState: (state, message) => {
        if (state === 'connecting' || state === 'reconnecting') {
          setState('loading');
          return;
        }
        if (state === 'open') {
          setState('loading');
          return;
        }
        if (state === 'error') {
          setError(message ?? 'Series websocket connection failed.');
          setState('error');
        }
      },
    });
  }, [complexViewMode, supportsWebSocketLivePath, websocketEndpoint]);

  const allValues = useMemo(
    () => (snapshot ? snapshot.seriesByChannel.flat() : []),
    [snapshot],
  );
  const yMin = allValues.length > 0 ? Math.min(...allValues) : 0;
  const yMax = allValues.length > 0 ? Math.max(...allValues) : 1;

  return (
    <div className="mt-3 rounded border border-slate-700 bg-slate-950/70 p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-100">Series Live</p>
        <span className="text-[10px] text-slate-400">{transport ?? 'n/a'}</span>
      </div>

      {!supportsLivePath && (
        <p className="mt-2 text-[11px] text-slate-400">
          {liveContext.binding.status === 'configured'
            ? 'Series live renderer currently supports http_snapshot/http_poll/websocket.'
            : 'Configure binding transport to enable live series rendering.'}
        </p>
      )}

      {supportsLivePath && state === 'loading' && (
        <p className="mt-2 text-[11px] text-sky-300">
          {supportsWebSocketLivePath ? 'Connecting series websocket...' : 'Loading series snapshot...'}
        </p>
      )}

      {supportsLivePath && state === 'error' && (
        <p className="mt-2 text-[11px] text-rose-300 break-words">
          Error: {error ?? 'Series live request failed.'}
        </p>
      )}

      {supportsLivePath && state === 'no-data' && (
        <p className="mt-2 text-[11px] text-slate-400">No data in snapshot window yet.</p>
      )}

      {supportsLivePath && state === 'ready' && snapshot && (
        <div className="mt-2 space-y-2">
          <div className="text-[10px] text-slate-400">
            channels {snapshot.channelCount} · samples {snapshot.samplesPerChannel}
          </div>
          <svg viewBox="0 0 320 96" className="w-full h-24 rounded border border-slate-700 bg-slate-950">
            <line x1="0" y1="48" x2="320" y2="48" stroke="var(--theme-canvas-grid)" strokeWidth="1" />
            {snapshot.seriesByChannel.map((series, index) => (
              <polyline
                key={`series-${index}`}
                points={buildSeriesPolyline(series, 320, 96, yMin, yMax)}
                fill="none"
                stroke={CHANNEL_COLORS[index % CHANNEL_COLORS.length]}
                strokeWidth="1.6"
              />
            ))}
          </svg>
        </div>
      )}
    </div>
  );
}
