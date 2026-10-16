/** Procedural sound effects and gnome voices (no asset files needed). */
export class Sound {
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;
  private lx = 0;
  private lz = 0;
  private lyaw = 0;
  private lastTaunt = 0;
  private voiceCache: SpeechSynthesisVoice | null | undefined;
  tauntsOn = true;

  init() {
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        const len = Math.floor(this.ctx.sampleRate * 0.4);
        this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
        const d = this.noise.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  /** Tell the mixer where the listener is, so sounds can be panned and attenuated. */
  setListener(x: number, z: number, yaw: number) {
    this.lx = x;
    this.lz = z;
    this.lyaw = yaw;
  }

  /** Volume (0..1) and stereo pan (-1..1) for a sound at world position (x, z). */
  spatial(x: number, z: number): { vol: number; pan: number } {
    const dx = x - this.lx;
    const dz = z - this.lz;
    const dist = Math.hypot(dx, dz);
    const vol = Math.max(0, Math.min(1, 1 - dist / 55));
    // listener's right vector for yaw: (cos, -sin)
    const pan = dist < 0.5 ? 0 : Math.max(-1, Math.min(1, (dx * Math.cos(this.lyaw) - dz * Math.sin(this.lyaw)) / dist));
    return { vol, pan };
  }

  /** gain -> optional panner -> speakers. Returns the node to feed audio into. */
  private out(vol: number, pan: number): { input: AudioNode; gain: GainNode } | null {
    if (!this.ctx) return null;
    const g = this.ctx.createGain();
    g.gain.value = vol;
    if (pan !== 0 && typeof this.ctx.createStereoPanner === 'function') {
      const p = this.ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p).connect(this.ctx.destination);
    } else {
      g.connect(this.ctx.destination);
    }
    return { input: g, gain: g };
  }

  private burst(vol: number, cutoff: number, decay: number, pan = 0) {
    if (!this.ctx || !this.noise) return;
    const t = this.ctx.currentTime;
    const o = this.out(vol, pan);
    if (!o) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(cutoff, t);
    f.frequency.exponentialRampToValueAtTime(200, t + decay);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(1, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + decay);
    src.connect(f).connect(env).connect(o.input);
    src.start(t);
    src.stop(t + decay + 0.05);
  }

  private tone(vol: number, f0: number, f1: number, dur: number, type: OscillatorType = 'sine', pan = 0, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.out(vol, pan);
    if (!o) return;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(1, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(env).connect(o.input);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  shot(vol = 1, pan = 0, heavy = false) {
    if (heavy) {
      this.burst(0.8 * vol, 2600, 0.3, pan);
      this.tone(0.5 * vol, 100, 30, 0.2, 'sine', pan);
      return;
    }
    this.burst(0.5 * vol, 4000, 0.16, pan);
    this.tone(0.35 * vol, 140, 40, 0.12, 'sine', pan);
  }
  /** Something solid breaking apart. */
  crash(vol = 1, pan = 0) {
    this.burst(0.7 * vol, 1500, 0.45, pan);
    this.tone(0.4 * vol, 90, 35, 0.3, 'sine', pan);
  }
  boom(vol = 1, pan = 0) {
    this.burst(1.0 * vol, 1800, 0.8, pan);
    this.tone(0.8 * vol, 70, 25, 0.5, 'sine', pan);
  }
  smokePop(vol = 1, pan = 0) {
    this.burst(0.5 * vol, 900, 0.9, pan);
    this.tone(0.25 * vol, 200, 90, 0.2, 'sine', pan);
  }
  whoosh(vol = 0.5) {
    this.tone(0.12 * vol, 300, 700, 0.15, 'sawtooth');
  }
  hit(head = false) {
    this.tone(0.25, head ? 1400 : 800, head ? 900 : 500, 0.07, 'square');
  }
  hurt() {
    this.tone(0.5, 90, 40, 0.25);
  }
  reload() {
    this.tone(0.15, 500, 300, 0.05, 'square');
    setTimeout(() => this.tone(0.15, 700, 500, 0.05, 'square'), 900);
  }
  empty() {
    this.tone(0.12, 300, 250, 0.04, 'square');
  }

  // --- gnome voices ----------------------------------------------------------

  /** A gnome got shot: short indignant squeak. `p` is the gnome's voice pitch (~1.5-2). */
  gnomeHit(vol: number, pan: number, p = 1.8, rasp = false) {
    if (vol < 0.03) return;
    const base = 420 * p;
    if (rasp) {
      // goblins grunt: low, buzzy, with a bit of breath
      this.tone(0.26 * vol, base, base * 0.6, 0.11, 'square', pan);
      this.burst(0.12 * vol, 1400, 0.09, pan);
      return;
    }
    this.tone(0.22 * vol, base, base * 1.7, 0.09, 'sawtooth', pan);
    this.tone(0.14 * vol, base * 1.5, base * 0.9, 0.07, 'square', pan, 0.05);
  }

  /** A gnome died: long falling wail with a wobble, then a soft thud. */
  gnomeDeath(vol: number, pan: number, p = 1.8, rasp = false) {
    if (vol < 0.03 || !this.ctx) return;
    if (rasp) this.burst(0.25 * vol, 1100, 0.5, pan);
    const t = this.ctx.currentTime;
    const o = this.out(0.3 * vol, pan);
    if (!o) return;
    const osc = this.ctx.createOscillator();
    osc.type = rasp ? 'square' : 'sawtooth';
    osc.frequency.setValueAtTime(620 * p, t);
    osc.frequency.exponentialRampToValueAtTime(110, t + 0.7);
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 11;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 40;
    lfo.connect(lfoGain).connect(osc.frequency);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 1100;
    f.Q.value = 1.5;
    const env = this.ctx.createGain();
    env.gain.setValueAtTime(1, t);
    env.gain.exponentialRampToValueAtTime(0.001, t + 0.75);
    osc.connect(f).connect(env).connect(o.input);
    osc.start(t);
    lfo.start(t);
    osc.stop(t + 0.8);
    lfo.stop(t + 0.8);
    this.tone(0.3 * vol, 90, 35, 0.2, 'sine', pan, 0.6);
  }

  private voice(): SpeechSynthesisVoice | null {
    if (this.voiceCache !== undefined) return this.voiceCache;
    const vs = window.speechSynthesis.getVoices();
    if (!vs.length) return null; // not loaded yet; try again next time
    this.voiceCache = vs.find((v) => v.lang.toLowerCase().startsWith('en')) ?? null;
    return this.voiceCache;
  }

  /** Speak a line in a squeaky voice (browser speech synthesis), or babble if that isn't available. */
  taunt(text: string, vol: number, pan: number, p = 1.8) {
    if (!this.tauntsOn || vol < 0.12) return;
    const now = performance.now();
    if (now - this.lastTaunt < 2500) return;
    const ss = typeof window !== 'undefined' ? window.speechSynthesis : undefined;
    if (ss && typeof SpeechSynthesisUtterance !== 'undefined') {
      if (ss.speaking || ss.pending) return;
      this.lastTaunt = now;
      const u = new SpeechSynthesisUtterance(text);
      u.pitch = Math.min(2, p);
      u.rate = p < 1 ? 0.95 : 1.15; // goblins drawl, gnomes chatter
      u.volume = Math.min(1, vol);
      const v = this.voice();
      if (v) u.voice = v;
      ss.speak(u);
      return;
    }
    this.lastTaunt = now;
    for (let i = 0; i < 4; i++) {
      const f = (400 + Math.random() * 500) * p;
      this.tone(0.14 * vol, f, f * (0.8 + Math.random() * 0.6), 0.07, 'square', pan, i * 0.09);
    }
  }

  stopTaunts() {
    try { window.speechSynthesis?.cancel(); } catch { /* ignore */ }
  }
}
