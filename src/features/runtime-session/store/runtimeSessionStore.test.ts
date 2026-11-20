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
import {
  createSession,
  deleteSession,
  getSession,
  listSessions,
  startSession,
  stopSession,
} from '../../../lib/api/sessionsApi';
import { useRuntimeSessionStore } from './runtimeSessionStore';
import { useEditorStore } from '../../graph-editor/store/editorStore';
import { graphDocumentFromEditor } from '../../graph-document/model/fromEditor';
import { buildCurrentGraphSubmissionFromEditorSnapshot } from '../../runtime-submission/model/current-graph-submission';

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
  });
  useRuntimeSessionStore.getState().ensureTabContext('tab-1');
  useRuntimeSessionStore.getState().setActiveTab('tab-1');
}

function setupDefaultMocks() {
  vi.mocked(listSessions).mockResolvedValue([]);
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
});
