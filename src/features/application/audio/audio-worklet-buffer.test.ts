import { describe, expect, it } from 'vitest';
// @ts-expect-error The worklet helper is served as a browser-native JavaScript module.
import { StudioAudioRingBuffer } from '../../../../public/audio-worklet-buffer.js';

function output(frames = 128, channels = 1): Float32Array[] {
  return Array.from({ length: channels }, () => new Float32Array(frames));
}

describe('Studio audio worklet ring buffer', () => {
  it('prefills before consuming without counting startup silence as an underrun', () => {
    const buffer = new StudioAudioRingBuffer();
    buffer.configure(1, 1_000, 400);

    buffer.render(output(), 1);
    buffer.enqueue(new Float32Array(256).fill(0.5));
    buffer.render(output(), 1);
    expect(buffer.stats()).toMatchObject({ buffering: true, availableFrames: 256, underrunEpisodes: 0 });

    buffer.enqueue(new Float32Array(256).fill(0.5));
    const rendered = output();
    buffer.render(rendered, 1);
    expect(rendered[0][0]).toBe(0.5);
    expect(buffer.stats()).toMatchObject({ buffering: false, availableFrames: 384, underrunEpisodes: 0 });
  });

  it('counts one underrun episode and rebuffers after starvation', () => {
    const buffer = new StudioAudioRingBuffer();
    buffer.configure(1, 512, 256);
    buffer.enqueue(new Float32Array(256).fill(0.5));
    buffer.render(output(), 1);
    buffer.render(output(), 1);
    buffer.render(output(), 1);

    expect(buffer.stats()).toMatchObject({
      buffering: true,
      availableFrames: 0,
      underrunEpisodes: 1,
      underrunFrames: 128,
    });

    buffer.enqueue(new Float32Array(128).fill(0.5));
    buffer.render(output(), 1);
    expect(buffer.stats()).toMatchObject({
      buffering: true,
      availableFrames: 128,
      underrunEpisodes: 1,
      underrunFrames: 256,
    });
  });

  it('counts overwritten audio frames when producer bursts exceed capacity', () => {
    const buffer = new StudioAudioRingBuffer();
    buffer.configure(1, 256, 128);
    buffer.enqueue(new Float32Array(384).fill(0.5));

    expect(buffer.stats()).toMatchObject({ availableFrames: 256, overrunFrames: 128 });
  });
});
