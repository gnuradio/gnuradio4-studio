import { useEffect, useMemo, useRef, useState } from 'react';
import { appendBoundedConsoleText } from '../lib/backend-console';

type ConsoleSnapshot = Awaited<
  ReturnType<NonNullable<NonNullable<Window['gr4StudioShell']>['getControlPlaneConsole']>>
>;
type AvailableConsoleSnapshot = Extract<ConsoleSnapshot, { available: true }>;
type ConsoleOutputEvent = Parameters<
  NonNullable<NonNullable<Window['gr4StudioShell']>['onControlPlaneConsoleOutput']>
>[0] extends (event: infer Event) => void
  ? Event
  : never;

function formatUpdatedAt(value: string | null): string {
  if (!value) {
    return 'no output yet';
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString();
}

export function applyOutputEvent(
  snapshot: AvailableConsoleSnapshot,
  event: ConsoleOutputEvent,
): AvailableConsoleSnapshot {
  if (event.cursor <= snapshot.cursor) {
    return snapshot;
  }

  const appended = appendBoundedConsoleText(snapshot.content, event.text, { replace: event.replace });
  return {
    ...snapshot,
    content: appended.content,
    cursor: event.cursor,
    truncated: snapshot.truncated || event.truncated || appended.didTruncate,
    updatedAt: event.updatedAt,
    running: event.running,
  };
}

export function BackendConsoleDrawer() {
  const [snapshot, setSnapshot] = useState<ConsoleSnapshot | null>(null);
  const [minimized, setMinimized] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const [hasUnreadOutput, setHasUnreadOutput] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const outputRef = useRef<HTMLPreElement | null>(null);
  const minimizedRef = useRef(minimized);

  useEffect(() => {
    minimizedRef.current = minimized;
    if (!minimized) {
      setHasUnreadOutput(false);
    }
  }, [minimized]);

  useEffect(() => {
    const getConsole = window.gr4StudioShell?.getControlPlaneConsole;
    const onOutput = window.gr4StudioShell?.onControlPlaneConsoleOutput;
    if (!getConsole || !onOutput) {
      return undefined;
    }

    let disposed = false;
    let initialSnapshotLoaded = false;
    const pendingEvents: ConsoleOutputEvent[] = [];
    const disposeOutput = onOutput((event) => {
      if (disposed) {
        return;
      }
      if (!initialSnapshotLoaded) {
        pendingEvents.push(event);
        return;
      }
      setSnapshot((current) =>
        current?.available ? applyOutputEvent(current, event) : current,
      );
      if (minimizedRef.current) {
        setHasUnreadOutput(true);
      }
    });

    void getConsole().then((initial) => {
      if (disposed) {
        return;
      }
      let next = initial;
      if (next.available) {
        for (const event of pendingEvents) {
          next = applyOutputEvent(next, event);
        }
      }
      const receivedPendingOutput = pendingEvents.some(
        (event) => !initial.available || event.cursor > initial.cursor,
      );
      pendingEvents.length = 0;
      initialSnapshotLoaded = true;
      setSnapshot(next);
      if (receivedPendingOutput) {
        setHasUnreadOutput(true);
      }
    }).catch(() => {
      initialSnapshotLoaded = true;
    });

    return () => {
      disposed = true;
      disposeOutput();
    };
  }, []);

  useEffect(() => {
    if (!minimized && autoScroll && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [autoScroll, minimized, snapshot]);

  const lineCount = useMemo(() => {
    if (!snapshot?.available || !snapshot.content) {
      return 0;
    }
    const lines = snapshot.content.split('\n');
    return lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
  }, [snapshot]);

  if (!window.gr4StudioShell?.getControlPlaneConsole || !snapshot?.available) {
    return null;
  }

  const refresh = async () => {
    try {
      const next = await window.gr4StudioShell?.getControlPlaneConsole?.();
      if (next) {
        setSnapshot(next);
        setActionMessage(next.available ? 'Console refreshed.' : next.message);
      }
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Could not refresh the console.');
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(snapshot.content);
      setActionMessage('Copied console output.');
    } catch {
      setActionMessage('Could not copy console output.');
    }
  };

  const showLog = async () => {
    try {
      const result = await window.gr4StudioShell?.revealControlPlaneLog?.();
      setActionMessage(result?.ok ? 'Opened the log location.' : result?.error ?? 'Could not open the log.');
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : 'Could not open the log.');
    }
  };

  if (minimized) {
    return (
      <button
        type="button"
        onClick={() => setMinimized(false)}
        className="flex h-8 shrink-0 items-center justify-between border-t border-slate-700 bg-slate-950 px-4 text-xs text-slate-300 hover:bg-slate-900"
        aria-label="Open backend console"
        title="Expand backend console"
      >
        <span className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${snapshot.running ? 'bg-emerald-400' : 'bg-rose-400'}`} />
          Backend Console
          <span className="text-slate-500">{lineCount} lines</span>
        </span>
        <span className="flex items-center gap-3">
          {hasUnreadOutput ? <span className="text-sky-300">new output</span> : null}
          <span className="text-sm leading-none" aria-hidden="true">^</span>
        </span>
      </button>
    );
  }

  return (
    <section className="flex h-64 shrink-0 flex-col border-t border-slate-700 bg-slate-950 shadow-[0_-10px_30px_rgba(0,0,0,0.25)]">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-slate-800 px-3">
        <div className="flex min-w-0 items-center gap-2 text-xs">
          <span className={`h-2 w-2 rounded-full ${snapshot.running ? 'bg-emerald-400' : 'bg-rose-400'}`} />
          <span className="font-medium text-slate-200">Backend Console</span>
          <span className="text-slate-500">{lineCount} lines</span>
          {snapshot.truncated ? <span className="text-amber-300">bounded tail</span> : null}
          <span className="truncate text-slate-600">updated {formatUpdatedAt(snapshot.updatedAt)}</span>
        </div>
        <div className="flex shrink-0 items-center gap-2 text-[11px]">
          <label className="flex items-center gap-1 text-slate-400">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(event) => setAutoScroll(event.target.checked)}
            />
            Auto-scroll
          </label>
          <button type="button" onClick={() => void refresh()} className="text-slate-300 hover:text-white">
            Refresh
          </button>
          <button
            type="button"
            onClick={() => {
              setSnapshot((current) => (current?.available ? { ...current, content: '' } : current));
              setActionMessage('Cleared this view.');
            }}
            className="text-slate-300 hover:text-white"
          >
            Clear
          </button>
          <button type="button" onClick={() => void copy()} className="text-slate-300 hover:text-white">
            Copy
          </button>
          <button type="button" onClick={() => void showLog()} className="text-slate-300 hover:text-white">
            Show Log
          </button>
          <button
            type="button"
            onClick={() => setMinimized(true)}
            className="h-6 w-6 rounded border border-slate-700 bg-slate-900 text-sm leading-none text-slate-200 hover:bg-slate-800"
            aria-label="Minimize backend console"
            title="Minimize backend console"
          >
            <span aria-hidden="true">v</span>
          </button>
        </div>
      </div>
      <pre
        ref={outputRef}
        className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words bg-black/40 p-3 font-mono text-[11px] leading-5 text-slate-200"
      >
        {snapshot.content || 'No backend output captured.'}
      </pre>
      <div className="flex h-6 shrink-0 items-center justify-between border-t border-slate-800 px-3 text-[10px] text-slate-500">
        <span>Unattributed stdout/stderr from the managed control plane and running blocks.</span>
        <span>{actionMessage}</span>
      </div>
    </section>
  );
}
