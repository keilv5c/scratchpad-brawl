import { clamp } from '../engine/math';

/**
 * Signature "Stationery Foley × Martial Arts" Web Audio API Synthesizer.
 * Zero external audio files — every sound is synthesized live with subtle pitch/filter variation
 * blending tactile paper/pencil/eraser/ruler acoustics with punchy martial arts impact.
 */
export class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private masterFilter: BiquadFilterNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private reverbNode: ConvolverNode | null = null;
  private reverbGain: GainNode | null = null;

  private whiteNoiseBuf: AudioBuffer | null = null;
  private pinkNoiseBuf: AudioBuffer | null = null;

  public muted = false;
  public sfxVolume = 0.85;

  public unlock(): AudioContext | null {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;
      this.ctx = new AudioCtx();
      this.setupGraph();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public getContext(): AudioContext | null {
    return this.ctx;
  }

  public getMasterFilter(): BiquadFilterNode | null {
    return this.masterFilter;
  }

  public getSfxGain(): GainNode | null {
    return this.sfxGain;
  }

  public setMuted(mute: boolean): void {
    this.muted = mute;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(mute ? 0 : 1, this.ctx.currentTime, 0.02);
    }
  }

  public setSfxVolume(vol: number): void {
    this.sfxVolume = clamp(vol, 0, 1);
    if (this.sfxGain && this.ctx) {
      this.sfxGain.gain.setTargetAtTime(this.sfxVolume, this.ctx.currentTime, 0.02);
    }
  }

  /**
   * Anime-style time-stop / slow-mo lowpass ducking on the master bus.
   */
  public setSlowMoFilter(active: boolean): void {
    if (!this.ctx || !this.masterFilter) return;
    const now = this.ctx.currentTime;
    this.masterFilter.frequency.cancelScheduledValues(now);
    if (active) {
      this.masterFilter.frequency.setTargetAtTime(420, now, 0.035);
      this.masterFilter.Q.setTargetAtTime(2.6, now, 0.04);
    } else {
      this.masterFilter.frequency.setTargetAtTime(19500, now, 0.055);
      this.masterFilter.Q.setTargetAtTime(0.7, now, 0.05);
    }
  }

  private setupGraph(): void {
    if (!this.ctx) return;
    const ctx = this.ctx;

    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -10;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 6;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.14;

    this.masterFilter = ctx.createBiquadFilter();
    this.masterFilter.type = 'lowpass';
    this.masterFilter.frequency.value = 19500;
    this.masterFilter.Q.value = 0.7;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = this.muted ? 0 : 1;

    this.sfxGain = ctx.createGain();
    this.sfxGain.gain.value = this.sfxVolume;

    // Short procedural studio-room impulse for metallic parry & clapper resonance
    this.reverbNode = ctx.createConvolver();
    this.reverbNode.buffer = this.createImpulseResponse(ctx, 0.65, 2.8);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.24;

    this.sfxGain.connect(this.masterFilter);
    this.sfxGain.connect(this.reverbNode);
    this.reverbNode.connect(this.reverbGain);
    this.reverbGain.connect(this.masterFilter);

    this.masterFilter.connect(this.compressor);
    this.compressor.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);

    this.buildNoiseBuffers(ctx);
  }

  private createImpulseResponse(ctx: AudioContext, duration: number, decay: number): AudioBuffer {
    const len = Math.floor(ctx.sampleRate * duration);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const env = Math.pow(1 - i / len, decay);
        data[i] = (Math.random() * 2 - 1) * env;
      }
    }
    return buf;
  }

  private buildNoiseBuffers(ctx: AudioContext): void {
    const len = ctx.sampleRate * 2;
    this.whiteNoiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const w = this.whiteNoiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) {
      w[i] = Math.random() * 2 - 1;
    }

    this.pinkNoiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const p = this.pinkNoiseBuf.getChannelData(0);
    let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      p[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
      b6 = white * 0.115926;
    }
  }

  private ready(): { ctx: AudioContext; out: GainNode } | null {
    if (this.muted || !this.ctx || !this.sfxGain || this.ctx.state !== 'running') return null;
    return { ctx: this.ctx, out: this.sfxGain };
  }

  private noiseSource(ctx: AudioContext, pink = true): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = pink ? this.pinkNoiseBuf : this.whiteNoiseBuf;
    src.loop = true;
    return src;
  }

  // ---- UI: Retractable Ballpoint Pen Click & Pencil Checkmark ----

  public playUiClick(): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    // Two-stage spring click ("ka-da")
    [0, 0.032].forEach((offset, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const baseF = idx === 0 ? 1850 : 2450;
      osc.frequency.setValueAtTime(baseF, now + offset);
      osc.frequency.exponentialRampToValueAtTime(340, now + offset + 0.018);

      gain.gain.setValueAtTime(0.001, now + offset);
      gain.gain.linearRampToValueAtTime(idx === 0 ? 0.18 : 0.24, now + offset + 0.002);
      gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.022);

      osc.connect(gain);
      gain.connect(out);
      osc.start(now + offset);
      osc.stop(now + offset + 0.028);
    });
  }

  public playUiSelect(): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;
    // Crisp pencil checkmark scratch + soft woody knock
    const src = this.noiseSource(ctx, true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2200, now);
    bp.frequency.exponentialRampToValueAtTime(4200, now + 0.09);
    bp.Q.value = 3.2;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.28, now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.11);

    src.connect(bp);
    bp.connect(g);
    g.connect(out);
    src.start(now, Math.random() * 1.2, 0.12);
  }

  // ---- Movement Foley: Graphite Paper Footsteps, Skid, Jump, Dash ----

  public playFootstep(intensity = 0.6): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;
    const v = clamp(intensity, 0.2, 1.2);

    const src = this.noiseSource(ctx, true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1600 + Math.random() * 900;
    bp.Q.value = 2.4;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.11 * v, now + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

    src.connect(bp);
    bp.connect(g);
    g.connect(out);
    src.start(now, Math.random(), 0.055);
  }

  public playPaperSkid(): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    const src = this.noiseSource(ctx, true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2800 + Math.random() * 400, now);
    bp.frequency.exponentialRampToValueAtTime(1100, now + 0.14);
    bp.Q.value = 3.6;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.22, now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    src.connect(bp);
    bp.connect(g);
    g.connect(out);
    src.start(now, Math.random(), 0.16);
  }

  public playJump(isWallKick = false): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    // Paper-flick upward sweep
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const startF = isWallKick ? 260 : 175;
    osc.frequency.setValueAtTime(startF, now);
    osc.frequency.exponentialRampToValueAtTime(startF * 2.3, now + 0.09);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(isWallKick ? 0.19 : 0.13, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.11);

    osc.connect(g);
    g.connect(out);
    osc.start(now);
    osc.stop(now + 0.12);

    // Subtle paper rustle
    const src = this.noiseSource(ctx, true);
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.setValueAtTime(1400, now);
    hp.frequency.exponentialRampToValueAtTime(3400, now + 0.08);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.001, now);
    ng.gain.linearRampToValueAtTime(0.14, now + 0.012);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.09);
    src.connect(hp);
    hp.connect(ng);
    ng.connect(out);
    src.start(now, Math.random(), 0.1);
  }

  public playDash(): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    // Sharp page-flick air tear + quick graphite streak
    const src = this.noiseSource(ctx, false);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(3800, now);
    bp.frequency.exponentialRampToValueAtTime(620, now + 0.14);
    bp.Q.value = 1.6;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.28, now + 0.014);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

    src.connect(bp);
    bp.connect(g);
    g.connect(out);
    src.start(now, Math.random(), 0.16);
  }

  public playPerfectDodge(): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    // Silky time-warp pitch bend + airy shimmer
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(740, now);
    osc.frequency.exponentialRampToValueAtTime(240, now + 0.22);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.24, now + 0.018);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

    osc.connect(g);
    g.connect(out);
    osc.start(now);
    osc.stop(now + 0.26);

    // High crystalline pencil glint
    const osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(1980, now);
    osc2.frequency.exponentialRampToValueAtTime(2840, now + 0.16);
    const g2 = ctx.createGain();
    g2.gain.setValueAtTime(0.001, now);
    g2.gain.linearRampToValueAtTime(0.12, now + 0.012);
    g2.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc2.connect(g2);
    g2.connect(out);
    osc2.start(now);
    osc2.stop(now + 0.19);
  }

  // ---- Combat Foley: Brush Whoosh, Frantic Pencil Charge, Layered Hit, Nib Parry ----

  public playWhoosh(weight = 0.7): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;
    const w = clamp(weight, 0.3, 1.5);
    const dur = 0.11 + w * 0.11;

    // Layer 1: Ink brush bristle sweeping across paper
    const src = this.noiseSource(ctx, true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    const startFreq = (3200 / w) * (0.9 + Math.random() * 0.2);
    const endFreq = (480 / w) * (0.9 + Math.random() * 0.2);
    bp.frequency.setValueAtTime(clamp(startFreq, 600, 6500), now);
    bp.frequency.exponentialRampToValueAtTime(clamp(endFreq, 180, 1400), now + dur);
    bp.Q.value = 2.1;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.32 + w * 0.08, now + dur * 0.25);
    g.gain.exponentialRampToValueAtTime(0.001, now + dur);

    src.connect(bp);
    bp.connect(g);
    g.connect(out);
    src.start(now, Math.random(), dur + 0.02);

    // Layer 2: Blade air whistle
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(620 / w, now);
    osc.frequency.exponentialRampToValueAtTime(140 / w, now + dur * 0.85);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.001, now);
    og.gain.linearRampToValueAtTime(0.11 * Math.min(1.2, w), now + dur * 0.2);
    og.gain.exponentialRampToValueAtTime(0.001, now + dur * 0.9);
    osc.connect(og);
    og.connect(out);
    osc.start(now);
    osc.stop(now + dur);
  }

  /**
   * Rapid graphite scribbling sound while holding Heavy Charge!
   */
  public playChargeScribble(progress: number): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;
    const p = clamp(progress, 0, 1);

    const src = this.noiseSource(ctx, true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1700 + p * 2600 + (Math.random() - 0.5) * 400;
    bp.Q.value = 4.5;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.16 + p * 0.14, now + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.065);

    src.connect(bp);
    bp.connect(g);
    g.connect(out);
    src.start(now, Math.random(), 0.075);

    if (p >= 0.98) {
      // Pen-tip full charge ping!
      const ping = ctx.createOscillator();
      ping.type = 'triangle';
      ping.frequency.setValueAtTime(1480, now);
      ping.frequency.exponentialRampToValueAtTime(2220, now + 0.08);
      const pg = ctx.createGain();
      pg.gain.setValueAtTime(0.001, now);
      pg.gain.linearRampToValueAtTime(0.18, now + 0.008);
      pg.gain.exponentialRampToValueAtTime(0.001, now + 0.14);
      ping.connect(pg);
      pg.connect(out);
      ping.start(now);
      ping.stop(now + 0.15);
    }
  }

  public playHit(damage: number, isHeavy: boolean, isGuardBreak = false): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;
    const power = clamp(damage / 18, 0.45, 1.8);

    // Layer 1: Deep martial-arts Sub-Bass Thump
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime((isHeavy ? 155 : 135) * (0.94 + Math.random() * 0.12), now);
    sub.frequency.exponentialRampToValueAtTime(34, now + (isHeavy ? 0.18 : 0.11));

    const subG = ctx.createGain();
    subG.gain.setValueAtTime(0.001, now);
    subG.gain.linearRampToValueAtTime(Math.min(0.65, 0.36 * power), now + 0.005);
    subG.gain.exponentialRampToValueAtTime(0.001, now + (isHeavy ? 0.21 : 0.13));

    sub.connect(subG);
    subG.connect(out);
    sub.start(now);
    sub.stop(now + 0.23);

    // Layer 2: Crisp Paper-Slap / Ink-Splatter Snap transient
    const crack = this.noiseSource(ctx, false);
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.setValueAtTime(isHeavy ? 2100 : 2900, now);
    hp.Q.value = 1.2;

    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.001, now);
    cg.gain.linearRampToValueAtTime(Math.min(0.5, 0.28 * power), now + 0.003);
    cg.gain.exponentialRampToValueAtTime(0.001, now + (isHeavy ? 0.11 : 0.065));

    crack.connect(hp);
    hp.connect(cg);
    cg.connect(out);
    crack.start(now, Math.random(), 0.13);

    // Layer 3: Guard Break paper-shatter & ruler snap!
    if (isGuardBreak) {
      const snap = ctx.createOscillator();
      snap.type = 'sawtooth';
      snap.frequency.setValueAtTime(620, now);
      snap.frequency.exponentialRampToValueAtTime(95, now + 0.22);
      const sf = ctx.createBiquadFilter();
      sf.type = 'bandpass';
      sf.frequency.value = 950;
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0.32, now);
      sg.gain.exponentialRampToValueAtTime(0.001, now + 0.24);
      snap.connect(sf);
      sf.connect(sg);
      sg.connect(out);
      snap.start(now);
      snap.stop(now + 0.25);
    }
  }

  public playBlock(): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    // Thick hardcover sketchbook thud + dry pencil tap
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(260, now);
    osc.frequency.exponentialRampToValueAtTime(95, now + 0.075);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.32, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.085);

    osc.connect(g);
    g.connect(out);
    osc.start(now);
    osc.stop(now + 0.09);

    const tap = ctx.createOscillator();
    tap.type = 'square';
    tap.frequency.setValueAtTime(920, now);
    tap.frequency.exponentialRampToValueAtTime(420, now + 0.03);
    const tg = ctx.createGain();
    tg.gain.setValueAtTime(0.11, now);
    tg.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
    tap.connect(tg);
    tg.connect(out);
    tap.start(now);
    tap.stop(now + 0.04);
  }

  /**
   * ICONIC SIGNATURE SOUND: Metallic Steel Pen-Nib / Draftsman's Ruler Parry Clink ("铛——!")
   */
  public playParry(): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;
    const base = 1140 + (Math.random() - 0.5) * 90;

    // FM metallic clang
    const carrier = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    const cGain = ctx.createGain();

    carrier.type = 'sine';
    carrier.frequency.setValueAtTime(base, now);
    carrier.frequency.exponentialRampToValueAtTime(base * 1.045, now + 0.06);
    carrier.frequency.exponentialRampToValueAtTime(base * 0.99, now + 0.55);

    mod.type = 'sine';
    mod.frequency.setValueAtTime(base * 2.756, now); // Inharmonic steel partial
    modGain.gain.setValueAtTime(base * 1.9, now);
    modGain.gain.exponentialRampToValueAtTime(40, now + 0.35);

    cGain.gain.setValueAtTime(0.001, now);
    cGain.gain.linearRampToValueAtTime(0.42, now + 0.003);
    cGain.gain.exponentialRampToValueAtTime(0.001, now + 0.62);

    mod.connect(modGain);
    modGain.connect(carrier.frequency);
    carrier.connect(cGain);
    cGain.connect(out);

    carrier.start(now);
    mod.start(now);
    carrier.stop(now + 0.65);
    mod.stop(now + 0.65);

    // Bright upper ring partial ("ting!")
    const ring = ctx.createOscillator();
    ring.type = 'sine';
    ring.frequency.setValueAtTime(base * 2.38, now);
    const rg = ctx.createGain();
    rg.gain.setValueAtTime(0.001, now);
    rg.gain.linearRampToValueAtTime(0.22, now + 0.002);
    rg.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
    ring.connect(rg);
    rg.connect(out);
    ring.start(now);
    ring.stop(now + 0.5);

    // Crisp transient spark burst
    const spark = this.noiseSource(ctx, false);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 4500;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.28, now);
    sg.gain.exponentialRampToValueAtTime(0.001, now + 0.045);
    spark.connect(hp);
    hp.connect(sg);
    sg.connect(out);
    spark.start(now, Math.random(), 0.055);
  }

  public playClash(): void {
    this.playParry();
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;
    // Extra lower blade-grind scrape
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(680, now);
    osc.frequency.exponentialRampToValueAtTime(1420, now + 0.14);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1800;
    bp.Q.value = 5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.22, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
    osc.connect(bp);
    bp.connect(g);
    g.connect(out);
    osc.start(now);
    osc.stop(now + 0.19);
  }

  // ---- Signature Stationery World Foley ----

  /**
   * Rapid 4-stroke pencil sketch sound when a weapon or bridge plank is drawn onto the page!
   */
  public playPencilSketch(): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    const strokes = [0, 0.065, 0.13, 0.2];
    strokes.forEach((t, i) => {
      const src = this.noiseSource(ctx, true);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1900 + i * 380, now + t);
      bp.frequency.exponentialRampToValueAtTime(3600 + i * 250, now + t + 0.05);
      bp.Q.value = 3.8;

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, now + t);
      g.gain.linearRampToValueAtTime(0.26, now + t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, now + t + 0.055);

      src.connect(bp);
      bp.connect(g);
      g.connect(out);
      src.start(now + t, Math.random(), 0.065);
    });
  }

  /**
   * Rubber eraser scraping across paper!
   */
  public playEraserRub(): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    [0, 0.11, 0.22].forEach((offset) => {
      const src = this.noiseSource(ctx, true);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(680, now + offset);
      bp.frequency.linearRampToValueAtTime(1180, now + offset + 0.09);
      bp.Q.value = 5.5;

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, now + offset);
      g.gain.linearRampToValueAtTime(0.32, now + offset + 0.025);
      g.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.1);

      src.connect(bp);
      bp.connect(g);
      g.connect(out);
      src.start(now + offset, Math.random(), 0.11);
    });
  }

  /**
   * Visceral paper rip sound on KO / Ink Finisher!
   */
  public playPaperTear(): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    const src = this.noiseSource(ctx, false);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1600, now);
    bp.frequency.exponentialRampToValueAtTime(4800, now + 0.12);
    bp.frequency.exponentialRampToValueAtTime(950, now + 0.34);
    bp.Q.value = 1.9;

    // Rapid flutter LFO simulating paper fibers tearing
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 46;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.14;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.42, now + 0.025);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.36);

    lfo.connect(lfoGain);
    lfoGain.connect(g.gain);

    src.connect(bp);
    bp.connect(g);
    g.connect(out);

    src.start(now, Math.random(), 0.38);
    lfo.start(now);
    lfo.stop(now + 0.38);
  }

  /**
   * Thick sketchbook page turn between rounds!
   */
  public playPageFlip(): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    const src = this.noiseSource(ctx, true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(900, now);
    bp.frequency.exponentialRampToValueAtTime(3200, now + 0.14);
    bp.frequency.exponentialRampToValueAtTime(600, now + 0.32);
    bp.Q.value = 1.4;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.36, now + 0.09);
    g.gain.linearRampToValueAtTime(0.18, now + 0.22);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.36);

    src.connect(bp);
    bp.connect(g);
    g.connect(out);
    src.start(now, Math.random(), 0.38);
  }

  /**
   * Heavy wooden seal stamp slamming onto the paper ("K.O." / "完胜")!
   */
  public playStamp(): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(170, now);
    osc.frequency.exponentialRampToValueAtTime(38, now + 0.22);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.58, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.26);

    osc.connect(g);
    g.connect(out);
    osc.start(now);
    osc.stop(now + 0.27);

    // Dry paper seal slap
    const src = this.noiseSource(ctx, true);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1900;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.38, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.07);
    src.connect(lp);
    lp.connect(ng);
    ng.connect(out);
    src.start(now, Math.random(), 0.08);
  }

  /**
   * Dramatic Ink Super activation: Kabuki wooden clapper (拍板) + deep time-freeze bass drop!
   */
  public playSuperActivate(): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    // 1. Sharp wooden hyoshigi clapper snap
    [0, 0.075].forEach((offset, idx) => {
      const clack = ctx.createOscillator();
      clack.type = 'triangle';
      clack.frequency.setValueAtTime(idx === 0 ? 1580 : 1760, now + offset);
      clack.frequency.exponentialRampToValueAtTime(640, now + offset + 0.045);
      const cg = ctx.createGain();
      cg.gain.setValueAtTime(0.36, now + offset);
      cg.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.07);
      clack.connect(cg);
      cg.connect(out);
      clack.start(now + offset);
      clack.stop(now + offset + 0.08);
    });

    // 2. Massive ink bass dive
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(120, now + 0.05);
    sub.frequency.exponentialRampToValueAtTime(28, now + 0.55);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.001, now + 0.05);
    sg.gain.linearRampToValueAtTime(0.55, now + 0.08);
    sg.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    sub.connect(sg);
    sg.connect(out);
    sub.start(now + 0.05);
    sub.stop(now + 0.62);
  }

  public playCrateBreak(): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    // Hollow sketched-box crunch
    [0, 0.035, 0.07].forEach((t, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(340 - i * 65, now + t);
      osc.frequency.exponentialRampToValueAtTime(80, now + t + 0.06);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.24, now + t);
      g.gain.exponentialRampToValueAtTime(0.001, now + t + 0.065);
      osc.connect(g);
      g.connect(out);
      osc.start(now + t);
      osc.stop(now + t + 0.07);
    });
  }

  public playShurikenThrow(): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(2400, now);
    osc.frequency.exponentialRampToValueAtTime(880, now + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.18, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.connect(g);
    g.connect(out);
    osc.start(now);
    osc.stop(now + 0.11);
  }

  /**
   * Metallic paperclip chain whip crack!
   */
  public playWhipCrack(): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    // Fast whip sweep
    const src = this.noiseSource(ctx, false);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1100, now);
    bp.frequency.exponentialRampToValueAtTime(5200, now + 0.085);
    bp.Q.value = 2.6;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.45, now + 0.072);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.12);
    src.connect(bp);
    bp.connect(g);
    g.connect(out);
    src.start(now, Math.random(), 0.14);

    // Tiny metal paperclip jingle at snap end
    const jingle = ctx.createOscillator();
    jingle.type = 'triangle';
    jingle.frequency.setValueAtTime(2880, now + 0.068);
    jingle.frequency.exponentialRampToValueAtTime(1820, now + 0.14);
    const jg = ctx.createGain();
    jg.gain.setValueAtTime(0.18, now + 0.068);
    jg.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    jingle.connect(jg);
    jg.connect(out);
    jingle.start(now + 0.068);
    jingle.stop(now + 0.16);
  }

  /**
   * Whirring plastic draftsman set-square boomerang spin!
   */
  public playBoomerangSpin(): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(340, now);
    osc.frequency.linearRampToValueAtTime(560, now + 0.09);
    osc.frequency.linearRampToValueAtTime(320, now + 0.18);

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 24;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.14;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.2, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    lfo.connect(lfoG);
    lfoG.connect(g.gain);
    osc.connect(g);
    g.connect(out);
    osc.start(now);
    lfo.start(now);
    osc.stop(now + 0.23);
    lfo.stop(now + 0.23);
  }

  /**
   * Electric sketched ink lightning bolt strike!
   */
  public playInkLightning(): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    const src = this.noiseSource(ctx, false);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2200;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.42, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    src.connect(hp);
    hp.connect(g);
    g.connect(out);
    src.start(now, Math.random(), 0.24);

    const sub = ctx.createOscillator();
    sub.type = 'sawtooth';
    sub.frequency.setValueAtTime(240, now);
    sub.frequency.exponentialRampToValueAtTime(42, now + 0.24);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 720;
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.32, now);
    sg.gain.exponentialRampToValueAtTime(0.001, now + 0.26);
    sub.connect(lp);
    lp.connect(sg);
    sg.connect(out);
    sub.start(now);
    sub.stop(now + 0.28);
  }

  /**
   * Heavy desk stapler slam!
   */
  public playStaplerSlam(): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    // Metallic ker-chunk
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(480, now);
    osc.frequency.exponentialRampToValueAtTime(75, now + 0.14);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.36, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.16);
    osc.connect(lp);
    lp.connect(g);
    g.connect(out);
    osc.start(now);
    osc.stop(now + 0.17);
  }

  /**
   * Sticker peel-and-stick sound for Roguelike buff selection!
   */
  public playStickerPick(): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    [523.25, 659.25, 783.99].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(freq, now + i * 0.055);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.001, now + i * 0.055);
      g.gain.linearRampToValueAtTime(0.22, now + i * 0.055 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, now + i * 0.055 + 0.22);
      osc.connect(g);
      g.connect(out);
      osc.start(now + i * 0.055);
      osc.stop(now + i * 0.055 + 0.24);
    });
  }

  /**
   * Ascending eastern chime when Stylish Rank levels up (甲 / 宗师 / 画圣!)
   */
  public playRankUp(highTier: boolean): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;
    const notes = highTier ? [587.33, 880, 1174.66] : [440, 587.33];
    notes.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(f, now + idx * 0.05);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.16, now + idx * 0.05);
      g.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.05 + 0.28);
      osc.connect(g);
      g.connect(out);
      osc.start(now + idx * 0.05);
      osc.stop(now + idx * 0.05 + 0.3);
    });
  }

  /**
   * Springy rubber-eraser bounce pad ("Duang!!")
   */
  public playBouncePad(): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(145, now);
    osc.frequency.exponentialRampToValueAtTime(580, now + 0.14);
    osc.frequency.exponentialRampToValueAtTime(340, now + 0.26);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.36, now + 0.015);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    osc.connect(g);
    g.connect(out);
    osc.start(now);
    osc.stop(now + 0.3);
  }

  /**
   * Airy updraft canyon wind gust!
   */
  public playWindGust(): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    const src = this.noiseSource(ctx, true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(520, now);
    bp.frequency.exponentialRampToValueAtTime(1650, now + 0.25);
    bp.Q.value = 2.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.18, now + 0.06);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

    src.connect(bp);
    bp.connect(g);
    g.connect(out);
    src.start(now, Math.random(), 0.3);
  }

  /**
   * Correction Tape internal plastic gear rattle ("ka-ka-ka-ka"!)
   */
  public playTapeWheel(): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    for (let i = 0; i < 5; i++) {
      const t = now + i * 0.026;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.setValueAtTime(1400 + i * 110, t);
      osc.frequency.exponentialRampToValueAtTime(520, t + 0.018);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1800;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.14, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.02);
      osc.connect(bp);
      bp.connect(g);
      g.connect(out);
      osc.start(t);
      osc.stop(t + 0.024);
    }
  }

  /**
   * Drafting Compass metal hinge click + sharp steel needle scratching paper!
   */
  public playCompassScratch(): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    const click = ctx.createOscillator();
    click.type = 'triangle';
    click.frequency.setValueAtTime(2400, now);
    click.frequency.exponentialRampToValueAtTime(1100, now + 0.03);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(0.18, now);
    cg.gain.exponentialRampToValueAtTime(0.001, now + 0.035);
    click.connect(cg);
    cg.connect(out);
    click.start(now);
    click.stop(now + 0.04);

    const src = this.noiseSource(ctx, false);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(3400, now);
    bp.frequency.exponentialRampToValueAtTime(5200, now + 0.14);
    bp.Q.value = 6.5;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.001, now);
    ng.gain.linearRampToValueAtTime(0.18, now + 0.02);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    src.connect(bp);
    bp.connect(ng);
    ng.connect(out);
    src.start(now, Math.random(), 0.17);
  }

  /**
   * Iconic steel ruler vibrating on a desk edge ("boing-wobble"!)
   */
  public playRulerTwang(): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(165, now);
    osc.frequency.exponentialRampToValueAtTime(235, now + 0.22);

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 32;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 28;
    lfo.connect(lfoG);
    lfoG.connect(osc.frequency);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1400, now);
    lp.frequency.exponentialRampToValueAtTime(420, now + 0.28);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.24, now);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

    osc.connect(lp);
    lp.connect(g);
    g.connect(out);
    osc.start(now);
    lfo.start(now);
    osc.stop(now + 0.32);
    lfo.stop(now + 0.32);
  }

  /**
   * Utility Knife ratchet blade push ("ka-ka-ka"!)
   */
  public playCutterClick(): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    [0, 0.028, 0.056].forEach((off, idx) => {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(2600 + idx * 320, now + off);
      osc.frequency.exponentialRampToValueAtTime(980, now + off + 0.016);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.16, now + off);
      g.gain.exponentialRampToValueAtTime(0.001, now + off + 0.02);
      osc.connect(g);
      g.connect(out);
      osc.start(now + off);
      osc.stop(now + off + 0.025);
    });
  }

  /**
   * Mechanical pencil top knock button ("ka-da")
   */
  public playPencilClick(): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;
    [0, 0.036].forEach((off, idx) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(idx === 0 ? 1900 : 2750, now + off);
      osc.frequency.exponentialRampToValueAtTime(620, now + off + 0.02);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.2, now + off);
      g.gain.exponentialRampToValueAtTime(0.001, now + off + 0.025);
      osc.connect(g);
      g.connect(out);
      osc.start(now + off);
      osc.stop(now + off + 0.03);
    });
  }

  /**
   * Craft Scissors crisp metallic snip ("ka-cha!!")
   */
  public playScissorsSnip(): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    const src = this.noiseSource(ctx, false);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(2600, now);
    bp.frequency.exponentialRampToValueAtTime(6400, now + 0.09);
    bp.Q.value = 4.2;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, now);
    g.gain.linearRampToValueAtTime(0.32, now + 0.055);
    g.gain.exponentialRampToValueAtTime(0.001, now + 0.11);
    src.connect(bp);
    bp.connect(g);
    g.connect(out);
    src.start(now, Math.random(), 0.13);

    // Final metallic blade close snap!
    const snap = ctx.createOscillator();
    snap.type = 'triangle';
    snap.frequency.setValueAtTime(3200, now + 0.065);
    snap.frequency.exponentialRampToValueAtTime(1450, now + 0.12);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.24, now + 0.065);
    sg.gain.exponentialRampToValueAtTime(0.001, now + 0.13);
    snap.connect(sg);
    sg.connect(out);
    snap.start(now + 0.065);
    snap.stop(now + 0.14);
  }

  /**
   * Fountain Pen wet ink-blob bomb splash!
   */
  public playInkSplashBomb(): void {
    const r = this.ready();
    if (!r) return;
    const { ctx, out } = r;
    const now = ctx.currentTime;

    const bloop = ctx.createOscillator();
    bloop.type = 'sine';
    bloop.frequency.setValueAtTime(280, now);
    bloop.frequency.exponentialRampToValueAtTime(85, now + 0.16);
    const bg = ctx.createGain();
    bg.gain.setValueAtTime(0.38, now);
    bg.gain.exponentialRampToValueAtTime(0.001, now + 0.19);
    bloop.connect(bg);
    bg.connect(out);
    bloop.start(now);
    bloop.stop(now + 0.2);

    const src = this.noiseSource(ctx, true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1800, now);
    bp.frequency.exponentialRampToValueAtTime(620, now + 0.18);
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.3, now);
    ng.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    src.connect(bp);
    bp.connect(ng);
    ng.connect(out);
    src.start(now, Math.random(), 0.22);
  }
}
