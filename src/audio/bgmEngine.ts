import { BgmPlayMode, BgmTrackId } from '../types';
import { SoundEngine } from './soundEngine';

export interface BgmTrackMeta {
  id: BgmTrackId;
  name: string;
  enName: string;
  style: string;
  bpm: number;
  desc: string;
  scaleHz: number[];
  motifA: number[];
  motifB: number[];
  bassLine: number[];
  leadWave: 'plucked' | 'flute' | 'square' | 'shamisen' | 'arp' | 'organ';
  drumStyle: 'standard' | 'zen' | 'rock' | 'storm' | 'musou' | 'boss';
}

export const BGM_TRACKS: Record<BgmTrackId, BgmTrackMeta> = {
  calligraphy: {
    id: 'calligraphy',
    name: '《笔走龙蛇》',
    enName: 'Calligraphy Duel',
    style: '东方武侠 · D小调五声',
    bpm: 124,
    desc: '经典桌面敲击鼓点 + 圆珠笔踩镲 + 直尺贝斯 + 五声音阶拨弦',
    scaleHz: [146.83, 174.61, 196.0, 220.0, 261.63, 293.66, 349.23, 392.0, 440.0, 523.25, 587.33],
    motifA: [5, -1, 7, 8, -1, 7, 5, -1, 3, -1, 5, 7, 8, -1, 10, -1],
    motifB: [8, -1, 7, 5, 3, -1, 5, -1, 7, 8, -1, 10, 8, 7, 5, -1],
    bassLine: [0, -1, -1, 0, -1, -1, 2, -1, 3, -1, -1, 2, 0, -1, 3, -1],
    leadWave: 'plucked',
    drumStyle: 'standard',
  },
  bamboo_zen: {
    id: 'bamboo_zen',
    name: '《竹林听风》',
    enName: 'Bamboo Ink Zen',
    style: '空灵禅意 · A羽调五声',
    bpm: 104,
    desc: '悠扬竹笛主奏配轻盈木鱼与古琴滑音，如置身微风宣纸画卷',
    scaleHz: [110.0, 130.81, 146.83, 164.81, 196.0, 220.0, 261.63, 293.66, 329.63, 392.0, 440.0],
    motifA: [8, -1, -1, 7, 5, -1, -1, 3, 5, -1, 7, -1, 8, -1, 10, -1],
    motifB: [10, -1, 8, -1, 7, -1, 5, 3, 5, -1, -1, 7, 5, -1, -1, -1],
    bassLine: [0, -1, -1, -1, 2, -1, -1, -1, 3, -1, -1, -1, 0, -1, 4, -1],
    leadWave: 'flute',
    drumStyle: 'zen',
  },
  recess_rush: {
    id: 'recess_rush',
    name: '《课间狂想》',
    enName: 'Recess Rush',
    style: '轻快摇滚 · E多利亚',
    bpm: 138,
    desc: '明快双铅笔切分鼓 + 弹跳铅笔合成主音 + 活跃 Funk 贝斯',
    scaleHz: [164.81, 185.0, 196.0, 220.0, 246.94, 277.18, 293.66, 329.63, 392.0, 440.0, 493.88],
    motifA: [7, 7, -1, 8, 9, -1, 7, -1, 6, -1, 7, 8, 10, -1, 8, 7],
    motifB: [10, -1, 9, 8, 7, -1, 6, 4, 7, -1, 8, 9, 7, -1, 10, -1],
    bassLine: [0, -1, 0, 2, -1, 3, -1, 2, 0, -1, 4, -1, 3, 2, 0, -1],
    leadWave: 'square',
    drumStyle: 'rock',
  },
  storm_bridge: {
    id: 'storm_bridge',
    name: '《断桥惊雷》',
    enName: 'Storm Over Bridge',
    style: '史诗紧迫 · C弗里吉亚',
    bpm: 132,
    desc: '急促战鼓连击 + 失真金属尺低音 Riff + 疾走三味线急奏',
    scaleHz: [130.81, 138.59, 155.56, 174.61, 196.0, 207.65, 233.08, 261.63, 277.18, 311.13, 392.0],
    motifA: [7, 8, 7, -1, 4, 7, 9, -1, 8, 7, 6, 4, 7, -1, 10, -1],
    motifB: [10, -1, 9, 8, 7, 8, 7, 4, 6, -1, 8, 7, 4, 1, 0, -1],
    bassLine: [0, 0, 1, -1, 0, 0, 4, -1, 0, 1, 3, -1, 4, 1, 0, -1],
    leadWave: 'shamisen',
    drumStyle: 'storm',
  },
  ink_musou: {
    id: 'ink_musou',
    name: '《千军破·无双》',
    enName: 'Ink Musou',
    style: '疾走电音武侠 · G小调',
    bpm: 148,
    desc: '高速四拍强节奏底鼓 + 十六分音符琶音脉冲 + 狂飙无双旋律',
    scaleHz: [196.0, 220.0, 233.08, 261.63, 293.66, 311.13, 349.23, 392.0, 466.16, 523.25, 587.33],
    motifA: [7, -1, 8, 7, 9, -1, 10, -1, 8, 7, 6, 4, 7, 8, 10, -1],
    motifB: [10, 9, 8, 7, 9, -1, 8, 6, 7, 4, 6, 7, 8, 9, 10, 10],
    bassLine: [0, 0, -1, 0, 2, 2, -1, 2, 4, 4, -1, 4, 6, 4, 2, 0],
    leadWave: 'arp',
    drumStyle: 'musou',
  },
  authors_finale: {
    id: 'authors_finale',
    name: '《作者之手·终章》',
    enName: "Author's Finale",
    style: '终极Boss · D和声小调',
    bpm: 154,
    desc: '宏大暗黑管风琴铺底 + 压迫心跳定音鼓 + 狂躁八度连斩主音',
    scaleHz: [146.83, 164.81, 174.61, 196.0, 220.0, 233.08, 277.18, 293.66, 349.23, 440.0, 554.37],
    motifA: [7, 6, 7, 8, 9, 8, 7, 6, 7, 9, 10, -1, 9, 8, 6, 7],
    motifB: [10, 9, 8, 7, 6, 7, 8, 9, 10, -1, 9, 6, 7, -1, 4, 6],
    bassLine: [0, -1, 0, 0, 5, -1, 4, 4, 0, -1, 6, 4, 0, 0, 6, 4],
    leadWave: 'organ',
    drumStyle: 'boss',
  },
};

export const BGM_TRACK_LIST: BgmTrackMeta[] = [
  BGM_TRACKS.calligraphy,
  BGM_TRACKS.bamboo_zen,
  BGM_TRACKS.recess_rush,
  BGM_TRACKS.storm_bridge,
  BGM_TRACKS.ink_musou,
  BGM_TRACKS.authors_finale,
];

/**
 * Multi-Track Procedural Sketchbook BGM Engine (6 distinct movements!).
 * Supports auto stage-matching, single loop, shuffle jukebox, and climax/stylish dynamic layering.
 */
export class BgmEngine {
  private sound: SoundEngine;
  private bgmGain: GainNode | null = null;
  private enabled = true;
  private playing = false;
  private timerId: number | null = null;
  private step = 0;
  private barsPlayed = 0;
  private nextNoteTime = 0;
  private bgmVolume = 0.6;
  private stylishFluteBoost = false;

  private intensity: 'menu' | 'fight' | 'climax' = 'menu';
  public currentTrackId: BgmTrackId = 'calligraphy';
  public playMode: BgmPlayMode = 'auto';
  public onTrackChanged?: (track: BgmTrackMeta) => void;

  constructor(sound: SoundEngine) {
    this.sound = sound;
  }

  public getCurrentTrack(): BgmTrackMeta {
    return BGM_TRACKS[this.currentTrackId];
  }

  public setPlayMode(mode: BgmPlayMode): void {
    this.playMode = mode;
  }

  public selectTrack(id: BgmTrackId, manual = false): void {
    if (this.currentTrackId === id && !manual) return;
    this.currentTrackId = id;
    this.barsPlayed = 0;
    this.onTrackChanged?.(this.getCurrentTrack());
  }

  public suggestStageTrack(id: BgmTrackId): void {
    if (this.playMode === 'auto') {
      this.selectTrack(id, false);
    }
  }

  public nextTrack(): BgmTrackMeta {
    const idx = BGM_TRACK_LIST.findIndex((t) => t.id === this.currentTrackId);
    const next = BGM_TRACK_LIST[(idx + 1) % BGM_TRACK_LIST.length];
    this.selectTrack(next.id, true);
    return next;
  }

  public prevTrack(): BgmTrackMeta {
    const idx = BGM_TRACK_LIST.findIndex((t) => t.id === this.currentTrackId);
    const prev = BGM_TRACK_LIST[(idx - 1 + BGM_TRACK_LIST.length) % BGM_TRACK_LIST.length];
    this.selectTrack(prev.id, true);
    return prev;
  }

  public setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) {
      this.stop();
    } else if (this.sound.getContext()) {
      this.start();
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public setIntensity(mode: 'menu' | 'fight' | 'climax'): void {
    this.intensity = mode;
  }

  public setStylishBoost(on: boolean): void {
    this.stylishFluteBoost = on;
  }

  public setVolume(vol: number): void {
    this.bgmVolume = Math.max(0, Math.min(1, vol));
    const ctx = this.sound.getContext();
    if (this.bgmGain && ctx) {
      this.bgmGain.gain.setTargetAtTime(this.bgmVolume * 0.38, ctx.currentTime, 0.03);
    }
  }

  public start(): void {
    if (!this.enabled || this.playing) return;
    const ctx = this.sound.unlock();
    const filter = this.sound.getMasterFilter();
    if (!ctx || !filter) return;

    if (!this.bgmGain) {
      this.bgmGain = ctx.createGain();
      this.bgmGain.gain.value = this.bgmVolume * 0.38;
      this.bgmGain.connect(filter);
    }

    this.playing = true;
    this.step = 0;
    this.nextNoteTime = ctx.currentTime + 0.06;
    this.timerId = window.setInterval(() => this.scheduler(), 32);
  }

  public stop(): void {
    this.playing = false;
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private getEffectiveBpm(): number {
    const base = this.getCurrentTrack().bpm;
    if (this.intensity === 'menu') return Math.round(base * 0.86);
    if (this.intensity === 'climax') return Math.round(base * 1.12);
    return base;
  }

  private scheduler(): void {
    const ctx = this.sound.getContext();
    if (!ctx || !this.playing || !this.enabled || ctx.state !== 'running') return;

    const stepSec = 60 / this.getEffectiveBpm() / 4; // 16th note
    while (this.nextNoteTime < ctx.currentTime + 0.14) {
      this.scheduleStep(ctx, this.step, this.nextNoteTime);
      this.nextNoteTime += stepSec;
      this.step = (this.step + 1) % 32;
      if (this.step === 0) {
        this.barsPlayed++;
        // Auto-shuffle to a fresh movement every 8 full phrases when shuffle mode is active!
        if (this.playMode === 'shuffle' && this.barsPlayed >= 8) {
          this.barsPlayed = 0;
          const pool = BGM_TRACK_LIST.filter((t) => t.id !== this.currentTrackId);
          const pick = pool[Math.floor(Math.random() * pool.length)];
          if (pick) this.selectTrack(pick.id, true);
        }
      }
    }
  }

  private scheduleStep(ctx: AudioContext, step: number, time: number): void {
    if (!this.bgmGain) return;
    const track = this.getCurrentTrack();
    const s16 = step % 16;
    const isMenu = this.intensity === 'menu';
    const isClimax = this.intensity === 'climax';

    // 1. Drums tailored to track drumStyle!
    if (track.drumStyle === 'zen') {
      if (s16 === 0 || s16 === 10) this.playDeskKick(ctx, time, 0.28);
      if (s16 === 4 || s16 === 12) this.playWoodblock(ctx, time, 620 + (s16 === 12 ? 120 : 0), 0.17);
      if (s16 % 4 === 2) this.playPenClickHat(ctx, time, 0.05);
    } else if (track.drumStyle === 'musou' || track.drumStyle === 'boss') {
      if (s16 % 4 === 0 || (isClimax && s16 % 4 === 2)) this.playDeskKick(ctx, time, s16 % 8 === 0 ? 0.44 : 0.32);
      if (s16 === 4 || s16 === 12 || (track.drumStyle === 'boss' && s16 === 15)) {
        this.playPencilRim(ctx, time, 0.28);
      }
      if (s16 % 2 === 1 || isClimax) this.playPenClickHat(ctx, time, 0.095);
    } else if (track.drumStyle === 'rock') {
      if (s16 === 0 || s16 === 6 || s16 === 8 || s16 === 14) this.playDeskKick(ctx, time, 0.38);
      if (s16 === 4 || s16 === 12 || s16 === 15) this.playPencilRim(ctx, time, 0.26);
      if (s16 % 2 === 0) this.playPenClickHat(ctx, time, s16 % 4 === 2 ? 0.12 : 0.07);
    } else if (track.drumStyle === 'storm') {
      if (s16 === 0 || s16 === 3 || s16 === 8 || s16 === 10 || s16 === 14) this.playDeskKick(ctx, time, 0.42);
      if (s16 === 4 || s16 === 12) this.playPencilRim(ctx, time, 0.3);
      if (s16 % 2 === 0 || isClimax) this.playPenClickHat(ctx, time, 0.085);
    } else {
      // standard calligraphy
      if (s16 === 0 || s16 === 8 || (!isMenu && (s16 === 6 || (isClimax && s16 === 14)))) {
        this.playDeskKick(ctx, time, s16 === 0 ? 0.42 : 0.28);
      }
      if (!isMenu && (s16 === 4 || s16 === 12)) this.playPencilRim(ctx, time, 0.26);
      if (s16 % 2 === 0 || (isClimax && s16 % 2 === 1)) {
        this.playPenClickHat(ctx, time, isMenu ? 0.06 : 0.1);
      }
    }

    // 2. Bassline
    const bassIdx = track.bassLine[s16];
    if (bassIdx >= 0 && (!isMenu || s16 % 4 === 0)) {
      const bassHz = track.scaleHz[bassIdx] * 0.5;
      if (track.leadWave === 'organ') {
        this.playOrganPad(ctx, time, bassHz, 0.2);
      } else {
        this.playRulerBass(ctx, time, bassHz, isMenu ? 0.15 : 0.22);
      }
    }

    // 3. Lead Melody with distinct synthesized instrument timbre!
    const motif = step < 16 ? track.motifA : track.motifB;
    const noteIdx = motif[s16];
    if (noteIdx >= 0) {
      if (isMenu && track.drumStyle !== 'zen' && s16 % 2 === 1) return;
      const hz = track.scaleHz[noteIdx];
      const vol = isMenu ? 0.13 : 0.19;

      switch (track.leadWave) {
        case 'flute':
          this.playBambooFlute(ctx, time, hz, vol * 1.05);
          break;
        case 'square':
          this.playSquareLead(ctx, time, hz, vol * 0.8);
          break;
        case 'shamisen':
          this.playPluckedString(ctx, time, hz * 1.0, vol * 1.15, 0.18);
          break;
        case 'arp':
          this.playArpSynth(ctx, time, hz, vol);
          if (s16 % 2 === 0) this.playArpSynth(ctx, time + 0.055, hz * 1.5, vol * 0.5);
          break;
        case 'organ':
          this.playOrganPad(ctx, time, hz, vol * 0.9);
          this.playPluckedString(ctx, time, hz * 2, vol * 0.55, 0.16);
          break;
        default:
          this.playPluckedString(ctx, time, hz, vol, 0.32);
          break;
      }

      // Stylish Rank (宗师 / 画圣!) High-Octave Bamboo Flute Harmony Layer!
      if (this.stylishFluteBoost && !isMenu && s16 % 4 === 0) {
        this.playBambooFlute(ctx, time, hz * 2, 0.12);
      }
    }
  }

  private playDeskKick(ctx: AudioContext, time: number, vol: number): void {
    if (!this.bgmGain) return;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, time);
    osc.frequency.exponentialRampToValueAtTime(40, time + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.13);
    osc.connect(g);
    g.connect(this.bgmGain);
    osc.start(time);
    osc.stop(time + 0.14);
  }

  private playWoodblock(ctx: AudioContext, time: number, freq: number, vol: number): void {
    if (!this.bgmGain) return;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, time);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.85, time + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.075);
    osc.connect(g);
    g.connect(this.bgmGain);
    osc.start(time);
    osc.stop(time + 0.08);
  }

  private playPencilRim(ctx: AudioContext, time: number, vol: number): void {
    if (!this.bgmGain) return;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(760, time);
    osc.frequency.exponentialRampToValueAtTime(290, time + 0.04);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.055);
    osc.connect(g);
    g.connect(this.bgmGain);
    osc.start(time);
    osc.stop(time + 0.06);
  }

  private playPenClickHat(ctx: AudioContext, time: number, vol: number): void {
    if (!this.bgmGain) return;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(3400 + (Math.random() - 0.5) * 300, time);
    osc.frequency.exponentialRampToValueAtTime(1100, time + 0.015);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2600;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, time);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.02);
    osc.connect(hp);
    hp.connect(g);
    g.connect(this.bgmGain);
    osc.start(time);
    osc.stop(time + 0.025);
  }

  private playRulerBass(ctx: AudioContext, time: number, freq: number, vol: number): void {
    if (!this.bgmGain) return;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq * 1.03, time);
    osc.frequency.exponentialRampToValueAtTime(freq, time + 0.06);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(540, time);
    lp.frequency.exponentialRampToValueAtTime(160, time + 0.24);
    lp.Q.value = 3.0;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.008);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.26);
    osc.connect(lp);
    lp.connect(g);
    g.connect(this.bgmGain);
    osc.start(time);
    osc.stop(time + 0.28);
  }

  private playPluckedString(ctx: AudioContext, time: number, freq: number, vol: number, dur = 0.32): void {
    if (!this.bgmGain) return;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(freq, time);
    const bp = ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.setValueAtTime(freq * 6.5, time);
    bp.frequency.exponentialRampToValueAtTime(freq * 1.4, time + dur * 0.7);
    bp.Q.value = 2.0;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.004);
    g.gain.exponentialRampToValueAtTime(0.001, time + dur);
    osc.connect(bp);
    bp.connect(g);
    g.connect(this.bgmGain);
    osc.start(time);
    osc.stop(time + dur + 0.02);
  }

  private playBambooFlute(ctx: AudioContext, time: number, freq: number, vol: number): void {
    if (!this.bgmGain) return;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 0.985, time);
    osc.frequency.exponentialRampToValueAtTime(freq, time + 0.05);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.045);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.42);
    osc.connect(g);
    g.connect(this.bgmGain);
    osc.start(time);
    osc.stop(time + 0.44);
  }

  private playSquareLead(ctx: AudioContext, time: number, freq: number, vol: number): void {
    if (!this.bgmGain) return;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.setValueAtTime(freq, time);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(freq * 4, time);
    lp.frequency.exponentialRampToValueAtTime(freq * 1.5, time + 0.16);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.18);
    osc.connect(lp);
    lp.connect(g);
    g.connect(this.bgmGain);
    osc.start(time);
    osc.stop(time + 0.2);
  }

  private playArpSynth(ctx: AudioContext, time: number, freq: number, vol: number): void {
    if (!this.bgmGain) return;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, time);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.15);
    osc.connect(g);
    g.connect(this.bgmGain);
    osc.start(time);
    osc.stop(time + 0.17);
  }

  private playOrganPad(ctx: AudioContext, time: number, freq: number, vol: number): void {
    if (!this.bgmGain) return;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(freq, time);
    osc2.frequency.setValueAtTime(freq * 2.003, time);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = freq * 3.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.001, time);
    g.gain.linearRampToValueAtTime(vol, time + 0.02);
    g.gain.exponentialRampToValueAtTime(0.001, time + 0.34);
    osc1.connect(lp);
    osc2.connect(lp);
    lp.connect(g);
    g.connect(this.bgmGain);
    osc1.start(time);
    osc2.start(time);
    osc1.stop(time + 0.36);
    osc2.stop(time + 0.36);
  }
}
