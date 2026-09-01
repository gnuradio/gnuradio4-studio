import { resolveWebSocketUrl } from '../../../../lib/api/websocket-url';
import { parseAudioFloat32Frame, type AudioFrame } from './audio-frame';

export type AudioConnectionState = 'connecting' | 'open' | 'closed' | 'error';

export type AudioWebSocketSubscription = {
  endpoint: string;
  onFrame: (frame: AudioFrame) => void;
  onConnectionState?: (state: AudioConnectionState, message?: string) => void;
  retryInitialMs?: number;
  retryMaxMs?: number;
};

export function normalizeAudioWebSocketEndpoint(endpoint: string): string {
  return resolveWebSocketUrl(endpoint);
}

export function createAudioWebSocketSubscription({
  endpoint,
  onFrame,
  onConnectionState,
  retryInitialMs = 250,
  retryMaxMs = 2_000,
}: AudioWebSocketSubscription): () => void {
  let closed = false;
  let socket: WebSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let retryDelayMs = Math.max(1, retryInitialMs);
  const maximumRetryDelayMs = Math.max(retryDelayMs, retryMaxMs);

  const scheduleReconnect = (message: string) => {
    if (closed || retryTimer) {
      return;
    }
    onConnectionState?.('connecting', message);
    const delay = retryDelayMs;
    retryDelayMs = Math.min(maximumRetryDelayMs, delay * 2);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      open();
    }, delay);
  };

  const open = () => {
    if (closed) {
      return;
    }
    onConnectionState?.('connecting');
    let candidate: WebSocket;
    try {
      candidate = new WebSocket(normalizeAudioWebSocketEndpoint(endpoint));
    } catch {
      scheduleReconnect('Audio websocket connection failed; retrying.');
      return;
    }
    socket = candidate;
    candidate.binaryType = 'arraybuffer';

    candidate.addEventListener('open', () => {
      if (socket !== candidate || closed) {
        return;
      }
      retryDelayMs = Math.max(1, retryInitialMs);
      onConnectionState?.('open');
    });
    candidate.addEventListener('message', (event) => {
      if (socket !== candidate || closed) {
        return;
      }
      if (!(event.data instanceof ArrayBuffer)) {
        onConnectionState?.('error', 'Audio websocket produced a non-binary frame.');
        return;
      }
      try {
        onFrame(parseAudioFloat32Frame(event.data));
      } catch (error) {
        onConnectionState?.('error', error instanceof Error ? error.message : 'Audio frame parse failed.');
      }
    });
    candidate.addEventListener('close', () => {
      const wasCurrent = socket === candidate;
      if (wasCurrent) {
        socket = null;
      }
      if (closed) {
        if (wasCurrent) {
          onConnectionState?.('closed');
        }
        return;
      }
      if (!wasCurrent) {
        return;
      }
      scheduleReconnect('Audio websocket closed; retrying.');
    });
    candidate.addEventListener('error', () => {
      if (socket !== candidate || closed) {
        return;
      }
      socket = null;
      candidate.close();
      scheduleReconnect('Audio websocket connection failed; retrying.');
    });
  };

  open();

  return () => {
    if (closed) {
      return;
    }
    closed = true;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    const activeSocket = socket;
    socket = null;
    activeSocket?.close();
    onConnectionState?.('closed');
  };
}
