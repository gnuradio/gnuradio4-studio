// Routes the studio's sink data plane into the in-process WASM module
// by patching the WebSocket contstructor

import {
  loadControlPlaneWasm,
  markControlPlaneWasmEnabled,
  type Gr4cpModule,
  type Gr4cpSinkSnapshot,
} from './control-plane-wasm';

const DEFAULT_SINK_HOST = '127.0.0.1';
const DEFAULT_SINK_PORT = '8080';
const DEFAULT_SINK_PATH = '/snapshot';


const DEFAULT_POLL_INTERVAL_MS = 50;

const DEFAULT_MISSING_ENDPOINT_TIMEOUT_MS = 10_000;

const WS_CONNECTING = 0;
const WS_OPEN = 1;
const WS_CLOSED = 3;

export type SinkAddress =
  | { kind: 'direct'; key: string }
  | { kind: 'app-api'; sessionId: string; streamId: string };

const APP_API_STREAM_ROUTE = /^\/api\/sessions\/([^/]+)\/streams\/([^/]+)\/ws$/;

export function parseSinkAddress(url: string): SinkAddress | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'ws:' && parsed.protocol !== 'wss:') {
    return null;
  }

  const route = APP_API_STREAM_ROUTE.exec(parsed.pathname);
  if (route) {
    return {
      kind: 'app-api',
      sessionId: decodeURIComponent(route[1]),
      streamId: decodeURIComponent(route[2]),
    };
  }

  const host = parsed.hostname === '' ? DEFAULT_SINK_HOST : parsed.hostname;
  const port = parsed.port === '' ? DEFAULT_SINK_PORT : parsed.port;
  const path = parsed.pathname === '' || parsed.pathname === '/' ? DEFAULT_SINK_PATH : parsed.pathname;

  return { kind: 'direct', key: `${host}:${port}${path}` };
}

export function toSinkRegistryKey(url: string): string | null {
  const address = parseSinkAddress(url);
  return address?.kind === 'direct' ? address.key : null;
}

function resolveAppApiKey(module: Gr4cpModule, sessionId: string, streamId: string): string {
  const target = `/sessions/${encodeURIComponent(sessionId)}/streams/${encodeURIComponent(streamId)}/ws`;
  const response = module.handleRequest('GET', target, '');
  if (response.status !== 200) {
    throw new Error(`Could not resolve stream ${streamId} of session ${sessionId}: ${response.status} ${response.body}`);
  }

  const binding = JSON.parse(response.body) as { host?: string; port?: number; path?: string };
  if (!binding.host || typeof binding.port !== 'number' || !binding.path) {
    throw new Error(`Stream ${streamId} of session ${sessionId} did not advertise an in-process binding.`);
  }

  return `${binding.host}:${binding.port}${binding.path}`;
}

function toMessageEvent(snapshot: Gr4cpSinkSnapshot): MessageEvent {
  if (snapshot.kind === 'binary') {
    const bytes = snapshot.payload as Uint8Array;
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    return new MessageEvent('message', { data: buffer });
  }
  return new MessageEvent('message', { data: snapshot.payload as string });
}

function toCloseEvent(code: number, reason: string, wasClean: boolean): CloseEvent {
  if (typeof CloseEvent === 'function') {
    return new CloseEvent('close', { code, reason, wasClean });
  }
  return { code, reason, wasClean } as CloseEvent;
}

type Clock = {
  setInterval: (handler: () => void, timeout: number) => number;
  clearInterval: (handle: number) => void;
};

export type WasmSinkSocketOptions = {
  pollIntervalMs?: number;
  missingEndpointTimeoutMs?: number;
  clock?: Clock;
  loadModule?: () => Promise<Gr4cpModule>;
};

export class WasmSinkSocket implements Partial<WebSocket> {
  readonly url: string;

  binaryType: BinaryType = 'blob';
  readyState: number = WS_CONNECTING;

  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;

  private readonly _address: SinkAddress;
  private readonly _clock: Clock;
  private readonly _pollIntervalMs: number;
  private readonly _missingEndpointTimeoutMs: number;

  private _key = '';
  private _handle: number | null = null;
  private _lastSequence: number | null = null;
  private _missingSinceMs: number | null = null;

  constructor(url: string, options: WasmSinkSocketOptions = {}) {
    this.url = url;

    const address = parseSinkAddress(url);
    if (address === null) {
      throw new Error(`Not a studio sink websocket URL: ${url}`);
    }
    this._address = address;

    this._clock = options.clock ?? {
      setInterval: (handler, timeout) => window.setInterval(handler, timeout),
      clearInterval: (handle) => window.clearInterval(handle),
    };
    this._pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this._missingEndpointTimeoutMs = options.missingEndpointTimeoutMs ?? DEFAULT_MISSING_ENDPOINT_TIMEOUT_MS;

    const loadModule = options.loadModule ?? (() => loadControlPlaneWasm());
    void loadModule().then(
      (module) => this._start(module),
      (error: unknown) => {
        this._fail(error instanceof Error ? error.message : 'Failed to load the control plane WASM module.');
      },
    );
  }

  close(): void {
    if (this.readyState === WS_CLOSED) {
      return;
    }
    this._stopPolling();
    this.readyState = WS_CLOSED;
    this.onclose?.(toCloseEvent(1000, '', true));
  }

  private _start(module: Gr4cpModule): void {
    if (this.readyState === WS_CLOSED) {
      return;
    }

    if (typeof module.studioSinkSnapshot !== 'function') {
      this._fail('This WASM module was built without the studio block library, so no sink data is available.');
      return;
    }
    const readSnapshot = module.studioSinkSnapshot.bind(module);

    try {
      this._key =
        this._address.kind === 'direct'
          ? this._address.key
          : resolveAppApiKey(module, this._address.sessionId, this._address.streamId);
    } catch (error) {
      this._fail(error instanceof Error ? error.message : 'Could not resolve the sink behind this stream route.');
      return;
    }

    this.readyState = WS_OPEN;
    this.onopen?.(new Event('open'));

    this._handle = this._clock.setInterval(() => this._poll(readSnapshot), this._pollIntervalMs);
  }

  private _poll(readSnapshot: (endpoint: string) => Gr4cpSinkSnapshot | null): void {
    if (this.readyState !== WS_OPEN) {
      return;
    }

    let snapshot: Gr4cpSinkSnapshot | null;
    try {
      snapshot = readSnapshot(this._key);
    } catch (error) {
      this._fail(error instanceof Error ? error.message : 'Reading the sink registry failed.');
      return;
    }

    if (snapshot === null) {
      this._noteMissingEndpoint();
      return;
    }
    this._missingSinceMs = null;

    // Sequence 0 means the sink registered but has not published
    if (snapshot.sequence === 0 || snapshot.sequence === this._lastSequence) {
      return;
    }
    this._lastSequence = snapshot.sequence;

    this.onmessage?.(toMessageEvent(snapshot));
  }

  private _noteMissingEndpoint(): void {
    const now = Date.now();
    this._missingSinceMs ??= now;

    if (now - this._missingSinceMs < this._missingEndpointTimeoutMs) {
      return;
    }

    this._stopPolling();
    this.readyState = WS_CLOSED;
    this.onclose?.(toCloseEvent(1006, `No studio sink is publishing at ${this._key}.`, false));
  }

  private _fail(message: string): void {
    this._stopPolling();
    this.readyState = WS_CLOSED;
    this.onerror?.(new Event('error'));
    this.onclose?.(toCloseEvent(1006, message, false));
  }

  private _stopPolling(): void {
    if (this._handle === null) {
      return;
    }
    this._clock.clearInterval(this._handle);
    this._handle = null;
  }
}

// Replaces `globalThis.WebSocket` so sink connections are served from the in-process registry.
export function installWasmSinkTransport(options: WasmSinkSocketOptions = {}): () => void {
  const OriginalWebSocket = globalThis.WebSocket;
  markControlPlaneWasmEnabled();

  const patched = function (this: unknown, url: string | URL, protocols?: string | string[]) {
    const href = typeof url === 'string' ? url : url.toString();
    if (parseSinkAddress(href) === null) {
      return new OriginalWebSocket(url, protocols);
    }
    return new WasmSinkSocket(href, options);
  } as unknown as typeof WebSocket;

  Object.defineProperties(patched, {
    CONNECTING: { value: WS_CONNECTING },
    OPEN: { value: WS_OPEN },
    CLOSING: { value: 2 },
    CLOSED: { value: WS_CLOSED },
  });

  globalThis.WebSocket = patched;

  return () => {
    if (globalThis.WebSocket === patched) {
      globalThis.WebSocket = OriginalWebSocket;
    }
  };
}
