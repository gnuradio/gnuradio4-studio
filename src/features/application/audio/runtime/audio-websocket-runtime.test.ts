import { afterEach, describe, expect, it, vi } from 'vitest';
import { createAudioWebSocketSubscription } from './audio-websocket-runtime';

class FakeWebSocket extends EventTarget {
  static instances: FakeWebSocket[] = [];
  binaryType = '';

  constructor(readonly url: string) {
    super();
    FakeWebSocket.instances.push(this);
  }

  close() {
    queueMicrotask(() => this.dispatchEvent(new Event('close')));
  }
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  FakeWebSocket.instances = [];
});

describe('audio websocket runtime', () => {
  it('retries startup failures and stops retrying after disposal', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const states: string[] = [];
    const unsubscribe = createAudioWebSocketSubscription({
      endpoint: 'ws://127.0.0.1:18084/audio',
      onFrame: () => undefined,
      onConnectionState: (state) => states.push(state),
      retryInitialMs: 10,
      retryMaxMs: 20,
    });

    expect(FakeWebSocket.instances).toHaveLength(1);
    FakeWebSocket.instances[0].dispatchEvent(new Event('error'));
    vi.advanceTimersByTime(10);
    expect(FakeWebSocket.instances).toHaveLength(2);

    FakeWebSocket.instances[1].dispatchEvent(new Event('open'));
    expect(states[states.length - 1]).toBe('open');

    unsubscribe();
    await Promise.resolve();
    vi.advanceTimersByTime(100);
    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(states[states.length - 1]).toBe('closed');
  });

  it('reconnects after an established websocket closes', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('WebSocket', FakeWebSocket);
    const unsubscribe = createAudioWebSocketSubscription({
      endpoint: 'ws://127.0.0.1:18084/audio',
      onFrame: () => undefined,
      retryInitialMs: 10,
      retryMaxMs: 20,
    });

    FakeWebSocket.instances[0].dispatchEvent(new Event('open'));
    FakeWebSocket.instances[0].close();
    await Promise.resolve();
    vi.advanceTimersByTime(10);

    expect(FakeWebSocket.instances).toHaveLength(2);
    unsubscribe();
  });
});
