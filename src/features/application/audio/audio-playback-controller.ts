import type { AudioFrame } from './runtime/audio-frame';

export type AudioPlaybackStats = {
  availableFrames: number;
  capacityFrames: number;
  prefillFrames: number;
  buffering: boolean;
  underrunEpisodes: number;
  underrunFrames: number;
  overrunFrames: number;
  contextSampleRate: number;
};

type AudioContextWithSink = AudioContext & {
  setSinkId?: (sinkId: string) => Promise<void>;
};

export class StudioAudioPlaybackController {
  private context: AudioContextWithSink | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private channels = 1;
  private sampleRate = 48000;
  private bufferMs = 120;
  private volume = 0.8;
  private onStats?: (stats: AudioPlaybackStats) => void;

  constructor(onStats?: (stats: AudioPlaybackStats) => void) {
    this.onStats = onStats;
  }

  get running(): boolean {
    return this.context?.state === 'running';
  }

  async start({ channels, sampleRate, bufferMs = 120 }: { channels: number; sampleRate: number; bufferMs?: number }) {
    this.channels = Math.max(1, Math.min(2, channels));
    this.sampleRate = sampleRate;
    this.bufferMs = bufferMs;

    if (!this.context) {
      this.context = new AudioContext({ sampleRate }) as AudioContextWithSink;
      await this.context.audioWorklet.addModule('/audio-worklet-processor.js');
      this.workletNode = new AudioWorkletNode(this.context, 'studio-audio-playback', {
        numberOfInputs: 0,
        numberOfOutputs: 1,
        outputChannelCount: [this.channels],
      });
      this.workletNode.port.onmessage = (event) => {
        if (event.data?.type === 'stats') {
          this.onStats?.({
            ...(event.data as Omit<AudioPlaybackStats, 'contextSampleRate'>),
            contextSampleRate: this.context?.sampleRate ?? this.sampleRate,
          });
        }
      };
      this.workletNode.connect(this.context.destination);
      this.configureWorklet();
      this.setVolume(this.volume);
    }

    await this.context.resume();
  }

  pause() {
    void this.context?.suspend();
  }

  close() {
    this.workletNode?.port.postMessage({ type: 'clear' });
    this.workletNode?.disconnect();
    this.workletNode = null;
    void this.context?.close();
    this.context = null;
  }

  clear() {
    this.workletNode?.port.postMessage({ type: 'clear' });
  }

  pushFrame(frame: AudioFrame) {
    if (!this.workletNode) {
      return;
    }
    if (frame.channels !== this.channels) {
      return;
    }
    this.workletNode.port.postMessage({ type: 'samples', samples: frame.samples }, [frame.samples.buffer]);
  }

  setVolume(value: number) {
    this.volume = Math.max(0, Math.min(1, value));
    this.workletNode?.port.postMessage({ type: 'volume', value: this.volume });
  }

  async setOutputDevice(deviceId: string) {
    if (!this.context?.setSinkId) {
      return false;
    }
    await this.context.setSinkId(deviceId);
    return true;
  }

  private configureWorklet() {
    const playbackSampleRate = this.context?.sampleRate ?? this.sampleRate;
    const prefillFrames = Math.max(128, Math.round((playbackSampleRate * this.bufferMs) / 1000));
    const capacityFrames = Math.max(1024, prefillFrames * 2);
    this.workletNode?.port.postMessage({
      type: 'configure',
      channels: this.channels,
      capacityFrames,
      prefillFrames,
    });
  }
}
