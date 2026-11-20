import { create } from 'zustand';
import { editorNodeIdentity, type EditorGraphNode } from '../../graph-editor/model/types';
import type { GraphDocument } from '../../graph-document/model/types';
import type { BlockDetails } from '../../../lib/api/block-details';
import { ApiClientError } from '../../../lib/api/client';
import { buildCurrentSessionGraphSubmission } from '../../runtime-submission/model/current-graph-submission';
import {
  createSession,
  deleteSession,
  getSession,
  listSessions,
  restartSession,
  startSession,
  stopSession,
  type SessionRecord,
} from '../../../lib/api/sessionsApi';

type RuntimeActionStatus = 'idle' | 'running' | 'success' | 'error';
export type ExecutionState = 'idle' | 'ready' | 'running' | 'stopped' | 'error';
export type OperationState = 'none' | 'running-graph' | 'stopping-session' | 'restarting-session' | 'refreshing';
export type GraphDriftState = 'in-sync' | 'out-of-sync' | 'unknown';
export type GraphSubmissionState = 'none' | 'current' | 'stale';
export type RunIntent = 'none' | 'create-session' | 'replace-session-from-edits' | 'start-linked-session';
export type RunTabResult =
  | {
      ok: true;
      sessionId: string;
      session: SessionRecord;
    }
  | {
      ok: false;
      error: string;
    };

export type TabRuntimeView = {
  executionState: ExecutionState;
  operationState: OperationState;
  graphDriftState: GraphDriftState;
  graphSubmissionState: GraphSubmissionState;
  graphSubmissionUpdatedAt: string | null;
  runIntent: RunIntent;
};

export type RuntimeActivity = {
  timestamp: string;
  action: string;
  message: string;
  level: 'info' | 'error';
};

export type TabExecutionContext = {
  sessionId: string | null;
  session: SessionRecord | null;
  lastSubmittedHash: string | null;
  submittedNodeIdentities: ReadonlyMap<string, symbol> | null;
  graphSubmissionUpdatedAt: string | null;
  lastAction: 'create' | 'start' | 'stop' | 'restart' | 'refresh' | 'delete' | null;
  lastActionStatus: RuntimeActionStatus;
  busy: boolean;
  lastError: string | null;
  lastUpdatedAt: string | null;
  sessionRefreshedAt: string | null;
  activity: RuntimeActivity[];
};

type SubmissionBaseline = Pick<TabExecutionContext, 'lastSubmittedHash' | 'submittedNodeIdentities' | 'graphSubmissionUpdatedAt'>;

type RuntimeSessionState = {
  activeTabId: string | null;
  contextsByTabId: Record<string, TabExecutionContext>;
  sessions: SessionRecord[];
  replacementCleanup: ReadonlyMap<string, 'pending' | 'deleted'>;
  sessionActionError: string | null;
  dismissSessionActionError: () => void;
  getTabRuntimeView: (tabId: string, currentSubmissionContent?: string | null, schedulerId?: string | null, editorNodes?: readonly EditorGraphNode[]) => TabRuntimeView;
  ensureTabContext: (tabId: string) => void;
  removeTabContext: (tabId: string) => void;
  setActiveTab: (tabId: string | null) => void;
  runTab: (
    tabId: string,
    document: GraphDocument,
    options?: { blockDetailsByType?: ReadonlyMap<string, BlockDetails>; editorNodes?: readonly EditorGraphNode[] },
  ) => Promise<RunTabResult>;
  stopSessionForTab: (tabId: string) => Promise<void>;
  restartSessionForTab: (tabId: string) => Promise<void>;
  deleteSessionForTab: (tabId: string) => Promise<void>;
  refreshTab: (tabId: string) => Promise<void>;
  refreshSessionStateForTab: (tabId: string) => Promise<void>;
  startSessionById: (sessionId: string) => Promise<void>;
  stopSessionById: (sessionId: string) => Promise<void>;
  restartSessionById: (sessionId: string) => Promise<void>;
  deleteSessionById: (sessionId: string) => Promise<void>;
  linkSessionToTab: (tabId: string, sessionId: string) => Promise<void>;
  unlinkSessionFromTab: (tabId: string) => void;
  findTabIdBySessionId: (sessionId: string) => string | null;
  refreshSessionList: () => Promise<void>;
};

function createDefaultContext(): TabExecutionContext {
  return {
    sessionId: null,
    session: null,
    lastSubmittedHash: null,
    submittedNodeIdentities: null,
    graphSubmissionUpdatedAt: null,
    lastAction: null,
    lastActionStatus: 'idle',
    busy: false,
    lastError: null,
    lastUpdatedAt: null,
    sessionRefreshedAt: null,
    activity: [],
  };
}

function nowIsoString(): string {
  return new Date().toISOString();
}

function hashContent(input: string): string {
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function hashSubmissionSignature(content: string, schedulerId?: string | null): string {
  return hashContent(`${content}\n__scheduler__:${schedulerId ?? ''}`);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    return error.details ? `${error.message}: ${error.details}` : error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return 'Unknown runtime error';
}

function isMissingSessionError(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === 'HTTP' && error.status === 404;
}

function isRunningState(state: string | undefined): boolean {
  return state === 'running';
}

function isStoppedState(state: string | undefined): boolean {
  return state === 'stopped';
}

function isErrorState(state: string | undefined): boolean {
  return state === 'error';
}

function deriveExecutionState(context: TabExecutionContext): ExecutionState {
  const state = context.session?.state;

  if (context.busy && context.lastActionStatus === 'running') {
    if (context.lastAction === 'stop' || context.lastAction === 'delete') {
      return 'stopped';
    }
  }

  if (isRunningState(state)) {
    return 'running';
  }

  if (isErrorState(state) || context.lastActionStatus === 'error') {
    return 'error';
  }

  if (isStoppedState(state)) {
    return 'stopped';
  }

  if (context.sessionId) {
    return 'ready';
  }

  return 'idle';
}

function deriveOperationState(context: TabExecutionContext): OperationState {
  if (!context.busy || context.lastActionStatus !== 'running') {
    return 'none';
  }

  if (context.lastAction === 'stop') {
    return 'stopping-session';
  }
  if (context.lastAction === 'restart') {
    return 'restarting-session';
  }
  if (context.lastAction === 'refresh') {
    return 'refreshing';
  }
  return 'running-graph';
}

function hasIdentityDrift(context: TabExecutionContext, nodes?: readonly EditorGraphNode[]): boolean {
  const submitted = context.submittedNodeIdentities;
  if (!nodes || !submitted) return false;
  const current = new Map(nodes.map((node) => [node.instanceId, node[editorNodeIdentity]]));
  for (const [id, identity] of submitted) {
    if (current.get(id) !== identity) return true;
  }
  return false;
}

function deriveRunIntent(
  context: TabExecutionContext,
  drift: GraphDriftState,
  executionState: ExecutionState,
): RunIntent {
  if (executionState === 'running') {
    return 'none';
  }

  if (!context.sessionId) {
    return 'create-session';
  }

  if (drift !== 'in-sync') {
    return 'replace-session-from-edits';
  }

  return 'start-linked-session';
}

function pushActivity(context: TabExecutionContext, item: Omit<RuntimeActivity, 'timestamp'>): TabExecutionContext {
  const nextEvent: RuntimeActivity = {
    ...item,
    timestamp: nowIsoString(),
  };

  return {
    ...context,
    activity: [nextEvent, ...context.activity].slice(0, 40),
  };
}

const POLL_INTERVALS_MS = [500, 500, 500, 1000, 1000, 1000, 1000, 1500];

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export const useRuntimeSessionStore = create<RuntimeSessionState>((set, get) => {
  // An unlinked session can be reattached to its originating editor tab.
  const submissions = new Map<string, { tabId: string; baseline: SubmissionBaseline }>();
  const actionVersionByTabId: Record<string, number> = {};
  let sessionListVersion = 0;

  const cleanupUnownedSession = async (id: string): Promise<string | null> => {
    if (get().findTabIdBySessionId(id) || get().replacementCleanup.has(id)) return null;
    // Publish the reservation before DELETE so a concurrent link sees it immediately.
    set((state) => ({ replacementCleanup: new Map(state.replacementCleanup).set(id, 'pending') }));
    try {
      const { deleted } = await deleteSession(id);
      if (!deleted) throw new Error('Control Plane did not confirm deletion.');
    } catch (error) {
      if (!isMissingSessionError(error)) {
        const message = `Could not delete session ${id} during replacement cleanup: ${toErrorMessage(error)}`;
        set((state) => {
          const replacementCleanup = new Map(state.replacementCleanup);
          replacementCleanup.delete(id);
          return { replacementCleanup, sessionActionError: message };
        });
        return message;
      }
    }

    submissions.delete(id);
    ++sessionListVersion;
    set((state) => ({
      sessions: state.sessions.filter((session) => session.id !== id),
      replacementCleanup: new Map(state.replacementCleanup).set(id, 'deleted'),
    }));
    return null;
  };

  const patchContext = (tabId: string, updater: (current: TabExecutionContext) => TabExecutionContext) => {
    set((state) => {
      const current = state.contextsByTabId[tabId] ?? createDefaultContext();
      return {
        contextsByTabId: {
          ...state.contextsByTabId,
          [tabId]: updater(current),
        },
      };
    });
  };

  const nextActionVersion = (tabId: string): number => {
    const next = (actionVersionByTabId[tabId] ?? 0) + 1;
    actionVersionByTabId[tabId] = next;
    return next;
  };

  const isCurrentAction = (tabId: string, version: number): boolean => actionVersionByTabId[tabId] === version;

  const patchContextIfCurrent = (
    tabId: string,
    version: number,
    updater: (current: TabExecutionContext) => TabExecutionContext,
  ): boolean => {
    if (!isCurrentAction(tabId, version)) {
      return false;
    }

    patchContext(tabId, updater);
    return true;
  };

  const beginAction = (tabId: string, action: TabExecutionContext['lastAction']): number => {
    const version = nextActionVersion(tabId);
    patchContext(tabId, (current) => ({
      ...current,
      lastAction: action,
      lastActionStatus: 'running',
      busy: true,
      lastError: null,
      lastUpdatedAt: nowIsoString(),
    }));
    return version;
  };

  const completeAction = (
    tabId: string,
    version: number,
    status: RuntimeActionStatus,
    errorMessage?: string | null,
    successMessage?: string,
  ) => {
    patchContextIfCurrent(tabId, version, (current) => {
      const withResult: TabExecutionContext = {
        ...current,
        lastActionStatus: status,
        busy: false,
        lastError: status === 'error' ? errorMessage ?? 'Action failed.' : null,
        lastUpdatedAt: nowIsoString(),
      };

      if (status === 'error') {
        return pushActivity(withResult, {
          action: current.lastAction ?? 'action',
          message: errorMessage ?? 'Action failed.',
          level: 'error',
        });
      }

      if (successMessage) {
        return pushActivity(withResult, {
          action: current.lastAction ?? 'action',
          message: successMessage,
          level: 'info',
        });
      }

      return withResult;
    });
  };

  const clearSessionFromContext = (context: TabExecutionContext, reason?: string): TabExecutionContext => {
    const cleared: TabExecutionContext = {
      ...context,
      sessionId: null,
      session: null,
      lastSubmittedHash: null,
      submittedNodeIdentities: null,
      graphSubmissionUpdatedAt: null,
      sessionRefreshedAt: null,
      busy: false,
      lastUpdatedAt: nowIsoString(),
      lastError: reason ?? context.lastError,
    };

    if (!reason) {
      return cleared;
    }

    return pushActivity(cleared, {
      action: 'refresh',
      message: reason,
      level: 'error',
    });
  };

  const refreshSessionStateWithVersion = async (
    tabId: string,
    sessionId: string,
    version: number,
  ): Promise<SessionRecord | null> => {
    try {
      const session = await getSession(sessionId);
      if (!patchContextIfCurrent(tabId, version, (current) => ({
        ...current,
        sessionId: session.id,
        session,
        sessionRefreshedAt: nowIsoString(),
        lastUpdatedAt: nowIsoString(),
      }))) {
        return null;
      }

      return session;
    } catch (error) {
      if (!isCurrentAction(tabId, version)) {
        return null;
      }

      if (isMissingSessionError(error)) {
        submissions.delete(sessionId);
        patchContext(tabId, (current) =>
          clearSessionFromContext(current, 'Linked session no longer exists on backend.'),
        );
        return null;
      }

      throw error;
    }
  };

  const pollSessionStateWithVersion = async (
    tabId: string,
    sessionId: string,
    version: number,
    target: 'running' | 'stopped',
    publishWhilePolling = true,
  ): Promise<SessionRecord | null> => {
    for (let index = 0; index < POLL_INTERVALS_MS.length; index += 1) {
      if (!isCurrentAction(tabId, version)) {
        return null;
      }

      // A replacement stays private until its session and submission baseline can be published together.
      const session = publishWhilePolling
        ? await refreshSessionStateWithVersion(tabId, sessionId, version)
        : await getSession(sessionId);
      if (!session || !isCurrentAction(tabId, version)) {
        return null;
      }

      if (session.state === 'error') {
        return session;
      }

      if (target === 'running' && session.state === 'running') {
        return session;
      }

      if (target === 'stopped' && session.state === 'stopped') {
        return session;
      }

      if (index < POLL_INTERVALS_MS.length - 1) {
        await wait(POLL_INTERVALS_MS[index]);
      }
    }

    return null;
  };

  return {
    activeTabId: null,
    contextsByTabId: {},
    sessions: [],
    replacementCleanup: new Map(),
    sessionActionError: null,
    dismissSessionActionError: () => set({ sessionActionError: null }),

    getTabRuntimeView: (tabId, currentSubmissionContent, schedulerId, editorNodes) => {
      const context = get().contextsByTabId[tabId] ?? createDefaultContext();
      const executionState = deriveExecutionState(context);
      const hasBaseline = Boolean(context.sessionId && context.lastSubmittedHash);
      const stale = hasBaseline && (
        !currentSubmissionContent || hasIdentityDrift(context, editorNodes) ||
        context.lastSubmittedHash !== hashSubmissionSignature(currentSubmissionContent, schedulerId)
      );
      const graphDriftState = !hasBaseline ? 'unknown' : stale ? 'out-of-sync' : 'in-sync';
      return {
        executionState,
        operationState: deriveOperationState(context),
        graphDriftState,
        graphSubmissionState: hasBaseline ? (stale ? 'stale' : 'current') : 'none',
        graphSubmissionUpdatedAt: context.graphSubmissionUpdatedAt,
        runIntent: deriveRunIntent(context, graphDriftState, executionState),
      };
    },

    ensureTabContext: (tabId) => {
      set((state) => {
        if (state.contextsByTabId[tabId]) {
          return state;
        }

        return {
          contextsByTabId: {
            ...state.contextsByTabId,
            [tabId]: createDefaultContext(),
          },
        };
      });
    },

    removeTabContext: (tabId) => {
      for (const [sessionId, submission] of submissions) {
        if (submission.tabId === tabId) submissions.delete(sessionId);
      }
      delete actionVersionByTabId[tabId];
      set((state) => {
        const next = { ...state.contextsByTabId };
        delete next[tabId];
        return { contextsByTabId: next };
      });
    },

    setActiveTab: (tabId) => {
      set({ activeTabId: tabId });
    },

    runTab: async (tabId, document, options) => {
      const actionVersion = beginAction(tabId, 'start');
      const superseded = 'Run was superseded by a newer runtime action.';
      let pendingReplacementId: string | null = null;

      const checkRunOwnership = () => {
        if (!isCurrentAction(tabId, actionVersion)) {
          throw new Error(superseded);
        }
        if (pendingReplacementId && get().findTabIdBySessionId(pendingReplacementId)) {
          throw new Error(`Replacement session ${pendingReplacementId} was linked to another tab.`);
        }
      };

      try {
        const submission = buildCurrentSessionGraphSubmission(document, options);
        const schedulerId = document.metadata.schedulerId;
        const submissionHash = hashSubmissionSignature(submission.content, schedulerId);
        const context = get().contextsByTabId[tabId] ?? createDefaultContext();

        const hasSubmissionDrift = context.lastSubmittedHash !== submissionHash || hasIdentityDrift(context, options?.editorNodes);
        const shouldReplaceErroredSession = Boolean(context.sessionId) && context.session?.state === 'error';
        const needsNewSession = !context.sessionId || hasSubmissionDrift || shouldReplaceErroredSession;
        const isReplacementRun = Boolean(context.sessionId) && (hasSubmissionDrift || shouldReplaceErroredSession);

        let activeSession: SessionRecord | null = context.session;
        let activeSessionId = context.sessionId;
        const previousSessionId = isReplacementRun ? context.sessionId : null;
        let baseline: SubmissionBaseline | undefined;

        if (needsNewSession) {
          const submittedNodeIdentities = new Map<string, symbol>();
          const submittedIds = new Set(submission.blockInstanceIds);
          for (const node of options?.editorNodes ?? []) {
            const identity = node[editorNodeIdentity];
            if (identity && submittedIds.has(node.instanceId)) {
              submittedNodeIdentities.set(node.instanceId, identity);
            }
          }
          const createdSession = await createSession({
            name: submission.graphName || 'demo',
            grc: submission.content,
            scheduler_id: schedulerId,
          });
          baseline = {
            lastSubmittedHash: submissionHash,
            submittedNodeIdentities: options?.editorNodes ? submittedNodeIdentities : null,
            graphSubmissionUpdatedAt: nowIsoString(),
          };
          submissions.set(createdSession.id, { tabId, baseline });
          activeSession = createdSession;
          activeSessionId = createdSession.id;
          pendingReplacementId = isReplacementRun ? createdSession.id : null;
          checkRunOwnership();

          if (!isReplacementRun) {
            patchContext(tabId, (current) => {
              let next: TabExecutionContext = {
                ...current,
                sessionId: createdSession.id,
                session: createdSession,
                ...baseline,
                sessionRefreshedAt: nowIsoString(),
                lastUpdatedAt: nowIsoString(),
                lastAction: 'create',
              };

              next = pushActivity(next, {
                action: 'create',
                message: `Created session ${createdSession.id}.`,
                level: 'info',
              });

              return next;
            });
          }

          await get().refreshSessionList();
        }

        if (!activeSessionId) {
          completeAction(tabId, actionVersion, 'error', 'No session available for run.');
          return { ok: false, error: 'No session available for run.' };
        }

        if (!activeSession) {
          activeSession = await refreshSessionStateWithVersion(tabId, activeSessionId, actionVersion);
          if (!activeSession) {
            completeAction(tabId, actionVersion, 'error', 'Failed to load linked session.');
            return { ok: false, error: 'Failed to load linked session.' };
          }
        }

        checkRunOwnership();
        if (activeSession.state !== 'running') {
          const started = await startSession(activeSessionId);
          if (!isReplacementRun && !patchContextIfCurrent(tabId, actionVersion, (current) => ({
            ...current,
            sessionId: started.id,
            session: started,
            sessionRefreshedAt: nowIsoString(),
            lastUpdatedAt: nowIsoString(),
            lastAction: 'start',
          }))) {
            return { ok: false, error: superseded };
          }
        }

        const converged = await pollSessionStateWithVersion(tabId, activeSessionId, actionVersion, 'running', !isReplacementRun);
        checkRunOwnership();
        if (!converged) {
          completeAction(tabId, actionVersion, 'error', 'Session did not converge to running in time.');
          return { ok: false, error: 'Session did not converge to running in time.' };
        }

        if (converged.state === 'error') {
          completeAction(
            tabId,
            actionVersion,
            'error',
            converged.lastError ?? 'Session reached error state while starting.',
          );
          return { ok: false, error: converged.lastError ?? 'Session reached error state while starting.' };
        }

        if (isReplacementRun) {
          patchContext(tabId, (current) => {
            let next: TabExecutionContext = {
              ...current,
              sessionId: converged.id,
              session: converged,
              ...baseline,
              sessionRefreshedAt: nowIsoString(),
              lastUpdatedAt: nowIsoString(),
              lastAction: 'create',
              lastError: null,
            };

            next = pushActivity(next, {
              action: 'create',
              message: `Replaced linked session ${previousSessionId} with ${converged.id}.`,
              level: 'info',
            });

            return next;
          });
          pendingReplacementId = null;
        }

        if (previousSessionId && previousSessionId !== converged.id) {
          const cleanupError = await cleanupUnownedSession(previousSessionId);
          if (cleanupError) {
            patchContextIfCurrent(tabId, actionVersion, (current) =>
              pushActivity(current, {
                action: 'delete',
                message: cleanupError,
                level: 'error',
              }),
            );
          }
        }

        await get().refreshSessionList();
        completeAction(tabId, actionVersion, 'success', null, 'Session running.');
        return { ok: true, sessionId: converged.id, session: converged };
      } catch (error) {
        if (!isCurrentAction(tabId, actionVersion)) {
          if (pendingReplacementId) {
            const cleanupError = await cleanupUnownedSession(pendingReplacementId);
            await get().refreshSessionList();
            if (cleanupError) return { ok: false, error: `${superseded} ${cleanupError}` };
          }
          return { ok: false, error: superseded };
        }
        const message = toErrorMessage(error);
        completeAction(tabId, actionVersion, 'error', message);
        return { ok: false, error: message };
      }
    },

    stopSessionForTab: async (tabId) => {
      const actionVersion = beginAction(tabId, 'stop');
      const sessionId = get().contextsByTabId[tabId]?.sessionId;

      if (!sessionId) {
        completeAction(tabId, actionVersion, 'error', 'No session linked to this tab.');
        return;
      }

      try {
        const stopped = await stopSession(sessionId);
        if (!patchContextIfCurrent(tabId, actionVersion, (current) => ({
          ...current,
          session: stopped,
          sessionRefreshedAt: nowIsoString(),
          lastUpdatedAt: nowIsoString(),
        }))) {
          return;
        }

        const converged = await pollSessionStateWithVersion(tabId, sessionId, actionVersion, 'stopped');
        if (!converged) {
          completeAction(tabId, actionVersion, 'error', 'Session did not converge to stopped in time.');
          return;
        }

        if (converged.state === 'error') {
          completeAction(
            tabId,
            actionVersion,
            'error',
            converged.lastError ?? 'Session reached error state while stopping.',
          );
          return;
        }

        await get().refreshSessionList();
        completeAction(tabId, actionVersion, 'success', null, 'Session stopped.');
      } catch (error) {
        completeAction(tabId, actionVersion, 'error', toErrorMessage(error));
      }
    },

    restartSessionForTab: async (tabId) => {
      const actionVersion = beginAction(tabId, 'restart');
      const sessionId = get().contextsByTabId[tabId]?.sessionId;

      if (!sessionId) {
        completeAction(tabId, actionVersion, 'error', 'No session linked to this tab.');
        return;
      }

      try {
        const restarted = await restartSession(sessionId);
        if (!patchContextIfCurrent(tabId, actionVersion, (current) => ({
          ...current,
          session: restarted,
          sessionRefreshedAt: nowIsoString(),
          lastUpdatedAt: nowIsoString(),
        }))) {
          return;
        }

        const converged = await pollSessionStateWithVersion(tabId, sessionId, actionVersion, 'running');
        if (!converged) {
          completeAction(tabId, actionVersion, 'error', 'Session did not converge to running in time.');
          return;
        }

        if (converged.state === 'error') {
          completeAction(
            tabId,
            actionVersion,
            'error',
            converged.lastError ?? 'Session reached error state while restarting.',
          );
          return;
        }

        await get().refreshSessionList();
        completeAction(tabId, actionVersion, 'success', null, 'Session restarted.');
      } catch (error) {
        completeAction(tabId, actionVersion, 'error', toErrorMessage(error));
      }
    },

    deleteSessionForTab: async (tabId) => {
      const actionVersion = beginAction(tabId, 'delete');
      const sessionId = get().contextsByTabId[tabId]?.sessionId;

      if (!sessionId) {
        completeAction(tabId, actionVersion, 'error', 'No session linked to this tab.');
        return;
      }

      try {
        await deleteSession(sessionId);
        submissions.delete(sessionId);

        patchContextIfCurrent(tabId, actionVersion, (current) =>
          pushActivity(
            {
              ...current,
              sessionId: null,
              session: null,
              lastSubmittedHash: null,
              submittedNodeIdentities: null,
              graphSubmissionUpdatedAt: null,
              sessionRefreshedAt: null,
              lastUpdatedAt: nowIsoString(),
              busy: false,
            },
            {
              action: 'delete',
              message: `Deleted session ${sessionId}.`,
              level: 'info',
            },
          ),
        );

        await get().refreshSessionList();
        completeAction(tabId, actionVersion, 'success');
      } catch (error) {
        if (isMissingSessionError(error)) {
          submissions.delete(sessionId);
          patchContextIfCurrent(tabId, actionVersion, (current) =>
            clearSessionFromContext(current, 'Session already missing on backend.'),
          );
          await get().refreshSessionList();
          completeAction(tabId, actionVersion, 'success');
          return;
        }

        completeAction(tabId, actionVersion, 'error', toErrorMessage(error));
      }
    },

    refreshTab: async (tabId) => {
      await get().refreshSessionStateForTab(tabId);
    },

    refreshSessionStateForTab: async (tabId) => {
      const actionVersion = beginAction(tabId, 'refresh');
      const sessionId = get().contextsByTabId[tabId]?.sessionId;

      if (!sessionId) {
        completeAction(tabId, actionVersion, 'success');
        return;
      }

      try {
        const refreshed = await refreshSessionStateWithVersion(tabId, sessionId, actionVersion);
        if (!refreshed) {
          completeAction(tabId, actionVersion, 'error', 'Unable to refresh linked session.');
          return;
        }

        await get().refreshSessionList();
        completeAction(tabId, actionVersion, 'success', null, 'Session refreshed.');
      } catch (error) {
        completeAction(tabId, actionVersion, 'error', toErrorMessage(error));
      }
    },

    startSessionById: async (sessionId) => {
      const tabId = get().findTabIdBySessionId(sessionId);
      if (tabId) {
        const actionVersion = beginAction(tabId, 'start');
        try {
          const started = await startSession(sessionId);
          if (!patchContextIfCurrent(tabId, actionVersion, (current) => ({
            ...current,
            sessionId: started.id,
            session: started,
            sessionRefreshedAt: nowIsoString(),
            lastUpdatedAt: nowIsoString(),
          }))) {
            return;
          }

          const converged = await pollSessionStateWithVersion(tabId, sessionId, actionVersion, 'running');
          if (!converged) {
            completeAction(tabId, actionVersion, 'error', 'Session did not converge to running in time.');
            return;
          }
          if (converged.state === 'error') {
            completeAction(tabId, actionVersion, 'error', converged.lastError ?? 'Session reached error state.');
            return;
          }

          await get().refreshSessionList();
          completeAction(tabId, actionVersion, 'success', null, 'Session started.');
        } catch (error) {
          completeAction(tabId, actionVersion, 'error', toErrorMessage(error));
        }
        return;
      }

      await startSession(sessionId);
      await get().refreshSessionList();
    },

    stopSessionById: async (sessionId) => {
      const tabId = get().findTabIdBySessionId(sessionId);
      if (tabId) {
        await get().stopSessionForTab(tabId);
        return;
      }

      await stopSession(sessionId);
      await get().refreshSessionList();
    },

    restartSessionById: async (sessionId) => {
      const tabId = get().findTabIdBySessionId(sessionId);
      if (tabId) {
        await get().restartSessionForTab(tabId);
        return;
      }

      await restartSession(sessionId);
      await get().refreshSessionList();
    },

    deleteSessionById: async (sessionId) => {
      const tabId = get().findTabIdBySessionId(sessionId);
      if (tabId) {
        await get().deleteSessionForTab(tabId);
        return;
      }

      await deleteSession(sessionId);
      submissions.delete(sessionId);
      await get().refreshSessionList();
    },

    linkSessionToTab: async (tabId, sessionId) => {
      const cleanup = get().replacementCleanup.get(sessionId);
      if (cleanup) {
        const reason = cleanup === 'pending' ? 'replacement cleanup is in progress' : 'the session was deleted';
        set({ sessionActionError: `Could not link session ${sessionId}: ${reason}.` });
        return;
      }
      set((state) => {
        const nextContexts = { ...state.contextsByTabId };

        for (const [candidateTabId, candidate] of Object.entries(nextContexts)) {
          if (candidateTabId !== tabId && candidate.sessionId === sessionId) {
            nextActionVersion(candidateTabId);
            nextContexts[candidateTabId] = pushActivity(
              {
                ...candidate,
                sessionId: null,
                session: null,
                submittedNodeIdentities: null,
                sessionRefreshedAt: null,
                busy: false,
                lastActionStatus: 'idle',
                lastError: 'Session moved to another tab.',
                lastUpdatedAt: nowIsoString(),
              },
              {
                action: 'refresh',
                message: 'Session moved to another tab.',
                level: 'info',
              },
            );
          }
        }

        const known = submissions.get(sessionId);
        const baseline = known?.tabId === tabId ? known.baseline : undefined;
        const target = nextContexts[tabId] ?? createDefaultContext();
        nextContexts[tabId] = {
          ...target,
          sessionId,
          session: null,
          sessionRefreshedAt: null,
          lastSubmittedHash: baseline?.lastSubmittedHash ?? null,
          submittedNodeIdentities: baseline?.submittedNodeIdentities ?? null,
          graphSubmissionUpdatedAt: baseline?.graphSubmissionUpdatedAt ?? null,
          lastUpdatedAt: nowIsoString(),
        };

        return { contextsByTabId: nextContexts };
      });

      await get().refreshSessionStateForTab(tabId);
    },

    unlinkSessionFromTab: (tabId) => {
      nextActionVersion(tabId);
      patchContext(tabId, (current) =>
        pushActivity(
          {
            ...current,
            busy: false,
            lastActionStatus: 'idle',
            sessionId: null,
            session: null,
            lastSubmittedHash: null,
            submittedNodeIdentities: null,
            graphSubmissionUpdatedAt: null,
            sessionRefreshedAt: null,
            lastUpdatedAt: nowIsoString(),
            lastError: null,
          },
          {
            action: 'refresh',
            message: 'Session unlinked from tab.',
            level: 'info',
          },
        ),
      );
    },

    findTabIdBySessionId: (sessionId) => {
      const entries = Object.entries(get().contextsByTabId);
      const found = entries.find(([, context]) => context.sessionId === sessionId);
      return found?.[0] ?? null;
    },

    refreshSessionList: async () => {
      const version = ++sessionListVersion;
      try {
        const sessions = await listSessions();
        if (version !== sessionListVersion) return;
        const cleanup = get().replacementCleanup;
        if (cleanup.size === 0) {
          set({ sessions });
          return;
        }
        // Keep a confirmed deletion hidden until a fresh list also omits its ID.
        const listedIds = new Set(sessions.map((session) => session.id));
        const replacementCleanup = new Map(cleanup);
        for (const [id, status] of cleanup) {
          if (status === 'deleted' && !listedIds.has(id)) replacementCleanup.delete(id);
        }
        set({ sessions: sessions.filter((session) => cleanup.get(session.id) !== 'deleted'), replacementCleanup });
      } catch {
        // auxiliary list refresh
      }
    },
  };
});
