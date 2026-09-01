import { afterEach, describe, expect, it } from 'vitest';
import { useAudioSessionStore } from './audio-session-store';

function resetStore() {
  useAudioSessionStore.getState().cleanupMissingSessions(new Set());
}

describe('audio session store', () => {
  afterEach(() => {
    resetStore();
  });

  it('creates playback sessions keyed by runtime session and node id', () => {
    useAudioSessionStore.getState().ensureSession({
      key: 'sess_1:audio_1',
      endpoint: '/api/sessions/sess_1/blocks/audio_1/stream',
      channels: 1,
      sampleRate: 48000,
      runtimeActive: false,
    });

    const session = useAudioSessionStore.getState().sessions['sess_1:audio_1'];
    expect(session).toMatchObject({
      key: 'sess_1:audio_1',
      channels: 1,
      sampleRate: 48000,
      runtimeActive: false,
      playing: false,
      connectionState: 'closed',
      bufferMs: 120,
      transportGapEvents: 0,
      missingAudioFrames: 0,
      selectedDeviceId: 'default',
      muted: false,
    });
    expect(session.endpoint).toContain('/api/sessions/sess_1/blocks/audio_1/stream');
  });

  it('removes sessions missing from the active runtime graph', () => {
    const store = useAudioSessionStore.getState();
    store.ensureSession({
      key: 'sess_1:audio_1',
      endpoint: '/api/sessions/sess_1/blocks/audio_1/stream',
      channels: 1,
      sampleRate: 48000,
      runtimeActive: false,
    });
    store.ensureSession({
      key: 'sess_1:audio_2',
      endpoint: '/api/sessions/sess_1/blocks/audio_2/stream',
      channels: 1,
      sampleRate: 48000,
      runtimeActive: false,
    });

    store.cleanupMissingSessions(new Set(['sess_1:audio_2']));

    expect(useAudioSessionStore.getState().sessions['sess_1:audio_1']).toBeUndefined();
    expect(useAudioSessionStore.getState().sessions['sess_1:audio_2']).toBeDefined();
  });
});
