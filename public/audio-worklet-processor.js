import { StudioAudioRingBuffer } from './audio-worklet-buffer.js';

class StudioAudioPlaybackProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ringBuffer = new StudioAudioRingBuffer();
    this.volume = 0.8;
    this.processCalls = 0;

    this.port.onmessage = (event) => {
      const message = event.data || {};
      if (message.type === 'configure') {
        this.ringBuffer.configure(
          message.channels || 1,
          message.capacityFrames || 48000,
          message.prefillFrames || 4800,
        );
      } else if (message.type === 'volume') {
        this.volume = Math.max(0, Math.min(1, Number(message.value) || 0));
      } else if (message.type === 'samples' && message.samples instanceof Float32Array) {
        this.ringBuffer.enqueue(message.samples);
      } else if (message.type === 'clear') {
        this.ringBuffer.clear();
      }
    };
  }

  process(_inputs, outputs) {
    const output = outputs[0];
    this.ringBuffer.render(output, this.volume);

    this.processCalls += 1;
    if (this.processCalls % 128 === 0) {
      this.port.postMessage({
        type: 'stats',
        ...this.ringBuffer.stats(),
      });
    }

    return true;
  }
}

registerProcessor('studio-audio-playback', StudioAudioPlaybackProcessor);
