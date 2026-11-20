import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { StatusPill } from '../../components/status-pill';
import { getSession } from '../../lib/api/sessionsApi';
import type { ExecutionState } from '../runtime-session/store/runtimeSessionStore';
import { ApplicationView } from './application-view';
import {
  publishDisplayApplicationVariableUpdate,
  readDisplayApplicationLaunchSnapshot,
  type DisplayApplicationLaunchSnapshot,
} from './runtime/display-application-launch';
import type { ExpressionBinding } from '../variables/model/types';

function executionStateFromSession(state: string | undefined, fallback: ExecutionState): ExecutionState {
  if (state === 'running' || state === 'stopped' || state === 'error') {
    return state;
  }
  return fallback;
}

function DisplayApplicationRuntime({ snapshot }: { snapshot: DisplayApplicationLaunchSnapshot }) {
  const sessionQuery = useQuery({
    queryKey: ['display-application-session', snapshot.sessionId],
    queryFn: () => getSession(snapshot.sessionId),
    refetchInterval: 1000,
    retry: false,
  });
  const executionState = executionStateFromSession(sessionQuery.data?.state, snapshot.executionState);
  const title = snapshot.title.trim() || 'Application';
  const statusText = sessionQuery.isError
    ? 'Session unavailable'
    : sessionQuery.data?.lastError ?? `Session ${snapshot.sessionId}`;
  const updateVariableValue = (variableName: string, binding: ExpressionBinding) => {
    publishDisplayApplicationVariableUpdate({
      launchId: snapshot.launchId,
      sourceTabId: snapshot.sourceTabId,
      variableName,
      binding,
    });
  };

  useEffect(() => {
    window.document.title = `${title} - gr4-studio`;
  }, [title]);

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-slate-950 text-slate-100">
      <header className="flex min-h-12 shrink-0 items-center justify-between gap-3 border-b border-slate-800 bg-slate-950 px-4 py-2">
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-slate-100">{title}</h1>
          <p className="truncate text-xs text-slate-500">{statusText}</p>
        </div>
        <StatusPill status={sessionQuery.isError ? 'error' : executionState} />
      </header>
      <main className="min-h-0 flex-1 overflow-hidden">
        <ApplicationView
          panelEntries={snapshot.panelEntries}
          layout={snapshot.layout}
          executionState={sessionQuery.isError ? 'error' : executionState}
          onUpdateVariableValue={updateVariableValue}
        />
      </main>
    </div>
  );
}

export function DisplayApplicationPage() {
  const { launchId } = useParams();
  const [snapshot, setSnapshot] = useState<DisplayApplicationLaunchSnapshot | null>(() =>
    launchId && typeof window !== 'undefined'
      ? readDisplayApplicationLaunchSnapshot(launchId, window.localStorage)
      : null,
  );
  const [snapshotLoaded, setSnapshotLoaded] = useState(Boolean(snapshot));
  const title = useMemo(() => snapshot?.title.trim() || 'Application', [snapshot?.title]);

  useEffect(() => {
    window.document.title = `${title} - gr4-studio`;
  }, [title]);

  useEffect(() => {
    if (!launchId || snapshot) {
      setSnapshotLoaded(true);
      return;
    }

    let cancelled = false;
    void window.gr4StudioShell?.getDisplayApplicationLaunchSnapshot?.(launchId).then((ipcSnapshot) => {
      if (cancelled) {
        return;
      }
      if (ipcSnapshot) {
        setSnapshot(ipcSnapshot as DisplayApplicationLaunchSnapshot);
      }
      setSnapshotLoaded(true);
    });

    if (!window.gr4StudioShell?.getDisplayApplicationLaunchSnapshot) {
      setSnapshotLoaded(true);
    }

    return () => {
      cancelled = true;
    };
  }, [launchId, snapshot]);

  if (!snapshotLoaded) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
        <div className="max-w-md rounded border border-slate-800 bg-slate-900 p-5">
          <h1 className="text-lg font-semibold">Opening application</h1>
          <p className="mt-2 text-base text-slate-400">Loading display launch snapshot.</p>
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
        <div className="max-w-md rounded border border-slate-800 bg-slate-900 p-5">
          <h1 className="text-lg font-semibold">Application launch expired</h1>
          <p className="mt-2 text-base text-slate-400">
            The display application could not find its launch snapshot. Run the graph again from Studio.
          </p>
        </div>
      </div>
    );
  }

  return <DisplayApplicationRuntime snapshot={snapshot} />;
}
