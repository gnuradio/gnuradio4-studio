import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { PlotAdapterSwitch } from '../adapters/plot-adapter-switch';
import type { PlotAxisMode, PlotDataFrame, PlotRuntimeBinding, PlotViewSpec } from '../model/types';
import { derivePlotVisibleState, hasRenderableImage, hasRenderableSeries } from './plot-visible-state';

type PlotSurfaceProps = {
  spec: PlotViewSpec;
  frame: PlotDataFrame;
  binding?: PlotRuntimeBinding;
  isPaused?: boolean;
  onPausedChange?: (paused: boolean) => void;
  axisMode?: PlotAxisMode;
  onAxisModeChange?: (mode: PlotAxisMode) => void;
  viewResetKey?: number;
  onViewReset?: () => void;
};

type ContextMenuState = {
  x: number;
  y: number;
} | null;

function shortenEndpoint(endpoint: string | undefined): string {
  const trimmed = endpoint?.trim() ?? '';
  if (trimmed.length <= 48) {
    return trimmed;
  }
  return `${trimmed.slice(0, 45)}...`;
}

function useVisibleRefreshFps(params: {
  sequence?: number;
  state?: NonNullable<PlotDataFrame['meta']>['state'];
}): number | null {
  const lastRef = useRef<{ sequence: number | null; seenAtMs: number | null; fpsHz: number | null }>({
    sequence: null,
    seenAtMs: null,
    fpsHz: null,
  });
  const [fpsHz, setFpsHz] = useState<number | null>(null);

  useEffect(() => {
    if (params.state !== 'ready' || typeof params.sequence !== 'number' || !Number.isFinite(params.sequence)) {
      lastRef.current = {
        sequence: null,
        seenAtMs: null,
        fpsHz: null,
      };
      setFpsHz(null);
      return;
    }

    const nowMs = performance.now();
    const previous = lastRef.current;
    if (previous.sequence === params.sequence) {
      return;
    }

    let nextFpsHz: number | null = previous.fpsHz;
    if (previous.seenAtMs !== null) {
      const elapsedMs = nowMs - previous.seenAtMs;
      if (elapsedMs > 0) {
        const instantFpsHz = 1000 / elapsedMs;
        nextFpsHz = nextFpsHz === null ? instantFpsHz : nextFpsHz * 0.75 + instantFpsHz * 0.25;
      }
    }

    lastRef.current = {
      sequence: params.sequence,
      seenAtMs: nowMs,
      fpsHz: nextFpsHz,
    };
    setFpsHz(nextFpsHz);
  }, [params.sequence, params.state]);

  return fpsHz;
}

function formatRateBadge(params: { renderFps: number | null; ingressFps: number | null }): string | null {
  const parts: string[] = [];
  if (typeof params.renderFps === 'number' && Number.isFinite(params.renderFps) && params.renderFps > 0) {
    parts.push(`render ${params.renderFps.toFixed(1)} fps`);
  }
  if (typeof params.ingressFps === 'number' && Number.isFinite(params.ingressFps) && params.ingressFps > 0) {
    parts.push(`ingress ${params.ingressFps.toFixed(1)} fps`);
  }
  return parts.length > 0 ? parts.join(' · ') : null;
}

function formatConnectionBadge(frame: PlotDataFrame): string | null {
  if (frame.meta?.statusMessage) {
    return frame.meta.statusMessage;
  }
  if (frame.meta?.errorMessage) {
    return frame.meta.errorMessage;
  }
  return null;
}

export function PlotSurface({
  spec,
  frame,
  binding,
  isPaused = false,
  onPausedChange,
  axisMode = 'x',
  onAxisModeChange,
  viewResetKey = 0,
  onViewReset,
}: PlotSurfaceProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [diagnosticsCollapsed, setDiagnosticsCollapsed] = useState(true);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const next = entries[0];
      if (!next) {
        return;
      }
      setSize({
        width: Math.floor(next.contentRect.width),
        height: Math.floor(next.contentRect.height),
      });
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!contextMenu) {
      return undefined;
    }

    const closeMenu = () => setContextMenu(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        closeMenu();
      }
    };

    window.addEventListener('pointerdown', closeMenu);
    window.addEventListener('scroll', closeMenu, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', closeMenu);
      window.removeEventListener('scroll', closeMenu, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [contextMenu]);

  const visibleState = derivePlotVisibleState({
    frame,
    width: size.width,
    height: size.height,
  });
  const showAdapter =
    visibleState === 'live' || (visibleState === 'loading' && (hasRenderableSeries(frame) || hasRenderableImage(frame)));
  const isCompactPlaceholder = size.width < 300 || size.height < 180;
  const statusLabel = frame.meta?.state ?? 'no-data';
  const transportLabel = binding?.transport?.trim() || 'n/a';
  const endpointLabel = binding?.showEndpointInUi === false ? '' : shortenEndpoint(binding?.endpoint);
  const sequenceLabel = typeof frame.meta?.sequence === 'number' ? `#${frame.meta.sequence}` : null;
  const rateLabel = formatRateBadge({
    renderFps: useVisibleRefreshFps({
      sequence: frame.meta?.sequence,
      state: frame.meta?.state,
    }),
    ingressFps: frame.meta?.liveIngressFpsHz ?? null,
  });
  const statusText =
    frame.meta?.errorMessage ?? frame.meta?.statusMessage ?? (visibleState === 'loading' ? 'Connecting live source...' : null);
  const connectionBadge = formatConnectionBadge(frame);
  const showDiagnostics = Boolean(binding?.transport || endpointLabel || frame.meta?.state);

  const titleByState: Record<Exclude<typeof visibleState, 'live'>, string> = {
    loading: 'Connecting',
    'no-data': 'No Data Yet',
    'invalid-binding': 'Invalid Binding',
    'runtime-error': 'Runtime Error',
    'too-small': 'Panel Too Small',
  };

  const message =
    visibleState === 'loading'
      ? 'Connecting to live source...'
      : visibleState === 'invalid-binding'
        ? frame.meta?.errorMessage ?? 'Invalid plot binding. Check transport and runtime stream availability.'
        : visibleState === 'runtime-error'
        ? frame.meta?.errorMessage ?? 'Unable to load live data.'
        : visibleState === 'too-small'
      ? 'Panel is too small to render plot.'
      : 'Waiting for live data.';

  const openContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (!onPausedChange && !onViewReset && !onAxisModeChange) {
      return;
    }
    event.preventDefault();
    const hostBounds = hostRef.current?.getBoundingClientRect();
    const menuWidth = 176;
    const menuHeight = 168;
    const maxX = Math.max(0, (hostBounds?.width ?? size.width) - menuWidth - 4);
    const maxY = Math.max(0, (hostBounds?.height ?? size.height) - menuHeight - 4);
    const localX = hostBounds ? event.clientX - hostBounds.left : event.clientX;
    const localY = hostBounds ? event.clientY - hostBounds.top : event.clientY;
    setContextMenu({
      x: Math.min(Math.max(4, localX), maxX),
      y: Math.min(Math.max(4, localY), maxY),
    });
  };

  const togglePaused = () => {
    onPausedChange?.(!isPaused);
    setContextMenu(null);
  };

  const selectAxisMode = (mode: PlotAxisMode) => {
    onAxisModeChange?.(mode);
    setContextMenu(null);
  };

  const resetView = () => {
    onViewReset?.();
    setContextMenu(null);
  };

  return (
    <div ref={hostRef} className="relative h-full w-full min-h-0 min-w-0" onContextMenu={openContextMenu}>
      {showAdapter ? (
        <PlotAdapterSwitch
          spec={spec}
          frame={frame}
          width={size.width}
          height={size.height}
          axisMode={axisMode}
          viewResetKey={viewResetKey}
        />
      ) : null}
      {isPaused ? (
        <div className="pointer-events-none absolute left-2 top-2 z-20 rounded border border-amber-500/50 bg-slate-950/85 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-amber-200 shadow-lg shadow-slate-950/30">
          Paused
        </div>
      ) : null}
      {contextMenu ? (
        <div
          className="absolute z-40 w-48 rounded border border-slate-700 bg-slate-950 py-1 text-xs text-slate-100 shadow-xl shadow-slate-950/50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          onContextMenu={(event) => event.preventDefault()}
          onPointerDown={(event) => event.stopPropagation()}
        >
          {onPausedChange ? (
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 py-1.5 text-left transition hover:bg-slate-800 focus:bg-slate-800 focus:outline-none"
              role="menuitem"
              onClick={togglePaused}
            >
              <span>{isPaused ? 'Resume updates' : 'Pause updates'}</span>
              <span className="text-[10px] text-slate-500">{isPaused ? 'running' : 'freeze'}</span>
            </button>
          ) : null}
          {onViewReset ? (
            <button
              type="button"
              className="flex w-full items-center justify-between px-3 py-1.5 text-left transition hover:bg-slate-800 focus:bg-slate-800 focus:outline-none"
              role="menuitem"
              onClick={resetView}
            >
              <span>Reset view</span>
              <span className="text-[10px] text-slate-500">autoscale</span>
            </button>
          ) : null}
          {onAxisModeChange ? (
            <div className="my-1 border-t border-slate-800 pt-1" role="group" aria-label="Navigation axes">
              {(['x', 'y', 'xy'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className="flex w-full items-center justify-between px-3 py-1.5 text-left transition hover:bg-slate-800 focus:bg-slate-800 focus:outline-none"
                  role="menuitemradio"
                  aria-checked={axisMode === mode}
                  onClick={() => selectAxisMode(mode)}
                >
                  <span>{mode === 'x' ? 'X axis' : mode === 'y' ? 'Y axis' : 'X/Y axes'}</span>
                  <span className="text-[10px] text-slate-500">{axisMode === mode ? 'selected' : ''}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {showDiagnostics ? (
        <div
          className={
            diagnosticsCollapsed
              ? 'absolute right-2 top-2 z-20 rounded border border-slate-700/80 bg-slate-950/90 p-1 text-[10px] text-slate-200 shadow-lg shadow-slate-950/40 backdrop-blur'
              : 'absolute right-2 top-2 z-20 max-w-[70%] rounded border border-slate-700/80 bg-slate-950/90 px-2 py-1 text-[10px] text-slate-200 shadow-lg shadow-slate-950/40 backdrop-blur'
          }
        >
          {diagnosticsCollapsed ? (
            <button
              type="button"
              className="flex h-5 w-5 items-center justify-center rounded border border-slate-700/70 bg-slate-950/70 text-[10px] leading-none text-slate-300/90 opacity-70 shadow-sm shadow-slate-950/30 transition hover:opacity-100 hover:border-slate-500 hover:bg-slate-900/90"
              onClick={() => setDiagnosticsCollapsed(false)}
              aria-label="Expand diagnostics"
              title="Expand diagnostics"
            >
              +
            </button>
          ) : (
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold uppercase tracking-wide text-slate-400">{statusLabel}</span>
                  <span className="rounded border border-slate-700 bg-slate-900/80 px-1.5 py-0.5 text-slate-100">
                    {transportLabel}
                  </span>
                  {sequenceLabel ? <span className="text-slate-400">{sequenceLabel}</span> : null}
                  {rateLabel ? <span className="text-slate-400">{rateLabel}</span> : null}
                </div>
                {connectionBadge ? <div className="mt-0.5 truncate text-slate-300">{connectionBadge}</div> : null}
                {endpointLabel ? (
                  <div className="mt-0.5 truncate text-slate-400" title={binding?.endpoint}>
                    {endpointLabel}
                  </div>
                ) : null}
                {statusText ? <div className="mt-0.5 truncate text-slate-300">{statusText}</div> : null}
              </div>
              <button
                type="button"
                className="shrink-0 rounded border border-slate-700 bg-slate-900/80 px-1.5 py-0.5 text-[10px] leading-none text-slate-200 transition hover:border-slate-500 hover:bg-slate-800"
                onClick={() => setDiagnosticsCollapsed(true)}
                aria-label="Collapse diagnostics"
                title="Collapse diagnostics"
              >
                -
              </button>
            </div>
          )}
        </div>
      ) : null}
      {!showAdapter ? (
        <div className="absolute inset-0 flex items-center justify-center rounded border border-slate-800/90 bg-slate-950/70 p-3 text-center">
          <div className="max-w-full">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
              {titleByState[visibleState]}
            </p>
            {!isCompactPlaceholder ? (
              <div
                className={
                  visibleState === 'invalid-binding' || visibleState === 'runtime-error'
                    ? 'mt-1 text-xs text-rose-300 break-words'
                    : 'mt-1 text-xs text-slate-300'
                }
              >
                <p>{message}</p>
                {binding?.transport || endpointLabel ? (
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">
                    {endpointLabel ? `${binding?.transport ?? 'n/a'} · ${binding?.endpoint ?? 'n/a'}` : (binding?.transport ?? 'n/a')}
                  </p>
                ) : null}
                {frame.meta?.state ? (
                  <p className="mt-1 text-[10px] uppercase tracking-wide text-slate-500">
                    frame state: {frame.meta.state}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
