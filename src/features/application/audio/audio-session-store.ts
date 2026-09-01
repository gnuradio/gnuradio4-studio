import { create } from 'zustand';
import { StudioAudioPlaybackController, type AudioPlaybackStats } from './audio-playback-controller';
import {
  createAudioWebSocketSubscription,
  normalizeAudioWebSocketEndpoint,
  type AudioConnectionState,
} from './runtime/audio-websocket-runtime';
import type { AudioFrame } from './runtime/audio-frame';

export type AudioDeviceInfo = {
  deviceId: string;
  label: string;
};

export type AudioFrameMetadata = Omit<AudioFrame, 'samples'>;

export type AudioSessionConfig = {
  key: string;
  endpoint: string;
  channels: number;
  sampleRate: number;
  runtimeActive: boolean;
  bufferMs?: number;
};

export type AudioSessionState = {
  key: string;
  endpoint: string;
  channels: number;
  sampleRate: number;
  runtimeActive: boolean;
  bufferMs: number;
  playing: boolean;
  connectionState: AudioConnectionState;
  message: string | null;
  volume: number;
  muted: boolean;
  stats: AudioPlaybackStats | null;
  transportGapEvents: number;
  missingAudioFrames: number;
  devices: AudioDeviceInfo[];
  selectedDeviceId: string;
  deviceSelectionSupported: boolean;
  lastFrame: AudioFrameMetadata | null;
};

type AudioSessionRuntime = {
  controller: StudioAudioPlaybackController;
  unsubscribe?: () => void;
  expectedSequence: bigint | null;
};

type AudioSessionStore = {
  sessions: Record<string, AudioSessionState>;
  ensureSession: (config: AudioSessionConfig) => void;
  play: (key: string) => Promise<void>;
  pause: (key: string) => void;
  stop: (key: string) => void;
  setVolume: (key: string, volume: number) => void;
  setMuted: (key: string, muted: boolean) => void;
  setOutputDevice: (key: string, deviceId: string) => Promise<void>;
  refreshDevices: (key: string) => Promise<void>;
  cleanupMissingSessions: (activeKeys: ReadonlySet<string>) => void;
};

const DEFAULT_DEVICES: readonly AudioDeviceInfo[] = [{ deviceId: 'default', label: 'Default output' }];
const runtimes = new Map<string, AudioSessionRuntime>();

function clampVolume(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function normalizeChannels(channels: number): number {
  return Math.max(1, Math.min(2, Math.trunc(channels || 1)));
}

function normalizeSampleRate(sampleRate: number): number {
  return Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 48000;
}

function defaultSessionState(config: AudioSessionConfig): AudioSessionState {
  return {
    key: config.key,
    endpoint: normalizeAudioWebSocketEndpoint(config.endpoint),
    channels: normalizeChannels(config.channels),
    sampleRate: normalizeSampleRate(config.sampleRate),
    runtimeActive: config.runtimeActive,
    bufferMs: config.bufferMs ?? 120,
    playing: false,
    connectionState: 'closed',
    message: null,
    volume: 0.8,
    muted: false,
    stats: null,
    transportGapEvents: 0,
    missingAudioFrames: 0,
    devices: [...DEFAULT_DEVICES],
    selectedDeviceId: 'default',
    deviceSelectionSupported: true,
    lastFrame: null,
  };
}

async function listAudioOutputDevices(): Promise<AudioDeviceInfo[]> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.enumerateDevices) {
    return [...DEFAULT_DEVICES];
  }

  let devices = await navigator.mediaDevices.enumerateDevices();
  if (devices.every((device) => !device.label) && navigator.mediaDevices.getUserMedia) {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      devices = await navigator.mediaDevices.enumerateDevices();
    } catch {
      // Permission is optional. Playback can continue with the default device.
    }
  }

  const outputs = devices
    .filter((device) => device.kind === 'audiooutput')
    .map((device, index) => ({
      deviceId: device.deviceId || 'default',
      label: device.label || (index === 0 ? 'Default output' : `Output ${index + 1}`),
    }));

  return outputs.length > 0 ? outputs : [...DEFAULT_DEVICES];
}

function closeRuntime(key: string) {
  const runtime = runtimes.get(key);
  if (!runtime) {
    return;
  }
  runtime.unsubscribe?.();
  runtime.controller.close();
  runtimes.delete(key);
}

function sessionChanged(existing: AudioSessionState, next: AudioSessionState): boolean {
  return (
    existing.endpoint !== next.endpoint ||
    existing.channels !== next.channels ||
    existing.sampleRate !== next.sampleRate ||
    existing.bufferMs !== next.bufferMs
  );
}

export const useAudioSessionStore = create<AudioSessionStore>((set, get) => ({
  sessions: {},

  ensureSession: (config) => {
    const next = defaultSessionState(config);
    const existing = get().sessions[config.key];
    const shouldRestart = Boolean(existing?.playing && config.runtimeActive && sessionChanged(existing, next));
    const shouldAutoplay = config.runtimeActive && (!existing || shouldRestart || !existing.playing);

    if (existing && !config.runtimeActive) {
      get().stop(config.key);
      return;
    }

    if (shouldRestart) {
      closeRuntime(config.key);
    }

    set((state) => ({
      sessions: {
        ...state.sessions,
        [config.key]: existing
          ? {
              ...existing,
              endpoint: next.endpoint,
              channels: next.channels,
              sampleRate: next.sampleRate,
              runtimeActive: next.runtimeActive,
              bufferMs: next.bufferMs,
              playing: shouldRestart ? false : existing.playing,
              connectionState: shouldRestart ? 'closed' : existing.connectionState,
              message: shouldRestart ? null : existing.message,
            }
          : next,
      },
    }));

    if (!existing) {
      void get().refreshDevices(config.key);
    }
    if (shouldAutoplay) {
      void get().play(config.key);
    }
  },

  play: async (key) => {
    const session = get().sessions[key];
    if (!session || !session.runtimeActive) {
      return;
    }

    let runtime = runtimes.get(key);
    if (!runtime) {
      runtime = {
        controller: new StudioAudioPlaybackController((stats) => {
          set((state) => {
            const current = state.sessions[key];
            if (!current) {
              return state;
            }
            return { sessions: { ...state.sessions, [key]: { ...current, stats } } };
          });
        }),
        expectedSequence: null,
      };
      runtimes.set(key, runtime);
    }

    runtime.unsubscribe?.();
    runtime.expectedSequence = null;
    try {
      await runtime.controller.start({
        channels: session.channels,
        sampleRate: session.sampleRate,
        bufferMs: session.bufferMs,
      });
      runtime.controller.setVolume(session.muted ? 0 : session.volume);
      if (session.selectedDeviceId !== 'default') {
        const ok = await runtime.controller.setOutputDevice(session.selectedDeviceId);
        if (!ok) {
          set((state) => {
            const current = state.sessions[key];
            return current
              ? { sessions: { ...state.sessions, [key]: { ...current, deviceSelectionSupported: false } } }
              : state;
          });
        }
      }
    } catch (error) {
      closeRuntime(key);
      set((state) => {
        const current = state.sessions[key];
        return current
          ? {
              sessions: {
                ...state.sessions,
                [key]: {
                  ...current,
                  playing: false,
                  connectionState: 'error',
                  message: error instanceof Error ? error.message : 'Audio playback failed to start.',
                },
              },
            }
          : state;
      });
      return;
    }

    set((state) => {
      const current = state.sessions[key];
      return current
        ? {
            sessions: {
              ...state.sessions,
              [key]: { ...current, playing: true, connectionState: 'connecting', message: null },
            },
          }
        : state;
    });

    runtime.unsubscribe = createAudioWebSocketSubscription({
      endpoint: session.endpoint,
      onFrame: (frame) => {
        const frameMetadata: AudioFrameMetadata = {
          channels: frame.channels,
          sampleRate: frame.sampleRate,
          frames: frame.frames,
          sequence: frame.sequence,
          timestampNs: frame.timestampNs,
        };
        let message: string | null | undefined;
        let missingPackets = 0;
        if (runtime.expectedSequence !== null && frame.sequence !== runtime.expectedSequence) {
          missingPackets = Number(frame.sequence > runtime.expectedSequence ? frame.sequence - runtime.expectedSequence : 0n);
          message = `Audio sequence gap: expected ${runtime.expectedSequence}, got ${frame.sequence}.`;
        }
        runtime.expectedSequence = frame.sequence + 1n;
        runtime.controller.pushFrame(frame);

        set((state) => {
          const current = state.sessions[key];
          if (!current) {
            return state;
          }
          return {
            sessions: {
              ...state.sessions,
              [key]: {
                ...current,
                lastFrame: frameMetadata,
                transportGapEvents: current.transportGapEvents + (missingPackets > 0 ? 1 : 0),
                missingAudioFrames: current.missingAudioFrames + missingPackets * frame.frames,
                message: message ?? current.message,
              },
            },
          };
        });
      },
      onConnectionState: (connectionState, stateMessage) => {
        if (connectionState === 'connecting') {
          runtime.controller.clear();
          runtime.expectedSequence = null;
        }
        set((state) => {
          const current = state.sessions[key];
          if (!current) {
            return state;
          }
          return {
            sessions: {
              ...state.sessions,
              [key]: {
                ...current,
                connectionState,
                message: stateMessage ?? (connectionState === 'open' ? null : current.message),
              },
            },
          };
        });
      },
    });
  },

  pause: (key) => {
    const runtime = runtimes.get(key);
    runtime?.unsubscribe?.();
    if (runtime) {
      runtime.unsubscribe = undefined;
      runtime.expectedSequence = null;
      runtime.controller.pause();
    }
    set((state) => {
      const current = state.sessions[key];
      return current
        ? { sessions: { ...state.sessions, [key]: { ...current, playing: false, connectionState: 'closed' } } }
        : state;
    });
  },

  stop: (key) => {
    closeRuntime(key);
    set((state) => {
      const current = state.sessions[key];
      return current
        ? {
            sessions: {
              ...state.sessions,
              [key]: {
                ...current,
                playing: false,
                connectionState: 'closed',
                message: null,
                stats: null,
                lastFrame: null,
                transportGapEvents: 0,
                missingAudioFrames: 0,
              },
            },
          }
        : state;
    });
  },

  setVolume: (key, volume) => {
    const nextVolume = clampVolume(volume);
    const current = get().sessions[key];
    runtimes.get(key)?.controller.setVolume(current?.muted ? 0 : nextVolume);
    set((state) => {
      const session = state.sessions[key];
      return session ? { sessions: { ...state.sessions, [key]: { ...session, volume: nextVolume } } } : state;
    });
  },

  setMuted: (key, muted) => {
    const current = get().sessions[key];
    runtimes.get(key)?.controller.setVolume(muted ? 0 : (current?.volume ?? 0.8));
    set((state) => {
      const session = state.sessions[key];
      return session ? { sessions: { ...state.sessions, [key]: { ...session, muted } } } : state;
    });
  },

  setOutputDevice: async (key, deviceId) => {
    set((state) => {
      const current = state.sessions[key];
      return current ? { sessions: { ...state.sessions, [key]: { ...current, selectedDeviceId: deviceId } } } : state;
    });
    const runtime = runtimes.get(key);
    if (!runtime) {
      return;
    }
    const ok = await runtime.controller.setOutputDevice(deviceId);
    set((state) => {
      const current = state.sessions[key];
      return current
        ? { sessions: { ...state.sessions, [key]: { ...current, deviceSelectionSupported: ok } } }
        : state;
    });
  },

  refreshDevices: async (key) => {
    const devices = await listAudioOutputDevices();
    set((state) => {
      const current = state.sessions[key];
      return current ? { sessions: { ...state.sessions, [key]: { ...current, devices } } } : state;
    });
  },

  cleanupMissingSessions: (activeKeys) => {
    const sessionKeys = Object.keys(get().sessions);
    const keysToRemove = sessionKeys.filter((key) => !activeKeys.has(key));
    if (keysToRemove.length === 0) {
      return;
    }

    keysToRemove.forEach(closeRuntime);
    set((state) => {
      const sessions = { ...state.sessions };
      keysToRemove.forEach((key) => {
        delete sessions[key];
      });
      return { sessions };
    });
  },
}));
