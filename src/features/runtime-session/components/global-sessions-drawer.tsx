import { useEffect } from 'react';
import { useRuntimeSessionStore } from '../store/runtimeSessionStore';

type GlobalSessionsDrawerProps = {
  open: boolean;
  onClose: () => void;
  onJumpToTab: (tabId: string) => void;
  activeTabId: string | null;
};

export function GlobalSessionsDrawer({ open, onClose, onJumpToTab, activeTabId }: GlobalSessionsDrawerProps) {
  const sessions = useRuntimeSessionStore((state) => state.sessions);
  const replacementCleanup = useRuntimeSessionStore((state) => state.replacementCleanup);
  const sessionActionError = useRuntimeSessionStore((state) => state.sessionActionError);
  const dismissSessionActionError = useRuntimeSessionStore((state) => state.dismissSessionActionError);
  const refreshSessionList = useRuntimeSessionStore((state) => state.refreshSessionList);
  const startSessionById = useRuntimeSessionStore((state) => state.startSessionById);
  const stopSessionById = useRuntimeSessionStore((state) => state.stopSessionById);
  const restartSessionById = useRuntimeSessionStore((state) => state.restartSessionById);
  const deleteSessionById = useRuntimeSessionStore((state) => state.deleteSessionById);
  const linkSessionToTab = useRuntimeSessionStore((state) => state.linkSessionToTab);
  const unlinkSessionFromTab = useRuntimeSessionStore((state) => state.unlinkSessionFromTab);
  const findTabIdBySessionId = useRuntimeSessionStore((state) => state.findTabIdBySessionId);

  useEffect(() => {
    if (!open) {
      return;
    }

    void refreshSessionList();
  }, [open, refreshSessionList]);

  const errorNotice = sessionActionError && (
    <div role="alert" className="flex items-center justify-between gap-2 bg-rose-950 px-4 py-2 text-sm text-rose-200">
      {sessionActionError}
      <button type="button" onClick={dismissSessionActionError}>Dismiss</button>
    </div>
  );
  if (!open) return errorNotice;

  const relationLabel = (linkedTabId: string | null): string => {
    if (!linkedTabId) {
      return 'unlinked';
    }
    if (activeTabId && linkedTabId === activeTabId) {
      return 'owned by active tab';
    }
    return `owned by ${linkedTabId}`;
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-slate-950/60" onClick={onClose} />
      <aside className="w-[30rem] max-w-full h-full border-l border-slate-700 bg-slate-900 p-4 overflow-y-auto">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-slate-100">Global Sessions</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded border border-slate-700 bg-slate-800 px-2 py-1 text-sm text-slate-200 hover:bg-slate-700"
          >
            Close
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">Active tab: {activeTabId ?? 'none'}</p>
        {errorNotice}

        <div className="mt-3 space-y-2">
          {sessions.length === 0 ? (
            <p className="text-xs text-slate-400">No sessions found.</p>
          ) : (
            sessions.map((session) => {
              const linkedTabId = findTabIdBySessionId(session.id);
              const isLinkedToActiveTab = Boolean(activeTabId) && linkedTabId === activeTabId;
              const cleanupPending = replacementCleanup.get(session.id) === 'pending';

              return (
                <div key={session.id} className="rounded border border-slate-700 bg-slate-800/60 p-2 space-y-2">
                  <div>
                    <p className="text-xs text-slate-100 break-all">{session.id}</p>
                    <p className="text-xs text-slate-400 mt-1">name={session.name} · state={session.state}</p>
                    <p className="text-xs text-slate-500 mt-1">attachment: {cleanupPending ? 'deleting during replacement cleanup' : relationLabel(linkedTabId)}</p>
                    {session.lastError && <p className="text-xs text-rose-300 mt-1 break-words">error: {session.lastError}</p>}
                  </div>

                  <div className="grid grid-cols-4 gap-1 text-xs">
                    <button
                      type="button"
                      onClick={() => void startSessionById(session.id)}
                      className="rounded border border-sky-700/70 bg-sky-900/30 px-2 py-1 text-sky-200 hover:bg-sky-800/40"
                    >
                      Start
                    </button>
                    <button
                      type="button"
                      onClick={() => void stopSessionById(session.id)}
                      className="rounded border border-amber-700/70 bg-amber-900/30 px-2 py-1 text-amber-200 hover:bg-amber-800/40"
                    >
                      Stop
                    </button>
                    <button
                      type="button"
                      onClick={() => void restartSessionById(session.id)}
                      className="rounded border border-indigo-700/70 bg-indigo-900/30 px-2 py-1 text-indigo-200 hover:bg-indigo-800/40"
                    >
                      Restart
                    </button>
                    <button
                      type="button"
                      onClick={() => void deleteSessionById(session.id)}
                      className="rounded border border-rose-700/70 bg-rose-900/30 px-2 py-1 text-rose-200 hover:bg-rose-800/40"
                    >
                      Delete
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (!activeTabId) {
                          return;
                        }
                        if (isLinkedToActiveTab) {
                          unlinkSessionFromTab(activeTabId);
                          return;
                        }
                        void linkSessionToTab(activeTabId, session.id);
                      }}
                      disabled={!activeTabId || cleanupPending}
                      className="col-span-3 rounded border border-indigo-700/70 bg-indigo-900/30 px-2 py-1 text-indigo-200 hover:bg-indigo-800/40 disabled:opacity-50"
                    >
                      {isLinkedToActiveTab
                        ? 'Unlink From Active Tab'
                        : linkedTabId
                          ? 'Move To Active Tab'
                          : 'Link To Active Tab'}
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (linkedTabId) {
                          onJumpToTab(linkedTabId);
                        }
                      }}
                      disabled={!linkedTabId}
                      className="rounded border border-slate-600 bg-slate-800 px-2 py-1 text-slate-100 hover:bg-slate-700 disabled:opacity-50"
                    >
                      Go To Tab
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </div>
  );
}
