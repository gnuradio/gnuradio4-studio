import { useEffect, useMemo } from 'react';
import { useAudioSessionStore } from '../../application/audio/audio-session-store';
import type { WorkspaceLiveRendererContext } from './live-renderer-contract';

type AudioLiveRendererProps = {
  liveContext: WorkspaceLiveRendererContext;
};

export function AudioLiveRenderer({ liveContext }: AudioLiveRendererProps) {
  const endpoint = liveContext.binding.endpoint?.trim() ?? '';
  const runtimeActive = liveContext.executionState === 'running';
  const sessionKey = useMemo(() => {
    if (!liveContext.sessionId || !liveContext.panel.nodeId) {
      return null;
    }
    return `${liveContext.sessionId}:${liveContext.panel.nodeId}`;
  }, [liveContext.panel.nodeId, liveContext.sessionId]);
  const supportsLivePath =
    runtimeActive &&
    liveContext.binding.status === 'configured' &&
    liveContext.binding.transport === 'websocket' &&
    endpoint.length > 0 &&
    Boolean(sessionKey);
  const channels = liveContext.binding.channels ?? 1;
  const sampleRate = liveContext.binding.sampleRate ?? 48000;
  const bufferMs = liveContext.binding.bufferMs ?? 120;

  const session = useAudioSessionStore((state) => (sessionKey ? state.sessions[sessionKey] : undefined));
  const ensureSession = useAudioSessionStore((state) => state.ensureSession);
  const setVolume = useAudioSessionStore((state) => state.setVolume);
  const setMuted = useAudioSessionStore((state) => state.setMuted);
  const setOutputDevice = useAudioSessionStore((state) => state.setOutputDevice);

  useEffect(() => {
    if (!sessionKey || !endpoint) {
      return;
    }
    ensureSession({
      key: sessionKey,
      endpoint,
      channels,
      sampleRate,
      bufferMs,
      runtimeActive: supportsLivePath,
    });
  }, [bufferMs, channels, endpoint, ensureSession, sampleRate, sessionKey, supportsLivePath]);

  const playing = session?.playing ?? false;
  const connectionState = session?.connectionState ?? 'closed';
  const volume = session?.volume ?? 0.8;
  const muted = session?.muted ?? false;
  const stats = session?.stats ?? null;
  const devices = session?.devices ?? [{ deviceId: 'default', label: 'Default output' }];
  const selectedDeviceId = session?.selectedDeviceId ?? 'default';
  const deviceSelectionSupported = session?.deviceSelectionSupported ?? true;
  const lastFrame = session?.lastFrame ?? null;
  const message = session?.message ?? null;
  const transportGapEvents = session?.transportGapEvents ?? 0;
  const missingAudioFrames = session?.missingAudioFrames ?? 0;

  const handleDeviceChange = async (deviceId: string) => {
    if (!sessionKey) {
      return;
    }
    await setOutputDevice(sessionKey, deviceId);
  };

  return (
    <div className="h-full rounded border border-slate-700 bg-slate-950/70 p-3 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-100">{liveContext.panel.title ?? 'Audio'}</p>
        <span className="text-[10px] text-slate-400">{connectionState}</span>
      </div>

      {!supportsLivePath && (
        <p className="text-[11px] text-slate-400">
          {liveContext.binding.status === 'configured'
            ? 'Audio playback waits for a running websocket stream.'
            : 'Configure a StudioAudioSink websocket binding to enable playback.'}
        </p>
      )}

      <div className="grid grid-cols-[auto_1fr] items-center gap-3">
        <button
          type="button"
          onClick={() => {
            if (sessionKey) {
              setMuted(sessionKey, !muted);
            }
          }}
          disabled={!supportsLivePath}
          className="h-9 rounded border border-slate-600 bg-slate-900 px-3 text-xs font-medium text-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {muted ? 'Unmute' : 'Mute'}
        </button>

        <label className="grid grid-cols-[64px_1fr] items-center gap-2 text-[11px] text-slate-300">
          <span>Volume</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(event) => {
              if (sessionKey) {
                setVolume(sessionKey, Number(event.currentTarget.value));
              }
            }}
            className="w-full"
          />
        </label>
      </div>

      <label className="grid gap-1 text-[11px] text-slate-300">
        <span>Output Device</span>
        <select
          value={selectedDeviceId}
          onChange={(event) => {
            void handleDeviceChange(event.currentTarget.value);
          }}
          disabled={!deviceSelectionSupported}
          className="h-8 rounded border border-slate-700 bg-slate-900 px-2 text-xs text-slate-100 disabled:opacity-60"
        >
          {devices.map((device) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label}
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-2 text-[11px] text-slate-400">
        <span>Rate {lastFrame?.sampleRate ?? sampleRate} Hz</span>
        <span>Context {stats?.contextSampleRate ?? 'n/a'} Hz</span>
        <span>Channels {lastFrame?.channels ?? channels}</span>
        <span>
          Buffer {stats ? `${stats.availableFrames}/${stats.capacityFrames}` : 'n/a'}
        </span>
        <span>{stats?.buffering ? `Buffering to ${stats.prefillFrames}` : playing ? 'Buffered' : 'Starting'}</span>
        <span>Underruns {stats?.underrunEpisodes ?? 0}</span>
        <span>Underflow frames {stats?.underrunFrames ?? 0}</span>
        <span>Overrun frames {stats?.overrunFrames ?? 0}</span>
        <span>Transport gaps {transportGapEvents}</span>
        <span>Missing frames {missingAudioFrames}</span>
      </div>

      {message && <p className="text-[11px] text-amber-200 break-words">{message}</p>}
    </div>
  );
}
