import { describe, expect, it, vi } from 'vitest';
import { parseSinkAddress, toSinkRegistryKey, WasmSinkSocket } from './wasm-sink-transport';
import type { Gr4cpModule, Gr4cpSinkSnapshot } from './control-plane-wasm';

type FakeClock = {
  setInterval: (handler: () => void, timeout: number) => number;
  clearInterval: (handle: number) => void;
  tick: () => void;
  pending: () => number;
};

function createFakeClock(): FakeClock {
  const handlers = new Map<number, () => void>();
  let nextHandle = 1;

  return {
    setInterval: (handler) => {
      const handle = nextHandle++;
      handlers.set(handle, handler);
      return handle;
    },
    clearInterval: (handle) => {
      handlers.delete(handle);
    },
    tick: () => {
      for (const handler of [...handlers.values()]) {
        handler();
      }
    },
    pending: () => handlers.size,
  };
}

function createModule(
  snapshotFor: (endpoint: string) => Gr4cpSinkSnapshot | null,
  handleRequest: Gr4cpModule['handleRequest'] = () => ({
    status: 200,
    contentType: 'application/json',
    body: '{}',
  }),
): Gr4cpModule {
  return {
    handleRequest,
    initialize: () => ({ status: 200, contentType: 'application/json', body: '{}' }),
    studioSinkEndpoints: () => [],
    studioSinkSnapshot: snapshotFor,
  };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('toSinkRegistryKey', () => {
  it('maps a websocket url onto the host:port/path key the sink registers', () => {
    expect(toSinkRegistryKey('ws://127.0.0.1:49152/stream')).toBe('127.0.0.1:49152/stream');
    expect(toSinkRegistryKey('wss://localhost:8080/snapshot')).toBe('localhost:8080/snapshot');
  });

  it('applies the same defaults the C++ endpoint parser does', () => {
    expect(toSinkRegistryKey('ws://127.0.0.1:18080')).toBe('127.0.0.1:18080/snapshot');
    expect(toSinkRegistryKey('ws://127.0.0.1/stream')).toBe('127.0.0.1:8080/stream');
  });

  it('rejects anything that is not a websocket url', () => {
    expect(toSinkRegistryKey('http://127.0.0.1:18080/snapshot')).toBeNull();
    expect(toSinkRegistryKey('/api/sessions/sess_1/streams/stream_1/ws')).toBeNull();
    expect(toSinkRegistryKey('nonsense')).toBeNull();
  });
});

describe('parseSinkAddress', () => {
  it('recognises the app-api stream route the studio resolves bindings to', () => {
    expect(parseSinkAddress('ws://127.0.0.1:5173/api/sessions/sess_1/streams/series0/ws')).toEqual({
      kind: 'app-api',
      sessionId: 'sess_1',
      streamId: 'series0',
    });
  });

  it('does not mistake an app-api route for a direct sink address', () => {
    expect(toSinkRegistryKey('ws://127.0.0.1:5173/api/sessions/sess_1/streams/series0/ws')).toBeNull();
  });

  it('still classifies a direct sink url', () => {
    expect(parseSinkAddress('ws://127.0.0.1:49152/stream')).toEqual({
      kind: 'direct',
      key: '127.0.0.1:49152/stream',
    });
  });
});

describe('WasmSinkSocket', () => {
  it('opens and delivers text frames, skipping sequences it has already seen', async () => {
    const clock = createFakeClock();
    let sequence = 0;
    const module = createModule(() => ({ sequence, kind: 'text', payload: `{"n":${sequence}}` }));

    const received: unknown[] = [];
    const socket = new WasmSinkSocket('ws://127.0.0.1:49152/stream', {
      clock,
      loadModule: () => Promise.resolve(module),
    });
    const opened = vi.fn();
    socket.onopen = opened;
    socket.onmessage = (event) => received.push(event.data);

    await flush();
    expect(opened).toHaveBeenCalledOnce();

    clock.tick();
    expect(received).toEqual([]);

    sequence = 1;
    clock.tick();
    clock.tick();
    expect(received).toEqual(['{"n":1}']);

    sequence = 2;
    clock.tick();
    expect(received).toEqual(['{"n":1}', '{"n":2}']);

    socket.close();
    expect(clock.pending()).toBe(0);
  });

  it('hands binary frames over as a detached ArrayBuffer', async () => {
    const clock = createFakeClock();
    const bytes = new Uint8Array([1, 2, 3, 4]);
    const module = createModule(() => ({ sequence: 1, kind: 'binary', payload: bytes }));

    const socket = new WasmSinkSocket('ws://127.0.0.1:49152/stream', {
      clock,
      loadModule: () => Promise.resolve(module),
    });
    let data: unknown = null;
    socket.onmessage = (event) => {
      data = event.data;
    };

    await flush();
    clock.tick();

    expect(data).toBeInstanceOf(ArrayBuffer);
    expect([...new Uint8Array(data as ArrayBuffer)]).toEqual([1, 2, 3, 4]);
  });

  it('reports a disconnect once an endpoint has stayed unregistered past the grace period', async () => {
    const clock = createFakeClock();
    const module = createModule(() => null);
    const now = vi.spyOn(Date, 'now');
    now.mockReturnValue(0);

    const socket = new WasmSinkSocket('ws://127.0.0.1:49152/stream', {
      clock,
      loadModule: () => Promise.resolve(module),
      missingEndpointTimeoutMs: 1_000,
    });
    const closed = vi.fn();
    socket.onclose = closed;

    await flush();

    clock.tick();
    expect(closed).not.toHaveBeenCalled();

    now.mockReturnValue(1_500);
    clock.tick();

    expect(closed).toHaveBeenCalledOnce();
    expect(closed.mock.calls[0][0].wasClean).toBe(false);
    expect(clock.pending()).toBe(0);
    now.mockRestore();
  });

  it('resolves an app-api stream route through the control plane before polling', async () => {
    const clock = createFakeClock();
    const requests: Array<[string, string]> = [];
    const module = createModule(
      (endpoint) =>
        endpoint === '127.0.0.1:49153/stream' ? { sequence: 1, kind: 'text', payload: '{"ok":true}' } : null,
      (method, target) => {
        requests.push([method, target]);
        return {
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ transport: 'wasm_in_process', host: '127.0.0.1', port: 49153, path: '/stream' }),
        };
      },
    );

    const socket = new WasmSinkSocket('ws://127.0.0.1:5173/api/sessions/sess_1/streams/series1/ws', {
      clock,
      loadModule: () => Promise.resolve(module),
    });
    const received: unknown[] = [];
    socket.onmessage = (event) => received.push(event.data);

    await flush();
    expect(requests).toEqual([['GET', '/sessions/sess_1/streams/series1/ws']]);

    clock.tick();
    expect(received).toEqual(['{"ok":true}']);
  });

  it('closes when the control plane cannot resolve the stream route', async () => {
    const clock = createFakeClock();
    const module = createModule(
      () => null,
      () => ({ status: 404, contentType: 'application/json', body: '{"error":{"code":"not_found"}}' }),
    );

    const socket = new WasmSinkSocket('ws://127.0.0.1:5173/api/sessions/sess_1/streams/gone/ws', {
      clock,
      loadModule: () => Promise.resolve(module),
    });
    const closed = vi.fn();
    socket.onclose = closed;

    await flush();

    expect(closed).toHaveBeenCalledOnce();
    expect(closed.mock.calls[0][0].reason).toContain('Could not resolve stream gone');
    expect(clock.pending()).toBe(0);
  });

  it('fails cleanly when the module has no studio block library linked in', async () => {
    const clock = createFakeClock();
    const module: Gr4cpModule = {
      handleRequest: () => ({ status: 200, contentType: 'application/json', body: '{}' }),
      initialize: () => ({ status: 200, contentType: 'application/json', body: '{}' }),
    };

    const socket = new WasmSinkSocket('ws://127.0.0.1:49152/stream', {
      clock,
      loadModule: () => Promise.resolve(module),
    });
    const closed = vi.fn();
    socket.onclose = closed;

    await flush();

    expect(closed).toHaveBeenCalledOnce();
    expect(closed.mock.calls[0][0].reason).toContain('without the studio block library');
  });
});
