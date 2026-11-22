import { SoundEngine } from '../audio/soundEngine';

const PHI = 1.61803398875;

/**
 * Pure Web Audio Mathematical Synthesizer SFX for Geometry Brawl!
 * Routes cleanly through SoundEngine's master compressor, slow-mo filter, volume & mute controls.
 */
export class MathSynth {
  private sound: SoundEngine;

  constructor(sound: SoundEngine) {
    this.sound = sound;
  }

  private getBus(): { ctx: AudioContext; out: AudioNode } | null {
    if (this.sound.muted) return null;
    const ctx = this.sound.getContext();
    const out = this.sound.getSfxGain();
    if (!ctx || !out || ctx.state !== 'running') return null;
    return { ctx, out };
  }

  private tone(
    ctx: AudioContext,
    out: AudioNode,
    type: OscillatorType,
    fStart: number,
    fEnd: number,
    startOffset: number,
    dur: number,
    vol: number
  ): void {
    const t0 = ctx.currentTime + startOffset;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(40, fStart), t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(40, fEnd), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g);
    g.connect(out);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  public playOperatorPickup(): void {
    const bus = this.getBus();
    if (!bus) return;
    this.tone(bus.ctx, bus.out, 'sine', 660, 880, 0, 0.11, 0.16);
    this.tone(bus.ctx, bus.out, 'triangle', 990, 1320, 0.05, 0.14, 0.13);
  }

  public playSineBeam(): void {
    const bus = this.getBus();
    if (!bus) return;
    this.tone(bus.ctx, bus.out, 'sine', 380, 920, 0, 0.24, 0.2);
    this.tone(bus.ctx, bus.out, 'triangle', 760, 440, 0.04, 0.22, 0.1);
  }

  public playGoldenChime(step = 0): void {
    const bus = this.getBus();
    if (!bus) return;
    // Tuned literally by the Golden Ratio φ = 1.618!
    const base = 320 * Math.pow(1.18, step);
    this.tone(bus.ctx, bus.out, 'sine', base, base * 1.03, 0, 0.22, 0.16);
    this.tone(bus.ctx, bus.out, 'triangle', base * PHI, base * PHI * 1.02, 0.035, 0.24, 0.12);
    this.tone(bus.ctx, bus.out, 'sine', base * PHI * PHI, base * PHI * PHI, 0.07, 0.26, 0.08);
  }

  public playEulerChord(isSuper = false): void {
    const bus = this.getBus();
    if (!bus) return;
    const freqs = isSuper ? [261.6, 329.6, 392.0, 523.3, 659.3] : [330, 440, 659.3];
    freqs.forEach((f, idx) => {
      this.tone(
        bus.ctx,
        bus.out,
        idx % 2 === 0 ? 'sine' : 'triangle',
        f,
        f * (isSuper ? 1.015 : 0.99),
        idx * (isSuper ? 0.045 : 0.025),
        isSuper ? 0.58 : 0.24,
        isSuper ? 0.12 : 0.11
      );
    });
  }

  public playDerivativeSlash(degreeLeft: number): void {
    const bus = this.getBus();
    if (!bus) return;
    const f0 = 720 - (3 - Math.max(0, degreeLeft)) * 120;
    this.tone(bus.ctx, bus.out, 'sawtooth', f0, Math.max(120, f0 * 0.45), 0, 0.14, 0.1);
    if (degreeLeft <= 0) {
      // Zero-collapse burst!
      this.tone(bus.ctx, bus.out, 'sine', 180, 62, 0, 0.34, 0.24);
      this.tone(bus.ctx, bus.out, 'triangle', 1040, 260, 0.02, 0.26, 0.14);
    }
  }

  public playIntegralSlam(): void {
    const bus = this.getBus();
    if (!bus) return;
    // Rising Riemann slice steps + bass area crush!
    [260, 330, 415, 520].forEach((f, i) => {
      this.tone(bus.ctx, bus.out, 'triangle', f, f * 1.05, i * 0.03, 0.09, 0.09);
    });
    this.tone(bus.ctx, bus.out, 'sine', 165, 52, 0.08, 0.32, 0.26);
  }

  public playSplitPop(depth = 0): void {
    const bus = this.getBus();
    if (!bus) return;
    const f = 520 * Math.pow(1.25, depth);
    this.tone(bus.ctx, bus.out, 'square', f, f * 1.45, 0, 0.09, 0.075);
  }

  public playSingularityWarp(): void {
    const bus = this.getBus();
    if (!bus) return;
    this.tone(bus.ctx, bus.out, 'sine', 240, 48, 0, 0.55, 0.28);
    this.tone(bus.ctx, bus.out, 'sawtooth', 140, 64, 0.04, 0.48, 0.11);
    this.tone(bus.ctx, bus.out, 'sine', 880, 220, 0.1, 0.42, 0.09);
  }

  public playTesseractPulse(): void {
    const bus = this.getBus();
    if (!bus) return;
    [440, 554.4, 659.3, 880, 1108.7].forEach((f, i) => {
      this.tone(bus.ctx, bus.out, 'sine', f, f * 1.01, i * 0.04, 0.34, 0.11);
    });
  }

  public playPhaseDash(): void {
    const bus = this.getBus();
    if (!bus) return;
    // Crisp 90-degree imaginary axis phase shift
    this.tone(bus.ctx, bus.out, 'sine', 540, 1280, 0, 0.12, 0.14);
  }

  public playIdentityTrigger(): void {
    const bus = this.getBus();
    if (!bus) return;
    [392, 493.9, 587.3, 784, 987.8].forEach((f, i) => {
      this.tone(bus.ctx, bus.out, 'triangle', f, f * 1.02, i * 0.04, 0.44, 0.13);
    });
  }
}
