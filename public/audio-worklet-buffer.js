export class StudioAudioRingBuffer {
  constructor() {
    this.channels = 1;
    this.capacityFrames = 48000;
    this.prefillFrames = 4800;
    this.buffer = new Float32Array(this.capacityFrames * this.channels);
    this.readFrame = 0;
    this.writeFrame = 0;
    this.availableFrames = 0;
    this.buffering = true;
    this.recovering = false;
    this.underrunEpisodes = 0;
    this.underrunFrames = 0;
    this.overrunFrames = 0;
  }

  configure(channels, capacityFrames, prefillFrames) {
    this.channels = Math.max(1, Math.min(2, Math.floor(channels)));
    this.capacityFrames = Math.max(128, Math.floor(capacityFrames));
    this.prefillFrames = Math.max(128, Math.min(this.capacityFrames, Math.floor(prefillFrames)));
    this.buffer = new Float32Array(this.capacityFrames * this.channels);
    this.underrunEpisodes = 0;
    this.underrunFrames = 0;
    this.overrunFrames = 0;
    this.clear();
  }

  clear() {
    this.readFrame = 0;
    this.writeFrame = 0;
    this.availableFrames = 0;
    this.buffering = true;
    this.recovering = false;
  }

  enqueue(samples) {
    const frames = Math.floor(samples.length / this.channels);
    for (let frame = 0; frame < frames; frame += 1) {
      if (this.availableFrames === this.capacityFrames) {
        this.readFrame = (this.readFrame + 1) % this.capacityFrames;
        this.availableFrames -= 1;
        this.overrunFrames += 1;
      }
      for (let channel = 0; channel < this.channels; channel += 1) {
        this.buffer[this.writeFrame * this.channels + channel] = samples[frame * this.channels + channel] || 0;
      }
      this.writeFrame = (this.writeFrame + 1) % this.capacityFrames;
      this.availableFrames += 1;
    }
  }

  render(output, volume) {
    const frameCount = output[0]?.length || 0;
    if (this.buffering && this.availableFrames >= this.prefillFrames) {
      this.buffering = false;
      this.recovering = false;
    }

    if (this.buffering) {
      this.writeSilence(output, 0, frameCount);
      if (this.recovering) {
        this.underrunFrames += frameCount;
      }
      return;
    }

    for (let index = 0; index < frameCount; index += 1) {
      if (this.availableFrames === 0) {
        const missingFrames = frameCount - index;
        this.writeSilence(output, index, frameCount);
        this.underrunEpisodes += 1;
        this.underrunFrames += missingFrames;
        this.buffering = true;
        this.recovering = true;
        return;
      }

      for (let channel = 0; channel < output.length; channel += 1) {
        const sourceChannel = Math.min(channel, this.channels - 1);
        output[channel][index] = this.buffer[this.readFrame * this.channels + sourceChannel] * volume;
      }
      this.readFrame = (this.readFrame + 1) % this.capacityFrames;
      this.availableFrames -= 1;
    }
  }

  stats() {
    return {
      availableFrames: this.availableFrames,
      capacityFrames: this.capacityFrames,
      prefillFrames: this.prefillFrames,
      buffering: this.buffering,
      underrunEpisodes: this.underrunEpisodes,
      underrunFrames: this.underrunFrames,
      overrunFrames: this.overrunFrames,
    };
  }

  writeSilence(output, start, end) {
    for (let channel = 0; channel < output.length; channel += 1) {
      output[channel].fill(0, start, end);
    }
  }
}
