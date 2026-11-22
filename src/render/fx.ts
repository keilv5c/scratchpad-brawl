import { FxIntensity, Vec2 } from '../types';
import { StickmanPose } from '../physics/skeleton';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../config/stages';
import { easeOutBack } from '../engine/math';

export type ImpactTier = 'normal' | 'parry' | 'super' | 'ko';

export interface SuperCutInState {
  active: boolean;
  age: number;
  duration: number;
  fighterName: string;
  weaponIcon: string;
  weaponName: string;
  moveName: string;
  accentColor: string;
  facing: 1 | -1;
}

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
  kind: 'ink' | 'dust' | 'spark' | 'shard' | 'leaf';
  rot: number;
  vrot: number;
  gravity: number;
}

export interface ComicPopText {
  text: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  scale: number;
  rot: number;
  life: number;
  maxLife: number;
  outline: string;
}

export interface Afterimage {
  pose: StickmanPose;
  color: string;
  scarfColor: string;
  life: number;
  maxLife: number;
}

export interface RingBurst {
  x: number;
  y: number;
  r: number;
  maxR: number;
  color: string;
  lineWidth: number;
  life: number;
  maxLife: number;
  starSpikes?: boolean;
}

export interface SuperSlashLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  color: string;
  life: number;
  maxLife: number;
}

export interface LightningBoltFx {
  points: Vec2[];
  color: string;
  life: number;
  maxLife: number;
}

export interface GradingStamp {
  active: boolean;
  text: string;
  subText: string;
  color: string;
  age: number;
  x: number;
  y: number;
  rot: number;
}

export class FxManager {
  public maxParticles = 240;
  public particles: Particle[] = [];
  public texts: ComicPopText[] = [];
  public afterimages: Afterimage[] = [];
  public rings: RingBurst[] = [];
  public superSlashes: SuperSlashLine[] = [];
  public lightnings: LightningBoltFx[] = [];

  // Tiered dramatic effects (Zero-strobe normal combat + Controlled Super/KO cinematics!)
  public fxIntensity: FxIntensity = 'balanced';
  public antiStrobeCooldown = 0; // Global cooldown preventing rapid consecutive fullscreen flashes!
  public impactFrames = 0;
  public impactInvert = false;
  public impactCenter: Vec2 = { x: WORLD_WIDTH / 2, y: WORLD_HEIGHT / 2 };
  public speedLinesTimer = 0;
  public speedLinesBoost = 1; // 1 for normal, >1 for Super/KO
  public speedLinesColor = '#141822';
  public superDimTimer = 0;
  public superDimMax = 1.05;
  public superSpotlightPos: Vec2 | null = null;
  public superDimColor = '#121622';

  public superCutIn: SuperCutInState = {
    active: false,
    age: 0,
    duration: 0.72,
    fighterName: '',
    weaponIcon: '',
    weaponName: '',
    moveName: '',
    accentColor: '#cf2a2a',
    facing: 1,
  };

  public stamp: GradingStamp = {
    active: false,
    text: 'K.O.',
    subText: '',
    color: '#cc2222',
    age: 0,
    x: WORLD_WIDTH / 2,
    y: WORLD_HEIGHT * 0.42,
    rot: -0.14,
  };

  public reset(): void {
    this.particles = [];
    this.texts = [];
    this.afterimages = [];
    this.rings = [];
    this.superSlashes = [];
    this.lightnings = [];
    this.impactFrames = 0;
    this.impactInvert = false;
    this.antiStrobeCooldown = 0;
    this.speedLinesTimer = 0;
    this.speedLinesBoost = 1;
    this.superDimTimer = 0;
    this.superSpotlightPos = null;
    this.superCutIn.active = false;
    this.stamp.active = false;
  }

  /**
   * Computes a silky-smooth ease-in / hold / ease-out alpha curve for the Super Spotlight Curtain.
   * Never snaps abruptly from bright to black!
   */
  public getSuperDimAlpha(): number {
    if (this.superDimTimer <= 0 || this.superDimMax <= 0) return 0;
    const elapsed = Math.max(0, this.superDimMax - this.superDimTimer);
    const fadeIn = Math.min(1, elapsed / 0.13);
    const fadeOut = Math.min(1, this.superDimTimer / 0.28);
    const env = Math.min(fadeIn, fadeOut);
    const smooth = env * env * (3 - 2 * env);
    const peak =
      this.fxIntensity === 'eyesafe' ? 0.2 : this.fxIntensity === 'cinema' ? 0.66 : 0.56;
    return peak * smooth;
  }

  /**
   * Full Signature Stationery Super Presentation:
   * Smooth Spotlight Curtain + Hand-Drawn Calligraphic Cut-In Banner + Cooldown-Protected Soft Ink Impact Frame!
   */
  public triggerSuperShowcase(
    pos: Vec2,
    fighterName: string,
    weaponIcon: string,
    weaponName: string,
    moveName: string,
    accentColor: string,
    facing: 1 | -1
  ): void {
    this.superDimMax = 1.08;
    this.superDimTimer = 1.08;
    this.superSpotlightPos = { x: pos.x, y: pos.y - 46 };
    this.superCutIn = {
      active: true,
      age: 0,
      duration: 0.76,
      fighterName,
      weaponIcon,
      weaponName,
      moveName,
      accentColor,
      facing,
    };
    this.triggerImpactFrame(6, { x: pos.x, y: pos.y - 46 }, 0.44, 'super');
  }

  public spawnInkBurst(pos: Vec2, color: string, count: number, dirX = 0, dirY = 0, speed = 340): void {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = (0.35 + Math.random() * 0.9) * speed;
      this.particles.push({
        x: pos.x,
        y: pos.y,
        vx: Math.cos(ang) * spd + dirX * speed * 0.65,
        vy: Math.sin(ang) * spd + dirY * speed * 0.45 - 60,
        size: 2.5 + Math.random() * 5.5,
        color,
        life: 0.35 + Math.random() * 0.4,
        maxLife: 0.75,
        kind: 'ink',
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 8,
        gravity: 960,
      });
    }
  }

  public spawnDust(pos: Vec2, dirX: number, count: number): void {
    for (let i = 0; i < count; i++) {
      this.particles.push({
        x: pos.x + (Math.random() - 0.5) * 18,
        y: pos.y - Math.random() * 10,
        vx: dirX * (60 + Math.random() * 110) + (Math.random() - 0.5) * 70,
        vy: -30 - Math.random() * 90,
        size: 3 + Math.random() * 4.5,
        color: '#6b6e76',
        life: 0.25 + Math.random() * 0.22,
        maxLife: 0.47,
        kind: 'dust',
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 5,
        gravity: 140,
      });
    }
  }

  public spawnParrySparks(pos: Vec2, color = '#f0a818', count = 20): void {
    for (let i = 0; i < count; i++) {
      const ang = (i / count) * Math.PI * 2 + (Math.random() - 0.5) * 0.3;
      const spd = 280 + Math.random() * 460;
      this.particles.push({
        x: pos.x,
        y: pos.y,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd,
        size: 10 + Math.random() * 14,
        color: i % 3 === 0 ? '#ffffff' : color,
        life: 0.2 + Math.random() * 0.22,
        maxLife: 0.42,
        kind: 'spark',
        rot: ang,
        vrot: 0,
        gravity: 340,
      });
    }

    this.rings.push({
      x: pos.x,
      y: pos.y,
      r: 12,
      maxR: 125,
      color,
      lineWidth: 5,
      life: 0.28,
      maxLife: 0.28,
      starSpikes: true,
    });
  }

  public spawnPaperShards(pos: Vec2, color: string, count = 14): void {
    for (let i = 0; i < count; i++) {
      const ang = Math.random() * Math.PI * 2;
      const spd = 160 + Math.random() * 320;
      this.particles.push({
        x: pos.x + (Math.random() - 0.5) * 28,
        y: pos.y + (Math.random() - 0.5) * 20,
        vx: Math.cos(ang) * spd,
        vy: Math.sin(ang) * spd - 140,
        size: 7 + Math.random() * 8,
        color,
        life: 0.55 + Math.random() * 0.45,
        maxLife: 1.0,
        kind: 'shard',
        rot: Math.random() * Math.PI,
        vrot: (Math.random() - 0.5) * 14,
        gravity: 780,
      });
    }
  }

  public spawnAmbientLeaf(worldWidth = WORLD_WIDTH): void {
    this.particles.push({
      x: Math.random() > 0.2 ? Math.random() * worldWidth : -20,
      y: -15,
      vx: 35 + Math.random() * 55,
      vy: 38 + Math.random() * 40,
      size: 10 + Math.random() * 7,
      color: 'rgba(28, 38, 32, 0.58)',
      life: 7.5,
      maxLife: 7.5,
      kind: 'leaf',
      rot: Math.random() * Math.PI,
      vrot: (Math.random() - 0.5) * 2.4,
      gravity: 0,
    });
  }

  public blowLeaves(origin: Vec2, forceX: number): void {
    for (const p of this.particles) {
      if (p.kind !== 'leaf') continue;
      const d = Math.hypot(p.x - origin.x, p.y - origin.y);
      if (d < 340) {
        const str = (1 - d / 340) * 320;
        p.vx += forceX * str * 0.8 + (Math.random() - 0.5) * 120;
        p.vy -= 80 + Math.random() * 120;
        p.vrot += (Math.random() - 0.5) * 10;
      }
    }
  }

  public spawnRing(pos: Vec2, maxR: number, color: string, lineWidth = 4): void {
    this.rings.push({
      x: pos.x,
      y: pos.y,
      r: 10,
      maxR,
      color,
      lineWidth,
      life: 0.24,
      maxLife: 0.24,
    });
  }

  public spawnPopText(text: string, pos: Vec2, color: string, scale = 1.0): void {
    this.texts.push({
      text,
      x: pos.x + (Math.random() - 0.5) * 28,
      y: pos.y - 20 + (Math.random() - 0.5) * 18,
      vx: (Math.random() - 0.5) * 50,
      vy: -85 - Math.random() * 45,
      color,
      scale,
      rot: (Math.random() - 0.5) * 0.34,
      life: 0.68,
      maxLife: 0.68,
      outline: '#fdfbf5',
    });
  }

  public spawnAfterimage(pose: StickmanPose, color: string, scarfColor: string): void {
    // Deep copy pose points
    const copy = (v: Vec2): Vec2 => ({ x: v.x, y: v.y });
    this.afterimages.push({
      pose: {
        head: copy(pose.head),
        neck: copy(pose.neck),
        chest: copy(pose.chest),
        hip: copy(pose.hip),
        lShoulder: copy(pose.lShoulder),
        lElbow: copy(pose.lElbow),
        lHand: copy(pose.lHand),
        rShoulder: copy(pose.rShoulder),
        rElbow: copy(pose.rElbow),
        rHand: copy(pose.rHand),
        lKnee: copy(pose.lKnee),
        lFoot: copy(pose.lFoot),
        rKnee: copy(pose.rKnee),
        rFoot: copy(pose.rFoot),
        weaponBase: copy(pose.weaponBase),
        weaponTip: copy(pose.weaponTip),
        offhandWeaponTip: pose.offhandWeaponTip ? copy(pose.offhandWeaponTip) : null,
        headTilt: pose.headTilt,
      },
      color,
      scarfColor,
      life: 0.24,
      maxLife: 0.24,
    });
  }

  /**
   * Tiered Anti-Strobe Impact System:
   * - 'normal' (heavy hits / clashes): ZERO fullscreen invert, only crisp local starburst + gentle rim speed-lines.
   * - 'parry' (perfect parry / guard break): ZERO fullscreen invert in eyesafe/balanced; soft ink freeze in cinema.
   * - 'super' (Stationery Ultimate): Soft warm-ivory/ink-navy freeze in balanced/cinema, guarded by anti-strobe cooldown!
   * - 'ko' (Round Finisher): Dramatic soft ink freeze in balanced/cinema for peak anime payoff!
   */
  public triggerImpactFrame(
    frames: number,
    center: Vec2,
    speedLinesSec = 0.2,
    tier: ImpactTier = 'normal'
  ): void {
    this.impactCenter = { ...center };

    const isBigMoment = tier === 'super' || tier === 'ko';
    const maxSpeedSec = isBigMoment ? 0.55 : 0.26;
    this.speedLinesTimer = Math.max(this.speedLinesTimer, Math.min(maxSpeedSec, speedLinesSec));
    if (isBigMoment) {
      this.speedLinesBoost = this.fxIntensity === 'eyesafe' ? 1.15 : 1.75;
    } else {
      this.speedLinesBoost = Math.max(this.speedLinesBoost, 1.0);
    }

    // Decide whether to grant a soft ink-silhouette impact frame based on tier + user's fxIntensity + anti-strobe cooldown!
    let allowInvert = false;
    let cooldownSec = 2.5;
    if (this.fxIntensity === 'balanced') {
      if (tier === 'super' && this.antiStrobeCooldown <= 0) {
        allowInvert = true;
        cooldownSec = 2.5;
      } else if (tier === 'ko' && this.antiStrobeCooldown <= 0.4) {
        allowInvert = true;
        cooldownSec = 2.0;
      }
    } else if (this.fxIntensity === 'cinema') {
      if ((tier === 'super' || tier === 'parry') && this.antiStrobeCooldown <= 0) {
        allowInvert = true;
        cooldownSec = 1.8;
      } else if (tier === 'ko') {
        allowInvert = true;
        cooldownSec = 1.6;
      }
    }

    if (allowInvert && frames > 0) {
      this.impactFrames = Math.max(this.impactFrames, frames);
      this.impactInvert = true;
      this.antiStrobeCooldown = cooldownSec;
    }

    this.rings.push({
      x: center.x,
      y: center.y,
      r: isBigMoment ? 18 : 14,
      maxR: isBigMoment ? 190 : 130,
      color: tier === 'parry' ? '#f0a818' : '#d93232',
      lineWidth: isBigMoment ? 6 : 4.5,
      life: isBigMoment ? 0.32 : 0.24,
      maxLife: isBigMoment ? 0.32 : 0.24,
      starSpikes: true,
    });
  }

  public spawnCompassRings(center: Vec2, color: string): void {
    [95, 165, 240].forEach((maxR, i) => {
      this.rings.push({
        x: center.x + (i - 1) * 45,
        y: center.y - 30,
        r: 18,
        maxR,
        color: i === 1 ? '#1f6fd4' : color,
        lineWidth: 4,
        life: 0.44 + i * 0.06,
        maxLife: 0.44 + i * 0.06,
      });
    });
  }

  public spawnWhiteoutStripes(center: Vec2): void {
    [-70, 0, 70].forEach((oy, i) => {
      this.superSlashes.push({
        x1: center.x - 560,
        y1: center.y + oy,
        x2: center.x + 560,
        y2: center.y + oy,
        width: 34,
        color: '#ffffff',
        life: 0.58 + i * 0.05,
        maxLife: 0.58 + i * 0.05,
      });
      this.superSlashes.push({
        x1: center.x - 560,
        y1: center.y + oy - 16,
        x2: center.x + 560,
        y2: center.y + oy - 16,
        width: 3,
        color: '#2685d9',
        life: 0.58 + i * 0.05,
        maxLife: 0.58 + i * 0.05,
      });
    });
  }

  public spawnScissorsCrossCut(center: Vec2): void {
    this.superSlashes.push({
      x1: center.x - 320, y1: center.y - 220,
      x2: center.x + 320, y2: center.y + 220,
      width: 18, color: '#d42c2c', life: 0.48, maxLife: 0.48,
    });
    this.superSlashes.push({
      x1: center.x + 320, y1: center.y - 220,
      x2: center.x - 320, y2: center.y + 220,
      width: 18, color: '#dfe6f0', life: 0.48, maxLife: 0.48,
    });
  }

  public spawnSuperCalligraphySlashes(center: Vec2, color: string): void {
    for (let i = 0; i < 7; i++) {
      const ang = (Math.random() - 0.5) * 1.9;
      const len = 420 + Math.random() * 420;
      const cx = center.x + (Math.random() - 0.5) * 280;
      const cy = center.y + (Math.random() - 0.5) * 170;
      this.superSlashes.push({
        x1: cx - Math.cos(ang) * len * 0.5,
        y1: cy - Math.sin(ang) * len * 0.5,
        x2: cx + Math.cos(ang) * len * 0.5,
        y2: cy + Math.sin(ang) * len * 0.5,
        width: 7 + Math.random() * 14,
        color: i % 2 === 0 ? '#ffffff' : color,
        life: 0.34 + i * 0.04,
        maxLife: 0.34 + i * 0.04,
      });
    }
  }

  /**
   * Katana Signature Super: Massive diagonal torn-paper rift across the entire canvas!
   */
  public spawnKatanaPaperRift(center: Vec2, color: string): void {
    this.superSlashes.push({
      x1: center.x - 680,
      y1: center.y - 260,
      x2: center.x + 680,
      y2: center.y + 260,
      width: 28,
      color: '#ffffff',
      life: 0.52,
      maxLife: 0.52,
    });
    this.superSlashes.push({
      x1: center.x - 680,
      y1: center.y - 260,
      x2: center.x + 680,
      y2: center.y + 260,
      width: 12,
      color,
      life: 0.62,
      maxLife: 0.62,
    });
  }

  /**
   * Daggers Signature Super: 6-point Crimson Thread Pin Cage snapping shut!
   */
  public spawnDaggerThreadCage(center: Vec2, color: string): void {
    for (let i = 0; i < 6; i++) {
      const ang = (i / 6) * Math.PI * 2;
      const r = 210;
      const px = center.x + Math.cos(ang) * r;
      const py = center.y + Math.sin(ang) * r;
      const oppX = center.x - Math.cos(ang) * r;
      const oppY = center.y - Math.sin(ang) * r;
      this.superSlashes.push({
        x1: px,
        y1: py,
        x2: oppX,
        y2: oppY,
        width: 5,
        color: i % 2 === 0 ? color : '#ff3040',
        life: 0.48,
        maxLife: 0.48,
      });
      this.rings.push({
        x: px,
        y: py,
        r: 8,
        maxR: 38,
        color: '#ff3040',
        lineWidth: 3,
        life: 0.36,
        maxLife: 0.36,
      });
    }
  }

  /**
   * Hand-drawn comic lightning bolt striking from top of page down to target!
   */
  public spawnLightningBolt(x: number, floorY: number, color = '#f5b818'): void {
    const pts: Vec2[] = [];
    const segs = 10;
    for (let i = 0; i <= segs; i++) {
      const t = i / segs;
      const jitter = i === 0 || i === segs ? 0 : (Math.random() - 0.5) * 44;
      pts.push({ x: x + jitter, y: -20 + t * (floorY + 20) });
    }
    this.lightnings.push({ points: pts, color, life: 0.28, maxLife: 0.28 });
  }

  public triggerStamp(text: string, subText: string, color = '#cf2424'): void {
    this.stamp = {
      active: true,
      text,
      subText,
      color,
      age: 0,
      x: WORLD_WIDTH * 0.5,
      y: WORLD_HEIGHT * 0.38,
      rot: -0.14 + (Math.random() - 0.5) * 0.08,
    };
  }

  public update(dt: number, realDt: number, hasLeaves: boolean, worldWidth = WORLD_WIDTH): void {
    if (hasLeaves && Math.random() < dt * 2.6) {
      this.spawnAmbientLeaf(worldWidth);
    }

    if (this.antiStrobeCooldown > 0) this.antiStrobeCooldown = Math.max(0, this.antiStrobeCooldown - realDt);
    if (this.speedLinesTimer > 0) {
      this.speedLinesTimer = Math.max(0, this.speedLinesTimer - realDt);
      if (this.speedLinesTimer <= 0) this.speedLinesBoost = 1;
    }
    if (this.superDimTimer > 0) {
      this.superDimTimer = Math.max(0, this.superDimTimer - realDt);
      if (this.superDimTimer <= 0) this.superSpotlightPos = null;
    }
    if (this.superCutIn.active) {
      this.superCutIn.age += realDt;
      if (this.superCutIn.age >= this.superCutIn.duration) {
        this.superCutIn.active = false;
      }
    }
    if (this.stamp.active) this.stamp.age += realDt;

    if (this.particles.length > this.maxParticles) {
      this.particles.splice(0, this.particles.length - this.maxParticles);
    }

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      if (p.kind === 'leaf') {
        p.x += (p.vx + Math.sin(p.life * 4) * 32) * dt;
        p.y += p.vy * dt;
        p.vx *= 0.99;
      } else {
        p.vy += p.gravity * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.kind === 'spark') {
          p.vx *= 0.94;
          p.vy *= 0.94;
          p.rot = Math.atan2(p.vy, p.vx);
        }
      }
      p.rot += p.vrot * dt;
    }

    for (let i = this.texts.length - 1; i >= 0; i--) {
      const t = this.texts[i];
      t.life -= realDt;
      if (t.life <= 0) {
        this.texts.splice(i, 1);
        continue;
      }
      t.x += t.vx * realDt;
      t.y += t.vy * realDt;
      t.vy *= 0.92;
    }

    for (let i = this.afterimages.length - 1; i >= 0; i--) {
      this.afterimages[i].life -= dt;
      if (this.afterimages[i].life <= 0) this.afterimages.splice(i, 1);
    }

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life -= realDt;
      if (r.life <= 0) {
        this.rings.splice(i, 1);
        continue;
      }
      const prog = 1 - r.life / r.maxLife;
      r.r = 12 + (r.maxR - 12) * (1 - Math.pow(1 - prog, 3));
    }

    for (let i = this.superSlashes.length - 1; i >= 0; i--) {
      this.superSlashes[i].life -= realDt;
      if (this.superSlashes[i].life <= 0) this.superSlashes.splice(i, 1);
    }

    for (let i = this.lightnings.length - 1; i >= 0; i--) {
      this.lightnings[i].life -= realDt;
      if (this.lightnings[i].life <= 0) this.lightnings.splice(i, 1);
    }
  }

  public drawWorldFx(ctx: CanvasRenderingContext2D): void {
    // 1. Afterimages (pencil sketch ghosts)
    for (const a of this.afterimages) {
      const alpha = (a.life / a.maxLife) * 0.42;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = a.color;
      ctx.lineWidth = 3.2;
      ctx.lineCap = 'round';
      const p = a.pose;
      const seg = (u: Vec2, v: Vec2) => {
        ctx.beginPath();
        ctx.moveTo(u.x, u.y);
        ctx.lineTo(v.x, v.y);
        ctx.stroke();
      };
      seg(p.neck, p.hip);
      seg(p.neck, p.lElbow); seg(p.lElbow, p.lHand);
      seg(p.neck, p.rElbow); seg(p.rElbow, p.rHand);
      seg(p.hip, p.lKnee); seg(p.lKnee, p.lFoot);
      seg(p.hip, p.rKnee); seg(p.rKnee, p.rFoot);
      ctx.beginPath();
      ctx.arc(p.head.x, p.head.y, 11, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 2. Impact rings & metallic parry star crosses
    for (const r of this.rings) {
      const alpha = Math.max(0, r.life / r.maxLife);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = r.lineWidth * alpha;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, Math.PI * 2);
      ctx.stroke();

      if (r.starSpikes) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 4 * alpha;
        const s = r.r * 1.25;
        ctx.beginPath();
        ctx.moveTo(r.x - s, r.y);
        ctx.lineTo(r.x + s, r.y);
        ctx.moveTo(r.x, r.y - s);
        ctx.lineTo(r.x, r.y + s);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 3. Particles
    for (const p of this.particles) {
      const alpha = Math.min(1, p.life / Math.min(0.35, p.maxLife));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);

      if (p.kind === 'ink') {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size * 1.25, p.size * 0.78, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (p.kind === 'dust') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(0, 0, p.size, 0, Math.PI * 1.6);
        ctx.stroke();
      } else if (p.kind === 'spark') {
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(-p.size * 0.6, 0);
        ctx.lineTo(p.size * 0.6, 0);
        ctx.stroke();
      } else if (p.kind === 'shard') {
        ctx.fillStyle = '#f5f0e2';
        ctx.strokeStyle = p.color;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(-p.size, -p.size * 0.5);
        ctx.lineTo(p.size * 0.8, -p.size * 0.7);
        ctx.lineTo(p.size * 0.6, p.size * 0.6);
        ctx.lineTo(-p.size * 0.5, p.size * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      } else if (p.kind === 'leaf') {
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.size, p.size * 0.28, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    // 4. Super calligraphy criss-cross slash lines
    for (const sl of this.superSlashes) {
      const a = Math.max(0, sl.life / sl.maxLife);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = sl.color;
      ctx.lineWidth = sl.width * a;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sl.x1, sl.y1);
      ctx.lineTo(sl.x2, sl.y2);
      ctx.stroke();
      ctx.restore();
    }

    // 4.5 Hand-drawn ink lightning bolts!
    for (const lb of this.lightnings) {
      const a = Math.max(0, lb.life / lb.maxLife);
      ctx.save();
      ctx.globalAlpha = a;
      ctx.strokeStyle = lb.color;
      ctx.lineWidth = 9 * a;
      ctx.lineJoin = 'miter';
      ctx.beginPath();
      lb.points.forEach((pt, idx) => (idx === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
      ctx.stroke();

      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3.2 * a;
      ctx.stroke();
      ctx.restore();
    }

    // 5. Hand-drawn comic onomatopoeia ("唰!""铛!""破!")
    for (const t of this.texts) {
      const prog = 1 - t.life / t.maxLife;
      const pop = prog < 0.22 ? easeOutBack(prog / 0.22) : 1;
      const alpha = prog > 0.65 ? 1 - (prog - 0.65) / 0.35 : 1;

      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.rotate(t.rot);
      ctx.scale(t.scale * pop, t.scale * pop);
      ctx.globalAlpha = Math.max(0, alpha);
      ctx.font = '900 32px "STKaiti", "KaiTi", "Comic Sans MS", serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 6;
      ctx.strokeStyle = t.outline;
      ctx.strokeText(t.text, 0, 0);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, 0, 0);
      ctx.restore();
    }
  }

  public drawScreenFx(ctx: CanvasRenderingContext2D, viewW = WORLD_WIDTH, viewH = WORLD_HEIGHT): void {
    const isInvertNow = this.impactFrames > 0 && this.impactInvert;

    // 1. Dynamic Outer-Rim Manga Speed-Lines (calm on normal hits, dramatic on Supers & KOs!)
    if (this.speedLinesTimer > 0) {
      const peakAlpha = this.speedLinesBoost > 1.2 ? 0.52 : 0.26;
      const alpha = Math.min(peakAlpha, this.speedLinesTimer * (this.speedLinesBoost > 1.2 ? 1.55 : 1.1));
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = isInvertNow ? '#faf6ec' : this.speedLinesColor;
      const cx = viewW * 0.5;
      const cy = viewH * 0.5;
      const maxR = Math.hypot(viewW, viewH) * 0.74;
      const count = this.speedLinesBoost > 1.2 ? 56 : 34;
      const innerFactor = this.speedLinesBoost > 1.2 ? 0.35 : 0.43;
      for (let i = 0; i < count; i++) {
        const ang = (i / count) * Math.PI * 2;
        const rIn = Math.max(viewW, viewH) * innerFactor + (i % 3) * 32;
        ctx.lineWidth = (1.4 + (i % 2) * 1.1) * (this.speedLinesBoost > 1.2 ? 1.25 : 1);
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(ang) * rIn, cy + Math.sin(ang) * rIn);
        ctx.lineTo(cx + Math.cos(ang) * maxR, cy + Math.sin(ang) * maxR);
        ctx.stroke();
      }
      ctx.restore();
    }

    // 1.5 Hand-Drawn Calligraphic Super Cut-In Ribbon Banner!
    if (this.superCutIn.active) {
      this.drawSuperCutIn(ctx, viewW, viewH);
    }

    // 2. Red Teacher's Grading Pen Stamp ("K.O." / "完胜") centered on real viewport!
    if (this.stamp.active) {
      const s = this.stamp;
      const slamT = Math.min(1, s.age / 0.16);
      const scale = slamT < 1 ? 2.5 - 1.5 * easeOutBack(slamT) : 1.0;

      ctx.save();
      ctx.translate(viewW * 0.5, viewH * 0.38);
      ctx.rotate(s.rot);
      ctx.scale(scale, scale);

      // Double hand-drawn crimson oval ring
      ctx.strokeStyle = s.color;
      ctx.lineWidth = 6;
      ctx.globalAlpha = 0.88;
      ctx.beginPath();
      ctx.ellipse(0, 0, 146, 72, 0, 0, Math.PI * 2);
      ctx.stroke();

      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(3, -2, 154, 78, 0.04, 0, Math.PI * 2);
      ctx.stroke();

      // Stamp lettering
      ctx.fillStyle = s.color;
      ctx.font = '900 72px "STKaiti", "KaiTi", Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(s.text, 0, -4);

      if (s.subText) {
        ctx.font = '700 22px "STKaiti", "KaiTi", sans-serif';
        ctx.fillText(s.subText, 0, 50);
      }

      ctx.restore();
    }
  }

  /**
   * Hand-Drawn Anime / Sketchbook Calligraphic Super Cut-In Ribbon!
   * Sweeps crisply across the upper-mid viewport with weapon seal + brush calligraphy move name.
   */
  private drawSuperCutIn(ctx: CanvasRenderingContext2D, viewW: number, viewH: number): void {
    const ci = this.superCutIn;
    const t = ci.age / ci.duration; // 0..1
    const dir = ci.facing;

    // Smooth slide-in (0..0.16), dramatic slow drift hold (0.16..0.76), snappy sweep-out (0.76..1.0)
    let slideX = 0;
    let alpha = 1;
    if (t < 0.16) {
      const p = t / 0.16;
      const ease = 1 - Math.pow(1 - p, 3);
      slideX = -dir * (1 - ease) * viewW * 0.55;
      alpha = Math.min(1, p * 1.6);
    } else if (t < 0.76) {
      const p = (t - 0.16) / 0.6;
      slideX = dir * (p - 0.5) * 34;
    } else {
      const p = (t - 0.76) / 0.24;
      const ease = p * p;
      slideX = dir * (17 + ease * viewW * 0.6);
      alpha = Math.max(0, 1 - p * 1.25);
    }

    const cx = viewW * 0.5 + slideX;
    const cy = viewH * 0.27;
    const bandW = Math.min(viewW * 0.82, 740);
    const bandH = 82;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(cx, cy);
    ctx.rotate(-0.032 * dir);

    // Subtle paper drop shadow
    ctx.fillStyle = 'rgba(10, 12, 18, 0.32)';
    ctx.beginPath();
    ctx.moveTo(-bandW * 0.52 + 8, -bandH * 0.5 + 8);
    ctx.lineTo(bandW * 0.52 + 8, -bandH * 0.5 + 4);
    ctx.lineTo(bandW * 0.48 + 8, bandH * 0.5 + 8);
    ctx.lineTo(-bandW * 0.48 + 8, bandH * 0.5 + 10);
    ctx.closePath();
    ctx.fill();

    // Main dark ink brush ribbon
    ctx.fillStyle = '#161a24';
    ctx.beginPath();
    ctx.moveTo(-bandW * 0.52, -bandH * 0.5);
    ctx.lineTo(bandW * 0.52, -bandH * 0.5 - 3);
    ctx.lineTo(bandW * 0.48, bandH * 0.5);
    ctx.lineTo(-bandW * 0.48, bandH * 0.5 + 3);
    ctx.closePath();
    ctx.fill();

    // Vibrant accent top & bottom trim strokes
    ctx.fillStyle = ci.accentColor;
    ctx.fillRect(-bandW * 0.5, -bandH * 0.5 - 4, bandW, 6);
    ctx.fillRect(-bandW * 0.47, bandH * 0.5 - 2, bandW * 0.94, 5);

    // Feathered ink speed streaks inside ribbon
    ctx.strokeStyle = 'rgba(250, 246, 236, 0.16)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const sy = -bandH * 0.34 + i * 13;
      ctx.beginPath();
      ctx.moveTo(-bandW * 0.44 + (i % 2) * 35, sy);
      ctx.lineTo(bandW * 0.42 - (i % 3) * 28, sy);
      ctx.stroke();
    }

    // Left Hand-Stamped Stationery Seal Square
    const sealX = -bandW * 0.36;
    ctx.save();
    ctx.translate(sealX, 0);
    ctx.rotate(-0.09);
    ctx.fillStyle = '#faf6ec';
    ctx.strokeStyle = ci.accentColor;
    ctx.lineWidth = 4;
    ctx.fillRect(-30, -30, 60, 60);
    ctx.strokeRect(-30, -30, 60, 60);
    ctx.font = '34px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(ci.weaponIcon, 0, 2);
    ctx.restore();

    // Kicker label ("小墨 · 黑金钢笔 终极大招")
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#f8d27a';
    ctx.font = '800 14px "Microsoft YaHei", sans-serif';
    ctx.fillText(`${ci.fighterName} · ${ci.weaponName} · 终极大招`, sealX + 48, -19);

    // Bold Brush Calligraphy Move Name
    ctx.fillStyle = '#faf6ec';
    ctx.font = '900 38px "STKaiti", "KaiTi", Georgia, serif';
    ctx.lineWidth = 4;
    ctx.strokeStyle = ci.accentColor;
    ctx.strokeText(ci.moveName, sealX + 46, 15);
    ctx.fillText(ci.moveName, sealX + 46, 15);

    ctx.restore();
  }
}
