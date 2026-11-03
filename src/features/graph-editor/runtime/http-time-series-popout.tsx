import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ComplexViewMode, HttpTimeSeriesSnapshot } from './http-time-series';
import {
  buildHttpTimeSeriesSnapshotUrl,
  parseHttpTimeSeriesSnapshot,
} from './http-time-series';
import { fetchRuntimeJsonPayload } from '../../../lib/api/runtime-http-fetch';

type HttpTimeSeriesPopoutProps = {
  instanceId: string;
  blockTypeId: string;
  displayName: string;
  parameterValues: Record<string, string>;
  onClose: () => void;
};

type LoadState = 'idle' | 'loading' | 'success' | 'error';

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

export function HttpTimeSeriesPopout({
  instanceId,
  blockTypeId,
  displayName,
  parameterValues,
  onClose,
}: HttpTimeSeriesPopoutProps) {
  const [state, setState] = useState<LoadState>('idle');
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<HttpTimeSeriesSnapshot | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [intervalSecondsInput, setIntervalSecondsInput] = useState('0.5');
  const [showDetails, setShowDetails] = useState(false);
  const [complexViewMode, setComplexViewMode] = useState<ComplexViewMode>('magnitude');
  const isFetchingRef = useRef(false);

  const endpointUrl = useMemo(
    () => buildHttpTimeSeriesSnapshotUrl(parameterValues, window.location.hostname || '127.0.0.1'),
    [parameterValues],
  );

  const intervalMs = useMemo(() => {
    const parsed = Number.parseFloat(intervalSecondsInput);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return 500;
    }
    return Math.max(100, Math.round(parsed * 1000));
  }, [intervalSecondsInput]);

  const refresh = useCallback(async () => {
    if (isFetchingRef.current) {
      return;
    }
    isFetchingRef.current = true;
    setState('loading');
    setError(null);

    try {
      const payload = await fetchRuntimeJsonPayload(endpointUrl);
      const parsed = parseHttpTimeSeriesSnapshot(payload, complexViewMode);
      setSnapshot(parsed);
      setState('success');
    } catch (loadError) {
      setState('error');
      setError(loadError instanceof Error ? loadError.message : 'Failed to load snapshot.');
    } finally {
      isFetchingRef.current = false;
    }
  }, [complexViewMode, endpointUrl]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!autoRefresh) {
      return undefined;
    }

    const timer = window.setInterval(() => {
      void refresh();
    }, intervalMs);

    return () => window.clearInterval(timer);
  }, [autoRefresh, intervalMs, refresh]);

  const allValues = useMemo(
    () => (snapshot ? snapshot.seriesByChannel.flat() : []),
    [snapshot],
  );
  const yMin = allValues.length > 0 ? Math.min(...allValues) : 0;
  const yMax = allValues.length > 0 ? Math.max(...allValues) : 1;
  const hasComplexData = Boolean(
    snapshot?.sampleType.includes('complex') || snapshot?.layout.includes('complex'),
  );

  return (
    <div className="absolute left-full top-0 ml-2 z-30 w-[360px] rounded-md border border-slate-600 bg-slate-950/95 shadow-xl backdrop-blur">
      <div className="flex items-center justify-between border-b border-slate-700 px-3 py-2">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-slate-100 truncate">{displayName}</p>
          <p className="text-[10px] text-slate-400 truncate">{instanceId}</p>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setShowDetails((value) => !value)}
            className="rounded border border-slate-600 px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800"
            title="Toggle details"
          >
            ...
          </button>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-600 px-1.5 py-0.5 text-[11px] text-slate-300 hover:bg-slate-800"
          >
            Close
          </button>
        </div>
      </div>

      <div className="space-y-2 p-3 text-xs">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-slate-100 hover:bg-slate-700"
          >
            Refresh
          </button>
          <label className="flex items-center gap-1 text-slate-300">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(event) => setAutoRefresh(event.target.checked)}
            />
            Auto
          </label>
          <label className="flex items-center gap-1 text-slate-300">
            every
            <input
              type="text"
              inputMode="decimal"
              value={intervalSecondsInput}
              onChange={(event) => setIntervalSecondsInput(event.target.value)}
              className="w-14 rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-xs text-slate-100"
            />
            s
          </label>
          {hasComplexData && (
            <label className="ml-auto flex items-center gap-1 text-slate-300">
              Complex view
              <select
                value={complexViewMode}
                onChange={(event) => setComplexViewMode(event.target.value as ComplexViewMode)}
                className="rounded border border-slate-600 bg-slate-900 px-1 py-0.5 text-xs text-slate-100"
              >
                <option value="magnitude">Magnitude</option>
                <option value="real">Real</option>
                <option value="imag">Imag</option>
              </select>
            </label>
          )}
        </div>

        {showDetails && (
          <div className="rounded border border-slate-700 bg-slate-900/70 p-2 space-y-1">
            <p className="text-slate-300 truncate" title={blockTypeId}>
              {blockTypeId}
            </p>
            <p className="text-slate-400 break-all">endpoint: {endpointUrl}</p>
            <p className="text-[10px] text-slate-500">
              Direct browser fetch in prod; dev falls back to same-origin Vite proxy when blocked.
            </p>
          </div>
        )}

        <div className="rounded border border-slate-700 bg-slate-900/60 p-2">
          {state === 'loading' && <p className="text-sky-300">Loading snapshot...</p>}
          {state === 'error' && <p className="text-rose-300 break-words">Failed to load: {error}</p>}
          {state === 'success' && snapshot && snapshot.seriesByChannel.every((series) => series.length === 0) && (
            <p className="text-slate-400">Snapshot has no samples.</p>
          )}

          {snapshot && snapshot.seriesByChannel.some((series) => series.length > 0) && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-[11px] text-slate-400">
                <span>
                  channels {snapshot.channelCount} · samples {snapshot.samplesPerChannel}
                </span>
                <span>
                  y[{yMin.toFixed(3)}, {yMax.toFixed(3)}]
                </span>
              </div>
              <svg viewBox="0 0 320 140" className="w-full h-36 rounded border border-slate-700 bg-slate-950">
                <line x1="0" y1="70" x2="320" y2="70" stroke="var(--theme-canvas-grid)" strokeWidth="1" />
                {snapshot.seriesByChannel.map((series, index) => (
                  <polyline
                    key={`series-${index}`}
                    points={buildSeriesPolyline(series, 320, 140, yMin, yMax)}
                    fill="none"
                    stroke={CHANNEL_COLORS[index % CHANNEL_COLORS.length]}
                    strokeWidth="1.8"
                  />
                ))}
              </svg>
              <div className="flex flex-wrap gap-1">
                {snapshot.seriesByChannel.map((_, index) => (
                  <span
                    key={`legend-${index}`}
                    className="rounded border border-slate-700 px-1.5 py-0.5 text-[10px] text-slate-200"
                    style={{ borderColor: CHANNEL_COLORS[index % CHANNEL_COLORS.length] }}
                  >
                    ch{index}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
