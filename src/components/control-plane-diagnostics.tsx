import { useCallback, useEffect, useState } from 'react';

type DiagnosticsResult = Awaited<
  ReturnType<NonNullable<NonNullable<Window['gr4StudioShell']>['getControlPlaneDiagnostics']>>
>;

type AvailableDiagnostics = Extract<DiagnosticsResult, { available: true }>;

type ControlPlaneDiagnosticsProps = {
  defaultOpen?: boolean;
  refreshKey?: string | null;
  showUnavailable?: boolean;
};

function formatDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function ControlPlaneDiagnostics({
  defaultOpen = false,
  refreshKey = null,
  showUnavailable = false,
}: ControlPlaneDiagnosticsProps) {
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const getDiagnostics = window.gr4StudioShell?.getControlPlaneDiagnostics;
    if (!getDiagnostics) {
      return;
    }

    setIsLoading(true);
    try {
      setDiagnostics(await getDiagnostics());
    } catch (error) {
      setDiagnostics({
        available: false,
        reason: 'read-failed',
        message: `Could not request control-plane diagnostics: ${error instanceof Error ? error.message : String(error)}`,
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  if (!window.gr4StudioShell?.getControlPlaneDiagnostics) {
    return null;
  }

  if (!diagnostics) {
    return showUnavailable ? <p className="mt-3 text-xs text-slate-500">Loading control-plane diagnostics…</p> : null;
  }

  if (!diagnostics.available) {
    return showUnavailable ? (
      <div className="mt-4 rounded-lg border border-slate-800 bg-slate-950/60 p-3 text-xs text-slate-400">
        <p className="font-medium text-slate-300">Control plane diagnostics unavailable</p>
        <p className="mt-1">{diagnostics.message}</p>
      </div>
    ) : null;
  }

  const copyDiagnostics = async (snapshot: AvailableDiagnostics) => {
    try {
      await navigator.clipboard.writeText(snapshot.content);
      setActionMessage('Copied log tail.');
    } catch {
      setActionMessage('Could not copy the log tail.');
    }
  };

  const revealLog = async () => {
    try {
      const result = await window.gr4StudioShell?.revealControlPlaneLog?.();
      setActionMessage(result?.ok ? 'Opened the log location.' : result?.error ?? 'Could not open the log location.');
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Could not open the log location.');
    }
  };

  return (
    <details
      className="mt-4 rounded-lg border border-amber-900/60 bg-slate-950/80 text-left"
      open={defaultOpen || undefined}
    >
      <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-amber-200">
        Control plane diagnostics ({diagnostics.lineCount} log lines)
      </summary>
      <div className="border-t border-slate-800 p-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-400">
          <div>
            <p>Captured: {formatDate(diagnostics.capturedAt)}</p>
            <p>Log updated: {formatDate(diagnostics.modifiedAt)}</p>
            {diagnostics.truncated ? <p className="text-amber-300">Showing only the newest bounded tail.</p> : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={isLoading}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            >
              {isLoading ? 'Refreshing…' : 'Refresh'}
            </button>
            <button
              type="button"
              onClick={() => void copyDiagnostics(diagnostics)}
              disabled={!diagnostics.content}
              className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-200 hover:bg-slate-700 disabled:opacity-50"
            >
              Copy
            </button>
            {window.gr4StudioShell?.revealControlPlaneLog ? (
              <button
                type="button"
                onClick={() => void revealLog()}
                className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-slate-200 hover:bg-slate-700"
              >
                Show Log
              </button>
            ) : null}
          </div>
        </div>
        <p className="mt-2 break-all text-[10px] text-slate-500">{diagnostics.logPath}</p>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded border border-slate-800 bg-black/40 p-3 text-[11px] leading-5 text-slate-200">
          {diagnostics.content || 'The control-plane log is empty.'}
        </pre>
        {actionMessage ? <p className="mt-2 text-[11px] text-slate-400">{actionMessage}</p> : null}
      </div>
    </details>
  );
}
