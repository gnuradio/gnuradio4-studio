import { useMemo, useState } from 'react';
import { StatusPill } from '../../../components/status-pill';
import { ControlPlaneDiagnostics } from '../../../components/control-plane-diagnostics';
import { formatTimestamp } from '../../../lib/utils/ui-formatting';
import { useRuntimeSessionStore, type ExecutionState, type OperationState, type RunIntent } from '../store/runtimeSessionStore';

type GraphExecutionOverlayProps = {
  tabId: string;
  onRun: () => void;
  currentSubmissionContent: string;
};

function shortId(id: string | null): string {
  if (!id) {
    return 'none';
  }

  if (id.length <= 14) {
    return id;
  }

  return `${id.slice(0, 7)}...${id.slice(-6)}`;
}

function toOperationMessage(operationState: OperationState): string | null {
  if (operationState === 'none') {
    return null;
  }
  if (operationState === 'running-graph') {
    return 'Submitting graph snapshot and starting session...';
  }
  if (operationState === 'stopping-session') {
    return 'Stopping session...';
  }
  if (operationState === 'restarting-session') {
    return 'Restarting session...';
  }
  return 'Refreshing session state...';
}

function runIntentMessage(runIntent: RunIntent): string {
  if (runIntent === 'create-session') {
    return 'Run will create and start a new session from the current graph snapshot.';
  }
  if (runIntent === 'replace-session-from-edits') {
    return 'Run will replace the linked session with a new one from the current graph snapshot.';
  }
  if (runIntent === 'start-linked-session') {
    return 'Run will start the currently linked session.';
  }
  return 'Session is already running.';
}

function executionHint(params: {
  executionState: ExecutionState;
  graphDriftState: 'in-sync' | 'out-of-sync';
  sessionId: string | null;
  lastError: string | null;
}): string {
  if (params.lastError) {
    return params.lastError;
  }

  if (!params.sessionId) {
    return 'No linked session. Run submits the current graph as a new session.';
  }

  if (params.graphDriftState === 'out-of-sync') {
    return 'Linked session is stale. Graph changed since the attached session snapshot.';
  }

  if (params.executionState === 'running') {
    return 'Running.';
  }

  if (params.executionState === 'stopped') {
    return 'Stopped.';
  }

  if (params.executionState === 'ready') {
    return 'Ready to run.';
  }

  if (params.executionState === 'error') {
    return 'Execution reported an error.';
  }

  return 'Idle.';
}

export function GraphExecutionOverlay({ tabId, onRun, currentSubmissionContent }: GraphExecutionOverlayProps) {
  const [collapsed, setCollapsed] = useState(false);

  const context = useRuntimeSessionStore((state) => state.contextsByTabId[tabId]);
  const stopSessionForTab = useRuntimeSessionStore((state) => state.stopSessionForTab);
  const restartSessionForTab = useRuntimeSessionStore((state) => state.restartSessionForTab);
  const refreshSessionStateForTab = useRuntimeSessionStore((state) => state.refreshSessionStateForTab);
  const deleteSessionForTab = useRuntimeSessionStore((state) => state.deleteSessionForTab);
  const getTabRuntimeView = useRuntimeSessionStore((state) => state.getTabRuntimeView);

  const safeContext = useMemo(
    () =>
      context ?? {
        sessionId: null,
        session: null,
        lastSubmittedHash: null,
        graphSubmissionUpdatedAt: null,
        lastAction: null,
        lastActionStatus: 'idle' as const,
        busy: false,
        lastError: null,
        lastUpdatedAt: null,
        sessionRefreshedAt: null,
        activity: [],
      },
    [context],
  );

  const runtimeView = getTabRuntimeView(tabId, currentSubmissionContent);
  const isRunning = runtimeView.executionState === 'running';
  const operationMessage = toOperationMessage(runtimeView.operationState);

  const playDisabled = safeContext.busy || isRunning;
  const stopDisabled = safeContext.busy || !safeContext.sessionId || !isRunning;
  const restartDisabled = safeContext.busy || !safeContext.sessionId;
  const deleteDisabled = safeContext.busy || !safeContext.sessionId;

  const hintText = executionHint({
    executionState: runtimeView.executionState,
    graphDriftState: runtimeView.graphDriftState,
    sessionId: safeContext.sessionId,
    lastError: safeContext.lastError,
  });

  return (
    <div className="absolute right-3 top-3 z-20 w-80 rounded-md border border-slate-700 bg-slate-900/95 shadow-lg backdrop-blur">
      <div className="flex items-center justify-between border-b border-slate-700 px-3 py-2">
        <div className="flex items-center gap-2">
          <StatusPill status={runtimeView.executionState} />
          {!collapsed && <h3 className="text-xs font-semibold text-slate-100">Execution</h3>}
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => {
              if (!playDisabled) {
                onRun();
              }
            }}
            disabled={playDisabled}
            title="Play"
            className="h-7 w-7 rounded border border-emerald-700/70 bg-emerald-900/35 text-emerald-200 hover:bg-emerald-800/45 disabled:opacity-50"
          >
            <svg viewBox="0 0 16 16" className="mx-auto h-3.5 w-3.5 fill-current" aria-hidden="true">
              <path d="M4 2.5v11l8-5.5z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => {
              if (!stopDisabled) {
                void stopSessionForTab(tabId);
              }
            }}
            disabled={stopDisabled}
            title="Stop"
            className="h-7 w-7 rounded border border-amber-700/70 bg-amber-900/35 text-amber-200 hover:bg-amber-800/45 disabled:opacity-50"
          >
            <svg viewBox="0 0 16 16" className="mx-auto h-3.5 w-3.5 fill-current" aria-hidden="true">
              <rect x="3.5" y="3.5" width="9" height="9" rx="1" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => setCollapsed((current) => !current)}
            className="w-6 text-xs text-slate-300 hover:text-white"
            aria-label={collapsed ? 'Expand execution panel' : 'Collapse execution panel'}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? 'v' : '^'}
          </button>
        </div>
      </div>

      {!collapsed && (
        <div className="p-3 space-y-2 text-xs">
          <div className="rounded border border-slate-700 bg-slate-800/60 p-2 space-y-2">
            {operationMessage && <p className="text-[11px] text-sky-300 break-words">{operationMessage}</p>}
            {!operationMessage && <p className="text-[11px] text-cyan-300 break-words">{runIntentMessage(runtimeView.runIntent)}</p>}
            <p className="text-[11px] text-slate-300 break-words">{hintText}</p>
            <p className="text-[11px] text-slate-500">
              {safeContext.lastAction ? `Last action: ${safeContext.lastAction}` : 'No actions yet'}
            </p>
            <p className="text-[11px] text-slate-500">session refreshed: {formatTimestamp(new Date(safeContext.sessionRefreshedAt ?? '').getTime())}</p>
            <p className="text-[11px] text-slate-500">updated: {formatTimestamp(new Date(safeContext.lastUpdatedAt ?? '').getTime())}</p>
          </div>

          <div className="rounded border border-slate-700 bg-slate-900/60 p-2 space-y-1">
            <p className="text-[11px] text-slate-400">session {shortId(safeContext.sessionId)}</p>
            <p className="text-[11px] text-slate-400">snapshot: {runtimeView.graphSubmissionState}</p>
            <p className="text-[11px] text-slate-400">
              sync: {runtimeView.graphDriftState === 'in-sync' ? 'linked session in sync' : 'linked session stale'}
            </p>
            <p className="text-[11px] text-slate-500">submitted: {formatTimestamp(new Date(runtimeView.graphSubmissionUpdatedAt ?? '').getTime())}</p>
            {safeContext.session?.lastError && <p className="text-[11px] text-rose-300 break-words">backend: {safeContext.session.lastError}</p>}
          </div>

          {safeContext.lastError || safeContext.session?.lastError ? (
            <ControlPlaneDiagnostics refreshKey={safeContext.lastError ?? safeContext.session?.lastError} />
          ) : null}

          <div className="grid grid-cols-2 gap-2 border-t border-slate-700 pt-2">
            <button
              type="button"
              onClick={() => void refreshSessionStateForTab(tabId)}
              disabled={safeContext.busy || !safeContext.sessionId}
              className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-slate-100 hover:bg-slate-700 disabled:opacity-50"
            >
              Refresh Session
            </button>
            <button
              type="button"
              onClick={() => void restartSessionForTab(tabId)}
              disabled={restartDisabled}
              className="rounded border border-indigo-700/70 bg-indigo-900/30 px-2 py-1 text-indigo-200 hover:bg-indigo-800/40 disabled:opacity-50"
            >
              Restart
            </button>
            <button
              type="button"
              onClick={() => void deleteSessionForTab(tabId)}
              disabled={deleteDisabled}
              className="col-span-2 rounded border border-rose-700/70 bg-rose-900/30 px-2 py-1 text-rose-200 hover:bg-rose-800/40 disabled:opacity-50"
            >
              Delete Session
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
