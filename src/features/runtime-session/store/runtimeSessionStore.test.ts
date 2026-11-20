import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../lib/api/sessionsApi', () => ({
  createSession: vi.fn(),
  deleteSession: vi.fn(),
  getSession: vi.fn(),
  listSessions: vi.fn(),
  restartSession: vi.fn(),
  startSession: vi.fn(),
  stopSession: vi.fn(),
}));

import { ApiClientError } from '../../../lib/api/client';
import type { BlockDetails } from '../../../lib/api/block-details';
import {
  createSession,
  deleteSession,
  getSession,
  listSessions,
  startSession,
  stopSession,
  type SessionRecord,
} from '../../../lib/api/sessionsApi';
import { useRuntimeSessionStore } from './runtimeSessionStore';
import { useEditorStore } from '../../graph-editor/store/editorStore';
import { graphDocumentFromEditor } from '../../graph-document/model/fromEditor';
import { buildCurrentGraphSubmissionFromEditorSnapshot } from '../../runtime-submission/model/current-graph-submission';
import { propagateRuntimeSettings } from '../model/propagate-runtime-settings';
import { resolveGraphVariables } from '../../variables/model/resolveGraphVariables';

function graphDocument(name: string) {
  return {
    format: 'gr4-studio.graph' as const,
    version: 1 as const,
    metadata: { name },
    graph: {
      nodes: [],
      edges: [],
    },
  };
}

function defer<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function resetStore() {
  useRuntimeSessionStore.setState({
    activeTabId: null,
    contextsByTabId: {},
    sessions: [],
    replacementCleanup: new Map(),
    sessionActionError: null,
  });
  useRuntimeSessionStore.getState().ensureTabContext('tab-1');
  useRuntimeSessionStore.getState().setActiveTab('tab-1');
}

function setupDefaultMocks() {
  vi.mocked(listSessions).mockResolvedValue([]);
  vi.mocked(deleteSession).mockResolvedValue({ deleted: true });
  vi.mocked(getSession).mockResolvedValue({
    id: 'session-1',
    name: 'demo',
    state: 'running',
    createdAt: '2026-03-20T00:00:00.000Z',
    updatedAt: '2026-03-20T00:00:00.000Z',
    lastError: null,
  });
}

describe('runtimeSessionStore (sessions-only model)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    setupDefaultMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it('ensureTabContext is idempotent for an existing tab context', () => {
    const firstContext = useRuntimeSessionStore.getState().contextsByTabId['tab-1'];
    useRuntimeSessionStore.getState().ensureTabContext('tab-1');
    const secondContext = useRuntimeSessionStore.getState().contextsByTabId['tab-1'];

    expect(secondContext).toBe(firstContext);
    expect(Object.keys(useRuntimeSessionStore.getState().contextsByTabId)).toEqual(['tab-1']);
  });

  it('runTab creates and starts a new session for first submission', async () => {
    vi.mocked(createSession).mockResolvedValue({
      id: 'session-1',
      name: 'demo',
      state: 'stopped',
      createdAt: '2026-03-20T00:00:00.000Z',
      updatedAt: '2026-03-20T00:00:00.000Z',
      lastError: null,
    });
    vi.mocked(startSession).mockResolvedValue({
      id: 'session-1',
      name: 'demo',
      state: 'running',
      createdAt: '2026-03-20T00:00:00.000Z',
      updatedAt: '2026-03-20T00:00:01.000Z',
      lastError: null,
    });

    await useRuntimeSessionStore.getState().runTab('tab-1', graphDocument('Null graph'));

    const context = useRuntimeSessionStore.getState().contextsByTabId['tab-1'];
    expect(vi.mocked(createSession)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(startSession)).toHaveBeenCalledTimes(1);
    expect(context.sessionId).toBe('session-1');
    expect(context.session?.state).toBe('running');
    expect(context.lastSubmittedHash).toBeTruthy();

    const view = useRuntimeSessionStore.getState().getTabRuntimeView('tab-1', 'irrelevant-content');
    expect(view.executionState).toBe('running');
  });

  it('rerun unchanged graph reuses linked session and skips createSession', async () => {
    vi.mocked(createSession).mockResolvedValue({
      id: 'session-1',
      name: 'demo',
      state: 'stopped',
      createdAt: '2026-03-20T00:00:00.000Z',
      updatedAt: '2026-03-20T00:00:00.000Z',
      lastError: null,
    });
    vi.mocked(startSession).mockResolvedValue({
      id: 'session-1',
      name: 'demo',
      state: 'running',
      createdAt: '2026-03-20T00:00:00.000Z',
      updatedAt: '2026-03-20T00:00:01.000Z',
      lastError: null,
    });

    await useRuntimeSessionStore.getState().runTab('tab-1', graphDocument('same graph'));
    vi.mocked(createSession).mockClear();

    await useRuntimeSessionStore.getState().runTab('tab-1', graphDocument('same graph'));

    expect(vi.mocked(createSession)).not.toHaveBeenCalled();
    expect(vi.mocked(startSession)).toHaveBeenCalledTimes(1);
  });

  it('rerun changed graph creates replacement session', async () => {
    vi.mocked(createSession)
      .mockResolvedValueOnce({
        id: 'session-1',
        name: 'demo',
        state: 'stopped',
        createdAt: '2026-03-20T00:00:00.000Z',
        updatedAt: '2026-03-20T00:00:00.000Z',
        lastError: null,
      })
      .mockResolvedValueOnce({
        id: 'session-2',
        name: 'demo',
        state: 'stopped',
        createdAt: '2026-03-20T00:00:02.000Z',
        updatedAt: '2026-03-20T00:00:02.000Z',
        lastError: null,
      });

    vi.mocked(startSession)
      .mockResolvedValueOnce({
        id: 'session-1',
        name: 'demo',
        state: 'running',
        createdAt: '2026-03-20T00:00:00.000Z',
        updatedAt: '2026-03-20T00:00:01.000Z',
        lastError: null,
      })
      .mockResolvedValueOnce({
        id: 'session-2',
        name: 'demo',
        state: 'running',
        createdAt: '2026-03-20T00:00:02.000Z',
        updatedAt: '2026-03-20T00:00:03.000Z',
        lastError: null,
      });
    vi.mocked(getSession)
      .mockResolvedValueOnce({
        id: 'session-1',
        name: 'demo',
        state: 'running',
        createdAt: '2026-03-20T00:00:00.000Z',
        updatedAt: '2026-03-20T00:00:01.000Z',
        lastError: null,
      })
      .mockResolvedValueOnce({
        id: 'session-2',
        name: 'demo',
        state: 'running',
        createdAt: '2026-03-20T00:00:02.000Z',
        updatedAt: '2026-03-20T00:00:03.000Z',
        lastError: null,
      });

    await useRuntimeSessionStore.getState().runTab('tab-1', graphDocument('graph-v1'));
    await useRuntimeSessionStore.getState().runTab('tab-1', graphDocument('graph-v2'));

    const context = useRuntimeSessionStore.getState().contextsByTabId['tab-1'];
    expect(vi.mocked(createSession)).toHaveBeenCalledTimes(2);
    expect(context.sessionId).toBe('session-2');
    expect(vi.mocked(deleteSession)).toHaveBeenCalledWith('session-1');
  });

  it('rerun unchanged graph replaces a linked error session with a fresh session', async () => {
    useRuntimeSessionStore.setState((state) => ({
      contextsByTabId: {
        ...state.contextsByTabId,
        'tab-1': {
          ...state.contextsByTabId['tab-1'],
          sessionId: 'session-bad',
          lastSubmittedHash: '667ef470',
          submittedNodeIdentities: null,
          graphSubmissionUpdatedAt: '2026-03-20T00:00:00.000Z',
          session: {
            id: 'session-bad',
            name: 'demo',
            state: 'error',
            createdAt: '2026-03-20T00:00:00.000Z',
            updatedAt: '2026-03-20T00:00:01.000Z',
            lastError: 'Request failed: 400 Bad Request',
          },
        },
      },
    }));

    vi.mocked(createSession).mockResolvedValue({
      id: 'session-fresh',
      name: 'demo',
      state: 'stopped',
      createdAt: '2026-03-20T00:00:02.000Z',
      updatedAt: '2026-03-20T00:00:02.000Z',
      lastError: null,
    });
    vi.mocked(startSession).mockResolvedValue({
      id: 'session-fresh',
      name: 'demo',
      state: 'running',
      createdAt: '2026-03-20T00:00:02.000Z',
      updatedAt: '2026-03-20T00:00:03.000Z',
      lastError: null,
    });
    vi.mocked(getSession).mockResolvedValue({
      id: 'session-fresh',
      name: 'demo',
      state: 'running',
      createdAt: '2026-03-20T00:00:02.000Z',
      updatedAt: '2026-03-20T00:00:03.000Z',
      lastError: null,
    });

    await useRuntimeSessionStore.getState().runTab('tab-1', graphDocument('same graph'));

    const context = useRuntimeSessionStore.getState().contextsByTabId['tab-1'];
    expect(vi.mocked(createSession)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(startSession)).toHaveBeenCalledWith('session-fresh');
    expect(context.sessionId).toBe('session-fresh');
    expect(vi.mocked(deleteSession)).toHaveBeenCalledWith('session-bad');
  });

  it('replacement run keeps old linked session if replacement start fails', async () => {
    vi.mocked(createSession).mockResolvedValue({
      id: 'session-2',
      name: 'demo',
      state: 'stopped',
      createdAt: '2026-03-20T00:00:02.000Z',
      updatedAt: '2026-03-20T00:00:02.000Z',
      lastError: null,
    });

    vi.mocked(startSession).mockRejectedValue(new Error('start failed'));

    useRuntimeSessionStore.setState((state) => ({
      contextsByTabId: {
        ...state.contextsByTabId,
        'tab-1': {
          ...state.contextsByTabId['tab-1'],
          sessionId: 'session-1',
          lastSubmittedHash: 'old-hash',
          submittedNodeIdentities: null,
          graphSubmissionUpdatedAt: '2026-03-20T00:00:00.000Z',
          session: {
            id: 'session-1',
            name: 'demo',
            state: 'stopped',
            createdAt: '2026-03-20T00:00:00.000Z',
            updatedAt: '2026-03-20T00:00:00.000Z',
            lastError: null,
          },
        },
      },
    }));

    await useRuntimeSessionStore.getState().runTab('tab-1', graphDocument('graph-v2'));

    const context = useRuntimeSessionStore.getState().contextsByTabId['tab-1'];
    expect(context.sessionId).toBe('session-1');
    expect(context.session?.id).toBe('session-1');
    expect(vi.mocked(deleteSession)).not.toHaveBeenCalled();
  });

  it('stopSessionForTab converges to stopped', async () => {
    useRuntimeSessionStore.setState((state) => ({
      contextsByTabId: {
        ...state.contextsByTabId,
        'tab-1': {
          ...state.contextsByTabId['tab-1'],
          sessionId: 'session-1',
          session: {
            id: 'session-1',
            name: 'demo',
            state: 'running',
            createdAt: '2026-03-20T00:00:00.000Z',
            updatedAt: '2026-03-20T00:00:00.000Z',
            lastError: null,
          },
        },
      },
    }));

    vi.mocked(stopSession).mockResolvedValue({
      id: 'session-1',
      name: 'demo',
      state: 'stopped',
      createdAt: '2026-03-20T00:00:00.000Z',
      updatedAt: '2026-03-20T00:00:04.000Z',
      lastError: null,
    });
    vi.mocked(getSession).mockResolvedValue({
      id: 'session-1',
      name: 'demo',
      state: 'stopped',
      createdAt: '2026-03-20T00:00:00.000Z',
      updatedAt: '2026-03-20T00:00:04.000Z',
      lastError: null,
    });

    await useRuntimeSessionStore.getState().stopSessionForTab('tab-1');

    const context = useRuntimeSessionStore.getState().contextsByTabId['tab-1'];
    expect(context.session?.state).toBe('stopped');
    expect(context.busy).toBe(false);
  });

  it('reports stopped execution state while stop is in progress', () => {
    useRuntimeSessionStore.setState((state) => ({
      contextsByTabId: {
        ...state.contextsByTabId,
        'tab-1': {
          ...state.contextsByTabId['tab-1'],
          sessionId: 'session-1',
          session: {
            id: 'session-1',
            name: 'demo',
            state: 'running',
            createdAt: '2026-03-20T00:00:00.000Z',
            updatedAt: '2026-03-20T00:00:00.000Z',
            lastError: null,
          },
          lastAction: 'stop',
          lastActionStatus: 'running',
          busy: true,
        },
      },
    }));

    const view = useRuntimeSessionStore.getState().getTabRuntimeView('tab-1');
    expect(view.executionState).toBe('stopped');
    expect(view.operationState).toBe('stopping-session');
  });

  it('reports stopped execution state while delete is in progress', () => {
    useRuntimeSessionStore.setState((state) => ({
      contextsByTabId: {
        ...state.contextsByTabId,
        'tab-1': {
          ...state.contextsByTabId['tab-1'],
          sessionId: 'session-1',
          session: {
            id: 'session-1',
            name: 'demo',
            state: 'running',
            createdAt: '2026-03-20T00:00:00.000Z',
            updatedAt: '2026-03-20T00:00:00.000Z',
            lastError: null,
          },
          lastAction: 'delete',
          lastActionStatus: 'running',
          busy: true,
        },
      },
    }));

    const view = useRuntimeSessionStore.getState().getTabRuntimeView('tab-1');
    expect(view.executionState).toBe('stopped');
  });

  it('stale async completion from older run action is ignored', async () => {
    const firstCreate = defer<{
      id: string;
      name: string;
      state: 'stopped';
      createdAt: string;
      updatedAt: string;
      lastError: null;
    }>();

    vi.mocked(createSession)
      .mockImplementationOnce(() => firstCreate.promise)
      .mockResolvedValueOnce({
        id: 'session-new',
        name: 'demo',
        state: 'stopped',
        createdAt: '2026-03-20T00:00:03.000Z',
        updatedAt: '2026-03-20T00:00:03.000Z',
        lastError: null,
      });

    vi.mocked(startSession).mockResolvedValue({
      id: 'session-new',
      name: 'demo',
      state: 'running',
      createdAt: '2026-03-20T00:00:03.000Z',
      updatedAt: '2026-03-20T00:00:04.000Z',
      lastError: null,
    });
    vi.mocked(getSession).mockResolvedValue({
      id: 'session-new',
      name: 'demo',
      state: 'running',
      createdAt: '2026-03-20T00:00:03.000Z',
      updatedAt: '2026-03-20T00:00:04.000Z',
      lastError: null,
    });

    const firstRun = useRuntimeSessionStore.getState().runTab('tab-1', graphDocument('graph-v1'));
    const secondRun = useRuntimeSessionStore.getState().runTab('tab-1', graphDocument('graph-v2'));

    firstCreate.resolve({
      id: 'session-old',
      name: 'demo',
      state: 'stopped',
      createdAt: '2026-03-20T00:00:01.000Z',
      updatedAt: '2026-03-20T00:00:01.000Z',
      lastError: null,
    });

    await Promise.all([firstRun, secondRun]);

    const context = useRuntimeSessionStore.getState().contextsByTabId['tab-1'];
    expect(context.sessionId).toBe('session-new');
    expect(context.session?.state).toBe('running');
  });

  it('refreshSessionStateForTab unlinks missing session on 404', async () => {
    useRuntimeSessionStore.setState((state) => ({
      contextsByTabId: {
        ...state.contextsByTabId,
        'tab-1': {
          ...state.contextsByTabId['tab-1'],
          sessionId: 'missing-session',
          lastSubmittedHash: 'abc123',
          submittedNodeIdentities: null,
          graphSubmissionUpdatedAt: '2026-03-20T00:00:00.000Z',
          session: {
            id: 'missing-session',
            name: 'demo',
            state: 'stopped',
            createdAt: '2026-03-20T00:00:00.000Z',
            updatedAt: '2026-03-20T00:00:00.000Z',
            lastError: null,
          },
        },
      },
    }));

    vi.mocked(getSession).mockRejectedValue(
      new ApiClientError('missing', 'HTTP', 404, 'not found', 'not_found'),
    );

    await useRuntimeSessionStore.getState().refreshSessionStateForTab('tab-1');

    const context = useRuntimeSessionStore.getState().contextsByTabId['tab-1'];
    expect(context.sessionId).toBeNull();
    expect(context.session).toBeNull();
    expect(context.lastSubmittedHash).toBeNull();
    expect(context.graphSubmissionUpdatedAt).toBeNull();
  });

  it('deleteSessionForTab clears linked session', async () => {
    useRuntimeSessionStore.setState((state) => ({
      contextsByTabId: {
        ...state.contextsByTabId,
        'tab-1': {
          ...state.contextsByTabId['tab-1'],
          sessionId: 'session-1',
          lastSubmittedHash: 'abc123',
          submittedNodeIdentities: null,
          graphSubmissionUpdatedAt: '2026-03-20T00:00:00.000Z',
          session: {
            id: 'session-1',
            name: 'demo',
            state: 'stopped',
            createdAt: '2026-03-20T00:00:00.000Z',
            updatedAt: '2026-03-20T00:00:00.000Z',
            lastError: null,
          },
        },
      },
    }));

    vi.mocked(deleteSession).mockResolvedValue({ deleted: true });

    await useRuntimeSessionStore.getState().deleteSessionForTab('tab-1');

    const context = useRuntimeSessionStore.getState().contextsByTabId['tab-1'];
    expect(context.sessionId).toBeNull();
    expect(context.session).toBeNull();
    expect(context.lastSubmittedHash).toBeNull();
    expect(context.graphSubmissionUpdatedAt).toBeNull();
  });

  it('unlinked tab does not stay in ready state from old submission hash', () => {
    useRuntimeSessionStore.setState((state) => ({
      contextsByTabId: {
        ...state.contextsByTabId,
        'tab-1': {
          ...state.contextsByTabId['tab-1'],
          lastSubmittedHash: 'abc123',
          submittedNodeIdentities: null,
          graphSubmissionUpdatedAt: '2026-03-20T00:00:00.000Z',
        },
      },
    }));

    const view = useRuntimeSessionStore.getState().getTabRuntimeView('tab-1', 'graph-content');
    expect(view.executionState).toBe('idle');
    expect(view.graphSubmissionState).toBe('none');
    expect(view.runIntent).toBe('create-session');
  });

  it('treats an instance ID rename as a graph edit without renaming or replacing the linked runtime', async () => {
    const session = {id:'session-1',name:'demo',state:'running' as const,createdAt:'',updatedAt:'',lastError:null};
    vi.mocked(createSession).mockResolvedValue({...session,state:'stopped'});
    vi.mocked(startSession).mockResolvedValue(session);
    useEditorStore.getState().replaceGraph({metadata:{name:'demo'},nodes:[{
      instanceId:'source',blockTypeId:'gr::testing::NullSource<float32>',displayName:'Source',parameters:{},position:{x:0,y:0},
    }],edges:[]});
    await useRuntimeSessionStore.getState().runTab('tab-1',graphDocumentFromEditor(useEditorStore.getState().getGraphSnapshot()));
    const submission = () => buildCurrentGraphSubmissionFromEditorSnapshot(useEditorStore.getState().getGraphSnapshot()).content;
    expect(useRuntimeSessionStore.getState().getTabRuntimeView('tab-1',submission()).graphDriftState).toBe('in-sync');
    const linkedContext = useRuntimeSessionStore.getState().contextsByTabId['tab-1'];
    useEditorStore.getState().renameNodeInstanceId('source','oscillator');
    expect(useRuntimeSessionStore.getState().contextsByTabId['tab-1']).toBe(linkedContext);
    expect(useRuntimeSessionStore.getState().getTabRuntimeView('tab-1',submission())).toMatchObject({
      graphDriftState:'out-of-sync',executionState:'running',runIntent:'none',
    });
    expect(createSession).toHaveBeenCalledTimes(1);
    expect(startSession).toHaveBeenCalledTimes(1);
    expect(stopSession).not.toHaveBeenCalled();
    expect(deleteSession).not.toHaveBeenCalled();
  });

  describe('session ownership', () => {
    const editor = useEditorStore.getState;
    const runtime = useRuntimeSessionStore.getState;
    const context = () => runtime().contextsByTabId['tab-1'];
    const run = () => runtime().runTab('tab-1', graphDocumentFromEditor(editor().getGraphSnapshot()), { editorNodes: editor().nodes });
    const content = () => buildCurrentGraphSubmissionFromEditorSnapshot(editor().getGraphSnapshot()).content;
    const sessions = new Map<string, SessionRecord>();

    beforeEach(async () => {
      const running = await getSession('session-1');
      sessions.clear();
      const update = (id: string, state: SessionRecord['state']) => {
        const session = { ...running, id, state };
        sessions.set(id, session);
        return session;
      };
      vi.mocked(createSession).mockImplementation(async () => update(`owned-${sessions.size + 1}`, 'stopped'));
      vi.mocked(startSession).mockImplementation(async (id) => update(id, 'running'));
      vi.mocked(stopSession).mockImplementation(async (id) => update(id, 'stopped'));
      vi.mocked(listSessions).mockImplementation(async () => [...sessions.values()]);
      vi.mocked(getSession).mockImplementation(async (id) => sessions.get(id)!);
      vi.mocked(deleteSession).mockImplementation(async (id) => ({ deleted: sessions.delete(id) }));
      editor().replaceGraph({
        metadata: { name: 'demo' }, edges: [],
        nodes: ['left', 'right'].map((instanceId) => ({
          instanceId, blockTypeId: 'gr::test::Gain<float32>', displayName: 'Gain', parameters: {}, position: { x: 0, y: 0 },
        })),
      });
      expect(await run()).toMatchObject({ ok: true, sessionId: 'owned-1' });
    });

    it('restores the submission only when its originating tab relinks', async () => {
      const original = context();
      runtime().unlinkSessionFromTab('tab-1');
      await runtime().linkSessionToTab('another-tab', 'owned-1');
      expect(runtime().contextsByTabId['another-tab'].submittedNodeIdentities).toBeNull();
      expect(runtime().getTabRuntimeView('another-tab', content(), undefined, editor().nodes)).toMatchObject({
        graphSubmissionState: 'none', graphDriftState: 'unknown',
      });
      await runtime().linkSessionToTab('tab-1', 'owned-1');
      expect(context().submittedNodeIdentities?.size).toBe(2);
      expect(context().submittedNodeIdentities).toBe(original.submittedNodeIdentities);
      expect(context().lastSubmittedHash).toBe(original.lastSubmittedHash);
      expect(runtime().getTabRuntimeView('tab-1', content(), undefined, editor().nodes).graphDriftState).toBe('in-sync');
      sessions.set('external', { ...original.session!, id: 'external' });
      await runtime().linkSessionToTab('tab-1', 'external');
      expect(context().submittedNodeIdentities).toBeNull();
    });

    it('replaces a session after an ID swap with identical exported content', async () => {
      const initialContent = content();
      for (const [from, to] of [['left', 'temp'], ['right', 'left'], ['temp', 'right']]) {
        expect(editor().renameNodeInstanceId(from, to).ok).toBe(true);
      }
      expect(content()).toBe(initialContent);
      expect(runtime().getTabRuntimeView('tab-1', content(), undefined, editor().nodes).graphDriftState).toBe('out-of-sync');
      expect(await run()).toMatchObject({ ok: true, sessionId: 'owned-2' });
      expect(runtime().getTabRuntimeView('tab-1', content(), undefined, editor().nodes).graphDriftState).toBe('in-sync');
    });

    it('keeps the graph stale when export fails, including after an instance ID is reused', () => {
      editor().addNodeFromCatalogItem({ blockTypeId: 'studio::VirtualSource', displayName: 'Unmatched source' });
      expect(content).toThrow(/no matching virtual sink/i);
      const failedExportView = () => runtime().getTabRuntimeView('tab-1', null, undefined, editor().nodes);
      expect(failedExportView().graphSubmissionState).toBe('stale');
      editor().renameNodeInstanceId('right', 'spare');
      editor().renameNodeInstanceId('left', 'right');
      expect(failedExportView().graphDriftState).toBe('out-of-sync');
    });

    it('keeps an explicit link made by another tab while a replacement is starting', async () => {
      editor().renameNodeInstanceId('left', 'renamed');
      const replacement = { ...context().session!, id: 'owned-2' };
      const pollStarted = defer<void>();
      const finishPoll = defer<typeof replacement>();
      vi.mocked(getSession).mockImplementationOnce(() => {
        pollStarted.resolve();
        return finishPoll.promise;
      });
      const result = run();
      await pollStarted.promise;
      await runtime().linkSessionToTab('another-tab', replacement.id);
      finishPoll.resolve(replacement);

      expect(await result).toMatchObject({ ok: false, error: expect.stringContaining('another tab') });
      expect(context()).toMatchObject({ sessionId: 'owned-1', busy: false, lastActionStatus: 'error' });
      expect(runtime().findTabIdBySessionId(replacement.id)).toBe('another-tab');
      expect(deleteSession).not.toHaveBeenCalled();
    });

    it.each(['before start', 'during startup', 'adopted during startup'] as const)(
      'preserves a moved session when replacement is cancelled (%s)',
      async (phase) => {
        await runtime().stopSessionForTab('tab-1');
        editor().renameNodeInstanceId('left', 'renamed');
        const entered = defer<void>();
        const release = defer<void>();
        if (phase === 'before start') {
          vi.mocked(listSessions).mockImplementationOnce(async () => {
            entered.resolve();
            await release.promise;
            return [...sessions.values()];
          });
        } else {
          vi.mocked(startSession).mockImplementationOnce(async (id) => {
            const started: SessionRecord = { ...sessions.get(id)!, state: 'running' };
            sessions.set(id, started);
            entered.resolve();
            await release.promise;
            return started;
          });
        }

        const result = run();
        await entered.promise;
        await runtime().linkSessionToTab('another-tab', 'owned-1');
        if (phase === 'adopted during startup') {
          await runtime().linkSessionToTab('third-tab', 'owned-2');
        }
        release.resolve();

        expect(await result).toMatchObject({ ok: false, error: expect.stringContaining('superseded') });
        expect(runtime().findTabIdBySessionId('owned-1')).toBe('another-tab');
        expect(sessions.get('owned-1')?.state).toBe('stopped');
        expect(context().sessionId).toBeNull();
        if (phase === 'before start') expect(startSession).not.toHaveBeenCalledWith('owned-2');
        if (phase === 'adopted during startup') {
          expect(runtime().findTabIdBySessionId('owned-2')).toBe('third-tab');
          expect(sessions.get('owned-2')?.state).toBe('running');
          expect(deleteSession).not.toHaveBeenCalled();
        } else {
          expect(deleteSession).toHaveBeenCalledExactlyOnceWith('owned-2');
          expect(sessions.has('owned-2')).toBe(false);
        }
      },
    );

    // Move the original session to the recipient while the replacement's first poll is pending.
    async function beginCancelledReplacementCleanup() {
      await runtime().stopSessionForTab('tab-1');
      editor().renameNodeInstanceId('left', 'renamed');
      const pollStarted = defer<void>();
      const finishPoll = defer<SessionRecord>();
      vi.mocked(getSession).mockImplementationOnce(() => {
        pollStarted.resolve();
        return finishPoll.promise;
      });
      const deleting = defer<void>();
      const finishDelete = defer<{ deleted: boolean }>();
      vi.mocked(deleteSession).mockImplementationOnce((id) => {
        expect(id).toBe('owned-2');
        deleting.resolve();
        return finishDelete.promise;
      });
      const replacing = run();
      await pollStarted.promise;
      await runtime().linkSessionToTab('recipient', 'owned-1');
      finishPoll.resolve(sessions.get('owned-2')!);
      await deleting.promise;
      return { replacing, finishDelete };
    }

    it('preserves the recipient attachment throughout DELETE and ignores stale lists after cleanup', async () => {
      const { replacing, finishDelete } = await beginCancelledReplacementCleanup();
      const recipient = runtime().contextsByTabId.recipient;
      expect(recipient.sessionId).toBe('owned-1');
      expect(runtime().replacementCleanup.get('owned-2')).toBe('pending');
      expect(runtime().sessions.some((session) => session.id === 'owned-2')).toBe(true);

      const observedOwners: (string | null)[] = [];
      const unsubscribe = useRuntimeSessionStore.subscribe((state) => {
        observedOwners.push(state.findTabIdBySessionId('owned-2'));
      });
      try {
        vi.mocked(getSession).mockClear();
        await runtime().linkSessionToTab('recipient', 'owned-2');
        expect(runtime().sessionActionError).toMatch(/owned-2.*cleanup is in progress/);
        expect(getSession).not.toHaveBeenCalled();
        expect(runtime().contextsByTabId.recipient).toBe(recipient);

        const staleList = [...sessions.values()];
        const delayedList = defer<SessionRecord[]>();
        vi.mocked(listSessions).mockReturnValueOnce(delayedList.promise);
        const previousRefresh = runtime().refreshSessionList();
        vi.mocked(listSessions).mockResolvedValueOnce(staleList);
        finishDelete.resolve({ deleted: sessions.delete('owned-2') });
        expect(await replacing).toMatchObject({ ok: false, error: expect.stringContaining('superseded') });
        expect(runtime().sessions.map((session) => session.id)).toEqual(['owned-1']);
        await runtime().linkSessionToTab('recipient', 'owned-2');
        expect(runtime().sessionActionError).toMatch(/owned-2.*was deleted/);

        await runtime().refreshSessionList(); // A fresh list confirms the deletion.
        expect(runtime().replacementCleanup.has('owned-2')).toBe(false);
        delayedList.resolve(staleList);
        await previousRefresh;
        expect(runtime().sessions.map((session) => session.id)).toEqual(['owned-1']);
        expect(runtime().contextsByTabId.recipient).toBe(recipient);
        expect(observedOwners.every((owner) => owner === null)).toBe(true);
      } finally {
        unsubscribe();
      }
    });

    it.each(['request failed', 'deletion unconfirmed'])('releases the replacement after cleanup failure (%s)', async (failure) => {
      const { replacing, finishDelete } = await beginCancelledReplacementCleanup();
      if (failure === 'request failed') finishDelete.reject(new Error('Backend unavailable'));
      else finishDelete.resolve({ deleted: false });

      const reason = failure === 'request failed' ? 'Backend unavailable' : 'did not confirm deletion';
      expect(await replacing).toMatchObject({ ok: false, error: expect.stringContaining(reason) });
      expect(runtime().sessionActionError).toContain('owned-2');
      expect(runtime().sessionActionError).toContain(reason);
      expect(runtime().replacementCleanup.has('owned-2')).toBe(false);
      expect(runtime().sessions.find((session) => session.id === 'owned-2')?.state).toBe('running');
      await runtime().linkSessionToTab('recipient', 'owned-2');
      expect(runtime().contextsByTabId.recipient.session?.id).toBe('owned-2');
    });

    it('publishes replacement block identities together with the replacement session', async () => {
      const original = context();
      await runtime().stopSessionForTab('tab-1');
      editor().renameNodeInstanceId('left', 'renamed');
      const started = { ...original.session!, id: 'owned-2' };
      const pending = defer<typeof started>();
      const polling = defer<void>();
      vi.mocked(getSession).mockImplementationOnce(() => {
        polling.resolve();
        return pending.promise;
      });
      const result = run();
      await polling.promise;
      expect(context().sessionId).toBe(original.sessionId);
      expect(context().submittedNodeIdentities).toBe(original.submittedNodeIdentities);
      pending.resolve(started);
      expect(await result).toMatchObject({ ok: true, sessionId: 'owned-2' });
      expect(deleteSession).toHaveBeenCalledExactlyOnceWith('owned-1');
      expect(runtime().findTabIdBySessionId('owned-2')).toBe('tab-1');
      expect(sessions.get('owned-2')?.state).toBe('running');
      expect(context().submittedNodeIdentities?.get('renamed')).toBe(original.submittedNodeIdentities?.get('left'));
    });
  });

  it('posts live settings only for submitted blocks that still own their instance IDs', async () => {
    const session = await getSession('session-1');
    vi.mocked(createSession).mockResolvedValue({ ...session, state: 'stopped' });
    vi.mocked(startSession).mockResolvedValue(session);
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      Response.json({ session_id: session.id, block: 'gain-block', applied_via: 'staged_settings', accepted: true }),
    );
    const editor = useEditorStore.getState;
    const runtime = useRuntimeSessionStore.getState;
    const blockTypeId = 'gr::test::Gain<float32>';
    const blockDetailsByType = new Map<string, BlockDetails>([[blockTypeId, {
      blockTypeId,
      displayName: 'Gain',
      parameters: [{ name: 'gain', label: 'Gain', mutable: true, readOnly: false, valueKind: 'scalar' }],
      inputPorts: [],
      outputPorts: [],
    }]]);
    editor().replaceGraph({
      metadata: { name: 'Gain graph' },
      edges: [],
      nodes: [
        { id: 'gain_a', gain: '2' },
        { id: 'gain_b', gain: '17' },
        { id: 'gain_c', gain: '5' },
      ].map(({ id, gain }) => ({
        instanceId: id,
        blockTypeId,
        displayName: 'Gain',
        position: { x: 0, y: 0 },
        parameters: { gain: { value: gain, bindingKind: 'expression' } },
      })),
    });
    const submit = () => {
      const snapshot = editor().getGraphSnapshot();
      return runtime().runTab('tab-1', graphDocumentFromEditor(snapshot), { blockDetailsByType, editorNodes: snapshot.nodes });
    };
    const propagate = async () => {
      const context = runtime().contextsByTabId['tab-1'];
      const snapshot = editor().getGraphSnapshot();
      const { parametersByNodeId } = resolveGraphVariables(graphDocumentFromEditor(snapshot));
      expect(context.session?.state).toBe('running');
      await propagateRuntimeSettings({
        sessionId: context.sessionId!,
        submittedNodeIdentities: context.submittedNodeIdentities!,
        nodes: snapshot.nodes,
        blockDetailsByType,
        parametersByNodeId,
      });
      const requests = fetchMock.mock.calls.map(([url, request]) => [request?.method, url, request?.body]);
      fetchMock.mockClear();
      return requests;
    };
    const post = (id: string, gain: number, sessionId = session.id) =>
      ['POST', `/api/sessions/${sessionId}/blocks/${id}/settings`, JSON.stringify({ gain })];

    expect(await submit()).toMatchObject({ ok: true });
    expect(await propagate()).toEqual([post('gain_a', 2), post('gain_b', 17), post('gain_c', 5)]);

    expect(editor().renameNodeInstanceId('gain_a', 'renamed')).toEqual({ ok: true, instanceId: 'renamed' });
    expect.soft(await propagate()).toEqual([post('gain_b', 17), post('gain_c', 5)]);

    expect(editor().renameNodeInstanceId('gain_b', 'gain_a')).toEqual({ ok: true, instanceId: 'gain_a' });
    editor().updateNodeParameterBinding('gain_c', 'gain', { kind: 'expression', expr: '9' });
    expect(await propagate()).toEqual([post('gain_c', 9)]);

    const replacement = { ...session, id: 'session-2' };
    vi.mocked(createSession).mockResolvedValue({ ...replacement, state: 'stopped' });
    vi.mocked(startSession).mockResolvedValue(replacement);
    vi.mocked(getSession).mockResolvedValue(replacement);
    expect(await submit()).toMatchObject({ ok: true, sessionId: replacement.id });
    expect(await propagate()).toEqual([
      post('renamed', 2, replacement.id),
      post('gain_a', 17, replacement.id),
      post('gain_c', 9, replacement.id),
    ]);
  });
});
