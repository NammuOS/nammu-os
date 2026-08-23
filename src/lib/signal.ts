export type Palette = {
  root: number;
  intervals: number[];
  filter: number;
  noise: number;
  lfo: number;
  wave: OscillatorType;
};

export function parsePalette(raw?: string | null): Palette {
  try {
    if (raw) {
      const palette = JSON.parse(raw) as Partial<Palette>;
      return {
        root: palette.root ?? 110,
        intervals: palette.intervals ?? [0, 7, 12],
        filter: palette.filter ?? 420,
        noise: palette.noise ?? 0.03,
        lfo: palette.lfo ?? 0.07,
        wave: palette.wave ?? 'sine',
      };
    }
  } catch {
    // Invalid palettes fall back to the default signal.
  }
  return { root: 110, intervals: [0, 7, 12], filter: 420, noise: 0.03, lfo: 0.07, wave: 'sine' };
}

class SignalEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private voices: AudioScheduledSourceNode[] = [];
  private nodes: AudioNode[] = [];
  private lfo: OscillatorNode | null = null;

  private ensure() {
    if (!this.context) {
      const AudioContextConstructor =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.context = new AudioContextConstructor();
      this.master = this.context.createGain();
      this.master.gain.value = 0;
      this.analyser = this.context.createAnalyser();
      this.analyser.fftSize = 64;
      this.analyser.smoothingTimeConstant = 0.82;
      this.master.connect(this.analyser);
      this.analyser.connect(this.context.destination);
    }
    if (this.context.state === 'suspended') void this.context.resume();
  }

  getAnalyser() {
    return this.analyser;
  }

  private stopVoices() {
    this.voices.forEach((voice) => {
      try {
        voice.stop();
      } catch {
        /* The voice was already stopped. */
      }
    });
    this.voices = [];
    if (this.lfo) {
      try {
        this.lfo.stop();
      } catch {
        /* The LFO was already stopped. */
      }
      this.lfo = null;
    }
    this.nodes.forEach((node) => {
      try {
        node.disconnect();
      } catch {
        /* The node was already disconnected. */
      }
    });
    this.nodes = [];
  }

  setVolume(value: number) {
    if (!this.context || !this.master) return;
    const volume = Math.max(0, Math.min(1, value));
    this.master.gain.setTargetAtTime(volume * 0.2, this.context.currentTime, 0.06);
  }

  play(palette: Palette, volume: number) {
    this.ensure();
    this.stopVoices();
    if (!this.context || !this.master) return;

    const now = this.context.currentTime;
    this.master.gain.cancelScheduledValues(now);
    this.master.gain.setValueAtTime(this.master.gain.value, now);
    const audibleVolume = volume <= 0 ? 0 : Math.max(0.02, volume);
    this.master.gain.linearRampToValueAtTime(audibleVolume * 0.2, now + 0.18);

    const filter = this.context.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = palette.filter;
    filter.Q.value = 0.7;
    filter.connect(this.master);
    this.nodes.push(filter);

    this.lfo = this.context.createOscillator();
    this.lfo.frequency.value = palette.lfo;
    const lfoGain = this.context.createGain();
    lfoGain.gain.value = palette.filter * 0.18;
    this.lfo.connect(lfoGain);
    lfoGain.connect(filter.frequency);
    this.lfo.start();
    this.nodes.push(lfoGain);

    palette.intervals.forEach((interval, index) => {
      const oscillator = this.context!.createOscillator();
      oscillator.type = index === 0 ? palette.wave : index % 2 === 0 ? 'triangle' : 'sine';
      oscillator.frequency.value = palette.root * Math.pow(2, interval / 12);
      const gain = this.context!.createGain();
      gain.gain.value = index === 0 ? 0.38 : 0.16 / (index + 0.6);
      oscillator.connect(gain);
      gain.connect(filter);
      oscillator.start();
      this.voices.push(oscillator);
      this.nodes.push(gain);
    });

    if (palette.noise > 0) {
      const frames = this.context.sampleRate * 2;
      const buffer = this.context.createBuffer(1, frames, this.context.sampleRate);
      const data = buffer.getChannelData(0);
      for (let index = 0; index < frames; index += 1) {
        data[index] = (Math.random() * 2 - 1) * palette.noise;
      }
      const source = this.context.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      const noiseGain = this.context.createGain();
      noiseGain.gain.value = 0.22;
      const noiseFilter = this.context.createBiquadFilter();
      noiseFilter.type = 'highpass';
      noiseFilter.frequency.value = 380;
      source.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(filter);
      source.start();
      this.voices.push(source);
      this.nodes.push(noiseGain, noiseFilter);
    }
  }

  pause() {
    if (!this.context || !this.master) return;
    this.master.gain.setTargetAtTime(0.0001, this.context.currentTime, 0.08);
  }
}

export const signal = new SignalEngine();
