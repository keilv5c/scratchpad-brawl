import {
  AudioVisualSettings,
  InputState,
  PlatformDef,
  Vec2,
} from '../types';
import { clamp, lerp, Rect, rectsOverlap } from '../engine/math';
import { Camera } from '../engine/camera';
import { KeyboardInputManager, createEmptyInput, decayInputBuffers } from '../engine/input';
import { ProceduralSkeleton } from '../physics/skeleton';
import { ScarfChain } from '../physics/scarf';
import { SoundEngine } from '../audio/soundEngine';
import { BgmEngine } from '../audio/bgmEngine';
import { MathSynth } from './mathSynth';
import { MathFighterRenderState, MathPlatformDef, MathRenderer } from './mathRenderer';
import {
  LanBestOf,
  LanFxEventPayload,
  LanGeoFighterState,
  LanGeometrySnapshot,
  LanInputPacket,
  LanLobbyState,
  LanPeerMessage,
  LanRole,
} from '../net/lanTypes';
import {
  GuestInputEncoder,
  HostRemoteInputDecoder,
  SnapshotInterpolator,
} from '../net/lanClient';
import {
  IDENTITY_COMBOS,
  MATH_OPERATORS,
  MATH_SCHOOLS,
  MATH_THEMES,
  MATH_TRIAL_MASTERS,
  SPAWNABLE_OPERATORS,
  buildFormulaPreview,
  detectIdentityCombo,
} from './mathSchools';
import {
  FloatingOperatorPickup,
  GeoDummyMode,
  GeoHudSnapshot,
  GeoMode,
  GridWarp,
  IdentityComboId,
  MathCutInBanner,
  MathEntity,
  MathOperatorId,
  MathParticle,
  MathPopText,
  MathSchoolId,
  MathThemeId,
} from './mathTypes';

const GEO_WORLD_W = 1480;
const GEO_WORLD_H = 740;
const GEO_FLOOR_Y = 635;

const GEO_PLATFORMS: MathPlatformDef[] = [
  { id: 'geo_floor', x: 0, y: GEO_FLOOR_Y, w: GEO_WORLD_W, h: 120, oneWay: false },
  { id: 'geo_left', x: 190, y: 470, w: 280, h: 16, oneWay: true, label: 'y = 2.5' },
  { id: 'geo_right', x: 1010, y: 470, w: 280, h: 16, oneWay: true, label: 'y = 2.5' },
  { id: 'geo_mid', x: 560, y: 345, w: 360, h: 16, oneWay: true, label: 'f(x) = const' },
];

const MATH_GLYPH_PARTICLES = ['π', 'e', 'i', 'φ', '∫', 'Σ', '∞', 'sin', 'dx', '√'];

let mathUidCounter = 1;

interface GeoDelayedEvent {
  timer: number;
  fn: () => void;
}

class MathFighter {
  public readonly uid = `mf_${mathUidCounter++}`;
  public readonly index: 0 | 1;
  public name: string;
  public isBoss = false;
  public school: MathSchoolId;
  public color: string;
  public secondaryColor: string;

  public pos: Vec2;
  public vel: Vec2 = { x: 0, y: 0 };
  public facing: 1 | -1;

  public hp: number;
  public maxHp: number;
  public delayedHp: number;
  public energy = 35;
  public readonly maxEnergy = 100;
  public guardMeter = 100;

  public action:
    | 'idle'
    | 'run'
    | 'jump'
    | 'fall'
    | 'crouch'
    | 'dash'
    | 'charge'
    | 'attack'
    | 'block'
    | 'parry_success'
    | 'hitstun'
    | 'guard_break'
    | 'super_startup'
    | 'super_active'
    | 'ko'
    | 'victory' = 'idle';
  public actionFrames = 0;
  public animPhase = 0;

  public onGround = false;
  public onOneWayPlatform = false;
  public coyoteFrames = 0;
  public jumpsLeft = 2;
  public dropThroughFrames = 0;

  public attackKind: 'light1' | 'light2' | 'light3' | 'up_light' | 'air_light' | 'heavy' | 'super' | null = null;
  public attackHitIds = new Set<string>();
  public comboStep = 0;
  public comboWindowFrames = 0;
  public queuedCombo: 'light2' | 'light3' | null = null;
  public hasTriggeredActive = false;

  public chargeFrames = 0;
  public readonly maxChargeFrames = 40;
  public lastChargeRatio = 0;
  public lastAimAngle: number | null = null;

  public parryWindowFrames = 0;
  public dashCooldown = 0;
  public dashInvulnFrames = 0;
  public hitstunFrames = 0;
  public invulnFrames = 0;
  public hurtFlashFrames = 0;
  public comboReceived = 0;

  // Math-Specific Combat Mechanics!
  public operators: MathOperatorId[] = [];
  public polyDegree = 4; // Calculus derivative countdown (4 = x³, 3 = 3x², 2 = 6x, 1 = 6, 0 = 0!!)
  public polyResetTimer = 0;
  public derivHasteTimer = 0;
  public shieldTimer = 0;

  public skeleton: ProceduralSkeleton;
  public scarf: ScarfChain;
  public afterimages: Array<{ pose: ReturnType<ProceduralSkeleton['update']>; color: string; life: number; maxLife: number }> = [];
  public smears: Array<{ base: Vec2; tip: Vec2; color: string; life: number; maxLife: number; heavy: boolean }> = [];
  private afterimageTimer = 0;

  constructor(
    index: 0 | 1,
    name: string,
    startPos: Vec2,
    facing: 1 | -1,
    school: MathSchoolId,
    maxHp = 140,
    isBoss = false
  ) {
    this.index = index;
    this.name = name;
    this.pos = { ...startPos };
    this.facing = facing;
    this.school = school;
    this.isBoss = isBoss;
    const def = MATH_SCHOOLS[school];
    this.color = def.color;
    this.secondaryColor = def.secondaryColor;
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.delayedHp = maxHp;
    this.skeleton = new ProceduralSkeleton(this.pos);
    this.scarf = new ScarfChain(this.pos.x, this.pos.y - 68);
  }

  public setSchool(school: MathSchoolId): void {
    this.school = school;
    const def = MATH_SCHOOLS[school];
    this.color = def.color;
    this.secondaryColor = def.secondaryColor;
  }

  public reset(startPos: Vec2, facing: 1 | -1): void {
    this.pos = { ...startPos };
    this.vel = { x: 0, y: 0 };
    this.facing = facing;
    this.hp = this.maxHp;
    this.delayedHp = this.maxHp;
    this.energy = 35;
    this.guardMeter = 100;
    this.action = 'idle';
    this.actionFrames = 0;
    this.onGround = false;
    this.jumpsLeft = 2;
    this.attackKind = null;
    this.attackHitIds.clear();
    this.comboStep = 0;
    this.comboWindowFrames = 0;
    this.queuedCombo = null;
    this.chargeFrames = 0;
    this.lastAimAngle = null;
    this.parryWindowFrames = 0;
    this.dashCooldown = 0;
    this.dashInvulnFrames = 0;
    this.hitstunFrames = 0;
    this.invulnFrames = 0;
    this.hurtFlashFrames = 0;
    this.comboReceived = 0;
    this.operators = [];
    this.polyDegree = 4;
    this.polyResetTimer = 0;
    this.derivHasteTimer = 0;
    this.shieldTimer = 0;
    this.afterimages = [];
    this.smears = [];
    this.scarf.reset(this.pos.x, this.pos.y - 68);
  }

  public addOperator(op: MathOperatorId): void {
    if (this.operators.length >= 2) {
      this.operators.shift();
    }
    this.operators.push(op);
  }

  public addEnergy(v: number): void {
    this.energy = clamp(this.energy + v, 0, this.maxEnergy);
  }

  public getHurtbox(): Rect {
    const h = this.action === 'crouch' ? 54 : 84;
    return { x: this.pos.x - 19, y: this.pos.y - h, w: 38, h };
  }

  public activeCastId: string | null = null;
  public activeCastCap = 0;

  public getMoveSpec(): {
    startup: number;
    active: number;
    recovery: number;
    reach: number;
    height: number;
    offsetY: number;
    damage: number;
    lungeX: number;
    lungeY?: number;
    kbX: number;
    kbY: number;
    hitstun: number;
    guardBreak?: boolean;
    superArmor?: boolean;
  } | null {
    if (!this.attackKind) return null;
    const s = MATH_SCHOOLS[this.school];
    const dm = s.damageMult;
    switch (this.attackKind) {
      case 'light1':
        return {
          startup: 4, active: 5, recovery: 8, reach: 94, height: 58, offsetY: -46,
          damage: this.school === 'golden' ? 5 : Math.round(6 * dm),
          lungeX: 175, kbX: 190, kbY: -75, hitstun: 15,
        };
      case 'light2':
        return {
          startup: 5, active: 5, recovery: 9, reach: 104, height: 64, offsetY: -46,
          damage: this.school === 'golden' ? 8 : Math.round(8 * dm),
          lungeX: 210, kbX: 230, kbY: -110, hitstun: 17,
        };
      case 'light3': {
        // Golden ratio follows exact Fibonacci 5 -> 8 -> 13!
        const fibReach = this.school === 'golden' ? 128 : 114;
        return {
          startup: 6, active: 7, recovery: 13,
          reach: fibReach, height: 76, offsetY: -48,
          damage: this.school === 'golden' ? 13 : Math.round(11 * dm),
          lungeX: 260, kbX: 460, kbY: -220, hitstun: 24,
        };
      }
      case 'up_light':
        return { startup: 5, active: 6, recovery: 12, reach: 88, height: 96, offsetY: -70, damage: Math.round(8 * dm), lungeX: 110, lungeY: -270, kbX: 110, kbY: -500, hitstun: 25 };
      case 'air_light':
        return { startup: 4, active: 7, recovery: 10, reach: 92, height: 78, offsetY: -38, damage: Math.round(9 * dm), lungeX: 150, kbX: 240, kbY: 290, hitstun: 20 };
      case 'heavy':
        // Short cast swing so ranged formula heavies NEVER double-dip melee + projectile!
        return {
          startup: 9, active: 6, recovery: 16,
          reach: 62, height: 64, offsetY: -46,
          damage: 5, lungeX: 140, kbX: 260, kbY: -120, hitstun: 18,
          guardBreak: false, superArmor: true,
        };
      case 'super':
        return {
          startup: 12, active: 18, recovery: 15,
          reach: 120, height: 96, offsetY: -50,
          damage: 8, lungeX: 300, kbX: 380, kbY: -200, hitstun: 28,
          guardBreak: true, superArmor: true,
        };
    }
  }

  public getActiveHitbox(): Rect | null {
    if (this.action !== 'attack' && this.action !== 'super_active') return null;
    const m = this.getMoveSpec();
    if (!m) return null;
    if (this.actionFrames < m.startup || this.actionFrames >= m.startup + m.active) return null;
    const x = this.facing > 0 ? this.pos.x - 8 : this.pos.x + 8 - m.reach;
    return { x, y: this.pos.y + m.offsetY - m.height * 0.5, w: m.reach, h: m.height };
  }

  public hasSuperArmor(): boolean {
    if (this.action === 'super_startup' || this.action === 'super_active') return true;
    if (this.shieldTimer > 0) return true;
    if (this.action === 'attack') {
      const m = this.getMoveSpec();
      if (m?.superArmor && this.actionFrames >= 4) return true;
    }
    return this.action === 'charge' && this.chargeFrames > 22;
  }

  public spawnAfterimage(color?: string): void {
    const p = this.skeleton.pose;
    const cp = (v: Vec2) => ({ x: v.x, y: v.y });
    this.afterimages.push({
      pose: {
        head: cp(p.head), neck: cp(p.neck), chest: cp(p.chest), hip: cp(p.hip),
        lShoulder: cp(p.lShoulder), lElbow: cp(p.lElbow), lHand: cp(p.lHand),
        rShoulder: cp(p.rShoulder), rElbow: cp(p.rElbow), rHand: cp(p.rHand),
        lKnee: cp(p.lKnee), lFoot: cp(p.lFoot), rKnee: cp(p.rKnee), rFoot: cp(p.rFoot),
        weaponBase: cp(p.weaponBase), weaponTip: cp(p.weaponTip),
        offhandWeaponTip: null, headTilt: p.headTilt,
      },
      color: color ?? this.color,
      life: 0.26,
      maxLife: 0.26,
    });
  }

  public stepTimersAndSkeleton(dt: number): void {
    this.animPhase += dt;
    this.actionFrames++;

    if (this.delayedHp > this.hp) this.delayedHp = Math.max(this.hp, this.delayedHp - 44 * dt);
    else this.delayedHp = this.hp;

    if (this.dashCooldown > 0) this.dashCooldown--;
    if (this.dashInvulnFrames > 0) this.dashInvulnFrames--;
    if (this.invulnFrames > 0) this.invulnFrames--;
    if (this.parryWindowFrames > 0) this.parryWindowFrames--;
    if (this.comboWindowFrames > 0) this.comboWindowFrames--;
    if (this.hurtFlashFrames > 0) this.hurtFlashFrames--;
    if (this.dropThroughFrames > 0) this.dropThroughFrames--;
    if (this.derivHasteTimer > 0) this.derivHasteTimer = Math.max(0, this.derivHasteTimer - dt);
    if (this.shieldTimer > 0) this.shieldTimer = Math.max(0, this.shieldTimer - dt);
    if (this.polyDegree < 4) {
      this.polyResetTimer -= dt;
      if (this.polyResetTimer <= 0) this.polyDegree = 4;
    }

    if (this.action !== 'block' && this.action !== 'guard_break') {
      this.guardMeter = Math.min(100, this.guardMeter + 16 * dt);
    }

    for (let i = this.afterimages.length - 1; i >= 0; i--) {
      this.afterimages[i].life -= dt;
      if (this.afterimages[i].life <= 0) this.afterimages.splice(i, 1);
    }
    for (let i = this.smears.length - 1; i >= 0; i--) {
      this.smears[i].life -= dt;
      if (this.smears[i].life <= 0) this.smears.splice(i, 1);
    }

    if (this.action === 'dash' || this.action === 'super_active') {
      this.afterimageTimer += dt;
      if (this.afterimageTimer >= 0.036) {
        this.afterimageTimer = 0;
        this.spawnAfterimage(this.school === 'euler' ? '#9b8aff' : this.color);
      }
    }

    // Map MathSchool -> closest martial arts ProceduralSkeleton pose family
    const poseWeapon =
      this.school === 'calculus'
        ? 'eraser'
        : this.school === 'trig'
          ? 'pencil'
          : this.school === 'golden'
            ? 'whip'
            : this.school === 'euclid'
              ? 'boomerang'
              : 'ruler';

    const m = this.getMoveSpec();
    let attackPhase: 'startup' | 'active' | 'recovery' = 'startup';
    let attackProgress = 0;
    if (m && (this.action === 'attack' || this.action === 'super_active')) {
      const total = Math.max(1, m.startup + m.active + m.recovery);
      attackProgress = clamp(this.actionFrames / total, 0, 1);
      if (this.actionFrames < m.startup) attackPhase = 'startup';
      else if (this.actionFrames < m.startup + m.active) attackPhase = 'active';
      else attackPhase = 'recovery';
    }

    const pose = this.skeleton.update(
      {
        pos: this.pos,
        vx: this.vel.x,
        vy: this.vel.y,
        facing: this.facing,
        action: this.action,
        actionTime: this.actionFrames / 60,
        animPhase: this.animPhase,
        weapon: poseWeapon,
        attackKind: this.attackKind,
        attackProgress,
        attackPhase,
        chargeRatio: clamp(this.chargeFrames / this.maxChargeFrames, 0, 1),
        onGround: this.onGround,
      },
      dt
    );

    this.scarf.update(pose.neck, this.facing, this.vel.x, this.animPhase);

    if ((this.action === 'attack' && attackPhase === 'active') || this.action === 'super_active') {
      const isHeavy = this.attackKind === 'heavy' || this.attackKind === 'super' || this.attackKind === 'light3';
      this.smears.push({
        base: { ...pose.weaponBase },
        tip: { ...pose.weaponTip },
        color: this.attackKind === 'super' ? this.secondaryColor : this.color,
        life: isHeavy ? 0.16 : 0.1,
        maxLife: isHeavy ? 0.16 : 0.1,
        heavy: isHeavy,
      });
    }
  }

  public updateVisualsOnly(dt: number): void {
    this.animPhase += dt;
    for (let i = this.afterimages.length - 1; i >= 0; i--) {
      this.afterimages[i].life -= dt;
      if (this.afterimages[i].life <= 0) this.afterimages.splice(i, 1);
    }
    for (let i = this.smears.length - 1; i >= 0; i--) {
      this.smears[i].life -= dt;
      if (this.smears[i].life <= 0) this.smears.splice(i, 1);
    }
    if (this.action === 'dash' || this.action === 'super_active') {
      this.afterimageTimer += dt;
      if (this.afterimageTimer >= 0.036) {
        this.afterimageTimer = 0;
        this.spawnAfterimage(this.school === 'euler' ? '#9b8aff' : this.color);
      }
    }
    const poseWeapon =
      this.school === 'calculus'
        ? 'eraser'
        : this.school === 'trig'
          ? 'pencil'
          : this.school === 'golden'
            ? 'whip'
            : this.school === 'euclid'
              ? 'boomerang'
              : 'ruler';

    const m = this.getMoveSpec();
    let attackPhase: 'startup' | 'active' | 'recovery' = 'startup';
    let attackProgress = 0;
    if (m && (this.action === 'attack' || this.action === 'super_active')) {
      const total = Math.max(1, m.startup + m.active + m.recovery);
      attackProgress = clamp(this.actionFrames / total, 0, 1);
      if (this.actionFrames < m.startup) attackPhase = 'startup';
      else if (this.actionFrames < m.startup + m.active) attackPhase = 'active';
      else attackPhase = 'recovery';
    }

    const pose = this.skeleton.update(
      {
        pos: this.pos,
        vx: this.vel.x,
        vy: this.vel.y,
        facing: this.facing,
        action: this.action,
        actionTime: this.actionFrames / 60,
        animPhase: this.animPhase,
        weapon: poseWeapon,
        attackKind: this.attackKind,
        attackProgress,
        attackPhase,
        chargeRatio: clamp(this.chargeFrames / this.maxChargeFrames, 0, 1),
        onGround: this.onGround,
      },
      dt
    );
    this.scarf.update(pose.neck, this.facing, this.vel.x, this.animPhase);

    if ((this.action === 'attack' && attackPhase === 'active') || this.action === 'super_active') {
      const isHeavy = this.attackKind === 'heavy' || this.attackKind === 'super' || this.attackKind === 'light3';
      this.smears.push({
        base: { ...pose.weaponBase },
        tip: { ...pose.weaponTip },
        color: this.attackKind === 'super' ? this.secondaryColor : this.color,
        life: isHeavy ? 0.16 : 0.1,
        maxLife: isHeavy ? 0.16 : 0.1,
        heavy: isHeavy,
      });
    }
  }
}

export interface GeoUiCallbacks {
  onHudUpdate: (hud: GeoHudSnapshot) => void;
  onMatchEnd: (winnerIdx: 0 | 1, mode: GeoMode, stageIndex: number, canAdvance: boolean, clearedAll: boolean) => void;
  onPauseChanged: (paused: boolean) => void;
}

export interface GeoMatchConfig {
  mode: GeoMode;
  p1School: MathSchoolId;
  p2School: MathSchoolId;
  theme: MathThemeId;
  trialStageIndex?: number;
}

export class MathGameManager {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private input: KeyboardInputManager;
  private sound: SoundEngine;
  private bgm: BgmEngine;
  private synth: MathSynth;
  private getAvSettings: () => AudioVisualSettings;
  private getViewport: () => { viewW: number; viewH: number; dpr: number };
  private callbacks: GeoUiCallbacks;

  private renderer = new MathRenderer();
  private camera = new Camera();

  public mode: GeoMode = 'sandbox';
  public themeId: MathThemeId = 'chalkboard';
  public sandboxInfEnergy = true;
  public sandboxDummy: GeoDummyMode = 'stand';
  public trialStageIndex = 0;

  private active = false;
  private paused = false;
  private phase: 'idle' | 'intro' | 'fighting' | 'match_over' = 'idle';
  private phaseTimer = 0;
  private roundTimer = 99;
  private bannerText = '';
  private bannerSub = '';

  private p1: MathFighter;
  private p2: MathFighter;
  private entities: MathEntity[] = [];
  private pickups: FloatingOperatorPickup[] = [];
  private warps: GridWarp[] = [];
  private particles: MathParticle[] = [];
  private popTexts: MathPopText[] = [];
  private delayedEvents: GeoDelayedEvent[] = [];
  // Per-cast total damage budget tracker preventing multi-projectile shotgun one-shots!
  private castDamageDealt = new Map<string, number>();

  private cutIn: MathCutInBanner = {
    active: false, age: 0, duration: 0.9, title: '', formula: '', sub: '', color: '#4de8ff', facing: 1,
  };
  private dimTimer = 0;
  private dimMax = 1.0;
  private spotlightPos: Vec2 | null = null;
  private pickupSpawnTimer = 3.2;

  private rafId = 0;
  private lastTs = 0;
  private accumulator = 0;
  private elapsed = 0;
  private hitstopTimer = 0;
  private slowMoTimer = 0;
  private timeScale = 1.0;
  private lastCursor = '';

  // Simple smart AI timers
  private aiDecisionTimer = 0;
  private aiPlatformCd = 0;
  private aiClimbTargetY: number | null = null;
  private aiMoveDir: -1 | 0 | 1 = 0;
  private aiWantBlock = false;
  private aiDifficulty = 0.65;

  // LAN Multiplayer (Host-authoritative 60Hz snapshots + Guest adaptive smooth interpolation)
  public lanRole: LanRole = 'none';
  private lanBestOf: LanBestOf = 3;
  private lanP1Wins = 0;
  private lanP2Wins = 0;
  private lanRound = 1;
  private lanNextRoundTimer = 0;
  private lanRemoteInput: InputState = createEmptyInput();
  private lanRemoteDecoder = new HostRemoteInputDecoder();
  private lanGuestEncoder = new GuestInputEncoder();
  private lanSnapSeq = 0;
  private lanInterp = new SnapshotInterpolator<LanGeometrySnapshot>();
  private lanOnSend: ((msg: LanPeerMessage, droppable?: boolean) => void) | null = null;
  private lanOnMatchEnd: ((winnerIdx: 0 | 1, p1Wins: number, p2Wins: number, bestOf: LanBestOf) => void) | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    input: KeyboardInputManager,
    sound: SoundEngine,
    bgm: BgmEngine,
    getAvSettings: () => AudioVisualSettings,
    getViewport: () => { viewW: number; viewH: number; dpr: number },
    callbacks: GeoUiCallbacks
  ) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.input = input;
    this.sound = sound;
    this.bgm = bgm;
    this.synth = new MathSynth(sound);
    this.getAvSettings = getAvSettings;
    this.getViewport = getViewport;
    this.callbacks = callbacks;

    this.camera.setWorldSize(GEO_WORLD_W, GEO_WORLD_H);
    this.p1 = new MathFighter(0, '小橙 (你)', { x: 460, y: GEO_FLOOR_Y }, 1, 'euler', 160);
    this.p2 = new MathFighter(1, '数理木桩', { x: 1020, y: GEO_FLOOR_Y }, -1, 'trig', 220);
  }

  public isGameplayActive(): boolean {
    return this.active && this.phase === 'fighting' && !this.paused;
  }

  public isActive(): boolean {
    return this.active;
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public setPaused(p: boolean): void {
    if (!this.active || this.lanRole !== 'none') return;
    this.paused = p;
    this.input.clearAll();
    this.callbacks.onPauseChanged(p);
  }

  public stop(): void {
    this.lanRole = 'none';
    this.active = false;
    this.paused = false;
    this.phase = 'idle';
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = 0;
    }
    this.input.clearAll();
    this.sound.setSlowMoFilter(false);
  }

  public setLanTransport(
    onSend: (msg: LanPeerMessage, droppable?: boolean) => void,
    onMatchEnd: (winnerIdx: 0 | 1, p1Wins: number, p2Wins: number, bestOf: LanBestOf) => void
  ): void {
    this.lanOnSend = onSend;
    this.lanOnMatchEnd = onMatchEnd;
  }

  public stopLanMatch(): void {
    this.lanRole = 'none';
    this.lanNextRoundTimer = 0;
    this.lanRemoteDecoder.reset();
    this.lanGuestEncoder.reset();
    this.lanInterp.reset();
    this.lanRemoteInput = createEmptyInput();
  }

  public startLanMatch(role: 'host' | 'guest', lobby: LanLobbyState): void {
    this.lanRole = role;
    this.lanBestOf = lobby.bestOf;
    this.lanP1Wins = 0;
    this.lanP2Wins = 0;
    this.lanRound = 1;
    this.lanNextRoundTimer = 0;
    this.lanRemoteDecoder.reset();
    this.lanGuestEncoder.reset();
    this.lanInterp.reset();
    this.lanRemoteInput = createEmptyInput();
    this.lanSnapSeq = 0;

    this.mode = 'versus';
    this.themeId = lobby.geoThemeId ?? 'chalkboard';
    this.paused = false;
    this.entities = [];
    this.pickups = [];
    this.warps = [];
    this.particles = [];
    this.popTexts = [];
    this.delayedEvents = [];
    this.castDamageDealt.clear();
    this.cutIn.active = false;
    this.dimTimer = 0;
    this.hitstopTimer = 0;
    this.slowMoTimer = 0;
    this.timeScale = 1.0;
    this.pickupSpawnTimer = 2.6;
    this.input.clearAll();
    this.sound.setSlowMoFilter(false);

    const hostLabel = role === 'host' ? `${lobby.hostName} (你)` : `${lobby.hostName} (房主)`;
    const guestLabel = role === 'guest' ? `${lobby.guestName} (你)` : `${lobby.guestName} (客机)`;
    this.p1 = new MathFighter(0, hostLabel, { x: 460, y: GEO_FLOOR_Y }, 1, lobby.hostSchool, 160);
    this.p2 = new MathFighter(1, guestLabel, { x: 1020, y: GEO_FLOOR_Y }, -1, lobby.guestSchool, 160);
    this.roundTimer = 99;
    this.phase = 'intro';
    this.phaseTimer = 1.25;
    this.bannerText = this.lanBestOf > 1 ? `第 1 回合 · BO${this.lanBestOf}` : '几何联机对决!';
    this.bannerSub = `${MATH_SCHOOLS[lobby.hostSchool].formula}  VS  ${MATH_SCHOOLS[lobby.guestSchool].formula}`;
    this.bgm.setIntensity('fight');

    if (role === 'host') {
      this.spawnOperatorPickupAt(740, GEO_FLOOR_Y - 125, 'pi');
      this.spawnOperatorPickupAt(740, 290, 'mul2');
    }

    this.camera.setWorldSize(GEO_WORLD_W, GEO_WORLD_H);
    this.camera.reset();
    this.ensureLoop();
    if (role === 'host') {
      this.emitLanSnapshot();
    }
  }

  private startNextLanRound(): void {
    this.lanRound++;
    this.entities = [];
    this.pickups = [];
    this.warps = [];
    this.delayedEvents = [];
    this.castDamageDealt.clear();
    this.cutIn.active = false;
    this.dimTimer = 0;
    this.input.clearAll();
    this.p1.reset({ x: 460, y: GEO_FLOOR_Y }, 1);
    this.p2.reset({ x: 1020, y: GEO_FLOOR_Y }, -1);
    this.spawnOperatorPickupAt(740, GEO_FLOOR_Y - 125, 'pi');
    this.spawnOperatorPickupAt(740, 290, 'mul2');
    this.roundTimer = 99;
    this.phase = 'intro';
    this.phaseTimer = 1.2;
    this.bannerText = `第 ${this.lanRound} 回合`;
    this.bannerSub = `比分 ${this.lanP1Wins} : ${this.lanP2Wins} (先胜 ${Math.ceil(this.lanBestOf / 2)} 局)`;
    this.synth.playEulerChord(false);
    this.emitLanFx({ kind: 'sfx', name: 'chord' });
  }

  public receiveLanInput(pkt: LanInputPacket): void {
    if (this.lanRole !== 'host') return;
    this.lanRemoteDecoder.applyPacket(pkt, this.lanRemoteInput);
  }

  public receiveLanSnapshot(snap: LanGeometrySnapshot): void {
    if (this.lanRole !== 'guest') return;
    this.lanInterp.push(snap, performance.now());
  }

  public receiveLanFx(ev: LanFxEventPayload): void {
    if (this.lanRole !== 'guest') return;
    switch (ev.kind) {
      case 'pop':
        this.spawnPopText(ev.text, ev.x, ev.y, ev.color, ev.scale ?? 1.0, ev.sub);
        break;
      case 'hit':
        this.sound.playHit(ev.dmg, !!ev.heavy, !!ev.guardBreak);
        this.spawnGlyphBurst(ev.x, ev.y, ev.color, ev.heavy ? 8 : 4);
        this.shakeCamera(ev.heavy ? 8 : 4, ev.dirX ?? 0, ev.dirY ?? 0);
        break;
      case 'parry':
        this.sound.playParry();
        this.synth.playOperatorPickup();
        this.spawnGlyphBurst(ev.x, ev.y, ev.color, 8);
        this.shakeCamera(7);
        break;
      case 'cutin':
        this.cutIn = {
          active: true,
          age: 0,
          duration: 0.92,
          title: ev.title,
          formula: ev.formula ?? '',
          sub: ev.sub ?? '',
          color: ev.color,
          facing: ev.facing,
        };
        this.triggerSpotlightDim(ev.dimDur ?? 0.9, { x: ev.fxX ?? GEO_WORLD_W * 0.5, y: ev.fxY ?? GEO_FLOOR_Y - 80 });
        this.synth.playEulerChord(true);
        break;
      case 'sfx':
        if (ev.name === 'block') this.sound.playBlock();
        else if (ev.name === 'dodge') this.synth.playPhaseDash();
        else if (ev.name === 'chord') this.synth.playEulerChord(false);
        else if (ev.name === 'chord_big') this.synth.playEulerChord(true);
        else if (ev.name === 'pickup') this.synth.playOperatorPickup();
        break;
      case 'burst':
        this.spawnGlyphBurst(ev.x, ev.y, ev.color, ev.count);
        break;
      case 'shake':
        this.shakeCamera(ev.mag, ev.dx ?? 0, ev.dy ?? 0);
        break;
      case 'match_end':
        this.phase = 'match_over';
        this.lanP1Wins = ev.p1Wins;
        this.lanP2Wins = ev.p2Wins;
        this.lanBestOf = ev.bestOf;
        this.lanOnMatchEnd?.(ev.winnerIdx, ev.p1Wins, ev.p2Wins, ev.bestOf);
        break;
    }
  }

  private emitLanFx(ev: LanFxEventPayload): void {
    if (this.lanRole !== 'host' || !this.lanOnSend) return;
    this.lanOnSend({ t: 'fx', mode: 'geometry', ev }, false);
  }

  private packGeoFighter(f: MathFighter): LanGeoFighterState {
    return {
      x: Math.round(f.pos.x * 10) / 10,
      y: Math.round(f.pos.y * 10) / 10,
      vx: Math.round(f.vel.x),
      vy: Math.round(f.vel.y),
      fc: f.facing,
      act: f.action,
      af: f.actionFrames,
      ak: f.attackKind,
      hp: Math.round(f.hp * 10) / 10,
      mhp: f.maxHp,
      dhp: Math.round(f.delayedHp * 10) / 10,
      en: Math.round(f.energy * 10) / 10,
      gm: Math.round(f.guardMeter),
      ch: f.chargeFrames,
      hf: f.hurtFlashFrames,
      pw: f.parryWindowFrames,
      sh: Math.round(f.shieldTimer * 10) / 10,
      dh: Math.round(f.derivHasteTimer * 10) / 10,
      pd: f.polyDegree,
      ops: [...f.operators],
      sc: f.school,
      cs: f.comboReceived,
      onG: f.onGround,
    };
  }

  private emitLanSnapshot(): void {
    if (this.lanRole !== 'host' || !this.lanOnSend) return;
    const phaseMap = this.phase === 'intro' || this.phase === 'fighting' || this.phase === 'match_over' ? this.phase : 'fighting';
    const snap: LanGeometrySnapshot = {
      t: 'geo_snap',
      seq: ++this.lanSnapSeq,
      ts: Math.round(performance.now()),
      phase: phaseMap,
      timer: Math.round(this.roundTimer * 10) / 10,
      bannerText: this.bannerText,
      bannerSub: this.bannerSub,
      theme: this.themeId,
      f: [this.packGeoFighter(this.p1), this.packGeoFighter(this.p2)],
      en: this.entities.map((e) => ({
        id: e.id,
        oi: e.ownerIndex,
        k: e.kind,
        x: Math.round(e.pos.x * 10) / 10,
        y: Math.round(e.pos.y * 10) / 10,
        vx: Math.round(e.vel.x),
        vy: Math.round(e.vel.y),
        ang: Math.round(e.angle * 100) / 100,
        fc: e.facing,
        r: Math.round(e.radius * 10) / 10,
        w: Math.round(e.width),
        h: Math.round(e.height),
        col: e.color,
        scol: e.secondaryColor,
        life: Math.round(e.life * 100) / 100,
        ml: e.maxLife,
        age: Math.round(e.age * 100) / 100,
        gl: e.glyph,
        amp: e.amplitude,
        wl: e.wavelength,
        sl: e.sliceCount,
        sld: e.slammed,
        sc: e.scale,
        neg: e.negated,
        imp: e.imagPhase,
      })),
      pk: this.pickups.map((pk) => ({
        id: pk.id,
        op: pk.op,
        x: Math.round(pk.pos.x),
        y: Math.round(pk.pos.y),
        baseY: pk.baseY,
        bobPhase: Math.round(pk.bobPhase * 100) / 100,
        life: Math.round(pk.life * 10) / 10,
        maxLife: pk.maxLife,
      })),
      wp: this.warps.map((w) => ({
        x: Math.round(w.x),
        y: Math.round(w.y),
        strength: Math.round(w.strength),
        radius: Math.round(w.radius),
        life: Math.round(w.life * 100) / 100,
        maxLife: w.maxLife,
        color: w.color,
      })),
      p1Wins: this.lanP1Wins,
      p2Wins: this.lanP2Wins,
      bestOf: this.lanBestOf,
    };
    this.lanOnSend(snap, true);
  }

  private applyLanGeoFighter(f: MathFighter, prev: LanGeoFighterState, next: LanGeoFighterState, alpha: number): void {
    const dist = Math.hypot(next.x - prev.x, next.y - prev.y);
    if (dist > 260) {
      f.pos.x = next.x;
      f.pos.y = next.y;
    } else {
      f.pos.x = lerp(prev.x, next.x, alpha);
      f.pos.y = lerp(prev.y, next.y, alpha);
    }
    f.vel.x = lerp(prev.vx, next.vx, alpha);
    f.vel.y = lerp(prev.vy, next.vy, alpha);
    f.facing = next.fc;
    f.action = next.act as MathFighter['action'];
    f.actionFrames = next.af;
    f.attackKind = next.ak as MathFighter['attackKind'];
    f.hp = next.hp;
    f.maxHp = next.mhp;
    f.delayedHp = next.dhp;
    f.energy = next.en;
    f.guardMeter = next.gm;
    f.chargeFrames = next.ch;
    f.hurtFlashFrames = next.hf;
    f.parryWindowFrames = next.pw;
    f.shieldTimer = next.sh;
    f.derivHasteTimer = next.dh;
    f.polyDegree = next.pd;
    f.operators = [...next.ops];
    if (f.school !== next.sc) f.setSchool(next.sc);
    f.comboReceived = next.cs;
    f.onGround = next.onG;
  }

  private tickLanGuest(realDt: number): void {
    // 1. Compute Guest local 360-degree aim relative to Guest's own fighter (P2) & transmit input immediately!
    const canControl = this.phase === 'fighting';
    this.resolveAimForPlayer(0, this.p2, this.input.p1, canControl);
    const pkt = this.lanGuestEncoder.consumeAndEncode(this.input.p1, performance.now());
    if (pkt && this.lanOnSend) {
      this.lanOnSend(pkt, false);
    }

    // 2. Sample adaptive low-latency snapshot buffer & smoothly interpolate fighters & math constructs!
    const sample = this.lanInterp.sample(performance.now());
    if (sample) {
      const { prev, next, alpha } = sample;
      this.phase = next.phase;
      this.roundTimer = next.timer;
      this.bannerText = next.bannerText;
      this.bannerSub = next.bannerSub;
      this.themeId = next.theme;
      this.lanP1Wins = next.p1Wins;
      this.lanP2Wins = next.p2Wins;
      this.lanBestOf = next.bestOf;

      this.applyLanGeoFighter(this.p1, prev.f[0], next.f[0], alpha);
      this.applyLanGeoFighter(this.p2, prev.f[1], next.f[1], alpha);

      const prevEntMap = new Map(prev.en.map((e) => [e.id, e]));
      this.entities = next.en.map((ne) => {
        const pe = prevEntMap.get(ne.id);
        const ex = pe && Math.hypot(ne.x - pe.x, ne.y - pe.y) < 300 ? lerp(pe.x, ne.x, alpha) : ne.x;
        const ey = pe && Math.hypot(ne.x - pe.x, ne.y - pe.y) < 300 ? lerp(pe.y, ne.y, alpha) : ne.y;
        return {
          id: ne.id,
          ownerIndex: ne.oi,
          kind: ne.k,
          pos: { x: ex, y: ey },
          vel: { x: ne.vx, y: ne.vy },
          angle: ne.ang,
          facing: ne.fc,
          radius: ne.r,
          width: ne.w,
          height: ne.h,
          damage: 0,
          knockbackX: 0,
          knockbackY: 0,
          color: ne.col,
          secondaryColor: ne.scol,
          life: ne.life,
          maxLife: ne.ml,
          age: ne.age,
          hitIds: new Set(),
          glyph: ne.gl,
          amplitude: ne.amp,
          wavelength: ne.wl,
          sliceCount: ne.sl,
          slammed: ne.sld,
          scale: ne.sc,
          negated: ne.neg,
          imagPhase: ne.imp,
        };
      });

      this.pickups = next.pk.map((pk) => ({
        id: pk.id,
        op: pk.op,
        pos: { x: pk.x, y: pk.y },
        baseY: pk.baseY,
        bobPhase: pk.bobPhase,
        life: pk.life,
        maxLife: pk.maxLife,
      }));
      this.warps = next.wp.map((w) => ({ ...w }));
    }

    // 3. Full 60/120fps local skeleton, smear trails, scarf cloth & camera!
    this.p1.updateVisualsOnly(realDt);
    this.p2.updateVisualsOnly(realDt);
    this.camera.update(realDt, this.p1.pos, this.p2.pos, false);
    this.emitHud();
  }

  public startPreview(school: MathSchoolId, theme: MathThemeId): void {
    this.themeId = theme;
    this.p1.setSchool(school);
    this.p1.reset({ x: 480, y: GEO_FLOOR_Y }, 1);
    this.p2.reset({ x: 1000, y: GEO_FLOOR_Y }, -1);
    this.entities = [];
    this.pickups = [];
    this.warps = [];
    this.particles = [];
    this.popTexts = [];
    this.phase = 'idle';
    this.ensureLoop();
  }

  public startMatch(cfg: GeoMatchConfig): void {
    this.lanRole = 'none';
    this.mode = cfg.mode;
    this.themeId = cfg.theme;
    this.trialStageIndex = cfg.trialStageIndex ?? 0;
    this.paused = false;
    this.entities = [];
    this.pickups = [];
    this.warps = [];
    this.particles = [];
    this.popTexts = [];
    this.delayedEvents = [];
    this.castDamageDealt.clear();
    this.cutIn.active = false;
    this.dimTimer = 0;
    this.hitstopTimer = 0;
    this.slowMoTimer = 0;
    this.timeScale = 1.0;
    this.pickupSpawnTimer = 2.6;
    this.input.clearAll();
    this.sound.setSlowMoFilter(false);

    this.p1 = new MathFighter(0, '小橙 (你)', { x: 460, y: GEO_FLOOR_Y }, 1, cfg.p1School, 160);

    if (cfg.mode === 'trial') {
      const m = MATH_TRIAL_MASTERS[clamp(this.trialStageIndex, 0, MATH_TRIAL_MASTERS.length - 1)];
      this.p2 = new MathFighter(1, m.name, { x: 1020, y: GEO_FLOOR_Y }, -1, m.school, m.maxHp, !!m.isBoss);
      this.aiDifficulty = m.difficulty;
      this.roundTimer = 99;
      this.phase = 'intro';
      this.phaseTimer = 1.35;
      this.bannerText = m.title;
      this.bannerSub = m.quote;
      this.bgm.suggestStageTrack(m.isBoss ? 'authors_finale' : 'ink_musou');
      this.bgm.setIntensity(m.isBoss ? 'climax' : 'fight');
    } else if (cfg.mode === 'versus') {
      this.p2 = new MathFighter(1, '小蓝 (P2)', { x: 1020, y: GEO_FLOOR_Y }, -1, cfg.p2School, 160);
      this.roundTimer = 99;
      this.phase = 'intro';
      this.phaseTimer = 1.1;
      this.bannerText = '几何对决 · 开始!';
      this.bannerSub = `${MATH_SCHOOLS[cfg.p1School].formula}  VS  ${MATH_SCHOOLS[cfg.p2School].formula}`;
      this.bgm.setIntensity('fight');
    } else {
      // Sandbox Lab!
      this.p2 = new MathFighter(1, '数理木桩', { x: 1020, y: GEO_FLOOR_Y }, -1, cfg.p2School, 220);
      this.aiDifficulty = 0.55;
      this.roundTimer = 999;
      this.phase = 'fighting';
      this.bannerText = '';
      this.bannerSub = '';
      if (this.sandboxInfEnergy) this.p1.energy = 100;
      this.bgm.setIntensity('fight');
    }

    // Spawn 2 initial floating operators right away so the player sees Equation Forge immediately!
    this.spawnOperatorPickupAt(740, GEO_FLOOR_Y - 125, 'pi');
    this.spawnOperatorPickupAt(740, 290, 'mul2');

    this.camera.setWorldSize(GEO_WORLD_W, GEO_WORLD_H);
    this.camera.reset();
    this.ensureLoop();
  }

  public setP1SchoolLive(school: MathSchoolId): void {
    this.p1.setSchool(school);
    this.synth.playGoldenChime(1);
    this.spawnPopText(MATH_SCHOOLS[school].formula, this.p1.pos.x, this.p1.pos.y - 95, '#ff7a1a', 1.0, MATH_SCHOOLS[school].name);
  }

  public setThemeLive(theme: MathThemeId): void {
    this.themeId = theme;
  }

  public injectSandboxOperator(op: MathOperatorId): void {
    this.p1.addOperator(op);
    this.applyImmediateOperatorEffects(this.p1, op);
    this.synth.playOperatorPickup();
    const def = MATH_OPERATORS[op];
    this.spawnPopText(`+${def.glyph}`, this.p1.pos.x, this.p1.pos.y - 94, def.color, 1.0);
  }

  public clearP1Operators(): void {
    this.p1.operators = [];
  }

  public resetSandbox(): void {
    this.input.clearAll();
    this.p1.reset({ x: 460, y: GEO_FLOOR_Y }, 1);
    this.p2.reset({ x: 1020, y: GEO_FLOOR_Y }, -1);
    if (this.sandboxInfEnergy) this.p1.energy = 100;
    this.entities = [];
    this.warps = [];
    this.delayedEvents = [];
    this.pickups = [];
    this.spawnOperatorPickupAt(740, GEO_FLOOR_Y - 125, 'pi');
    this.spawnOperatorPickupAt(740, 290, 'imag');
    this.synth.playEulerChord(false);
  }

  private ensureLoop(): void {
    if (!this.active) {
      this.active = true;
      this.lastTs = performance.now();
      this.rafId = requestAnimationFrame(this.loop);
    }
  }

  private loop = (now: number): void => {
    if (!this.active) return;
    const rawDt = Math.min(0.05, Math.max(0.001, (now - this.lastTs) / 1000));
    this.lastTs = now;

    this.input.pollGamepads();

    if (!this.paused) {
      this.tick(rawDt);
    }
    this.renderFrame();
    this.rafId = requestAnimationFrame(this.loop);
  };

  private tick(realDt: number): void {
    this.elapsed += realDt;

    if (this.cutIn.active) {
      this.cutIn.age += realDt;
      if (this.cutIn.age >= this.cutIn.duration) this.cutIn.active = false;
    }
    if (this.dimTimer > 0) {
      this.dimTimer = Math.max(0, this.dimTimer - realDt);
    }

    // Visual effects (particles, pop-texts, spacetime grid warps) ALWAYS run smoothly every rAF frame!
    this.updateWarpsAndParticles(realDt);

    if (this.lanRole === 'guest') {
      this.tickLanGuest(realDt);
      return;
    }

    if (this.slowMoTimer > 0) {
      this.slowMoTimer -= realDt;
      if (this.slowMoTimer <= 0) {
        this.timeScale = 1.0;
        this.sound.setSlowMoFilter(false);
      }
    }

    const STEP = 1 / 60;
    if (this.hitstopTimer > 0) {
      this.hitstopTimer = Math.max(0, this.hitstopTimer - realDt);
    } else {
      // Snap slight 60Hz rAF jitter (±2.5ms) to exact STEP to prevent 0-step/2-step micro-stutter
      const smoothDt = Math.abs(realDt - STEP) < 0.0025 ? STEP : realDt;
      this.accumulator = Math.min(STEP * 2.5, this.accumulator + smoothDt * this.timeScale);
      while (this.accumulator >= STEP) {
        this.fixedUpdate(STEP);
        this.accumulator -= STEP;
      }
    }

    this.camera.update(realDt, this.p1.pos, this.p2.pos, false);
    if (this.phase !== 'idle') {
      this.emitHud();
    }
  }

  private fixedUpdate(dt: number): void {
    if (this.phase === 'idle') {
      // Gentle breathing preview behind Geometry Setup Hub!
      this.p1.stepTimersAndSkeleton(dt);
      this.p2.stepTimersAndSkeleton(dt);
      return;
    }

    // Delayed math effects
    for (let i = this.delayedEvents.length - 1; i >= 0; i--) {
      this.delayedEvents[i].timer -= dt;
      if (this.delayedEvents[i].timer <= 0) {
        const fn = this.delayedEvents[i].fn;
        this.delayedEvents.splice(i, 1);
        fn();
      }
    }

    // Best-Of multi-round transition timer for Geometry LAN Host!
    if (this.lanRole === 'host' && this.lanNextRoundTimer > 0) {
      this.lanNextRoundTimer -= dt;
      if (this.lanNextRoundTimer <= 0) {
        this.startNextLanRound();
      }
    }

    if (this.phase === 'intro') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0.38 && this.bannerText !== '求解开始!') {
        this.bannerText = '求解开始!';
        this.bannerSub = 'SOLVE & BRAWL!';
        this.synth.playEulerChord(false);
      }
      if (this.phaseTimer <= 0) {
        this.phase = 'fighting';
        this.bannerText = '';
        this.bannerSub = '';
      }
    } else if (this.phase === 'fighting') {
      if (this.mode !== 'sandbox') {
        this.roundTimer = Math.max(0, this.roundTimer - dt);
        if (this.roundTimer <= 0) {
          this.finishMatch(this.p1.hp >= this.p2.hp ? 0 : 1);
        }
      } else {
        if (this.sandboxInfEnergy) this.p1.energy = 100;
        if (this.p2.hp < this.p2.maxHp && this.p2.action !== 'hitstun') {
          this.p2.hp = Math.min(this.p2.maxHp, this.p2.hp + 45 * dt);
        }
        if (this.p1.hp < 50) {
          this.p1.hp = Math.min(this.p1.maxHp, this.p1.hp + 50 * dt);
        }
      }

      // Periodically spawn floating math operator pickups on grid intersections!
      this.pickupSpawnTimer -= dt;
      if (this.pickupSpawnTimer <= 0 && this.pickups.length < 3) {
        this.pickupSpawnTimer = 4.5 + Math.random() * 2.5;
        const spots: Vec2[] = [
          { x: 330, y: 420 },
          { x: 740, y: 295 },
          { x: 1150, y: 420 },
          { x: 560, y: GEO_FLOOR_Y - 95 },
          { x: 920, y: GEO_FLOOR_Y - 95 },
        ];
        const spot = spots[Math.floor(Math.random() * spots.length)];
        const op = SPAWNABLE_OPERATORS[Math.floor(Math.random() * SPAWNABLE_OPERATORS.length)];
        this.spawnOperatorPickupAt(spot.x, spot.y, op);
      }
    }

    const canControl = this.phase === 'fighting';

    // 360° Aim resolution for P1 & P2 (Gamepad Right Stick OR Mouse Aim)
    this.resolveAimForPlayer(0, this.p1, this.input.p1, canControl);
    if (this.mode === 'versus' && this.lanRole === 'none') {
      this.resolveAimForPlayer(1, this.p2, this.input.p2, canControl);
    }

    const p2Inp =
      this.lanRole === 'host'
        ? this.lanRemoteInput
        : this.mode === 'versus'
          ? this.input.p2
          : this.computeAiInput(dt);

    this.updateFighter(this.p1, this.p2, this.input.p1, dt, canControl);
    this.updateFighter(this.p2, this.p1, p2Inp, dt, canControl);

    decayInputBuffers(this.input.p1);
    decayInputBuffers(this.input.p2);
    if (this.lanRole === 'host') {
      decayInputBuffers(this.lanRemoteInput);
    }

    this.resolveSeparation();
    this.updatePickups(dt);
    this.updateEntities(dt);

    if (this.phase === 'fighting') {
      this.resolveMeleeCombat();
    }

    if (this.lanRole === 'host') {
      this.emitLanSnapshot();
    }
  }

  private resolveAimForPlayer(idx: 0 | 1, f: MathFighter, inp: InputState, canControl: boolean): void {
    const stick = this.input.getPlayerStickAim(idx);
    if (canControl && stick.aimAngle !== null) {
      inp.aimDir = stick.aimDir;
      inp.aimAngle = stick.aimAngle;
    } else if (canControl && this.input.doesPlayerUseMouseAim(idx) && this.input.mouseHasMoved) {
      const mw = this.camera.screenToWorld(this.input.mouseCanvasPos);
      const dx = mw.x - f.pos.x;
      const dy = mw.y - (f.pos.y - 46);
      if (Math.abs(dx) > 6) inp.aimDir = dx > 0 ? 1 : -1;
      inp.aimAngle = Math.atan2(dy, dx);
    } else {
      inp.aimDir = 0;
      inp.aimAngle = null;
    }
  }

  private updateFighter(
    f: MathFighter,
    opp: MathFighter,
    inp: InputState,
    dt: number,
    canControl: boolean
  ): void {
    const sDef = MATH_SCHOOLS[f.school];
    const hasteMult = f.derivHasteTimer > 0 ? 1.24 : 1.0;
    const moveSpeed = 400 * sDef.speedMult * hasteMult;

    if (canControl && f.action !== 'ko') {
      f.lastAimAngle = inp.aimAngle ?? null;
      this.stepFighterStateMachine(f, opp, inp, dt, moveSpeed);
    } else if (f.action === 'run' || f.action === 'charge' || f.action === 'block') {
      f.action = 'idle';
      f.vel.x *= 0.72;
    }

    // Physics integration
    const prevY = f.pos.y;
    let gravity = 1720;
    if (f.action === 'dash' || f.action === 'super_startup') gravity = 140;
    f.vel.y = Math.min(1150, f.vel.y + gravity * dt);
    f.pos.x += f.vel.x * dt;
    f.pos.y += f.vel.y * dt;

    // Arena walls
    const leftBound = 64;
    const rightBound = GEO_WORLD_W - 64;
    if (f.pos.x < leftBound) {
      f.pos.x = leftBound;
      f.vel.x = f.action === 'hitstun' && Math.abs(f.vel.x) > 340 ? Math.abs(f.vel.x) * 0.5 : Math.max(0, f.vel.x);
    } else if (f.pos.x > rightBound) {
      f.pos.x = rightBound;
      f.vel.x = f.action === 'hitstun' && Math.abs(f.vel.x) > 340 ? -Math.abs(f.vel.x) * 0.5 : Math.min(0, f.vel.x);
    }

    // Platform collisions
    const prevGround = f.onGround;
    f.onGround = false;
    f.onOneWayPlatform = false;
    if (f.vel.y >= 0) {
      for (const p of GEO_PLATFORMS) {
        if (p.oneWay && f.dropThroughFrames > 0) continue;
        if (f.pos.x + 14 >= p.x && f.pos.x - 14 <= p.x + p.w) {
          if (prevY <= p.y + 14 && f.pos.y >= p.y) {
            f.pos.y = p.y;
            f.vel.y = 0;
            f.onGround = true;
            f.onOneWayPlatform = Boolean(p.oneWay);
            f.jumpsLeft = 2;
            f.coyoteFrames = 6;
            break;
          }
        }
      }
    }
    if (!f.onGround && prevGround && f.coyoteFrames === 0) f.coyoteFrames = 6;
    if (!f.onGround && f.coyoteFrames > 0) f.coyoteFrames--;

    f.stepTimersAndSkeleton(dt);
  }

  private stepFighterStateMachine(
    f: MathFighter,
    opp: MathFighter,
    inp: InputState,
    dt: number,
    moveSpeed: number
  ): void {
    const moveDir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);

    // 1. Hitstun / Guard Break
    if (f.action === 'hitstun' || f.action === 'guard_break') {
      f.hitstunFrames--;
      f.vel.x *= f.onGround ? 0.84 : 0.96;
      if (f.hitstunFrames <= 0) {
        f.comboReceived = 0;
        f.action = f.onGround ? 'idle' : 'fall';
        f.actionFrames = 0;
      }
      return;
    }

    // 2. Parry Success
    if (f.action === 'parry_success') {
      f.vel.x *= 0.78;
      if (f.actionFrames > 14) {
        f.action = 'idle';
        f.actionFrames = 0;
      }
      if (f.actionFrames > 4 && (inp.lightPressed > 0 || inp.heavyPressed > 0 || inp.superPressed > 0)) {
        this.tryStartOffense(f, opp, inp);
      }
      return;
    }

    // 3. Super Startup & Active
    if (f.action === 'super_startup') {
      f.vel.x *= 0.72;
      f.vel.y = 0;
      if (f.actionFrames >= 14) {
        f.action = 'super_active';
        f.actionFrames = 0;
        f.attackKind = 'super';
        f.attackHitIds.clear();
        f.vel.x = f.facing * 560;
      }
      return;
    }

    if (f.action === 'super_active') {
      const m = f.getMoveSpec();
      f.vel.x *= 0.86;
      f.vel.y *= 0.5;
      if (!m || f.actionFrames >= m.active + m.recovery) {
        if (moveDir === 0) {
          f.vel.x *= 0.2;
          if (Math.abs(f.vel.x) < 35) f.vel.x = 0;
        }
        f.action = f.onGround ? 'idle' : 'fall';
        f.actionFrames = 0;
        f.attackKind = null;
      }
      return;
    }

    // 4. Dash (Euler gets ×i 90° imaginary axis phase shift!)
    if (f.action === 'dash') {
      if (f.actionFrames >= 5 && (inp.lightPressed > 0 || inp.heavyPressed > 0)) {
        this.tryStartOffense(f, opp, inp);
        return;
      }
      if (f.actionFrames >= 12) {
        if (moveDir !== 0 && Math.sign(moveDir) === Math.sign(f.vel.x)) {
          f.vel.x = clamp(f.vel.x * 0.45, -moveSpeed, moveSpeed);
        } else {
          f.vel.x *= 0.2;
          if (Math.abs(f.vel.x) < 35) f.vel.x = 0;
        }
        f.action = f.onGround ? 'idle' : 'fall';
        f.actionFrames = 0;
      }
      return;
    }

    // 5. Charging Heavy Formula
    if (f.action === 'charge') {
      f.vel.x *= 0.75;
      f.chargeFrames = Math.min(f.maxChargeFrames, f.chargeFrames + 1);
      if (inp.aimDir) f.facing = inp.aimDir;
      else if (Math.abs(opp.pos.x - f.pos.x) > 10) f.facing = opp.pos.x >= f.pos.x ? 1 : -1;

      if (!inp.heavy || f.chargeFrames >= f.maxChargeFrames + 14) {
        f.lastChargeRatio = f.chargeFrames / f.maxChargeFrames;
        this.startAttack(f, 'heavy');
      } else if (inp.dashPressed > 0 && f.dashCooldown <= 0) {
        this.startDash(f, inp);
      }
      return;
    }

    // 6. Active Attack
    if (f.action === 'attack') {
      const m = f.getMoveSpec();
      if (!m) {
        f.action = 'idle';
        return;
      }

      if (f.actionFrames === m.startup && !f.hasTriggeredActive) {
        f.hasTriggeredActive = true;
        const chargeBoost = f.attackKind === 'heavy' ? 1 + f.lastChargeRatio * 0.26 : 1;
        f.vel.x = f.facing * m.lungeX * chargeBoost;
        if (m.lungeY) {
          f.vel.y = m.lungeY;
          f.onGround = false;
        }

        // School-specific active-frame math spawns!
        if (f.attackKind === 'heavy') {
          this.fireSchoolHeavyFormula(f);
        } else if (f.attackKind === 'light3') {
          this.fireSchoolComboFinisher(f, opp);
        } else {
          this.sound.playWhoosh(0.55);
        }
      }

      // Crisp damping both on ground & in air (zero skating!)
      f.vel.x *= f.onGround ? 0.78 : 0.9;

      if (inp.lightPressed > 0 && f.actionFrames >= m.startup) {
        if (f.attackKind === 'light1') f.queuedCombo = 'light2';
        else if (f.attackKind === 'light2') f.queuedCombo = 'light3';
        inp.lightPressed = 0;
      }

      if (f.actionFrames >= m.startup + m.active && inp.dashPressed > 0 && f.dashCooldown <= 0) {
        this.startDash(f, inp);
        return;
      }

      if (f.queuedCombo && f.actionFrames >= m.startup + m.active + 2) {
        const next = f.queuedCombo;
        f.queuedCombo = null;
        if (inp.aimDir) f.facing = inp.aimDir;
        else if (Math.abs(opp.pos.x - f.pos.x) > 12) f.facing = opp.pos.x >= f.pos.x ? 1 : -1;
        this.startAttack(f, next);
        return;
      }

      if (f.actionFrames >= m.startup + m.active + m.recovery) {
        if (moveDir === 0) {
          f.vel.x *= 0.25;
          if (Math.abs(f.vel.x) < 35) f.vel.x = 0;
        }
        f.action = f.onGround ? 'idle' : 'fall';
        f.actionFrames = 0;
        f.attackKind = null;
        f.comboWindowFrames = 18;
      }
      return;
    }

    // 7. Block / Parry
    if (f.action === 'block') {
      f.vel.x *= 0.75;
      if (inp.aimDir) f.facing = inp.aimDir;
      else if (Math.abs(opp.pos.x - f.pos.x) > 12) f.facing = opp.pos.x >= f.pos.x ? 1 : -1;
      if (!inp.block) {
        f.action = f.onGround ? 'idle' : 'fall';
        f.actionFrames = 0;
      } else if (inp.dashPressed > 0 && f.dashCooldown <= 0) {
        this.startDash(f, inp);
      }
      return;
    }

    // 8. Neutral Checks
    if (inp.superPressed > 0 && f.energy >= f.maxEnergy) {
      inp.superPressed = 0;
      this.startSuper(f, opp, inp);
      return;
    }
    if (inp.dashPressed > 0 && f.dashCooldown <= 0) {
      this.startDash(f, inp);
      return;
    }
    if (inp.blockPressed > 0 || (inp.block && f.onGround)) {
      if (inp.blockPressed > 0) {
        f.parryWindowFrames = 11;
        inp.blockPressed = 0;
      }
      f.action = 'block';
      f.actionFrames = 0;
      return;
    }
    if (inp.lightPressed > 0 || inp.heavyPressed > 0) {
      this.tryStartOffense(f, opp, inp);
      return;
    }

    // Horizontal Movement (anti-drift crisp stopping!)
    if (inp.aimDir) f.facing = inp.aimDir;
    if (moveDir !== 0) {
      if (!inp.aimDir) f.facing = moveDir > 0 ? 1 : -1;
      const accel = f.onGround ? 2900 : 1850;
      f.vel.x = clamp(f.vel.x + moveDir * accel * dt, -moveSpeed, moveSpeed);
    } else {
      f.vel.x *= f.onGround ? 0.64 : 0.92;
      if (Math.abs(f.vel.x) < 18) f.vel.x = 0;
    }

    // Drop through one-way math bar (Double-tap Down S×2/↓×2 OR Down + Jump!)
    if (
      f.onGround &&
      f.onOneWayPlatform &&
      (inp.dropThroughPressed > 0 || (inp.down && inp.jumpPressed > 0))
    ) {
      if (inp.dropThroughPressed > 0) {
        inp.dropThroughPressed = 0;
      } else {
        inp.jumpPressed = 0;
      }
      f.dropThroughFrames = 16;
      f.pos.y += 5;
      f.onGround = false;
      f.onOneWayPlatform = false;
      f.vel.y = 140;
      f.action = 'fall';
      f.actionFrames = 0;
      return;
    }

    // Jump & Double Jump
    if (inp.jumpPressed > 0) {
      if (f.onGround || f.coyoteFrames > 0) {
        inp.jumpPressed = 0;
        f.vel.y = -660;
        f.onGround = false;
        f.coyoteFrames = 0;
        f.jumpsLeft = 1;
        f.action = 'jump';
        f.actionFrames = 0;
        this.sound.playJump(false);
        return;
      } else if (f.jumpsLeft > 0) {
        inp.jumpPressed = 0;
        f.vel.y = -590;
        f.jumpsLeft--;
        f.action = 'jump';
        f.actionFrames = 0;
        this.sound.playJump(true);
        this.spawnGlyphBurst(f.pos.x, f.pos.y - 10, f.color, 5);
        return;
      }
    }

    // Visual action (ONLY 'run' when moveDir !== 0!)
    if (f.onGround) {
      if (inp.down) {
        f.action = 'crouch';
        f.vel.x *= 0.76;
      } else if (moveDir !== 0 && Math.abs(f.vel.x) > 25) {
        f.action = 'run';
      } else {
        f.action = 'idle';
      }
    } else {
      f.action = f.vel.y < 0 ? 'jump' : 'fall';
    }
  }

  private tryStartOffense(f: MathFighter, opp: MathFighter, inp: InputState): void {
    if (inp.superPressed > 0 && f.energy >= f.maxEnergy) {
      inp.superPressed = 0;
      this.startSuper(f, opp, inp);
      return;
    }
    if (inp.aimDir) f.facing = inp.aimDir;
    else if (inp.left && !inp.right) f.facing = -1;
    else if (inp.right && !inp.left) f.facing = 1;
    else if (Math.abs(opp.pos.x - f.pos.x) > 12) f.facing = opp.pos.x >= f.pos.x ? 1 : -1;

    if (inp.heavyPressed > 0) {
      inp.heavyPressed = 0;
      if (f.onGround && inp.heavy) {
        f.action = 'charge';
        f.actionFrames = 0;
        f.chargeFrames = 0;
        f.lastChargeRatio = 0;
      } else {
        f.lastChargeRatio = 0.35;
        this.startAttack(f, 'heavy');
      }
      return;
    }

    if (inp.lightPressed > 0) {
      inp.lightPressed = 0;
      if (!f.onGround) this.startAttack(f, 'air_light');
      else if (inp.up) this.startAttack(f, 'up_light');
      else {
        let k: 'light1' | 'light2' | 'light3' = 'light1';
        if (f.comboWindowFrames > 0) {
          if (f.comboStep === 1) k = 'light2';
          else if (f.comboStep === 2) k = 'light3';
        }
        this.startAttack(f, k);
      }
    }
  }

  private startAttack(f: MathFighter, kind: NonNullable<MathFighter['attackKind']>): void {
    f.action = 'attack';
    f.actionFrames = 0;
    f.attackKind = kind;
    f.attackHitIds.clear();
    f.queuedCombo = null;
    f.hasTriggeredActive = false;
    if (kind === 'light1') f.comboStep = 1;
    else if (kind === 'light2') f.comboStep = 2;
    else f.comboStep = 0;
  }

  private startDash(f: MathFighter, inp: InputState): void {
    inp.dashPressed = 0;
    if (inp.left && !inp.right) f.facing = -1;
    else if (inp.right && !inp.left) f.facing = 1;
    else if (inp.aimDir) f.facing = inp.aimDir;

    f.action = 'dash';
    f.actionFrames = 0;
    f.attackKind = null;
    f.dashCooldown = f.derivHasteTimer > 0 ? 18 : 26;
    // Euler school ×i imaginary-axis phase dash gets extended invuln & special glyph!
    f.dashInvulnFrames = f.school === 'euler' ? 14 : 10;
    f.vel.x = f.facing * (f.school === 'euler' ? 840 : 780);
    f.vel.y = f.onGround ? 0 : Math.min(f.vel.y, -40);
    f.spawnAfterimage();

    if (f.school === 'euler') {
      this.synth.playPhaseDash();
      this.spawnPopText('×i', f.pos.x, f.pos.y - 72, '#ffffff', 0.96);
    } else if (f.school === 'trig') {
      this.synth.playSineBeam();
    } else {
      this.sound.playDash();
    }
    this.spawnGlyphBurst(f.pos.x, f.pos.y - 36, f.color, 5);
  }

  // ==================== EQUATION FORGE & SCHOOL FORMULAS ====================
  private applyImmediateOperatorEffects(f: MathFighter, op: MathOperatorId): void {
    if (op === 'deriv') {
      f.derivHasteTimer = Math.max(f.derivHasteTimer, 5.0);
    } else if (op === 'integ') {
      f.addEnergy(22);
      f.guardMeter = Math.min(100, f.guardMeter + 32);
    }
  }

  private consumeOperatorsAndCheckCombo(
    f: MathFighter,
    opp: MathFighter
  ): {
    countMult: number;
    dmgMult: number;
    sizeMult: number;
    negated: boolean;
    piOrbit: boolean;
    imagPhase: boolean;
    guardBreak: boolean;
    hasPow2: boolean;
  } {
    const ops = [...f.operators];
    f.operators = [];

    const combo = detectIdentityCombo(f.school, ops);
    if (combo) {
      this.triggerIdentityCombo(f, opp, combo);
    }

    const has = (id: MathOperatorId) => ops.includes(id);
    const hasPow2 = has('pow2');
    const dmgMult = hasPow2 ? 1.25 : 1.0;
    const sizeMult = hasPow2 ? 1.3 : 1.0;
    const countMult = has('mul2') ? 2 : 1;
    const negated = has('neg');
    const piOrbit = has('pi');
    const imagPhase = has('imag');

    if (ops.length > 0 && !combo) {
      const label = ops.map((o) => MATH_OPERATORS[o].glyph).join(' ');
      this.spawnPopText(`[ ${label} ]`, f.pos.x, f.pos.y - 94, MATH_OPERATORS[ops[0]].color, 0.92);
    }

    return {
      countMult,
      dmgMult,
      sizeMult,
      negated,
      piOrbit,
      imagPhase,
      guardBreak: hasPow2 || imagPhase,
      hasPow2,
    };
  }

  private triggerIdentityCombo(f: MathFighter, opp: MathFighter, comboId: IdentityComboId): void {
    const def = IDENTITY_COMBOS[comboId];
    this.synth.playIdentityTrigger();
    this.triggerCutIn(def.title, def.formula, `${f.name} · 恒等式共鸣`, def.color, f.facing);
    this.triggerSpotlightDim(0.68, f.pos);

    if (comboId === 'euler_zero') {
      for (let i = this.entities.length - 1; i >= 0; i--) {
        if (this.entities[i].ownerIndex !== f.index) {
          this.spawnGlyphBurst(this.entities[i].pos.x, this.entities[i].pos.y, '#f2c14e', 4);
          this.entities.splice(i, 1);
        }
      }
      this.warps.push({ x: f.pos.x, y: f.pos.y - 46, strength: -44, radius: 400, life: 0.7, maxLife: 0.7, color: '#f2c14e' });
      this.shakeCamera(11);
      if (opp.action !== 'ko') {
        const dir = Math.sign(opp.pos.x - f.pos.x || f.facing);
        this.applyMathDamage(f, opp, 14, dir * 480, -240, 0.016, 24, true, true, opp.pos, 'e^(iπ)+1=0');
      }
    } else if (comboId === 'pythagorean_one') {
      f.hp = Math.min(f.maxHp, f.hp + 18);
      f.shieldTimer = 3.5;
      this.spawnPopText('sin²+cos² = 1', f.pos.x, f.pos.y - 102, '#ffffff', 0.96, '+18 HP');
    } else if (comboId === 'ftc_cycle') {
      f.addEnergy(35);
      f.derivHasteTimer = 5.0;
      this.spawnPopText('d/dx · ∫', f.pos.x, f.pos.y - 102, '#f2c14e', 0.96, '+35%');
    } else if (comboId === 'div_zero') {
      const cid = `div0_${mathUidCounter++}`;
      this.spawnSingularity(f, { x: opp.pos.x, y: opp.pos.y - 54 }, 0.75, cid, 18);
    }
  }

  private fireSchoolComboFinisher(f: MathFighter, opp: MathFighter): void {
    const sDef = MATH_SCHOOLS[f.school];
    if (f.school === 'euler') {
      this.synth.playEulerChord(false);
      const ang = Math.atan2(opp.pos.y - 46 - (f.pos.y - 46), opp.pos.x - f.pos.x);
      this.entities.push(this.makeEntity(f.index, 'euler_echo', { x: f.pos.x + f.facing * 40, y: f.pos.y - 48 }, ang, f.facing, 660, 20, 40, 40, 6, 220, -110, sDef.color, sDef.secondaryColor, 0.85));
    } else if (f.school === 'trig') {
      this.synth.playSineBeam();
      this.entities.push(this.makeEntity(f.index, 'tan_slash', { x: f.pos.x + f.facing * 92, y: f.pos.y - 48 }, 0, f.facing, 0, 34, 54, 240, 7, 240, -280, sDef.color, sDef.secondaryColor, 0.34));
    } else if (f.school === 'algebra') {
      this.synth.playSplitPop(0);
      const ang = f.lastAimAngle ?? (f.facing > 0 ? 0 : Math.PI);
      const e = this.makeEntity(f.index, 'arith_glyph', { x: f.pos.x + Math.cos(ang) * 40, y: f.pos.y - 48 + Math.sin(ang) * 20 }, ang, f.facing, 740, 20, 38, 38, 6, 210, -100, sDef.color, sDef.secondaryColor, 0.68);
      e.glyph = '×';
      this.entities.push(e);
    } else if (f.school === 'golden') {
      this.synth.playGoldenChime(2);
    } else {
      this.sound.playWhoosh(0.8);
    }
  }

  private fireSchoolHeavyFormula(f: MathFighter): void {
    const opp = f.index === 0 ? this.p2 : this.p1;
    if (f.lastAimAngle !== null) {
      const c = Math.cos(f.lastAimAngle);
      if (Math.abs(c) > 0.12) f.facing = c >= 0 ? 1 : -1;
    }
    const baseAng = f.lastAimAngle ?? (f.facing > 0 ? 0 : Math.PI);
    const mod = this.consumeOperatorsAndCheckCombo(f, opp);
    const hasteSpd = f.derivHasteTimer > 0 ? 1.22 : 1.0;
    // Balanced charge boost (+26% max) & charge-aware Heavy cap: tap 17 -> full charge 22 (+4 with x²)
    const chargeBoost = 1 + f.lastChargeRatio * 0.26;
    const sDef = MATH_SCHOOLS[f.school];
    const fanAngles = mod.countMult > 1 ? [-0.15, 0.15] : [0];
    const castId = `hvy_${mathUidCounter++}`;
    const baseCap = Math.round(17 + f.lastChargeRatio * 5);
    const castCap = mod.hasPow2 ? baseCap + 4 : baseCap;
    f.activeCastId = castId;
    f.activeCastCap = castCap;

    for (const off of fanAngles) {
      const ang = baseAng + off;
      const pFacing: 1 | -1 = Math.cos(ang) >= 0 ? 1 : -1;
      const sx = f.pos.x + Math.cos(ang) * 48;
      const sy = f.pos.y - 48 + Math.sin(ang) * 24;

      if (f.school === 'euler') {
        this.synth.playEulerChord(false);
        const e = this.makeEntity(
          f.index, 'euler_disc', { x: sx, y: sy }, ang, pFacing,
          590 * hasteSpd, 32 * mod.sizeMult, 64 * mod.sizeMult, 64 * mod.sizeMult,
          Math.round(14 * chargeBoost * mod.dmgMult), 420, -190,
          sDef.color, sDef.secondaryColor, 1.0, castId, castCap
        );
        e.negated = mod.negated; e.imagPhase = mod.imagPhase; e.guardBreak = mod.guardBreak;
        this.entities.push(e);
      } else if (f.school === 'golden') {
        this.synth.playGoldenChime(1);
        const e = this.makeEntity(
          f.index, 'golden_spiral', { x: sx, y: sy }, ang, pFacing,
          640 * hasteSpd, 38 * mod.sizeMult, 92 * mod.sizeMult, 64 * mod.sizeMult,
          Math.round(14 * chargeBoost * mod.dmgMult), 440, -200,
          sDef.color, sDef.secondaryColor, 0.9, castId, castCap
        );
        e.scale = mod.sizeMult * (0.9 + f.lastChargeRatio * 0.3);
        e.negated = mod.negated; e.imagPhase = mod.imagPhase; e.guardBreak = mod.guardBreak;
        this.entities.push(e);
      } else if (f.school === 'trig') {
        this.synth.playSineBeam();
        const e = this.makeEntity(
          f.index, 'sine_wave', { x: sx + Math.cos(ang) * 42, y: sy + Math.sin(ang) * 24 }, ang, pFacing,
          700 * hasteSpd, 34 * mod.sizeMult, 165 * mod.sizeMult, 60 * mod.sizeMult,
          Math.round(13 * chargeBoost * mod.dmgMult), 410, -180,
          sDef.color, sDef.secondaryColor, 0.92, castId, castCap
        );
        e.amplitude = (26 + f.lastChargeRatio * 14) * mod.sizeMult;
        e.wavelength = 96;
        e.negated = mod.negated; e.imagPhase = mod.imagPhase; e.guardBreak = mod.guardBreak;
        this.entities.push(e);
      } else if (f.school === 'calculus') {
        this.synth.playIntegralSlam();
        const fx = clamp(f.pos.x + f.facing * (160 + off * 210), 120, GEO_WORLD_W - 120);
        const slices = Math.round(6 + f.lastChargeRatio * 14);
        const e = this.makeEntity(
          f.index, 'riemann_field', { x: fx, y: GEO_FLOOR_Y }, 0, f.facing,
          0, 84 * mod.sizeMult, 185 * mod.sizeMult, 148 * mod.sizeMult,
          Math.round(16 * chargeBoost * mod.dmgMult), 420, -290,
          sDef.color, sDef.secondaryColor, 0.76, castId, castCap
        );
        e.sliceCount = slices; e.slammed = false;
        e.negated = mod.negated; e.imagPhase = mod.imagPhase; e.guardBreak = true;
        this.entities.push(e);
      } else if (f.school === 'algebra') {
        this.synth.playSplitPop(0);
        const e = this.makeEntity(
          f.index, 'exp_orb', { x: sx, y: sy }, ang, pFacing,
          560 * hasteSpd, 21 * mod.sizeMult, 42 * mod.sizeMult, 42 * mod.sizeMult,
          Math.round(10 * chargeBoost * mod.dmgMult), 310, -150,
          sDef.color, sDef.secondaryColor, 1.05, castId, castCap
        );
        e.glyph = '2'; e.splitDepth = 0; e.splitTimer = 0.26;
        e.negated = mod.negated; e.imagPhase = mod.imagPhase; e.guardBreak = mod.guardBreak;
        this.entities.push(e);
      } else {
        this.synth.playTesseractPulse();
        const e = this.makeEntity(
          f.index, 'fractal_tri', { x: sx, y: sy }, ang, pFacing,
          620 * hasteSpd, 28 * mod.sizeMult, 54 * mod.sizeMult, 54 * mod.sizeMult,
          Math.round(11 * chargeBoost * mod.dmgMult), 350, -170,
          sDef.color, sDef.secondaryColor, 1.0, castId, castCap
        );
        e.splitDepth = 0; e.splitTimer = 0.3;
        e.negated = mod.negated; e.imagPhase = mod.imagPhase; e.guardBreak = mod.guardBreak;
        this.entities.push(e);
      }
    }

    if (mod.piOrbit) {
      for (const aOff of [-0.52, 0.52]) {
        const a = baseAng + aOff;
        const g = this.makeEntity(f.index, 'arith_glyph', { x: f.pos.x, y: f.pos.y - 48 }, a, Math.cos(a) >= 0 ? 1 : -1, 720, 18, 36, 36, 6, 220, -110, '#ffffff', '#f2c14e', 0.78, castId, castCap);
        g.glyph = 'π';
        this.entities.push(g);
      }
    }
  }

  private startSuper(f: MathFighter, opp: MathFighter, inp: InputState): void {
    f.energy = 0;
    if (inp.aimDir) f.facing = inp.aimDir;
    else if (inp.left && !inp.right) f.facing = -1;
    else if (inp.right && !inp.left) f.facing = 1;
    else if (Math.abs(opp.pos.x - f.pos.x) > 10) f.facing = opp.pos.x >= f.pos.x ? 1 : -1;

    const castDir: 1 | -1 = f.facing;
    const aimBase = inp.aimAngle ?? (castDir > 0 ? 0 : Math.PI);
    f.lastAimAngle = inp.aimAngle ?? null;
    f.action = 'super_startup';
    f.actionFrames = 0;
    f.attackKind = 'super';
    f.attackHitIds.clear();
    f.invulnFrames = 36;
    f.vel.x = 0;
    f.vel.y = 0;

    const mod = this.consumeOperatorsAndCheckCombo(f, opp);
    const castId = `sup_${mathUidCounter++}`;
    const castCap = mod.hasPow2 ? 40 : 35;
    f.activeCastId = castId;
    f.activeCastCap = castCap;

    const sDef = MATH_SCHOOLS[f.school];
    this.triggerCutIn(sDef.superName, sDef.superFormula, `${f.name} · 终极数学公式`, sDef.color, castDir);
    this.triggerSpotlightDim(1.05, f.pos);
    this.camera.punchFocus(f.pos, 1.18, 0.42);
    // Keep 1.0 full-speed 60/120fps silky smoothness during Supers (zero 30fps slow-mo stutter!)
    this.slowMoTimer = 0;
    this.timeScale = 1.0;

    const dmgBoost = mod.dmgMult;

    if (f.school === 'euler') {
      this.synth.playEulerChord(true);
      const planeCenter: Vec2 = { x: clamp(f.pos.x + castDir * 120, 240, GEO_WORLD_W - 240), y: Math.min(f.pos.y - 84, 510) };
      this.entities.push(this.makeEntity(f.index, 'euler_plane', planeCenter, 0, castDir, 0, 200, 400, 400, 0, 0, 0, sDef.color, sDef.secondaryColor, 1.22));
      this.warps.push({ x: planeCenter.x, y: planeCenter.y, strength: 34, radius: 420, life: 1.05, maxLife: 1.05, color: sDef.color });

      this.delayedEvents.push({
        timer: 0.28,
        fn: () => {
          if (this.phase !== 'fighting') return;
          for (const angOff of [-0.32, 0, 0.32]) {
            const a = aimBase + angOff;
            this.entities.push(
              this.makeEntity(f.index, 'euler_echo', { x: planeCenter.x, y: planeCenter.y }, a, Math.cos(a) >= 0 ? 1 : -1, 740, 24, 48, 48, Math.round(7 * dmgBoost), 300, -150, sDef.color, sDef.secondaryColor, 0.88, castId, castCap)
            );
          }
        },
      });
      this.delayedEvents.push({
        timer: 0.8,
        fn: () => {
          if (this.phase !== 'fighting') return;
          this.synth.playIdentityTrigger();
          this.shakeCamera(12);
          this.warps.push({ x: planeCenter.x, y: planeCenter.y, strength: -58, radius: 480, life: 0.52, maxLife: 0.52, color: '#f2c14e' });
          this.spawnGlyphBurst(planeCenter.x, planeCenter.y, '#f2c14e', 12);
          for (let i = this.entities.length - 1; i >= 0; i--) {
            if (this.entities[i].ownerIndex !== f.index) this.entities.splice(i, 1);
          }
          if (opp.action !== 'ko' && Math.hypot(opp.pos.x - planeCenter.x, opp.pos.y - 46 - planeCenter.y) < 360) {
            this.applyMathDamage(f, opp, Math.round(20 * dmgBoost), castDir * 620, -300, 0.018, 34, true, true, opp.pos, 'e^(iπ)+1=0', castId, castCap);
          }
        },
      });
    } else if (f.school === 'golden') {
      this.synth.playGoldenChime(0);
      const center: Vec2 = { x: clamp(f.pos.x + castDir * 165, 220, GEO_WORLD_W - 220), y: f.pos.y - 80 };
      const gg = this.makeEntity(f.index, 'golden_grid', center, 0, castDir, 0, 220, 440, 440, 0, 0, 0, sDef.color, sDef.secondaryColor, 1.3);
      gg.pullForce = 380;
      this.entities.push(gg);
      this.warps.push({ x: center.x, y: center.y, strength: 42, radius: 420, life: 1.15, maxLife: 1.15, color: sDef.color });

      // Exact Fibonacci 5-hit sequence: 2 + 3 + 5 + 8 + 13 = 31 DMG!
      [2, 3, 5, 8, 13].forEach((fib, idx) => {
        this.delayedEvents.push({
          timer: 0.22 + idx * 0.16,
          fn: () => {
            if (this.phase !== 'fighting') return;
            this.synth.playGoldenChime(idx);
            this.spawnGlyphBurst(center.x, center.y, '#f2c14e', 4 + idx);
            if (opp.action !== 'ko' && Math.hypot(opp.pos.x - center.x, opp.pos.y - 46 - center.y) < 290) {
              const isLast = idx === 4;
              this.applyMathDamage(
                f, opp,
                Math.round(fib * dmgBoost),
                isLast ? castDir * 640 : Math.sign(center.x - opp.pos.x) * 120,
                isLast ? -320 : -95,
                isLast ? 0.018 : 0,
                isLast ? 34 : 14,
                isLast,
                false,
                opp.pos,
                isLast ? 'φ = 1.618' : `Fib ${fib}`,
                castId,
                castCap
              );
            }
          },
        });
      });
    } else if (f.school === 'trig') {
      this.synth.playSineBeam();
      const center: Vec2 = { x: f.pos.x, y: Math.min(f.pos.y - 120, 380) };
      this.entities.push(this.makeEntity(f.index, 'trig_circle', center, 0, castDir, 0, 135, 270, 270, 0, 0, 0, sDef.color, sDef.secondaryColor, 1.15));
      for (let k = -1; k <= 1; k++) {
        this.delayedEvents.push({
          timer: 0.2 + (k + 1) * 0.15,
          fn: () => {
            if (this.phase !== 'fighting') return;
            this.synth.playSineBeam();
            const ang = aimBase + k * 0.22;
            const sw = this.makeEntity(f.index, 'sine_wave', { x: f.pos.x + Math.cos(ang) * 48, y: f.pos.y - 48 + Math.sin(ang) * 28 }, ang, Math.cos(ang) >= 0 ? 1 : -1, 760, 32, 170, 60, Math.round(11 * dmgBoost), 420, -190, sDef.color, sDef.secondaryColor, 0.88, castId, castCap);
            sw.amplitude = 34;
            sw.wavelength = 90;
            this.entities.push(sw);
          },
        });
      }
    } else if (f.school === 'calculus') {
      this.synth.playIntegralSlam();
      const tx = opp.pos.x;
      const ty = opp.pos.y - 54;
      const tl = this.makeEntity(f.index, 'taylor_lock', { x: tx, y: ty }, 0, castDir, 0, 155, 330, 210, 0, 0, 0, sDef.color, sDef.secondaryColor, 1.2);
      this.entities.push(tl);
      this.delayedEvents.push({
        timer: 0.56,
        fn: () => {
          if (this.phase !== 'fighting') return;
          this.synth.playDerivativeSlash(0);
          this.shakeCamera(11);
          this.spawnGlyphBurst(tl.pos.x, tl.pos.y, '#ef5350', 12);
          if (opp.action !== 'ko' && Math.hypot(opp.pos.x - tl.pos.x, opp.pos.y - 46 - tl.pos.y) < 245) {
            opp.polyDegree = 4;
            this.applyMathDamage(f, opp, Math.round(28 * dmgBoost), castDir * 640, -320, 0.018, 36, true, false, opp.pos, 'Σ P₄(x)', castId, castCap);
          }
        },
      });
    } else if (f.school === 'algebra') {
      const sx = clamp(f.pos.x + castDir * 200, 180, GEO_WORLD_W - 180);
      this.spawnSingularity(f, { x: sx, y: Math.min(f.pos.y - 90, 460) }, dmgBoost, castId, castCap);
    } else {
      this.synth.playTesseractPulse();
      const center: Vec2 = { x: clamp(f.pos.x + castDir * 145, 220, GEO_WORLD_W - 220), y: Math.min(f.pos.y - 94, 485) };
      this.entities.push(this.makeEntity(f.index, 'tesseract', center, 0, castDir, 0, 170, 340, 340, 0, 0, 0, sDef.color, sDef.secondaryColor, 1.4));
      for (let i = 0; i < 4; i++) {
        this.delayedEvents.push({
          timer: 0.22 + i * 0.14,
          fn: () => {
            if (this.phase !== 'fighting') return;
            this.synth.playTesseractPulse();
            // Respect explicit mouse aimAngle; otherwise sweep downward along castDir toward grounded targets
            let waveBase = aimBase;
            if (inp.aimAngle === undefined) {
              const dx = Math.sign(opp.pos.x - center.x) === castDir && Math.abs(opp.pos.x - center.x) > 36
                ? opp.pos.x - center.x
                : castDir * 220;
              const dy = (opp.pos.y - 48) - center.y;
              waveBase = Math.atan2(dy, dx);
            }
            const ang = waveBase + (i - 1.5) * 0.16;
            const ft = this.makeEntity(f.index, 'fractal_tri', { x: center.x, y: center.y }, ang, Math.cos(ang) >= 0 ? 1 : -1, 680, 28, 52, 52, Math.round(9 * dmgBoost), 380, -190, sDef.color, sDef.secondaryColor, 0.92, castId, castCap);
            ft.splitDepth = 1;
            this.entities.push(ft);
          },
        });
      }
      this.delayedEvents.push({
        timer: 0.84,
        fn: () => {
          if (this.phase !== 'fighting') return;
          this.synth.playTesseractPulse();
          this.shakeCamera(10);
          this.spawnGlyphBurst(center.x, center.y, '#ffffff', 12);
          if (opp.action !== 'ko' && Math.hypot(opp.pos.x - center.x, opp.pos.y - 46 - center.y) < 285) {
            this.applyMathDamage(f, opp, Math.round(14 * dmgBoost), castDir * 560, -280, 0.018, 30, true, false, opp.pos, 'ℝ⁴ → ℝ²', castId, castCap);
          }
        },
      });
    }
  }

  private spawnSingularity(f: MathFighter, pos: Vec2, dmgBoost = 1.0, castId?: string, castCap = 35): void {
    this.synth.playSingularityWarp();
    const s = this.makeEntity(f.index, 'singularity', pos, 0, f.facing, 0, 140, 280, 280, Math.round(18 * dmgBoost), 0, 0, '#ffffff', '#ef5350', 1.45, castId, castCap);
    s.pullForce = 620;
    s.tickTimer = 0.36;
    this.entities.push(s);
    this.warps.push({ x: pos.x, y: pos.y, strength: 78, radius: 460, life: 1.45, maxLife: 1.45, color: '#ef5350' });
  }

  private makeEntity(
    ownerIndex: 0 | 1,
    kind: MathEntity['kind'],
    pos: Vec2,
    angle: number,
    facing: 1 | -1,
    speed: number,
    radius: number,
    width: number,
    height: number,
    damage: number,
    knockbackX: number,
    knockbackY: number,
    color: string,
    secondaryColor: string,
    life: number,
    castId?: string,
    castCap?: number
  ): MathEntity {
    return {
      id: `me_${mathUidCounter++}`,
      ownerIndex,
      kind,
      pos: { ...pos },
      vel: { x: Math.cos(angle) * speed, y: Math.sin(angle) * speed },
      angle,
      facing,
      radius,
      width,
      height,
      damage,
      knockbackX,
      knockbackY,
      color,
      secondaryColor,
      life,
      maxLife: life,
      age: 0,
      hitIds: new Set(),
      castId,
      castCap,
    };
  }

  private spawnOperatorPickupAt(x: number, y: number, op: MathOperatorId): void {
    this.pickups.push({
      id: `op_${mathUidCounter++}`,
      op,
      pos: { x, y },
      baseY: y,
      bobPhase: Math.random() * Math.PI * 2,
      life: 15,
      maxLife: 15,
    });
  }

  private updatePickups(dt: number): void {
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.life -= dt;
      pk.pos.y = pk.baseY + Math.sin(this.elapsed * 3.5 + pk.bobPhase) * 8;
      if (pk.life <= 0) {
        this.pickups.splice(i, 1);
        continue;
      }

      let taken = false;
      for (const f of [this.p1, this.p2]) {
        if (f.action === 'ko') continue;
        if (Math.hypot(pk.pos.x - f.pos.x, pk.pos.y - (f.pos.y - 44)) < 44) {
          f.addOperator(pk.op);
          this.applyImmediateOperatorEffects(f, pk.op);
          this.synth.playOperatorPickup();
          const def = MATH_OPERATORS[pk.op];
          this.spawnPopText(`+${def.glyph}`, pk.pos.x, pk.pos.y - 20, def.color, 0.98);
          this.spawnGlyphBurst(pk.pos.x, pk.pos.y, def.color, 5);
          taken = true;
          break;
        }
      }
      if (taken) this.pickups.splice(i, 1);
    }
  }

  private updateEntities(dt: number): void {
    for (let i = this.entities.length - 1; i >= 0; i--) {
      const e = this.entities[i];
      e.life -= dt;
      e.age += dt;
      if (e.life <= 0 || e.pos.x < -280 || e.pos.x > GEO_WORLD_W + 280 || e.pos.y < -280 || e.pos.y > GEO_WORLD_H + 260) {
        // Final explosion for ÷0 Singularity!
        if (e.kind === 'singularity' && e.life <= 0) {
          this.synth.playIdentityTrigger();
          this.shakeCamera(12);
          this.spawnGlyphBurst(e.pos.x, e.pos.y, '#ef5350', 12);
          this.warps.push({ x: e.pos.x, y: e.pos.y, strength: -68, radius: 460, life: 0.48, maxLife: 0.48, color: '#f2c14e' });
          const atk = e.ownerIndex === 0 ? this.p1 : this.p2;
          const def = e.ownerIndex === 0 ? this.p2 : this.p1;
          if (def.action !== 'ko' && Math.hypot(def.pos.x - e.pos.x, def.pos.y - 46 - e.pos.y) < 250) {
            const dir = Math.sign(def.pos.x - e.pos.x || atk.facing);
            this.applyMathDamage(atk, def, e.damage, dir * 640, -320, 0.018, 34, true, false, def.pos, 'x/0 → ∞', e.castId, e.castCap);
          }
        }
        this.entities.splice(i, 1);
        continue;
      }

      // Exponential 2^n Orb Mid-Flight Split (clean 1-stage split: 2 -> 4, capped by shared castId!)
      if (e.kind === 'exp_orb' && (e.splitDepth ?? 0) < 1 && e.splitTimer !== undefined) {
        e.splitTimer -= dt;
        if (e.splitTimer <= 0) {
          e.splitDepth = 1;
          e.glyph = '4';
          this.synth.playSplitPop(1);
          for (const dAng of [-0.24, 0.24]) {
            const na = e.angle + dAng;
            const child = this.makeEntity(
              e.ownerIndex, 'exp_orb', e.pos, na, Math.cos(na) >= 0 ? 1 : -1,
              580, Math.max(15, e.radius * 0.85), e.width * 0.85, e.height * 0.85,
              Math.max(5, Math.round(e.damage * 0.7)), 240, -130, e.color, e.secondaryColor, 0.65,
              e.castId, e.castCap
            );
            child.glyph = '4';
            child.splitDepth = 1;
            child.negated = e.negated;
            child.imagPhase = e.imagPhase;
            this.entities.push(child);
          }
        }
      }

      // Sierpinski Fractal Triangle Mid-Flight Split (inherits shared castId damage cap!)
      if (e.kind === 'fractal_tri' && (e.splitDepth ?? 0) < 1 && e.splitTimer !== undefined) {
        e.splitTimer -= dt;
        if (e.splitTimer <= 0) {
          e.splitDepth = 1;
          this.synth.playSplitPop(1);
          for (const dAng of [-0.3, 0.3]) {
            const na = e.angle + dAng;
            const child = this.makeEntity(
              e.ownerIndex, 'fractal_tri', e.pos, na, Math.cos(na) >= 0 ? 1 : -1,
              640, e.radius * 0.68, e.width * 0.68, e.height * 0.68,
              Math.max(5, Math.round(e.damage * 0.65)), 260, -140, e.secondaryColor, e.color, 0.6,
              e.castId, e.castCap
            );
            child.splitDepth = 1;
            child.negated = e.negated;
            child.imagPhase = e.imagPhase;
            this.entities.push(child);
          }
        }
      }

      // Riemann Sum Field Slam timing!
      if (e.kind === 'riemann_field' && !e.slammed && e.age >= 0.24) {
        e.slammed = true;
        this.shakeCamera(8, 0, 1);
        this.spawnGlyphBurst(e.pos.x, e.pos.y - 40, e.color, 7);
      }

      // Gravitational Pull for Golden Grid & ÷0 Singularity!
      if ((e.kind === 'singularity' || e.kind === 'golden_grid') && e.pullForce) {
        const def = e.ownerIndex === 0 ? this.p2 : this.p1;
        if (def.action !== 'ko') {
          const dx = e.pos.x - def.pos.x;
          const dy = e.pos.y - (def.pos.y - 46);
          const dist = Math.hypot(dx, dy);
          if (dist < 420 && dist > 18) {
            def.vel.x += (dx / dist) * e.pullForce * dt;
            def.vel.y += (dy / dist) * e.pullForce * 0.45 * dt;
          }
        }
        if (e.kind === 'singularity' && e.tickTimer !== undefined) {
          e.tickTimer -= dt;
          if (e.tickTimer <= 0) {
            e.tickTimer = 0.38;
            const atk = e.ownerIndex === 0 ? this.p1 : this.p2;
            if (def.action !== 'ko' && Math.hypot(def.pos.x - e.pos.x, def.pos.y - 46 - e.pos.y) < 155) {
              this.applyMathDamage(atk, def, 5, 0, -80, 0, 10, false, false, def.pos, '÷0', e.castId, e.castCap);
            }
          }
        }
      }

      // Negated (-) Operator projectiles reflect opposing projectiles on contact!
      if (e.negated && e.damage > 0) {
        for (const other of this.entities) {
          if (other.id === e.id || other.ownerIndex === e.ownerIndex || other.damage <= 0) continue;
          if (Math.hypot(other.pos.x - e.pos.x, other.pos.y - e.pos.y) < e.radius + other.radius) {
            other.ownerIndex = e.ownerIndex;
            other.vel.x = -other.vel.x * 1.15;
            other.vel.y = -other.vel.y * 1.15;
            other.angle = Math.atan2(other.vel.y, other.vel.x);
            other.facing = (-other.facing) as 1 | -1;
            other.hitIds.clear();
            this.spawnPopText('×(−1)', other.pos.x, other.pos.y - 24, '#ef5350', 0.95);
          }
        }
      }

      e.pos.x += e.vel.x * dt;
      e.pos.y += e.vel.y * dt;

      // Hit Detection for Damaging Math Projectiles & Slammed Riemann Fields
      if (e.damage <= 0) continue;
      if (e.kind === 'riemann_field' && !e.slammed) continue;
      if (e.kind === 'singularity') continue;

      const atk = e.ownerIndex === 0 ? this.p1 : this.p2;
      const def = e.ownerIndex === 0 ? this.p2 : this.p1;
      if (def.action === 'ko' || e.hitIds.has(def.uid)) continue;

      const pb: Rect =
        e.kind === 'riemann_field'
          ? { x: e.pos.x - e.width * 0.5, y: e.pos.y - e.height, w: e.width, h: e.height }
          : { x: e.pos.x - e.width * 0.5, y: e.pos.y - e.height * 0.5, w: e.width, h: e.height };

      if (!rectsOverlap(pb, def.getHurtbox())) continue;

      if (def.dashInvulnFrames > 0) {
        this.triggerPerfectDodge(def);
        e.hitIds.add(def.uid);
        continue;
      }
      if (def.invulnFrames > 0) continue;

      // Perfect Parry reflects formula projectiles AND extracts a math operator into defender's Forge!
      if (
        def.action === 'block' &&
        def.parryWindowFrames > 0 &&
        e.kind !== 'riemann_field' &&
        e.kind !== 'tan_slash'
      ) {
        e.ownerIndex = def.index;
        e.facing = (-e.facing) as 1 | -1;
        e.vel.x = -e.vel.x * 1.25;
        e.vel.y = -e.vel.y * 1.25;
        e.angle = Math.atan2(e.vel.y, e.vel.x);
        e.life = e.maxLife;
        e.hitIds.clear();
        def.action = 'parry_success';
        def.actionFrames = 0;
        def.addEnergy(22);
        const extracted = SPAWNABLE_OPERATORS[Math.floor(Math.random() * SPAWNABLE_OPERATORS.length)];
        def.addOperator(extracted);
        this.applyImmediateOperatorEffects(def, extracted);
        this.sound.playParry();
        this.synth.playOperatorPickup();
        this.spawnPopText('弹反', e.pos.x, e.pos.y - 20, '#f2c14e', 1.0, `+ ${MATH_OPERATORS[extracted].glyph}`);
        this.hitstopTimer = Math.max(this.hitstopTimer, 0.012);
        this.shakeCamera(7);
        continue;
      }

      e.hitIds.add(def.uid);
      const dirSign = e.vel.x !== 0 ? Math.sign(e.vel.x) : e.facing;
      const kbX = e.negated ? -dirSign * 380 : e.knockbackX * dirSign;
      this.applyMathDamage(
        atk,
        def,
        e.damage,
        kbX,
        e.knockbackY,
        0,
        20,
        !!e.guardBreak,
        !!e.imagPhase,
        e.pos,
        e.kind === 'riemann_field' ? '∫ dx' : e.kind === 'sine_wave' ? 'sin(x)' : e.kind === 'euler_disc' ? 'e^(iθ)' : '',
        e.castId,
        e.castCap
      );

      // Consume single-hit orbs (keep piercing beams & fields alive!)
      if (e.kind === 'exp_orb' || e.kind === 'arith_glyph' || e.kind === 'euler_echo') {
        this.entities.splice(i, 1);
      }
    }
  }

  private resolveMeleeCombat(): void {
    const pairs: Array<[MathFighter, MathFighter]> = [
      [this.p1, this.p2],
      [this.p2, this.p1],
    ];
    for (const [atk, def] of pairs) {
      if (atk.action === 'ko' || def.action === 'ko') continue;
      const box = atk.getActiveHitbox();
      if (!box || atk.attackHitIds.has(def.uid)) continue;
      const m = atk.getMoveSpec();
      if (!m) continue;
      if (!rectsOverlap(box, def.getHurtbox())) continue;

      if (def.dashInvulnFrames > 0) {
        atk.attackHitIds.add(def.uid);
        this.triggerPerfectDodge(def);
        continue;
      }
      if (def.invulnFrames > 0) continue;

      atk.attackHitIds.add(def.uid);
      const hitPos: Vec2 = { x: (atk.pos.x + def.pos.x) * 0.5, y: def.pos.y - 46 };
      const chargeMult = atk.attackKind === 'heavy' ? 1 + atk.lastChargeRatio * 0.26 : 1;
      const dmg = Math.round(m.damage * chargeMult);

      const isCastMove = atk.attackKind === 'heavy' || atk.attackKind === 'super';
      this.applyMathDamage(
        atk,
        def,
        dmg,
        m.kbX * chargeMult * atk.facing,
        m.kbY,
        0,
        m.hitstun,
        !!m.guardBreak,
        false,
        hitPos,
        atk.school === 'golden' && atk.attackKind === 'light3' ? 'φ · 13' : atk.school === 'calculus' ? 'd/dx' : '',
        isCastMove ? atk.activeCastId ?? undefined : undefined,
        isCastMove ? atk.activeCastCap : undefined
      );

      // Anti-drift melee contact damping (matches v0.2.3 crisp feel!)
      if (atk.action === 'attack' || atk.action === 'super_active') {
        atk.vel.x *= 0.32;
      }

      // Calculus Passive: Derivative Order Reduction (x³ -> 3x² -> 6x -> 6 -> 0!! Balanced +10 Guard-Break Burst!)
      if (atk.school === 'calculus' && def.hp > 0) {
        def.polyDegree = Math.max(0, def.polyDegree - 1);
        def.polyResetTimer = 5.5;
        this.synth.playDerivativeSlash(def.polyDegree);
        if (def.polyDegree === 0) {
          def.polyDegree = 4;
          this.shakeCamera(9);
          this.spawnGlyphBurst(def.pos.x, def.pos.y - 48, '#ef5350', 9);
          this.applyMathDamage(atk, def, 10, atk.facing * 460, -280, 0.016, 26, true, true, def.pos, 'd/dx = 0');
        }
      }
    }
  }

  private triggerPerfectDodge(f: MathFighter): void {
    f.addEnergy(16);
    this.synth.playPhaseDash();
    const txt = f.school === 'euler' ? '×i' : 'Δx';
    this.spawnPopText(txt, f.pos.x, f.pos.y - 82, f.color, 0.96);
    this.spawnGlyphBurst(f.pos.x, f.pos.y - 44, f.color, 5);
    this.emitLanFx({ kind: 'pop', x: Math.round(f.pos.x), y: Math.round(f.pos.y - 82), text: txt, color: f.color, scale: 0.96 });
    this.emitLanFx({ kind: 'sfx', name: 'dodge' });
  }

  private applyMathDamage(
    atk: MathFighter,
    def: MathFighter,
    damage: number,
    kbX: number,
    kbY: number,
    hitstop: number,
    hitstun: number,
    guardBreak: boolean,
    ignoreBlock: boolean,
    hitPos: Vec2,
    label: string,
    castId?: string,
    castCap?: number
  ): void {
    // Trial Mode Stage 4/5 AI gentle PvE damage scaling (Versus/LAN PvP stay 100% symmetrical!)
    const trialAiScale = this.mode === 'trial' && atk.index === 1 && def.index === 0 && this.trialStageIndex >= 3 ? 0.88 : 1.0;
    const scaledDamage = Math.max(1, Math.round(damage * trialAiScale));
    const scaledCap = castCap && castCap > 0 ? Math.max(1, Math.round(castCap * trialAiScale)) : castCap;

    // Enforce strict per-cast damage cap so multi-hit/split formulas stay fair & never one-shot!
    let cappedDmg = scaledDamage;
    if (castId && scaledCap && scaledCap > 0) {
      const dealt = this.castDamageDealt.get(castId) ?? 0;
      const rem = Math.max(0, scaledCap - dealt);
      if (rem <= 0) return;
      cappedDmg = Math.min(scaledDamage, rem);
    }

    const facingAtk = (atk.pos.x - def.pos.x) * def.facing >= -18;
    const isBlocking = !ignoreBlock && def.action === 'block' && facingAtk;

    if (isBlocking && def.parryWindowFrames > 0) {
      def.action = 'parry_success';
      def.actionFrames = 0;
      def.parryWindowFrames = 0;
      def.addEnergy(20);
      def.guardMeter = Math.min(100, def.guardMeter + 32);
      const extracted = SPAWNABLE_OPERATORS[Math.floor(Math.random() * SPAWNABLE_OPERATORS.length)];
      def.addOperator(extracted);
      this.applyImmediateOperatorEffects(def, extracted);

      if (atk.action !== 'super_active') {
        atk.action = 'hitstun';
        atk.actionFrames = 0;
        atk.hitstunFrames = 24;
        atk.attackKind = null;
        atk.vel.x = -atk.facing * 320;
      }
      this.sound.playParry();
      this.synth.playOperatorPickup();
      this.spawnPopText('弹反', hitPos.x, hitPos.y - 16, '#f2c14e', 1.0, `+ ${MATH_OPERATORS[extracted].glyph}`);
      this.spawnGlyphBurst(hitPos.x, hitPos.y, '#f2c14e', 8);
      this.emitLanFx({ kind: 'parry', x: Math.round(hitPos.x), y: Math.round(hitPos.y), color: '#f2c14e' });
      this.emitLanFx({ kind: 'pop', x: Math.round(hitPos.x), y: Math.round(hitPos.y - 16), text: '弹反', sub: `+ ${MATH_OPERATORS[extracted].glyph}`, color: '#f2c14e', scale: 1.0 });
      this.hitstopTimer = Math.max(this.hitstopTimer, 0.012);
      this.shakeCamera(7);
      return;
    }

    if (isBlocking) {
      def.guardMeter -= cappedDmg * (guardBreak ? 2.4 : 1.3);
      if (guardBreak || def.guardMeter <= 0) {
        def.guardMeter = 0;
        def.action = 'guard_break';
        def.actionFrames = 0;
        def.hitstunFrames = 38;
        def.hp = Math.max(1, def.hp - Math.round(cappedDmg * 0.45));
        def.vel.x = kbX * 0.48;
        def.vel.y = -170;
        this.sound.playHit(cappedDmg, true, true);
        this.spawnPopText('破防', hitPos.x, hitPos.y - 14, '#ef4747', 1.0);
        this.emitLanFx({ kind: 'hit', x: Math.round(hitPos.x), y: Math.round(hitPos.y), color: '#ef4747', dmg: cappedDmg, heavy: true, guardBreak: true, dirX: Math.sign(kbX) });
        this.emitLanFx({ kind: 'pop', x: Math.round(hitPos.x), y: Math.round(hitPos.y - 14), text: '破防', color: '#ef4747', scale: 1.0 });
        this.hitstopTimer = Math.max(this.hitstopTimer, 0.012);
        this.shakeCamera(9);
        return;
      }
      def.hp = Math.max(1, def.hp - Math.max(1, Math.round(cappedDmg * 0.2)));
      def.vel.x = Math.sign(kbX) * 190;
      atk.addEnergy(5);
      def.addEnergy(7);
      this.sound.playBlock();
      this.spawnPopText('挡', hitPos.x, hitPos.y, '#ffffff', 0.86);
      this.emitLanFx({ kind: 'sfx', name: 'block' });
      this.emitLanFx({ kind: 'pop', x: Math.round(hitPos.x), y: Math.round(hitPos.y), text: '挡', color: '#ffffff', scale: 0.86 });
      return;
    }

    // Pythagorean Absolute-One Shield reduces incoming damage by 40%!
    const finalDmg = def.shieldTimer > 0 ? Math.max(1, Math.round(cappedDmg * 0.6)) : cappedDmg;
    if (castId && castCap && castCap > 0) {
      this.castDamageDealt.set(castId, (this.castDamageDealt.get(castId) ?? 0) + finalDmg);
      if (this.castDamageDealt.size > 40) {
        const firstKey = this.castDamageDealt.keys().next().value;
        if (firstKey) this.castDamageDealt.delete(firstKey);
      }
    }

    def.hp = Math.max(0, def.hp - finalDmg);
    def.hurtFlashFrames = 5;
    def.comboReceived++;
    atk.addEnergy(Math.round(finalDmg * 0.65));
    def.addEnergy(Math.round(finalDmg * 0.42));

    const hitCol = label === 'd/dx = 0' || label === '÷0' || label === 'x/0 → ∞'
      ? '#ef5350'
      : atk.index === 0
        ? '#ff7a1a'
        : '#ffffff';
    this.spawnGlyphBurst(hitPos.x, hitPos.y, hitCol, finalDmg >= 14 ? 8 : 4);
    const popMain = label ? label : `−${finalDmg}`;
    const popSub = label && finalDmg >= 10 ? `−${finalDmg}` : undefined;
    this.spawnPopText(popMain, hitPos.x, hitPos.y - 14, hitCol, finalDmg >= 16 ? 1.04 : 0.92, popSub);
    this.sound.playHit(finalDmg, finalDmg >= 14, false);
    this.emitLanFx({
      kind: 'hit',
      x: Math.round(hitPos.x),
      y: Math.round(hitPos.y),
      color: hitCol,
      dmg: finalDmg,
      heavy: finalDmg >= 14,
      dirX: Math.sign(kbX),
    });
    this.emitLanFx({
      kind: 'pop',
      x: Math.round(hitPos.x),
      y: Math.round(hitPos.y - 14),
      text: popMain,
      sub: popSub,
      color: hitCol,
      scale: finalDmg >= 16 ? 1.04 : 0.92,
    });

    if (def.hp <= 0) {
      if (this.mode === 'sandbox') {
        def.hp = def.maxHp;
      } else {
        def.action = 'ko';
        def.vel.x = kbX * 1.1;
        def.vel.y = Math.min(-340, kbY);
        this.finishMatch(atk.index);
        return;
      }
    }

    if (!def.hasSuperArmor()) {
      def.action = 'hitstun';
      def.actionFrames = 0;
      def.attackKind = null;
      def.hitstunFrames = hitstun;
      def.vel.x = kbX;
      def.vel.y = kbY;
      if (kbY < -80) def.onGround = false;
    }

    if (hitstop > 0) {
      this.hitstopTimer = Math.max(this.hitstopTimer, Math.min(0.012, hitstop));
    }
    this.shakeCamera(finalDmg >= 16 ? 8 : 4, Math.sign(kbX), 0);
  }

  private finishMatch(winnerIdx: 0 | 1): void {
    if (this.phase !== 'fighting') return;
    this.phase = 'match_over';
    this.input.clearAll();
    const winner = winnerIdx === 0 ? this.p1 : this.p2;
    winner.action = 'victory';
    this.synth.playEulerChord(true);
    this.triggerSpotlightDim(1.1, winner.pos);

    if (this.lanRole === 'host') {
      if (winnerIdx === 0) this.lanP1Wins++;
      else this.lanP2Wins++;
      const neededWins = Math.ceil(this.lanBestOf / 2);
      const matchDone = this.lanP1Wins >= neededWins || this.lanP2Wins >= neededWins;
      this.bannerText = matchDone ? 'Q.E.D. 证毕!!' : `${winner.name} 拿下本局!`;
      this.bannerSub = `当前比分 ${this.lanP1Wins} : ${this.lanP2Wins} (BO${this.lanBestOf})`;
      this.emitLanFx({ kind: 'sfx', name: 'chord_big' });
      this.emitLanSnapshot();

      if (!matchDone) {
        this.lanNextRoundTimer = 1.45;
        return;
      }

      window.setTimeout(() => {
        if (this.active && this.lanRole === 'host' && this.phase === 'match_over') {
          this.emitLanFx({
            kind: 'match_end',
            winnerIdx,
            p1Wins: this.lanP1Wins,
            p2Wins: this.lanP2Wins,
            bestOf: this.lanBestOf,
          });
          this.lanOnMatchEnd?.(winnerIdx, this.lanP1Wins, this.lanP2Wins, this.lanBestOf);
        }
      }, 1150);
      return;
    }

    this.bannerText = winnerIdx === 0 ? 'Q.E.D. 证毕!!' : '求解失败…';
    this.bannerSub = `${winner.name} 赢得本场几何对决！`;

    const canAdvance =
      this.mode === 'trial' && winnerIdx === 0 && this.trialStageIndex < MATH_TRIAL_MASTERS.length - 1;
    const clearedAll =
      this.mode === 'trial' && winnerIdx === 0 && this.trialStageIndex === MATH_TRIAL_MASTERS.length - 1;

    window.setTimeout(() => {
      if (this.active && this.phase === 'match_over') {
        this.callbacks.onMatchEnd(winnerIdx, this.mode, this.trialStageIndex, canAdvance, clearedAll);
      }
    }, 1150);
  }

  private resolveSeparation(): void {
    if (this.p1.action === 'ko' || this.p2.action === 'ko' || this.p1.action === 'dash' || this.p2.action === 'dash') return;
    if (Math.abs(this.p1.pos.y - this.p2.pos.y) > 65) return;
    const dx = this.p2.pos.x - this.p1.pos.x;
    if (Math.abs(dx) < 34) {
      const push = (34 - Math.abs(dx)) * 0.45;
      const s = dx >= 0 ? 1 : -1;
      this.p1.pos.x -= s * push;
      this.p2.pos.x += s * push;
    }
  }

  private updateWarpsAndParticles(dt: number): void {
    for (let i = this.warps.length - 1; i >= 0; i--) {
      this.warps[i].life -= dt;
      if (this.warps[i].life <= 0) this.warps.splice(i, 1);
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy += p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vrot * dt;
    }
    for (let i = this.popTexts.length - 1; i >= 0; i--) {
      const t = this.popTexts[i];
      t.life -= dt;
      if (t.life <= 0) {
        this.popTexts.splice(i, 1);
        continue;
      }
      t.x += t.vx * dt;
      t.y += t.vy * dt;
      t.vy *= 0.94;
    }
  }

  private computeAiInput(dt: number): InputState {
    const inp = createEmptyInput();
    if (this.mode === 'sandbox' && this.sandboxDummy === 'stand') return inp;
    if (this.phase !== 'fighting' || this.p2.action === 'ko') return inp;

    this.aiDecisionTimer -= dt;
    if (this.aiPlatformCd > 0) this.aiPlatformCd -= dt;
    const dx = this.p1.pos.x - this.p2.pos.x;
    const dy = this.p1.pos.y - this.p2.pos.y;
    const dist = Math.abs(dx);
    const dirToP1: -1 | 1 = dx >= 0 ? 1 : -1;

    if (this.p2.onGround || (this.aiClimbTargetY !== null && this.p2.pos.y <= this.aiClimbTargetY - 10)) {
      this.aiClimbTargetY = null;
    }

    // Mid-air double-jump follow-up when climbing to clear higher math bars (Jump #1 peaks ~126px, bars are ~165px!)
    if (
      !this.p2.onGround &&
      this.p2.jumpsLeft > 0 &&
      this.p2.vel.y > -120 &&
      (dy < -12 || (this.aiClimbTargetY !== null && this.p2.pos.y > this.aiClimbTargetY - 8))
    ) {
      inp.up = true;
      inp.jumpPressed = 6;
    }

    if (this.aiDecisionTimer <= 0) {
      this.aiDecisionTimer = 0.22 + (1 - this.aiDifficulty) * 0.25;
      this.aiWantBlock = false;

      // Seek nearby floating operator if close
      const nearOp = this.pickups.find((pk) => Math.hypot(pk.pos.x - this.p2.pos.x, pk.pos.y - (this.p2.pos.y - 44)) < 240);
      if (nearOp && this.p2.operators.length < 2 && Math.random() < 0.55) {
        this.aiMoveDir = nearOp.pos.x >= this.p2.pos.x ? 1 : -1;
        if (nearOp.pos.y < this.p2.pos.y - 80 && this.p2.onGround) {
          inp.up = true;
          inp.jumpPressed = 6;
          this.aiClimbTargetY = nearOp.pos.y;
        } else if (nearOp.pos.y > this.p2.pos.y + 65 && this.p2.onGround && this.p2.onOneWayPlatform && this.aiPlatformCd <= 0) {
          inp.dropThroughPressed = 6;
          this.aiPlatformCd = 0.52;
        }
      } else if (dist > 260) {
        this.aiMoveDir = dirToP1;
      } else if (dist < 85) {
        this.aiMoveDir = Math.random() < 0.35 ? (-dirToP1 as -1 | 1) : 0;
      } else {
        this.aiMoveDir = Math.random() < 0.55 ? dirToP1 : 0;
      }

      // Smart Platform Navigation on GEO_PLATFORMS (climb UP & drop DOWN actively!)
      if (this.p2.onGround && this.aiPlatformCd <= 0) {
        if (this.p2.onOneWayPlatform && dy > 68 && Math.random() < 0.72 + this.aiDifficulty * 0.22) {
          // P1 is below us: drop down through the math bar!
          inp.dropThroughPressed = 6;
          this.aiPlatformCd = 0.52;
        } else if (dy < -65) {
          // P1 is higher: steer toward best one-way math bar and climb up!
          let bestPlat: MathPlatformDef | null = null;
          let bestScore = Infinity;
          for (const p of GEO_PLATFORMS) {
            if (!p.oneWay) continue;
            if (p.y < this.p2.pos.y - 35 && p.y > this.p2.pos.y - 250) {
              const cx = p.x + p.w * 0.5;
              const score = Math.abs(cx - this.p1.pos.x) * 0.65 + Math.abs(cx - this.p2.pos.x) * 0.5;
              if (score < bestScore) {
                bestScore = score;
                bestPlat = p;
              }
            }
          }
          if (bestPlat) {
            const margin = 48;
            if (this.p2.pos.x < bestPlat.x - margin) {
              this.aiMoveDir = 1;
            } else if (this.p2.pos.x > bestPlat.x + bestPlat.w + margin) {
              this.aiMoveDir = -1;
            } else if (Math.random() < 0.72 + this.aiDifficulty * 0.2) {
              inp.up = true;
              inp.jumpPressed = 6;
              this.aiClimbTargetY = bestPlat.y;
              this.aiPlatformCd = 0.48;
            }
          } else if (Math.random() < 0.65) {
            inp.up = true;
            inp.jumpPressed = 6;
            this.aiClimbTargetY = this.p1.pos.y;
            this.aiPlatformCd = 0.48;
          }
        } else if (this.p2.onOneWayPlatform && Math.random() < 0.15) {
          // Tactical drop-down mixup
          inp.dropThroughPressed = 6;
          this.aiPlatformCd = 1.6;
        } else if (!this.p2.onOneWayPlatform && Math.random() < 0.18) {
          // Proactively hop up onto a nearby overhead math bar for elevation play!
          const overhead = GEO_PLATFORMS.find(
            (p) =>
              p.oneWay &&
              p.y < this.p2.pos.y - 55 &&
              p.y > this.p2.pos.y - 220 &&
              this.p2.pos.x >= p.x - 45 &&
              this.p2.pos.x <= p.x + p.w + 45
          );
          if (overhead) {
            inp.up = true;
            inp.jumpPressed = 6;
            this.aiClimbTargetY = overhead.y;
            this.aiPlatformCd = 2.0;
          }
        }
      }

      // Defensive reaction
      if (this.p1.action === 'attack' && dist < 170 && Math.abs(dy) < 90 && Math.random() < this.aiDifficulty * 0.48) {
        this.aiWantBlock = true;
        inp.blockPressed = 5;
      }

      // Super!
      if (this.p2.energy >= this.p2.maxEnergy && dist < 440 && Math.abs(dy) < 140 && Math.random() < this.aiDifficulty * 0.65) {
        inp.superPressed = 6;
      } else if (dist < 130 && Math.abs(dy) < 85 && Math.random() < this.aiDifficulty * 0.72) {
        inp.lightPressed = 5;
      } else if (dist >= 160 && dist < 520 && Math.random() < this.aiDifficulty * 0.52) {
        inp.heavyPressed = 5;
      } else if (dist > 320 && Math.random() < 0.25) {
        inp.dashPressed = 5;
      }
    }

    if (this.aiMoveDir < 0) inp.left = true;
    else if (this.aiMoveDir > 0) inp.right = true;
    inp.block = this.aiWantBlock;
    return inp;
  }

  private spawnGlyphBurst(x: number, y: number, color: string, count: number): void {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const spd = 120 + Math.random() * 250;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * spd,
        vy: Math.sin(a) * spd - 60,
        size: i % 2 === 0 ? 13 + Math.random() * 4 : 2.2 + Math.random() * 2.8,
        color: i % 3 === 0 ? '#ffffff' : color,
        life: 0.36 + Math.random() * 0.28,
        maxLife: 0.64,
        glyph: i % 2 === 0 ? MATH_GLYPH_PARTICLES[Math.floor(Math.random() * MATH_GLYPH_PARTICLES.length)] : undefined,
        rot: (Math.random() - 0.5) * 0.5,
        vrot: (Math.random() - 0.5) * 3.5,
        gravity: 340,
      });
    }
    if (this.particles.length > 85) {
      this.particles.splice(0, this.particles.length - 85);
    }
  }

  private spawnPopText(text: string, x: number, y: number, color: string, scale = 1.0, sub?: string): void {
    this.popTexts.push({
      text,
      sub,
      x: x + (Math.random() - 0.5) * 16,
      y,
      vx: (Math.random() - 0.5) * 22,
      vy: -74,
      color,
      scale,
      life: 0.72,
      maxLife: 0.72,
    });
    if (this.popTexts.length > 14) {
      this.popTexts.splice(0, this.popTexts.length - 14);
    }
  }

  private triggerCutIn(title: string, formula: string, sub: string, color: string, facing: 1 | -1): void {
    this.cutIn = { active: true, age: 0, duration: 0.92, title, formula, sub, color, facing };
    this.emitLanFx({
      kind: 'cutin',
      fighterName: sub,
      icon: '∑',
      weaponName: formula,
      title,
      formula,
      sub,
      color,
      facing,
      dimDur: 0.92,
      fxX: Math.round(facing > 0 ? this.p1.pos.x : this.p2.pos.x),
      fxY: Math.round(facing > 0 ? this.p1.pos.y : this.p2.pos.y),
    });
  }

  private triggerSpotlightDim(dur: number, pos: Vec2): void {
    this.dimMax = dur;
    this.dimTimer = dur;
    this.spotlightPos = { x: pos.x, y: pos.y - 48 };
  }

  private shakeCamera(mag: number, dx = 0, dy = 0): void {
    const lvl = this.getAvSettings().shakeLevel;
    if (lvl === 'off') return;
    this.camera.shake(mag * (lvl === 'soft' ? 0.5 : 1.0), dx, dy);
  }

  private getSmoothDimAlpha(): number {
    if (this.dimTimer <= 0 || this.dimMax <= 0) return 0;
    const elapsed = Math.max(0, this.dimMax - this.dimTimer);
    const env = Math.min(Math.min(1, elapsed / 0.14), Math.min(1, this.dimTimer / 0.28));
    const smooth = env * env * (3 - 2 * env);
    const fx = this.getAvSettings().fxIntensity;
    const peak = fx === 'eyesafe' ? 0.22 : fx === 'cinema' ? 0.66 : 0.54;
    return peak * smooth;
  }

  private toRenderState(f: MathFighter): MathFighterRenderState {
    return {
      index: f.index,
      name: f.name,
      isBoss: f.isBoss,
      isVersusP2: this.mode === 'versus' && f.index === 1,
      isLocalPlayer: this.lanRole === 'guest' ? f.index === 1 : f.index === 0,
      pos: f.pos,
      facing: f.facing,
      school: f.school,
      color: f.color,
      secondaryColor: f.secondaryColor,
      action: f.action,
      parryWindowFrames: f.parryWindowFrames,
      hurtFlashFrames: f.hurtFlashFrames,
      shieldTimer: f.shieldTimer,
      derivHasteTimer: f.derivHasteTimer,
      polyDegree: f.polyDegree,
      operators: f.operators,
      comboStep: f.comboStep,
      pose: f.skeleton.pose,
      scarfPoints: f.scarf.getPoints(),
      afterimages: f.afterimages,
      smears: f.smears,
    };
  }

  private renderFrame(): void {
    const { viewW, viewH, dpr } = this.getViewport();
    this.camera.setViewport(viewW, viewH);

    const p1MouseAim = this.input.doesPlayerUseMouseAim(0);
    const p2MouseAim = this.mode === 'versus' && this.lanRole === 'none' && this.input.doesPlayerUseMouseAim(1);
    const showAim = (p1MouseAim || p2MouseAim) && this.input.mouseHasMoved && this.phase === 'fighting' && !this.paused;
    const aimWorld = showAim ? this.camera.screenToWorld(this.input.mouseCanvasPos) : null;

    const sticks: Array<{ pos: Vec2; angle: number; color: string }> = [];
    if (this.phase === 'fighting' && !this.paused) {
      const s1 = this.input.getPlayerStickAim(0);
      if (s1.aimAngle !== null) {
        const localF = this.lanRole === 'guest' ? this.p2 : this.p1;
        sticks.push({ pos: localF.pos, angle: s1.aimAngle, color: localF.color });
      }
      if (this.mode === 'versus' && this.lanRole === 'none') {
        const s2 = this.input.getPlayerStickAim(1);
        if (s2.aimAngle !== null) sticks.push({ pos: this.p2.pos, angle: s2.aimAngle, color: this.p2.color });
      }
    }

    const nextCursor = showAim ? 'none' : 'default';
    if (this.lastCursor !== nextCursor) {
      this.lastCursor = nextCursor;
      this.canvas.style.cursor = nextCursor;
    }
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    this.renderer.render(this.ctx, {
      theme: MATH_THEMES[this.themeId],
      worldWidth: GEO_WORLD_W,
      worldHeight: GEO_WORLD_H,
      floorY: GEO_FLOOR_Y,
      platforms: GEO_PLATFORMS,
      fighters: [this.toRenderState(this.p1), this.toRenderState(this.p2)],
      entities: this.entities,
      pickups: this.pickups,
      warps: this.warps,
      particles: this.particles,
      popTexts: this.popTexts,
      cutIn: this.cutIn,
      dimAlpha: this.getSmoothDimAlpha(),
      spotlightPos: this.spotlightPos,
      fxIntensity: this.getAvSettings().fxIntensity,
      camera: this.camera,
      time: this.elapsed,
      viewW,
      viewH,
      aimReticleWorld: aimWorld,
      aimReticleOwner: this.lanRole === 'guest' ? 1 : p1MouseAim ? 0 : 1,
      stickAimIndicators: sticks,
    });
  }

  private emitHud(): void {
    const localF = this.lanRole === 'guest' ? this.p2 : this.p1;
    const combo = detectIdentityCombo(localF.school, localF.operators);
    const scoreTag =
      this.lanRole !== 'none' && this.lanBestOf > 1
        ? `【局域网 BO${this.lanBestOf} · ${this.lanP1Wins}:${this.lanP2Wins}】 `
        : '';
    const comboHint = combo
      ? `${scoreTag}恒等式就绪 · 释放重击/大招触发：${IDENTITY_COMBOS[combo].formula}（${IDENTITY_COMBOS[combo].title}）`
      : `${scoreTag}拾取/弹反拆解公式算子：π+i 触发欧拉归零 · d/dx+∫ 触发微积分永动 · ÷0 撕裂黑洞网格`;

    const mapF = (f: MathFighter) => {
      const s = MATH_SCHOOLS[f.school];
      return {
        name: f.name,
        school: f.school,
        schoolName: s.name,
        schoolFormula: s.formula,
        color: f.color,
        hp: f.hp,
        maxHp: f.maxHp,
        delayedHp: f.delayedHp,
        energy: f.energy,
        maxEnergy: f.maxEnergy,
        guardMeter: f.guardMeter,
        superReady: f.energy >= f.maxEnergy,
        operators: [...f.operators],
        polyDegree: f.polyDegree,
        derivHasteTimer: f.derivHasteTimer,
        shieldTimer: f.shieldTimer,
      };
    };

    this.callbacks.onHudUpdate({
      mode: this.mode,
      stageIndex: this.trialStageIndex + 1,
      stageTotal: MATH_TRIAL_MASTERS.length,
      timer: Math.ceil(this.roundTimer),
      p1: mapF(this.p1),
      p2: mapF(this.p2),
      comboP1: this.p2.comboReceived,
      comboP2: this.p1.comboReceived,
      bannerText: this.bannerText,
      bannerSub: this.bannerSub,
      activeFormulaPreview: buildFormulaPreview(localF.school, localF.operators),
      comboHint,
      theme: this.themeId,
      sandboxInfEnergy: this.sandboxInfEnergy,
      sandboxDummy: this.sandboxDummy,
    });
  }
}
