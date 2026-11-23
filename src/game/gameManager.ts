import {
  AudioVisualSettings,
  CareerStats,
  GameMode,
  HudSnapshot,
  InputState,
  MatchStats,
  MoveProjectileSpawn,
  PaperTheme,
  RoguelikeBuffDef,
  RoguelikeBuffId,
  StageDef,
  StageId,
  StyleRank,
  ThemeId,
  TrainingDummyMode,
  Vec2,
  WeaponId,
} from '../types';
import { PAPER_THEMES } from '../config/themes';
import { STAGES, WORLD_HEIGHT, WORLD_WIDTH } from '../config/stages';
import { WEAPONS } from '../config/weapons';
import { ARCADE_MASTERS } from '../config/arcade';
import { ControlProfile, GamepadProfile, PlayerInputDevice } from '../config/controls';
import {
  INK_SKINS,
  loadAudioVisualSettings,
  loadCareerStats,
  saveAudioVisualSettings,
  saveCareerStats,
  scoreToStyleRank,
} from '../config/cosmetics';
import { buildRoguelikeWave, rollThreeBuffChoices } from '../config/roguelike';
import { KeyboardInputManager, createEmptyInput, decayInputBuffers } from '../engine/input';
import { Camera } from '../engine/camera';
import { clamp, lerp, rectsOverlap } from '../engine/math';
import { Fighter } from '../combat/fighter';
import { Projectile, createProjectile, getProjectileHitbox } from '../combat/projectiles';
import { ArenaObjectManager } from '../combat/arenaObjects';
import { PaperLayer } from '../render/paperLayer';
import { FxManager } from '../render/fx';
import { GameRenderer, buildKoComicSnapshot } from '../render/gameRenderer';
import { SoundEngine } from '../audio/soundEngine';
import { BgmEngine } from '../audio/bgmEngine';
import { AiBrain } from '../ai/brain';
import {
  LanBestOf,
  LanFxEventPayload,
  LanInputPacket,
  LanLobbyState,
  LanPeerMessage,
  LanRole,
  LanScratchpadSnapshot,
  LanSpFighterState,
} from '../net/lanTypes';
import {
  GuestInputEncoder,
  HostRemoteInputDecoder,
  SnapshotInterpolator,
} from '../net/lanClient';

export interface MatchConfig {
  mode: GameMode;
  p1Weapon: WeaponId;
  p2Weapon: WeaponId;
  stageId: StageId;
  themeId: ThemeId;
  arcadeStageIndex?: number;
}

export interface GameUiCallbacks {
  onHudUpdate: (hud: HudSnapshot) => void;
  onMatchEnd: (winnerIndex: 0 | 1, stats: MatchStats, canAdvanceArcade: boolean, arcadeCleared: boolean) => void;
  onPauseChanged: (paused: boolean) => void;
  onRoguelikeBuffChoices: (waveCleared: number, choices: RoguelikeBuffDef[]) => void;
}

interface DelayedEvent {
  timer: number;
  fn: () => void;
}

const RANK_ORDER: StyleRank[] = ['none', 'D', 'C', 'B', 'A', 'S'];

export class GameManager {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;

  public sound: SoundEngine;
  public bgm: BgmEngine;
  public input: KeyboardInputManager;
  public avSettings: AudioVisualSettings;
  public career: CareerStats;

  private camera = new Camera();
  private paper = new PaperLayer();
  private fx = new FxManager();
  private renderer = new GameRenderer();
  private arenaObjects = new ArenaObjectManager();

  private mode: GameMode = 'arcade';
  private theme: PaperTheme = PAPER_THEMES.grid;
  private stage: StageDef = STAGES.notebook;
  private p1!: Fighter;
  private enemies: Fighter[] = [];
  private enemyAis: AiBrain[] = [];
  private demoAiP1 = new AiBrain();
  private projectiles: Projectile[] = [];
  private delayedEvents: DelayedEvent[] = [];

  private viewW = WORLD_WIDTH;
  private viewH = WORLD_HEIGHT;
  private dpr = 1;
  private boundResize: () => void;

  private arcadeStageIndex = 0;
  private roguelikeWave = 1;
  private roguelikeBuffs: RoguelikeBuffId[] = [];
  private p1HitCounterForPins = 0;
  private superCaster: Fighter | null = null;

  private round = 1;
  private p1Wins = 0;
  private p2Wins = 0;
  private roundTimer = 99;
  private phase: 'menu' | 'intro' | 'fighting' | 'buff_pick' | 'round_over' | 'match_over' = 'menu';
  private phaseTimer = 0;
  private bannerText = '';
  private bannerSub = '';
  private bannerStamp = false;
  private winnerIndex: 0 | 1 | -1 = -1;

  // Stylish Rank Meter
  private styleScore = 0;
  private styleRank: StyleRank = 'none';
  private highestStyleRank: StyleRank = 'none';
  private koSnapshotDataUrl: string | null = null;

  // Timing & juice
  private paused = false;
  private rafId = 0;
  private lastTimestamp = 0;
  private accumulator = 0;
  private elapsedTime = 0;
  private boilTimer = 0;
  private boilFrame = 0;
  private hitstopTimer = 0;
  private slowMoTimer = 0;
  private timeScale = 1.0;
  private heavyCastDealt = new Map<string, number>();

  // Training toggles
  public trainingDummy: TrainingDummyMode = 'spar';
  public trainingInfInk = false;
  public showHitboxes = false;

  // Stats
  private stats: MatchStats = {
    p1DamageDealt: 0,
    p2DamageDealt: 0,
    p1Parries: 0,
    p2Parries: 0,
    p1MaxCombo: 0,
    p2MaxCombo: 0,
    clashes: 0,
    durationSec: 0,
    highestStyleRank: 'none',
  };

  private uiCallbacks: GameUiCallbacks;
  private suspended = false;
  public externalGameplayActive?: () => boolean;
  public onExternalPauseToggle?: () => void;

  // LAN Multiplayer (Host-authoritative 60Hz snapshots + Guest adaptive smooth interpolation)
  public lanRole: LanRole = 'none';
  private lanBestOf: LanBestOf = 3;
  private lanRemoteInput: InputState = createEmptyInput();
  private lanRemoteDecoder = new HostRemoteInputDecoder();
  private lanGuestEncoder = new GuestInputEncoder();
  private lanSnapSeq = 0;
  private lanInterp = new SnapshotInterpolator<LanScratchpadSnapshot>();
  private lanOnSend: ((msg: LanPeerMessage, droppable?: boolean) => void) | null = null;
  private lanOnMatchEnd: ((winnerIdx: 0 | 1, p1Wins: number, p2Wins: number, bestOf: LanBestOf) => void) | null = null;
  private lanGuestPrevRound = 1;

  constructor(canvas: HTMLCanvasElement, uiCallbacks: GameUiCallbacks) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d')!;
    this.uiCallbacks = uiCallbacks;

    this.boundResize = () => this.resizeCanvas();
    window.addEventListener('resize', this.boundResize);
    this.resizeCanvas();

    this.avSettings = loadAudioVisualSettings();
    this.fx.fxIntensity = this.avSettings.fxIntensity;
    this.career = loadCareerStats();

    this.sound = new SoundEngine();
    this.sound.setSfxVolume(this.avSettings.sfxVolume);
    this.bgm = new BgmEngine(this.sound);
    this.bgm.setVolume(this.avSettings.bgmVolume);

    this.input = new KeyboardInputManager(
      this.canvas,
      () => (this.suspended ? Boolean(this.externalGameplayActive?.()) : this.phase === 'fighting' && !this.paused)
    );

    this.input.onAnyKey = () => {
      this.sound.unlock();
      if (this.bgm.isEnabled()) this.bgm.start();
    };
    this.input.onPauseToggle = () => {
      if (this.suspended) {
        this.onExternalPauseToggle?.();
        return;
      }
      if (this.lanRole !== 'none') return; // Never freeze live LAN peer match on Esc!
      if (this.phase === 'fighting' || this.phase === 'intro') {
        this.setPaused(!this.paused);
      }
    };

    this.paper.setThemeAndStage(this.theme, this.stage, true);
    this.camera.setWorldSize(this.stage.worldWidth, this.stage.worldHeight);
    this.setupMenuFighters();
    this.arenaObjects.reset(this.stage.crateSpawns, this.stage.platforms);

    this.lastTimestamp = performance.now();
    this.loop(this.lastTimestamp);
  }

  public resizeCanvas(): void {
    const rect = this.canvas.parentElement?.getBoundingClientRect();
    const w = Math.max(320, Math.round(rect?.width || window.innerWidth));
    const h = Math.max(240, Math.round(rect?.height || window.innerHeight));
    this.viewW = w;
    this.viewH = h;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
    this.camera.setViewport(w, h);
  }

  public triggerUiPageFlip(): void {
    this.paper.triggerPageFlip(this.canvas);
    this.sound.playPageFlip();
  }

  public previewSetupScene(stageId: StageId, themeId: ThemeId, p1Weapon: WeaponId): void {
    if (this.phase !== 'menu') return;
    this.stage = STAGES[stageId];
    this.theme = PAPER_THEMES[themeId];
    this.paper.setThemeAndStage(this.theme, this.stage);
    this.camera.setWorldSize(this.stage.worldWidth, this.stage.worldHeight);
    this.p1.weapon = p1Weapon;
    this.p1.resetForRound({ ...this.stage.spawnP1 }, 1);
    if (this.enemies[0]) {
      this.enemies[0].resetForRound({ ...this.stage.spawnP2 }, -1);
    }
    this.arenaObjects.reset(this.stage.crateSpawns, this.stage.platforms);
    this.bgm.suggestStageTrack(this.stage.defaultTrack);
  }

  private applySkinToP1(): void {
    const skin = INK_SKINS[this.avSettings.skinId] ?? INK_SKINS.classic;
    this.p1.inkColor = skin.inkColor;
    this.p1.scarfColor = skin.scarfColor;
    this.p1.rainbowSkin = !!skin.rainbow;
  }

  private setupMenuFighters(): void {
    const skin = INK_SKINS[this.avSettings.skinId] ?? INK_SKINS.classic;
    this.p1 = new Fighter(
      0,
      '小墨',
      '1P 红巾涂鸦人',
      { ...this.stage.spawnP1 },
      1,
      'ruler',
      skin.inkColor,
      skin.scarfColor,
      200
    );
    this.p1.rainbowSkin = !!skin.rainbow;
    const f2 = new Fighter(
      1,
      '小蓝',
      '2P 蓝带涂鸦人',
      { ...this.stage.spawnP2 },
      -1,
      'compass',
      this.theme.p2Ink,
      this.theme.p2Scarf,
      200
    );
    this.enemies = [f2];
    const ai2 = new AiBrain();
    ai2.setProfile({
      id: 'demo_2',
      stageIndex: 0,
      name: '小蓝',
      title: '',
      quote: '',
      weapon: 'compass',
      stage: this.stage.id,
      theme: this.theme.id,
      inkColor: this.theme.p2Ink,
      scarfColor: this.theme.p2Scarf,
      maxHp: 200,
      difficulty: 0.72,
      aggression: 0.78,
      parrySkill: 0.48,
      dodgeSkill: 0.55,
    });
    this.enemyAis = [ai2];
    this.demoAiP1.setProfile({
      id: 'demo_1',
      stageIndex: 0,
      name: '小墨',
      title: '',
      quote: '',
      weapon: 'ruler',
      stage: this.stage.id,
      theme: this.theme.id,
      inkColor: skin.inkColor,
      scarfColor: skin.scarfColor,
      maxHp: 200,
      difficulty: 0.76,
      aggression: 0.82,
      parrySkill: 0.52,
      dodgeSkill: 0.58,
    });
  }

  public updateAudioVisualSettings(partial: Partial<AudioVisualSettings>): void {
    this.avSettings = { ...this.avSettings, ...partial };
    saveAudioVisualSettings(this.avSettings);
    this.fx.fxIntensity = this.avSettings.fxIntensity;
    this.sound.setSfxVolume(this.avSettings.sfxVolume);
    this.bgm.setVolume(this.avSettings.bgmVolume);
    this.applySkinToP1();
  }

  public setTheme(themeId: ThemeId): void {
    this.theme = PAPER_THEMES[themeId];
    this.paper.setThemeAndStage(this.theme, this.stage);
  }

  public setControlProfile(profile: ControlProfile): void {
    this.input.setProfile(profile);
  }

  public setGamepadProfile(gpProfile: GamepadProfile): void {
    this.input.setGamepadProfile(gpProfile);
  }

  public setPlayerDevices(p1Dev: PlayerInputDevice, p2Dev: PlayerInputDevice): void {
    this.input.setPlayerDevices(p1Dev, p2Dev);
  }

  public setPaused(p: boolean): void {
    this.paused = p;
    this.input.clearAll();
    this.uiCallbacks.onPauseChanged(p);
  }

  public isPaused(): boolean {
    return this.paused;
  }

  public setSuspended(s: boolean): void {
    this.suspended = s;
    if (s) {
      this.input.clearAll();
      this.sound.setSlowMoFilter(false);
    } else {
      this.resizeCanvas();
      this.lastTimestamp = performance.now();
    }
  }

  public isSuspended(): boolean {
    return this.suspended;
  }

  public getViewport(): { viewW: number; viewH: number; dpr: number } {
    return { viewW: this.viewW, viewH: this.viewH, dpr: this.dpr };
  }

  public returnToMenu(): void {
    this.lanRole = 'none';
    this.phase = 'menu';
    this.paused = false;
    this.input.clearAll();
    this.sound.setSlowMoFilter(false);
    this.bgm.setIntensity('menu');
    this.bgm.setStylishBoost(false);
    this.fx.reset();
    this.delayedEvents = [];
    this.projectiles = [];
    this.paper.triggerPageFlip(this.canvas);
    this.stage = STAGES.notebook;
    this.theme = PAPER_THEMES.grid;
    this.paper.setThemeAndStage(this.theme, this.stage, true);
    this.camera.setWorldSize(this.stage.worldWidth, this.stage.worldHeight);
    this.camera.reset();
    this.setupMenuFighters();
    this.arenaObjects.reset(this.stage.crateSpawns, this.stage.platforms);
  }

  public setP1WeaponLive(weapon: WeaponId): void {
    this.p1.weapon = weapon;
    this.sound.playPencilSketch();
    this.fx.spawnPopText(
      WEAPONS[weapon].name,
      { x: this.p1.pos.x, y: this.p1.pos.y - 80 },
      this.p1.scarfColor,
      0.9
    );
  }

  public resetTrainingState(): void {
    if (this.mode !== 'training') return;
    this.input.clearAll();
    this.p1.resetForRound({ ...this.stage.spawnP1 }, 1);
    this.enemies[0]?.resetForRound({ ...this.stage.spawnP2 }, -1);
    this.p1.ink = 100;
    this.projectiles = [];
    this.delayedEvents = [];
    this.styleScore = 0;
    this.styleRank = 'none';
    this.fx.reset();
    this.paper.triggerPageFlip(this.canvas);
    this.sound.playPageFlip();
    this.arenaObjects.reset(this.stage.crateSpawns, this.stage.platforms);
  }

  private hasBuff(id: RoguelikeBuffId): boolean {
    return this.mode === 'roguelike' && this.roguelikeBuffs.includes(id);
  }

  private syncP1Modifiers(): void {
    const inHighlighter = this.arenaObjects.isInHighlighterZone(this.p1.pos);
    this.p1.moveSpeedMult = (this.hasBuff('sketch_haste') ? 1.18 : 1.0) * (inHighlighter ? 1.2 : 1.0);
    this.p1.dashCooldownMult = this.hasBuff('sketch_haste') ? 0.65 : 1.0;
    this.p1.damageMult = (this.hasBuff('heavy_ink') ? 1.28 : 1.0) * (inHighlighter ? 1.15 : 1.0);
    this.p1.inkGainMult = this.hasBuff('ink_fountain') ? 1.5 : 1.0;
  }

  public pickRoguelikeBuff(buffId: RoguelikeBuffId): void {
    if (this.phase !== 'buff_pick') return;
    this.sound.playStickerPick();
    this.roguelikeBuffs.push(buffId);

    const clearedBossWave = this.roguelikeWave % 3 === 0;
    if (buffId === 'thick_paper') {
      this.p1.maxHp += 40;
      this.p1.hp = Math.min(this.p1.maxHp, this.p1.hp + (clearedBossWave ? 60 : 45));
      this.p1.guardMeter = 100;
    } else {
      // Generous breather heal between waves (+28 normal, +45 after Boss waves)
      this.p1.hp = Math.min(this.p1.maxHp, this.p1.hp + (clearedBossWave ? 45 : 28));
    }

    this.roguelikeWave++;
    this.startRoguelikeWave(true);
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
    this.lanRemoteDecoder.reset();
    this.lanGuestEncoder.reset();
    this.lanInterp.reset();
    this.lanRemoteInput = createEmptyInput();
  }

  public startLanMatch(role: 'host' | 'guest', lobby: LanLobbyState): void {
    this.sound.unlock();
    if (this.bgm.isEnabled()) this.bgm.start();

    this.lanRole = role;
    this.lanBestOf = lobby.bestOf;
    this.lanRemoteDecoder.reset();
    this.lanGuestEncoder.reset();
    this.lanInterp.reset();
    this.lanRemoteInput = createEmptyInput();
    this.lanSnapSeq = 0;
    this.lanGuestPrevRound = 1;

    this.mode = 'versus';
    this.paused = false;
    this.koSnapshotDataUrl = null;
    this.styleScore = 0;
    this.styleRank = 'none';
    this.highestStyleRank = 'none';
    this.bgm.setStylishBoost(false);
    this.delayedEvents = [];
    this.projectiles = [];
    this.round = 1;
    this.p1Wins = 0;
    this.p2Wins = 0;
    this.winnerIndex = -1;
    this.stats = {
      p1DamageDealt: 0,
      p2DamageDealt: 0,
      p1Parries: 0,
      p2Parries: 0,
      p1MaxCombo: 0,
      p2MaxCombo: 0,
      clashes: 0,
      durationSec: 0,
      highestStyleRank: 'none',
    };

    this.stage = STAGES[lobby.stageId] ?? STAGES.notebook;
    this.theme = PAPER_THEMES[lobby.themeId] ?? PAPER_THEMES.grid;
    this.paper.setThemeAndStage(this.theme, this.stage, true);
    this.camera.setWorldSize(this.stage.worldWidth, this.stage.worldHeight);
    this.bgm.suggestStageTrack(this.stage.defaultTrack);

    const skin = INK_SKINS[this.avSettings.skinId] ?? INK_SKINS.classic;
    const hostLabel = role === 'host' ? `${lobby.hostName} (你)` : `${lobby.hostName} (房主)`;
    const guestLabel = role === 'guest' ? `${lobby.guestName} (你)` : `${lobby.guestName} (客机)`;

    this.p1 = new Fighter(
      0,
      hostLabel,
      WEAPONS[lobby.hostWeapon].name,
      { ...this.stage.spawnP1 },
      1,
      lobby.hostWeapon,
      skin.inkColor,
      skin.scarfColor,
      125
    );
    this.p1.rainbowSkin = !!skin.rainbow;

    const f2 = new Fighter(
      1,
      guestLabel,
      WEAPONS[lobby.guestWeapon].name,
      { ...this.stage.spawnP2 },
      -1,
      lobby.guestWeapon,
      this.theme.p2Ink,
      this.theme.p2Scarf,
      125
    );
    this.enemies = [f2];
    this.enemyAis = [new AiBrain()];

    if (role === 'host') {
      this.startRound(false);
      this.emitLanSnapshot();
    } else {
      this.paper.clearStains();
      this.input.clearAll();
      this.fx.reset();
      this.camera.reset();
      this.sound.setSlowMoFilter(false);
      this.arenaObjects.reset(this.stage.crateSpawns, this.stage.platforms);
      this.phase = 'intro';
      this.roundTimer = 99;
      this.bannerText = '第 1 回合';
      this.bannerSub = '局域网同步就绪…';
      this.bannerStamp = false;
      this.bgm.setIntensity('fight');
    }
  }

  public receiveLanInput(pkt: LanInputPacket): void {
    if (this.lanRole !== 'host') return;
    this.lanRemoteDecoder.applyPacket(pkt, this.lanRemoteInput);
  }

  public receiveLanSnapshot(snap: LanScratchpadSnapshot): void {
    if (this.lanRole !== 'guest') return;
    this.lanInterp.push(snap, performance.now());
  }

  public receiveLanFx(ev: LanFxEventPayload): void {
    if (this.lanRole !== 'guest') return;
    switch (ev.kind) {
      case 'pop':
        this.fx.spawnPopText(ev.text, { x: ev.x, y: ev.y }, ev.color, ev.scale ?? 1.0);
        break;
      case 'hit':
        this.sound.playHit(ev.dmg, !!ev.heavy, !!ev.guardBreak);
        this.fx.spawnInkBurst({ x: ev.x, y: ev.y }, ev.color, ev.heavy ? 18 : 9, ev.dirX ?? 0, ev.dirY ?? -0.25, ev.heavy ? 420 : 280);
        this.fx.spawnRing({ x: ev.x, y: ev.y }, ev.heavy ? 92 : 54, ev.color, ev.heavy ? 4.2 : 2.6);
        this.paper.addInkSplatter({ x: ev.x, y: ev.y }, ev.color, ev.heavy ? 20 : 11, ev.dirX ?? 0, ev.dirY ?? 0);
        if (ev.guardBreak) {
          this.fx.spawnPaperShards({ x: ev.x, y: ev.y }, ev.color, 14);
          this.fx.triggerImpactFrame(4, { x: ev.x, y: ev.y }, 0.25, 'parry');
          this.shakeCamera(14, ev.dirX ?? 0, 0);
        } else if (ev.heavy) {
          this.fx.triggerImpactFrame(0, { x: ev.x, y: ev.y }, 0.18, 'normal');
          this.shakeCamera(12, ev.dirX ?? 0, ev.dirY ?? 0);
        } else {
          this.shakeCamera(5, ev.dirX ?? 0, 0);
        }
        break;
      case 'parry':
        this.sound.playParry();
        this.fx.spawnParrySparks({ x: ev.x, y: ev.y }, ev.color, 24);
        this.fx.triggerImpactFrame(4, { x: ev.x, y: ev.y }, 0.24, 'parry');
        this.shakeCamera(10);
        break;
      case 'clash':
        this.sound.playClash();
        this.fx.spawnParrySparks({ x: ev.x, y: ev.y }, '#f7ba2a', 26);
        this.fx.triggerImpactFrame(0, { x: ev.x, y: ev.y }, 0.22, 'normal');
        this.shakeCamera(12);
        break;
      case 'cutin':
        this.fx.triggerSuperShowcase(
          { x: ev.fxX ?? this.p1.pos.x, y: ev.fxY ?? this.p1.pos.y },
          ev.fighterName,
          ev.icon,
          ev.weaponName,
          ev.title,
          ev.color,
          ev.facing
        );
        this.sound.playPaperTear();
        break;
      case 'sfx':
        if (ev.name === 'block') this.sound.playBlock();
        else if (ev.name === 'dodge') this.sound.playPerfectDodge();
        else if (ev.name === 'stamp') {
          this.sound.playStamp();
          this.shakeCamera(9);
        } else if (ev.name === 'tear') this.sound.playPaperTear();
        else if (ev.name === 'page_flip') {
          this.paper.triggerPageFlip(this.canvas);
          this.sound.playPageFlip();
        }
        break;
      case 'shake':
        this.shakeCamera(ev.mag, ev.dx ?? 0, ev.dy ?? 0);
        break;
      case 'burst':
        this.fx.spawnInkBurst({ x: ev.x, y: ev.y }, ev.color, ev.count, 0, -0.4, 380);
        break;
      case 'match_end':
        this.phase = 'match_over';
        this.winnerIndex = ev.winnerIdx;
        this.p1Wins = ev.p1Wins;
        this.p2Wins = ev.p2Wins;
        this.lanOnMatchEnd?.(ev.winnerIdx, ev.p1Wins, ev.p2Wins, ev.bestOf);
        break;
    }
  }

  private emitLanFx(ev: LanFxEventPayload): void {
    if (this.lanRole !== 'host' || !this.lanOnSend) return;
    this.lanOnSend({ t: 'fx', mode: 'scratchpad', ev }, false);
  }

  private packSpFighter(f: Fighter): LanSpFighterState {
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
      ink: Math.round(f.ink * 10) / 10,
      gm: Math.round(f.guardMeter),
      ch: f.chargeFrames,
      hf: f.hurtFlashFrames,
      pw: f.parryWindowFrames,
      wep: f.weapon,
      cs: f.comboReceived,
      onG: f.onGround,
      cr: Math.round(f.lastChargeRatio * 100) / 100,
    };
  }

  private emitLanSnapshot(): void {
    if (this.lanRole !== 'host' || !this.lanOnSend || !this.enemies[0]) return;
    const phaseMap =
      this.phase === 'intro' || this.phase === 'fighting' || this.phase === 'round_over' || this.phase === 'match_over'
        ? this.phase
        : 'fighting';
    const snap: LanScratchpadSnapshot = {
      t: 'sp_snap',
      seq: ++this.lanSnapSeq,
      ts: Math.round(performance.now()),
      phase: phaseMap,
      round: this.round,
      maxRounds: this.lanBestOf,
      p1Wins: this.p1Wins,
      p2Wins: this.p2Wins,
      timer: Math.round(this.roundTimer * 10) / 10,
      bannerText: this.bannerText,
      bannerSub: this.bannerSub,
      bannerStamp: this.bannerStamp,
      styleScore: Math.round(this.styleScore),
      styleRank: this.styleRank,
      f: [this.packSpFighter(this.p1), this.packSpFighter(this.enemies[0])],
      pr: this.projectiles.map((p) => ({
        id: p.id,
        oi: p.ownerIndex,
        k: p.kind,
        x: Math.round(p.pos.x * 10) / 10,
        y: Math.round(p.pos.y * 10) / 10,
        vx: Math.round(p.vel.x),
        vy: Math.round(p.vel.y),
        ang: Math.round(p.angle * 100) / 100,
        fc: p.facing,
        r: p.radius,
        w: p.width,
        h: p.height,
        col: p.color,
        acc: p.accent,
        life: Math.round(p.life * 100) / 100,
        ml: p.maxLife,
        rot: Math.round(p.rotation * 100) / 100,
        tt: p.telegraphTime !== undefined ? Math.round(p.telegraphTime * 100) / 100 : undefined,
        age: Math.round(p.age * 100) / 100,
      })),
      pl: this.stage.platforms
        .filter((p) => p.origami || p.elevator)
        .map((p) => ({ id: p.id, x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 })),
      br: Array.from(this.arenaObjects.getBrokenPlatformIds()),
      pk: this.arenaObjects.pickups.map((pk) => ({
        id: pk.id,
        x: Math.round(pk.pos.x),
        y: Math.round(pk.pos.y),
        wep: pk.weapon,
        life: Math.round(pk.life * 10) / 10,
      })),
      cr: this.arenaObjects.crates
        .filter((c) => !c.broken)
        .map((c) => ({ id: c.id, x: Math.round(c.pos.x), y: Math.round(c.pos.y), hp: Math.round(c.hp) })),
      hz: this.arenaObjects.highlighterZone.active
        ? {
            active: true,
            x: Math.round(this.arenaObjects.highlighterZone.x),
            y: Math.round(this.arenaObjects.highlighterZone.y),
            w: Math.round(this.arenaObjects.highlighterZone.w),
            color: this.arenaObjects.highlighterZone.color,
            life: Math.round(this.arenaObjects.highlighterZone.life * 10) / 10,
            maxLife: this.arenaObjects.highlighterZone.maxLife,
          }
        : null,
    };
    this.lanOnSend(snap, true);
  }

  private applyLanFighterState(f: Fighter, prev: LanSpFighterState, next: LanSpFighterState, alpha: number): void {
    const dist = Math.hypot(next.x - prev.x, next.y - prev.y);
    if (dist > 260) {
      f.pos.x = next.x;
      f.pos.y = next.y;
    } else {
      f.pos.x = lerp(prev.x, next.x, alpha);
      f.pos.y = lerp(prev.y, next.y, alpha);
    }
    const wasKo = f.action === 'ko';
    f.vel.x = lerp(prev.vx, next.vx, alpha);
    f.vel.y = lerp(prev.vy, next.vy, alpha);
    f.facing = next.fc;
    f.action = next.act;
    f.actionFrames = next.af;
    f.attackKind = next.ak;
    f.hp = next.hp;
    f.maxHp = next.mhp;
    f.delayedHp = next.dhp;
    f.ink = next.ink;
    f.guardMeter = next.gm;
    f.chargeFrames = next.ch;
    f.hurtFlashFrames = next.hf;
    f.parryWindowFrames = next.pw;
    f.weapon = next.wep;
    f.comboReceived = next.cs;
    f.onGround = next.onG;
    f.lastChargeRatio = next.cr;

    if (!wasKo && next.act === 'ko') {
      f.triggerKO(next.vx || -next.fc * 360, Math.min(-300, next.vy || -340));
    } else if (wasKo && next.act !== 'ko') {
      f.ragdoll.active = false;
    }
  }

  private tickLanGuest(realDt: number): void {
    const guestFighter = this.enemies[0];
    if (!guestFighter) return;

    // 1. Compute Guest local 360-degree aim relative to Guest's own fighter (P2) & transmit input immediately!
    const canControl = this.phase === 'fighting';
    const stick = this.input.getPlayerStickAim(0);
    if (canControl && stick.aimAngle !== null) {
      this.input.p1.aimDir = stick.aimDir;
      this.input.p1.aimAngle = stick.aimAngle;
    } else if (canControl && this.input.doesPlayerUseMouseAim(0) && this.input.mouseHasMoved) {
      const mw = this.camera.screenToWorld(this.input.mouseCanvasPos);
      const dxMouse = mw.x - guestFighter.pos.x;
      const dyMouse = mw.y - (guestFighter.pos.y - 46);
      if (Math.abs(dxMouse) > 6) this.input.p1.aimDir = dxMouse > 0 ? 1 : -1;
      this.input.p1.aimAngle = Math.atan2(dyMouse, dxMouse);
    } else {
      this.input.p1.aimDir = 0;
      this.input.p1.aimAngle = null;
    }

    const pkt = this.lanGuestEncoder.consumeAndEncode(this.input.p1, performance.now());
    if (pkt && this.lanOnSend) {
      this.lanOnSend(pkt, false);
    }

    // 2. Sample adaptive low-latency snapshot buffer & smoothly interpolate!
    const sample = this.lanInterp.sample(performance.now());
    if (sample) {
      const { prev, next, alpha } = sample;
      if (next.round !== this.lanGuestPrevRound) {
        this.lanGuestPrevRound = next.round;
        this.paper.triggerPageFlip(this.canvas);
        this.sound.playPageFlip();
      }
      this.phase = next.phase;
      this.round = next.round;
      this.lanBestOf = (next.maxRounds === 1 || next.maxRounds === 5 ? next.maxRounds : 3) as LanBestOf;
      this.p1Wins = next.p1Wins;
      this.p2Wins = next.p2Wins;
      this.roundTimer = next.timer;
      this.bannerText = next.bannerText;
      this.bannerSub = next.bannerSub;
      this.bannerStamp = next.bannerStamp;
      this.styleScore = next.styleScore;
      this.styleRank = next.styleRank;

      this.applyLanFighterState(this.p1, prev.f[0], next.f[0], alpha);
      this.applyLanFighterState(guestFighter, prev.f[1], next.f[1], alpha);

      // Dynamic moving platforms (origami planes & elevators)
      const prevPlatMap = new Map(prev.pl.map((p) => [p.id, p]));
      for (const np of next.pl) {
        const targetPlat = this.stage.platforms.find((p) => p.id === np.id);
        if (targetPlat) {
          const pp = prevPlatMap.get(np.id) ?? np;
          targetPlat.x = lerp(pp.x, np.x, alpha);
          targetPlat.y = lerp(pp.y, np.y, alpha);
        }
      }

      // Breakable bridges
      const brokenSet = new Set(next.br);
      for (const [id, st] of this.arenaObjects.bridges.entries()) {
        st.broken = brokenSet.has(id);
        st.redrawProgress = st.broken ? 0.35 : 1;
      }

      // Crates
      const liveCrates = new Map(next.cr.map((c) => [c.id, c]));
      for (const c of this.arenaObjects.crates) {
        const nc = liveCrates.get(c.id);
        if (!nc) {
          c.broken = true;
          c.hp = 0;
        } else {
          c.broken = false;
          c.hp = nc.hp;
        }
      }

      // Weapon pickups
      this.arenaObjects.pickups = next.pk.map((pk) => ({
        id: pk.id,
        weapon: pk.wep,
        pos: { x: pk.x, y: pk.y },
        vy: 0,
        life: pk.life,
        sketchProgress: 1,
        bobPhase: this.elapsedTime * 3,
      }));

      // Highlighter boost zone
      if (next.hz && next.hz.active) {
        this.arenaObjects.highlighterZone = { ...next.hz };
      } else {
        this.arenaObjects.highlighterZone.active = false;
      }

      // Interpolate projectiles smoothly by id!
      const prevProjMap = new Map(prev.pr.map((p) => [p.id, p]));
      this.projectiles = next.pr.map((np) => {
        const pp = prevProjMap.get(np.id);
        const px = pp && Math.hypot(np.x - pp.x, np.y - pp.y) < 300 ? lerp(pp.x, np.x, alpha) : np.x;
        const py = pp && Math.hypot(np.x - pp.x, np.y - pp.y) < 300 ? lerp(pp.y, np.y, alpha) : np.y;
        return {
          id: np.id,
          ownerIndex: np.oi,
          kind: np.k,
          pos: { x: px, y: py },
          vel: { x: np.vx, y: np.vy },
          facing: np.fc,
          angle: np.ang,
          radius: np.r,
          width: np.w,
          height: np.h,
          damage: 0,
          knockbackX: 0,
          knockbackY: 0,
          color: np.col,
          accent: np.acc,
          life: np.life,
          maxLife: np.ml,
          rotation: np.rot,
          hitIds: new Set(),
          telegraphTime: np.tt,
          age: np.age,
        };
      });
    }

    // 3. Local 60/120fps procedural skeleton, smear trails, scarf cloth, particles & camera!
    const brokenIds = this.arenaObjects.getBrokenPlatformIds();
    this.p1.updateVisualsOnly(realDt, this.stage.platforms, brokenIds, this.stage.worldWidth);
    guestFighter.updateVisualsOnly(realDt, this.stage.platforms, brokenIds, this.stage.worldWidth);
    this.fx.update(realDt, realDt, !!this.stage.hasBambooLeaves, this.stage.worldWidth);
    this.camera.update(realDt, this.p1.pos, guestFighter.pos, false);
    this.emitHud();
  }

  public startMatch(cfg: MatchConfig): void {
    this.lanRole = 'none';
    this.sound.unlock();
    if (this.bgm.isEnabled()) this.bgm.start();

    this.mode = cfg.mode;
    this.paused = false;
    this.arcadeStageIndex = cfg.arcadeStageIndex ?? 0;
    this.roguelikeWave = 1;
    this.roguelikeBuffs = [];
    this.p1HitCounterForPins = 0;
    this.koSnapshotDataUrl = null;
    this.styleScore = 0;
    this.styleRank = 'none';
    this.highestStyleRank = 'none';
    this.bgm.setStylishBoost(false);
    this.delayedEvents = [];

    const skin = INK_SKINS[this.avSettings.skinId] ?? INK_SKINS.classic;

    this.round = 1;
    this.p1Wins = 0;
    this.p2Wins = 0;
    this.winnerIndex = -1;
    this.stats = {
      p1DamageDealt: 0,
      p2DamageDealt: 0,
      p1Parries: 0,
      p2Parries: 0,
      p1MaxCombo: 0,
      p2MaxCombo: 0,
      clashes: 0,
      durationSec: 0,
      highestStyleRank: 'none',
    };

    if (cfg.mode === 'roguelike') {
      this.p1 = new Fighter(
        0,
        '小墨',
        '涂鸦生存挑战者',
        { x: 260, y: 590 },
        1,
        cfg.p1Weapon,
        skin.inkColor,
        skin.scarfColor,
        140
      );
      this.p1.rainbowSkin = !!skin.rainbow;
      this.startRoguelikeWave(false);
      return;
    }

    if (cfg.mode === 'arcade') {
      const master = ARCADE_MASTERS[this.arcadeStageIndex];
      this.stage = STAGES[master.stage];
      this.theme = PAPER_THEMES[master.theme];
      this.paper.setThemeAndStage(this.theme, this.stage, true);
      this.camera.setWorldSize(this.stage.worldWidth, this.stage.worldHeight);
      this.bgm.suggestStageTrack(master.isBoss ? 'authors_finale' : this.stage.defaultTrack);

      this.p1 = new Fighter(
        0,
        '小墨',
        '草稿纸挑战者',
        { ...this.stage.spawnP1 },
        1,
        cfg.p1Weapon,
        skin.inkColor,
        skin.scarfColor,
        125
      );
      this.p1.rainbowSkin = !!skin.rainbow;
      const f2 = new Fighter(
        1,
        master.name,
        master.title,
        { ...this.stage.spawnP2 },
        -1,
        master.weapon,
        master.inkColor,
        master.scarfColor,
        master.maxHp
      );
      f2.isBoss = !!master.isBoss;
      this.enemies = [f2];
      const ai = new AiBrain();
      ai.setProfile(master);
      this.enemyAis = [ai];
    } else {
      this.stage = STAGES[cfg.stageId];
      this.theme = PAPER_THEMES[cfg.themeId];
      this.paper.setThemeAndStage(this.theme, this.stage, true);
      this.camera.setWorldSize(this.stage.worldWidth, this.stage.worldHeight);
      this.bgm.suggestStageTrack(this.stage.defaultTrack);

      this.p1 = new Fighter(
        0,
        '小墨 (P1)',
        WEAPONS[cfg.p1Weapon].name,
        { ...this.stage.spawnP1 },
        1,
        cfg.p1Weapon,
        skin.inkColor,
        skin.scarfColor,
        125
      );
      this.p1.rainbowSkin = !!skin.rainbow;
      const f2 = new Fighter(
        1,
        cfg.mode === 'training' ? '草稿木桩' : '小蓝 (P2)',
        cfg.mode === 'training' ? '自由陪练同桌' : WEAPONS[cfg.p2Weapon].name,
        { ...this.stage.spawnP2 },
        -1,
        cfg.p2Weapon,
        this.theme.p2Ink,
        this.theme.p2Scarf,
        cfg.mode === 'training' ? 200 : 125
      );
      this.enemies = [f2];
      this.enemyAis = [new AiBrain()];
    }

    this.startRound(false);
  }

  private startRoguelikeWave(withPageFlip: boolean): void {
    const waveSpec = buildRoguelikeWave(this.roguelikeWave);
    this.stage = STAGES[waveSpec.stage];
    this.theme = PAPER_THEMES[waveSpec.theme];
    this.paper.setThemeAndStage(this.theme, this.stage, true);
    this.camera.setWorldSize(this.stage.worldWidth, this.stage.worldHeight);
    this.bgm.suggestStageTrack(
      waveSpec.enemies.some((e) => e.isBoss) ? 'authors_finale' : 'ink_musou'
    );

    if (withPageFlip) {
      this.paper.triggerPageFlip(this.canvas);
      this.sound.playPageFlip();
    } else {
      this.paper.clearStains();
    }

    this.projectiles = [];
    this.delayedEvents = [];
    this.heavyCastDealt.clear();
    this.input.clearAll();
    this.fx.reset();
    this.camera.reset();
    this.sound.setSlowMoFilter(false);
    this.hitstopTimer = 0;
    this.slowMoTimer = 0;
    this.timeScale = 1.0;

    // Keep P1 HP & Ink across waves!
    const keptHp = this.p1.hp;
    const keptInk = this.p1.ink;
    this.p1.resetForRound({ ...this.stage.spawnP1 }, 1);
    this.p1.hp = keptHp;
    this.p1.delayedHp = keptHp;
    this.p1.ink = keptInk;
    this.syncP1Modifiers();

    this.enemies = [];
    this.enemyAis = [];
    const count = waveSpec.enemies.length;
    waveSpec.enemies.forEach((m, idx) => {
      const spreadX =
        count === 1
          ? this.stage.spawnP2.x
          : clamp(
              this.stage.spawnP2.x - 140 + idx * (280 / Math.max(1, count - 1)),
              this.stage.worldWidth * 0.52,
              this.stage.worldWidth - 130
            );
      const enemy = new Fighter(
        1,
        m.name,
        m.title,
        { x: spreadX, y: this.stage.spawnP2.y - idx * 24 },
        -1,
        m.weapon,
        m.inkColor,
        m.scarfColor,
        m.maxHp
      );
      enemy.isBoss = !!m.isBoss;
      this.enemies.push(enemy);
      const brain = new AiBrain();
      brain.setProfile(m);
      this.enemyAis.push(brain);
    });

    this.arenaObjects.reset(this.stage.crateSpawns, this.stage.platforms);
    this.roundTimer = 120;
    this.phase = 'intro';
    this.phaseTimer = 1.4;
    this.bannerStamp = false;
    this.bannerText = waveSpec.title;
    this.bannerSub =
      waveSpec.enemies.length > 1
        ? `迎战 ${waveSpec.enemies.length} 名涂鸦强敌！`
        : waveSpec.enemies[0].quote || '头目降临！';
    this.bgm.setIntensity(waveSpec.enemies.some((e) => e.isBoss) ? 'climax' : 'fight');
  }

  private startRound(withPageFlip: boolean): void {
    if (withPageFlip) {
      this.paper.triggerPageFlip(this.canvas);
      this.sound.playPageFlip();
    } else {
      this.paper.clearStains();
    }

    this.projectiles = [];
    this.delayedEvents = [];
    this.heavyCastDealt.clear();
    this.input.clearAll();
    this.fx.reset();
    this.camera.setWorldSize(this.stage.worldWidth, this.stage.worldHeight);
    this.camera.reset();
    this.sound.setSlowMoFilter(false);
    this.hitstopTimer = 0;
    this.slowMoTimer = 0;
    this.timeScale = 1.0;

    this.p1.resetForRound({ ...this.stage.spawnP1 }, 1);
    this.enemies[0].resetForRound({ ...this.stage.spawnP2 }, -1);
    this.arenaObjects.reset(this.stage.crateSpawns, this.stage.platforms);
    this.enemyAis.forEach((a) => a.reset());

    if (this.mode === 'training') {
      this.phase = 'fighting';
      this.bannerText = '';
      this.bannerSub = '';
      this.roundTimer = 999;
      this.bgm.setIntensity('fight');
      return;
    }

    this.roundTimer = 99;
    this.phase = 'intro';
    this.phaseTimer = 1.5;
    this.bannerStamp = false;
    if (this.mode === 'arcade' && this.round === 1) {
      const m = ARCADE_MASTERS[this.arcadeStageIndex];
      this.bannerText = `第 ${this.arcadeStageIndex + 1} 战 · ${m.name}`;
      this.bannerSub = m.quote;
    } else {
      this.bannerText = `第 ${this.round} 回合`;
      this.bannerSub = 'READY — 文具出击！';
    }
    this.bgm.setIntensity(this.enemies[0]?.isBoss ? 'climax' : 'fight');
  }

  private getAllFighters(): Fighter[] {
    return [this.p1, ...this.enemies];
  }

  private getNearestAliveEnemy(from: Vec2): Fighter {
    let best = this.enemies[0];
    let bestD = Infinity;
    for (const e of this.enemies) {
      if (e.action === 'ko') continue;
      const d = Math.hypot(e.pos.x - from.x, e.pos.y - from.y);
      if (d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best ?? this.enemies[0];
  }

  private getPrimaryHudEnemy(): Fighter {
    // Prefer boss, otherwise nearest alive enemy
    const boss = this.enemies.find((e) => e.isBoss && e.action !== 'ko');
    if (boss) return boss;
    return this.getNearestAliveEnemy(this.p1.pos);
  }

  private shakeCamera(mag: number, dx = 0, dy = 0): void {
    if (this.avSettings.shakeLevel === 'off') return;
    const mult = this.avSettings.shakeLevel === 'soft' ? 0.52 : 1.0;
    this.camera.shake(mag * mult, dx, dy);
  }

  private addStylePoints(points: number): void {
    const prevRank = this.styleRank;
    this.styleScore = clamp(this.styleScore + points, 0, 210);
    const nextRank = scoreToStyleRank(this.styleScore);
    this.styleRank = nextRank;

    if (RANK_ORDER.indexOf(nextRank) > RANK_ORDER.indexOf(this.highestStyleRank)) {
      this.highestStyleRank = nextRank;
      this.stats.highestStyleRank = nextRank;
    }

    if (RANK_ORDER.indexOf(nextRank) > RANK_ORDER.indexOf(prevRank) && nextRank !== 'D') {
      this.sound.playRankUp(nextRank === 'A' || nextRank === 'S');
    }
    this.bgm.setStylishBoost(nextRank === 'A' || nextRank === 'S');
  }

  private loop = (now: number): void => {
    const rawDt = Math.min(0.05, Math.max(0.001, (now - this.lastTimestamp) / 1000));
    this.lastTimestamp = now;

    if (this.suspended) {
      this.rafId = requestAnimationFrame(this.loop);
      return;
    }

    // Always poll gamepads every frame (supports menus, button capture, claim & Start-button unpause!)
    this.input.pollGamepads();

    if (!this.paused) {
      this.tick(rawDt);
    }

    this.renderFrame();
    this.rafId = requestAnimationFrame(this.loop);
  };

  private tick(realDt: number): void {
    this.elapsedTime += realDt;

    // 10 FPS Line Boil clock!
    this.boilTimer += realDt;
    if (this.boilTimer >= 0.095) {
      this.boilTimer -= 0.095;
      this.boilFrame++;
    }

    if (this.fx.impactFrames > 0) {
      this.fx.impactFrames--;
      if (this.fx.impactFrames === 0) {
        this.fx.impactInvert = false;
      }
    }

    if (this.fx.superDimTimer > 0 && this.superCaster) {
      this.fx.superSpotlightPos = { x: this.superCaster.pos.x, y: this.superCaster.pos.y - 46 };
    } else if (this.fx.superDimTimer <= 0) {
      this.superCaster = null;
    }

    this.paper.update(realDt);

    if (this.lanRole === 'guest') {
      this.tickLanGuest(realDt);
      return;
    }

    const focusEnemy = this.getPrimaryHudEnemy();

    if (this.hitstopTimer > 0) {
      this.hitstopTimer -= realDt;
      this.camera.update(realDt, this.p1.pos, focusEnemy.pos, this.mode === 'roguelike');
      this.fx.update(0, realDt, !!this.stage.hasBambooLeaves, this.stage.worldWidth);
      return;
    }

    if (this.slowMoTimer > 0) {
      this.slowMoTimer -= realDt;
      if (this.slowMoTimer <= 0) {
        this.timeScale = 1.0;
        this.sound.setSlowMoFilter(false);
      }
    }

    const scaledDt = realDt * this.timeScale;
    this.accumulator += scaledDt;
    const FIXED_STEP = 1 / 60;

    while (this.accumulator >= FIXED_STEP) {
      this.fixedUpdate(FIXED_STEP);
      this.accumulator -= FIXED_STEP;
    }

    this.fx.update(scaledDt, realDt, !!this.stage.hasBambooLeaves, this.stage.worldWidth);
    this.camera.update(realDt, this.p1.pos, focusEnemy.pos, this.mode === 'roguelike');

    if (this.phase !== 'menu') {
      this.emitHud();
    }
  }

  private fixedUpdate(dt: number): void {
    // Live Attract-Mode AI Stickman Duel raging behind the Title Screen!
    if (this.phase === 'menu') {
      const broken = this.arenaObjects.getBrokenPlatformIds();
      this.arenaObjects.update(
        dt,
        this.elapsedTime,
        this.stage.platforms,
        this.stage.weaponDropXs,
        false,
        false,
        this.stage.floorY,
        this.stage.worldWidth,
        this.stage.worldHeight,
        () => {}
      );
      const e0 = this.enemies[0];
      if (e0) {
        // Keep demo fighters perpetually alive & spirited!
        if (this.p1.hp < 80) this.p1.hp = 200;
        if (e0.hp < 80) e0.hp = 200;
        if (this.p1.pos.y > this.stage.worldHeight + 40) this.p1.resetForRound({ ...this.stage.spawnP1 }, 1);
        if (e0.pos.y > this.stage.worldHeight + 40) e0.resetForRound({ ...this.stage.spawnP2 }, -1);

        const stageBounds = { floorY: this.stage.floorY, worldWidth: this.stage.worldWidth, pitKillY: this.stage.pitKillY };
        const aiInp1 = this.demoAiP1.update(dt, this.p1, e0, [], false, 'spar', undefined, this.stage.platforms, broken, stageBounds);
        const aiInp2 = this.enemyAis[0].update(dt, e0, this.p1, [], false, 'spar', undefined, this.stage.platforms, broken, stageBounds);
        const cb = this.makeFighterCallbacks();
        // Mute combat sfx subtly? SoundEngine stays silent until first click anyway!
        this.p1.update(dt, aiInp1, e0, this.stage.platforms, broken, this.sound, cb, true, this.stage.worldWidth, this.stage.updraftZones);
        e0.update(dt, aiInp2, this.p1, this.stage.platforms, broken, this.sound, cb, true, this.stage.worldWidth, this.stage.updraftZones);
        this.resolveFighterSeparations();
        this.updateProjectiles(dt);
        this.resolveCombat();
      }
      return;
    }

    // Process delayed cinematic events (e.g., Katana delayed paper rift!)
    for (let i = this.delayedEvents.length - 1; i >= 0; i--) {
      this.delayedEvents[i].timer -= dt;
      if (this.delayedEvents[i].timer <= 0) {
        const fn = this.delayedEvents[i].fn;
        this.delayedEvents.splice(i, 1);
        fn();
      }
    }

    // Gentle Stylish Rank decay during neutral
    if (this.phase === 'fighting' && this.styleScore > 0) {
      this.styleScore = Math.max(0, this.styleScore - 6.8 * dt);
      this.styleRank = scoreToStyleRank(this.styleScore);
      this.bgm.setStylishBoost(this.styleRank === 'A' || this.styleRank === 'S');
    }

    if (this.phase === 'intro') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0.42 && this.bannerText !== '开战!') {
        this.bannerText = '开战!';
        this.bannerSub = 'FIGHT!';
        this.sound.playStamp();
      }
      if (this.phaseTimer <= 0) {
        this.phase = 'fighting';
        this.bannerText = '';
        this.bannerSub = '';
      }
    } else if (this.phase === 'fighting') {
      this.stats.durationSec += dt;
      if (this.mode !== 'training') {
        this.roundTimer = Math.max(0, this.roundTimer - dt);
        if (this.roundTimer <= 0) {
          if (this.mode === 'roguelike') {
            this.finishRoguelikeRun();
          } else {
            const winner: 0 | 1 = this.p1.hp >= this.enemies[0].hp ? 0 : 1;
            this.finishRound(winner, '时间到!');
          }
        }
      } else {
        if (this.trainingInfInk) this.p1.ink = 100;
        const dummy = this.enemies[0];
        if (dummy.hp < dummy.maxHp && dummy.action !== 'hitstun') {
          dummy.hp = Math.min(dummy.maxHp, dummy.hp + 38 * dt);
        }
        if (this.p1.hp < 40) {
          this.p1.hp = Math.min(this.p1.maxHp, this.p1.hp + 45 * dt);
        }
      }

      const lowHp =
        this.p1.hp / this.p1.maxHp < 0.34 ||
        this.enemies.some((e) => e.action !== 'ko' && e.hp / e.maxHp < 0.34);
      this.bgm.setIntensity(lowHp || this.enemies.some((e) => e.isBoss) ? 'climax' : 'fight');
    } else if (this.phase === 'round_over') {
      this.phaseTimer -= dt;
      if (this.phaseTimer <= 0) {
        if (this.mode === 'roguelike') {
          // Wave cleared -> open 3-Card Sticker Buff Picker!
          this.phase = 'buff_pick';
          this.bannerText = '';
          const choices = rollThreeBuffChoices(this.roguelikeBuffs);
          this.uiCallbacks.onRoguelikeBuffChoices(this.roguelikeWave, choices);
        } else {
          const neededWins = this.lanRole !== 'none' ? Math.ceil(this.lanBestOf / 2) : 2;
          if (this.p1Wins >= neededWins || this.p2Wins >= neededWins) {
            this.phase = 'match_over';
            this.winnerIndex = this.p1Wins >= neededWins ? 0 : 1;
            if (this.lanRole === 'host') {
              this.emitLanSnapshot();
              this.emitLanFx({
                kind: 'match_end',
                winnerIdx: this.winnerIndex,
                p1Wins: this.p1Wins,
                p2Wins: this.p2Wins,
                bestOf: this.lanBestOf,
              });
              this.lanOnMatchEnd?.(this.winnerIndex, this.p1Wins, this.p2Wins, this.lanBestOf);
            } else {
              this.commitCareerProgress(this.winnerIndex === 0);
              const canNext =
                this.mode === 'arcade' &&
                this.winnerIndex === 0 &&
                this.arcadeStageIndex < ARCADE_MASTERS.length - 1;
              const cleared =
                this.mode === 'arcade' &&
                this.winnerIndex === 0 &&
                this.arcadeStageIndex === ARCADE_MASTERS.length - 1;
              this.stats.koSnapshotDataUrl = this.koSnapshotDataUrl;
              this.uiCallbacks.onMatchEnd(this.winnerIndex, this.stats, canNext, cleared);
            }
          } else {
            this.round++;
            this.startRound(true);
            if (this.lanRole === 'host') {
              this.emitLanFx({ kind: 'sfx', name: 'page_flip' });
            }
          }
        }
      }
    }

    // Update arena interactive objects (Origami planes, elevators, crates, bridges, highlighter zone, stapler!)
    this.arenaObjects.update(
      dt,
      this.elapsedTime,
      this.stage.platforms,
      this.stage.weaponDropXs,
      this.phase === 'fighting',
      !!this.stage.hasStationeryEvents || this.mode === 'roguelike',
      this.stage.floorY,
      this.stage.worldWidth,
      this.stage.worldHeight,
      () => this.sound.playPencilSketch(),
      (staplerX) => {
        this.sound.playPencilSketch();
        this.projectiles.push(
          createProjectile(1, 'stapler_hazard', { x: staplerX, y: this.stage.floorY }, 1, '#2b3242', '#d93636', 0.5)
        );
      },
      this.stage.pitKillY !== undefined
    );

    this.syncP1Modifiers();

    const brokenIds = this.arenaObjects.getBrokenPlatformIds();
    const canControl = this.phase === 'fighting';

    // 360-degree Aim calculation for BOTH P1 & P2 (Gamepad Right Stick OR Mouse Aim!)
    const p1Stick = this.input.getPlayerStickAim(0);
    if (canControl && p1Stick.aimAngle !== null) {
      this.input.p1.aimDir = p1Stick.aimDir;
      this.input.p1.aimAngle = p1Stick.aimAngle;
    } else if (canControl && this.input.doesPlayerUseMouseAim(0) && this.input.mouseHasMoved) {
      const mw = this.camera.screenToWorld(this.input.mouseCanvasPos);
      const dxMouse = mw.x - this.p1.pos.x;
      const dyMouse = mw.y - (this.p1.pos.y - 46);
      if (Math.abs(dxMouse) > 6) {
        this.input.p1.aimDir = dxMouse > 0 ? 1 : -1;
      }
      this.input.p1.aimAngle = Math.atan2(dyMouse, dxMouse);
    } else {
      this.input.p1.aimDir = 0;
      this.input.p1.aimAngle = null;
    }

    const p2Fighter = this.mode === 'versus' && this.lanRole === 'none' ? this.enemies[0] : null;
    const p2Stick = this.input.getPlayerStickAim(1);
    if (canControl && p2Fighter && p2Stick.aimAngle !== null) {
      this.input.p2.aimDir = p2Stick.aimDir;
      this.input.p2.aimAngle = p2Stick.aimAngle;
    } else if (canControl && p2Fighter && this.input.doesPlayerUseMouseAim(1) && this.input.mouseHasMoved) {
      const mw = this.camera.screenToWorld(this.input.mouseCanvasPos);
      const dxMouse = mw.x - p2Fighter.pos.x;
      const dyMouse = mw.y - (p2Fighter.pos.y - 46);
      if (Math.abs(dxMouse) > 6) {
        this.input.p2.aimDir = dxMouse > 0 ? 1 : -1;
      }
      this.input.p2.aimAngle = Math.atan2(dyMouse, dxMouse);
    } else {
      this.input.p2.aimDir = 0;
      this.input.p2.aimAngle = null;
    }

    const cb = this.makeFighterCallbacks();
    const nearestEnemy = this.getNearestAliveEnemy(this.p1.pos);
    this.p1.update(
      dt,
      this.input.p1,
      nearestEnemy,
      this.stage.platforms,
      brokenIds,
      this.sound,
      cb,
      canControl,
      this.stage.worldWidth,
      this.stage.updraftZones
    );

    // Update every enemy
    const stageBounds = { floorY: this.stage.floorY, worldWidth: this.stage.worldWidth, pitKillY: this.stage.pitKillY };
    this.enemies.forEach((enemy, idx) => {
      const inHighlighter = this.arenaObjects.isInHighlighterZone(enemy.pos);
      enemy.moveSpeedMult = inHighlighter ? 1.2 : 1.0;
      enemy.damageMult = inHighlighter ? 1.15 : 1.0;

      const enemyInp =
        this.lanRole === 'host' && idx === 0
          ? this.lanRemoteInput
          : this.mode === 'versus' && idx === 0
            ? this.input.p2
            : this.enemyAis[idx].update(
                dt,
                enemy,
                this.p1,
                this.arenaObjects.pickups,
                this.mode === 'training',
                this.trainingDummy,
                (trigger) => this.handleBossSkill(enemy, trigger.kind, trigger.targetX),
                this.stage.platforms,
                brokenIds,
                stageBounds
              );
      enemy.update(
        dt,
        enemyInp,
        this.p1,
        this.stage.platforms,
        brokenIds,
        this.sound,
        cb,
        canControl,
        this.stage.worldWidth,
        this.stage.updraftZones
      );
    });

    decayInputBuffers(this.input.p1);
    decayInputBuffers(this.input.p2);
    if (this.lanRole === 'host') {
      decayInputBuffers(this.lanRemoteInput);
    }

    this.resolveFighterSeparations();
    this.updateProjectiles(dt);

    if (this.phase === 'fighting') {
      this.resolveCombat();
      this.resolvePickupsAndOrbs();
      this.checkPitfalls();
    }

    if (this.lanRole === 'host') {
      this.emitLanSnapshot();
    }
  }

  private commitCareerProgress(p1Won: boolean): void {
    this.career.totalParries += this.stats.p1Parries;
    this.career.totalClashes += this.stats.clashes;
    this.career.maxCombo = Math.max(this.career.maxCombo, this.stats.p1MaxCombo);
    if (this.mode === 'roguelike') {
      this.career.highestWave = Math.max(this.career.highestWave, this.roguelikeWave);
    }
    if (this.mode === 'arcade' && p1Won && this.arcadeStageIndex === ARCADE_MASTERS.length - 1) {
      this.career.arcadeClears++;
    }
    saveCareerStats(this.career);
  }

  private makeFighterCallbacks() {
    return {
      onSpawnAfterimage: (f: Fighter, isDash: boolean) => {
        this.fx.spawnAfterimage(f.getPose(), f.inkColor, f.scarfColor);
        // Roguelike Buff: 「残影爆墨」 leaves an exploding ink mine behind on P1 dash!
        if (isDash && f.index === 0 && this.hasBuff('echo_bomb')) {
          this.projectiles.push(
            createProjectile(0, 'echo_bomb', { x: f.pos.x, y: f.pos.y - 42 }, f.facing, f.inkColor, f.scarfColor, 0.5)
          );
        }
      },
      onSpawnDust: (pos: Vec2, dir: number, count: number) => {
        this.fx.spawnDust(pos, dir, count);
      },
      onSkidMark: (pos: Vec2, facing: number) => {
        this.paper.addPaperScratch(pos.x - facing * 24, pos.y - 1, pos.x + facing * 10, pos.y - 1, '#32353d', 2.8);
      },
      onSpawnProjectile: (
        owner: Fighter,
        kind: MoveProjectileSpawn,
        pos: Vec2,
        facing: number,
        chargeRatio: number,
        aimAngle?: number | null
      ) => {
        // Dual Highlighters Heavy: paints a personal neon Highlighter Boost Zone on the floor!
        if (kind === 'paint_zone') {
          this.arenaObjects.highlighterZone = {
            active: true,
            x: clamp(owner.pos.x - 125, 70, this.stage.worldWidth - 320),
            y: owner.pos.y,
            w: 250,
            color: 'rgba(250, 232, 48, 0.48)',
            life: 8.0,
            maxLife: 8.0,
          };
          this.sound.playPencilSketch();
          this.fx.spawnPopText('划重点增幅!', { x: owner.pos.x, y: owner.pos.y - 86 }, '#d48c17', 1.05);
          return;
        }

        const baseAngle = aimAngle !== undefined && aimAngle !== null ? aimAngle : facing > 0 ? 0 : Math.PI;
        let fanOffsets: number[] = [0];
        if (kind === 'staple_bolt') {
          fanOffsets = owner.index === 0 && this.hasBuff('triple_proj')
            ? [-0.22, -0.11, 0, 0.11, 0.22]
            : [-0.09, 0, 0.09];
        } else if (owner.index === 0 && this.hasBuff('triple_proj') && kind !== 'shockwave') {
          fanOffsets = [-0.22, 0, 0.22];
        }

        for (const offset of fanOffsets) {
          const proj = createProjectile(
            owner.index,
            kind,
            pos,
            facing as 1 | -1,
            owner.inkColor,
            owner.scarfColor,
            chargeRatio,
            baseAngle + offset
          );
          if (owner.attackKind === 'heavy' && owner.activeHeavyCastId && owner.activeHeavyCastCap > 0) {
            proj.castId = owner.activeHeavyCastId;
            // Roguelike triple_proj buff grants +35% higher per-cast Heavy ceiling so fan barrages stay rewarding!
            const tripleBoost = owner.index === 0 && this.hasBuff('triple_proj') ? 1.35 : 1.0;
            proj.castCap = Math.round(owner.activeHeavyCastCap * tripleBoost);
          }
          this.projectiles.push(proj);
        }

        if (kind === 'shuriken') this.sound.playShurikenThrow();
        else if (kind === 'boomerang') this.sound.playBoomerangSpin();
        else if (kind === 'whiteout_beam') this.sound.playTapeWheel();
        else if (kind === 'compass_arc') this.sound.playCompassScratch();
        else if (kind === 'staple_bolt') this.sound.playStaplerSlam();
        else if (kind === 'ink_bomb') this.sound.playInkSplashBomb();
        else if (kind === 'wave') this.sound.playRulerTwang();
        else this.sound.playWhoosh(1.0);
        this.fx.blowLeaves(pos, facing);
      },
      onSuperTrigger: (f: Fighter) => {
        this.triggerWeaponSignatureSuper(f);
      },
      onRagdollBounce: (pos: Vec2, speed: number, color: string) => {
        this.paper.addInkSplatter(pos, color, Math.min(20, speed * 1.4));
        this.sound.playHit(Math.min(14, speed * 1.1), false);
        this.shakeCamera(Math.min(8, speed * 0.5));
      },
      onBouncePad: (pos: Vec2) => {
        this.fx.spawnPopText('弹!', pos, '#e85a82', 1.15);
        this.fx.spawnRing(pos, 72, '#4c86d6', 3.5);
        this.fx.spawnDust(pos, 0, 8);
      },
    };
  }

  /**
   * 12 Distinct Pure-Stationery Signature Super Finisher Cinematics
   * (Tiered Anti-Strobe Showcase: Smooth Spotlight Curtain + Hand-Drawn Cut-In + Soft Ink Impact!)
   */
  private triggerWeaponSignatureSuper(f: Fighter): void {
    const target = f.index === 0 ? this.getNearestAliveEnemy(f.pos) : this.p1;
    // Snapshot cast facing & 360° aim angle at trigger time so delayed effects NEVER flip backwards!
    const castDir: 1 | -1 = f.facing;
    const aimBase = f.lastAimAngle ?? (castDir > 0 ? 0 : Math.PI);
    const forwardMid: Vec2 = {
      x: clamp(f.pos.x + castDir * 150, 80, this.stage.worldWidth - 80),
      y: f.pos.y - 50,
    };
    const targetInFront = (target.pos.x - f.pos.x) * castDir >= -40;
    const mid: Vec2 = targetInFront
      ? { x: (f.pos.x + target.pos.x) * 0.5, y: f.pos.y - 50 }
      : forwardMid;
    const wDef = WEAPONS[f.weapon];

    // Keep Title Screen attract-mode demo calm; trigger full anime Super Showcase during real matches!
    if (this.phase !== 'menu') {
      this.superCaster = f;
      this.fx.triggerSuperShowcase(
        f.pos,
        f.name,
        wDef.icon,
        wDef.name,
        wDef.moves.super.name,
        f.scarfColor,
        castDir
      );
      this.emitLanFx({
        kind: 'cutin',
        fighterName: f.name,
        icon: wDef.icon,
        weaponName: wDef.name,
        title: wDef.moves.super.name,
        color: f.scarfColor,
        facing: castDir,
        fxX: Math.round(f.pos.x),
        fxY: Math.round(f.pos.y),
      });
      this.camera.punchFocus(f.pos, 1.26, 0.54);
      this.sound.setSlowMoFilter(true);
      this.slowMoTimer = 0.28;
      this.timeScale = 0.44;
    } else {
      this.fx.spawnPopText(wDef.moves.super.name, { x: f.pos.x, y: f.pos.y - 108 }, f.scarfColor, 1.25);
    }

    if (f.index === 0) this.addStylePoints(35);
    if (f.index === 0 || (this.mode === 'versus' && f.index === 1)) {
      this.input.triggerRumble(f.index === 0 ? 0 : 1, 220, 0.55, 0.78);
    }

    const supCastId = f.activeSuperCastId ?? undefined;
    const supCastCap = f.activeSuperCastCap > 0 ? f.activeSuperCastCap : Math.round(40 * f.damageMult);
    const pushSuperProj = (p: Projectile) => {
      if (supCastId) {
        p.castId = supCastId;
        p.castCap = supCastCap;
      }
      this.projectiles.push(p);
    };

    if (f.weapon === 'ruler') {
      // 30cm STEEL RULER: Delayed straightedge paper tear rift!
      this.sound.playRulerTwang();
      this.fx.spawnSuperCalligraphySlashes(mid, f.scarfColor);
      this.delayedEvents.push({
        timer: 0.38,
        fn: () => {
          if (this.phase !== 'fighting') return;
          this.sound.playPaperTear();
          this.sound.playHit(28, true, true);
          this.fx.spawnKatanaPaperRift(mid, f.scarfColor);
          this.shakeCamera(14, castDir, -0.3);
          const foes = f.index === 0 ? this.enemies : [this.p1];
          for (const foe of foes) {
            if (foe.action === 'ko') continue;
            if (Math.hypot(foe.pos.x - mid.x, foe.pos.y - f.pos.y) < 380) {
              this.applyDamage(f, foe, Math.round(18 * f.damageMult), 6, castDir * 640, -340, 0.1, 34, true, foe.pos, '沿尺撕页!', supCastId, supCastCap);
            }
          }
        },
      });
    } else if (f.weapon === 'compass') {
      // DRAFTING COMPASS: Pi = 3.14 triple geometry rings + 3 forward aimed arcs + 1 rear guard arc!
      this.sound.playCompassScratch();
      this.fx.spawnCompassRings(mid, f.scarfColor);
      this.delayedEvents.push({
        timer: 0.24,
        fn: () => {
          if (this.phase !== 'fighting') return;
          this.sound.playCompassScratch();
          for (const off of [-0.35, 0, 0.35, Math.PI]) {
            const ang = aimBase + off;
            const projFacing: 1 | -1 = Math.cos(ang) >= 0 ? 1 : -1;
            const spawnPos: Vec2 = {
              x: f.pos.x + Math.cos(ang) * 20,
              y: f.pos.y - 48 + Math.sin(ang) * 20,
            };
            pushSuperProj(
              createProjectile(f.index, 'compass_arc', spawnPos, projFacing, f.inkColor, '#1f6fd4', 0.8, ang)
            );
          }
        },
      });
    } else if (f.weapon === 'tape') {
      // CORRECTION TAPE: 3 parallel snow-white correction stripes sweeping along aimed direction!
      this.sound.playTapeWheel();
      this.fx.spawnWhiteoutStripes(mid);
      this.delayedEvents.push({
        timer: 0.2,
        fn: () => {
          if (this.phase !== 'fighting') return;
          this.sound.playTapeWheel();
          const projFacing: 1 | -1 = Math.cos(aimBase) >= 0 ? 1 : -1;
          const perpX = -Math.sin(aimBase);
          const perpY = Math.cos(aimBase);
          for (const offset of [-34, 0, 34]) {
            const spawnPos: Vec2 = {
              x: f.pos.x + Math.cos(aimBase) * 35 + perpX * offset,
              y: f.pos.y - 48 + Math.sin(aimBase) * 35 + perpY * offset,
            };
            pushSuperProj(
              createProjectile(f.index, 'whiteout_beam', spawnPos, projFacing, '#ffffff', '#2685d9', 0.9, aimBase)
            );
          }
        },
      });
    } else if (f.weapon === 'eraser') {
      // GIANT ERASER HAMMER: Leap + 3 Erupting White-Out Erasure Pillars in cast direction!
      f.vel.y = -420;
      this.delayedEvents.push({
        timer: 0.24,
        fn: () => {
          if (this.phase !== 'fighting') return;
          this.sound.playEraserRub();
          this.sound.playInkLightning();
          this.shakeCamera(16, 0, 1);
          for (const off of [95, 220, 345]) {
            const px = clamp(f.pos.x + castDir * off, 85, this.stage.worldWidth - 85);
            pushSuperProj(
              createProjectile(f.index, 'ink_pillar', { x: px, y: this.stage.floorY }, castDir, '#f089a4', '#4c86d6', 0.85)
            );
          }
        },
      });
    } else if (f.weapon === 'cutter') {
      // UTILITY KNIFE & THUMBTACKS: 6-point Crimson Cut Cage + 6 radiating pins anchored on aim!
      this.sound.playCutterClick();
      const cageCenter = targetInFront ? { x: target.pos.x, y: target.pos.y - 45 } : forwardMid;
      this.fx.spawnDaggerThreadCage(cageCenter, f.scarfColor);
      this.delayedEvents.push({
        timer: 0.28,
        fn: () => {
          if (this.phase !== 'fighting') return;
          this.sound.playShurikenThrow();
          this.sound.playParry();
          for (let i = 0; i < 6; i++) {
            const a = aimBase + (i / 6) * Math.PI * 2;
            const projFacing: 1 | -1 = Math.cos(a) >= 0 ? 1 : -1;
            pushSuperProj(
              createProjectile(f.index, 'shuriken', { x: f.pos.x, y: f.pos.y - 48 }, projFacing, f.inkColor, '#e02f2f', 0.85, a)
            );
          }
        },
      });
    } else if (f.weapon === 'pencil') {
      // MECHANICAL PENCIL: God-Tier Pen-Spinning Graphite Tornado lifting enemies!
      this.sound.playPencilClick();
      this.fx.spawnSuperCalligraphySlashes(f.pos, f.scarfColor);
      this.delayedEvents.push({
        timer: 0.22,
        fn: () => {
          if (this.phase !== 'fighting') return;
          this.sound.playWhoosh(1.2);
          this.fx.spawnRing({ x: f.pos.x, y: f.pos.y - 48 }, 230, '#2a8c76', 5);
          const foes = f.index === 0 ? this.enemies : [this.p1];
          for (const foe of foes) {
            if (foe.action === 'ko') continue;
            if (Math.hypot(foe.pos.x - f.pos.x, foe.pos.y - f.pos.y) < 300) {
              foe.vel.y = -620;
              foe.vel.x = (f.pos.x - foe.pos.x) * 1.4;
              this.fx.spawnPopText('转笔风暴!', foe.pos, '#2a8c76', 1.2);
            }
          }
        },
      });
    } else if (f.weapon === 'whip') {
      // PAPERCLIP CHAIN: Lasso ALL enemies violently into smash range in front of caster!
      this.sound.playWhipCrack();
      this.fx.spawnSuperCalligraphySlashes(mid, f.scarfColor);
      const foes = f.index === 0 ? this.enemies : [this.p1];
      for (const foe of foes) {
        if (foe.action === 'ko') continue;
        foe.vel.x = (f.pos.x + castDir * 75 - foe.pos.x) * 4.5;
        foe.vel.y = -240;
      }
    } else if (f.weapon === 'boomerang') {
      // SET-SQUARE BOOMERANG: 4-way Symmetric Returning Set-Square Storm anchored on aim!
      this.sound.playBoomerangSpin();
      this.fx.spawnSuperCalligraphySlashes(f.pos, '#1f98ad');
      for (const off of [-0.32, 0.32, Math.PI - 0.32, Math.PI + 0.32]) {
        const ang = aimBase + off;
        const projFacing: 1 | -1 = Math.cos(ang) >= 0 ? 1 : -1;
        pushSuperProj(
          createProjectile(f.index, 'boomerang', { x: f.pos.x, y: f.pos.y - 50 }, projFacing, f.inkColor, '#1f98ad', 0.85, ang)
        );
      }
    } else if (f.weapon === 'scissors') {
      // CRAFT SCISSORS: Giant Crimson X Cross-Cut Snip!
      this.sound.playScissorsSnip();
      this.fx.spawnScissorsCrossCut(mid);
      this.delayedEvents.push({
        timer: 0.24,
        fn: () => {
          if (this.phase !== 'fighting') return;
          this.sound.playScissorsSnip();
          this.sound.playPaperTear();
          this.shakeCamera(15);
          const foes = f.index === 0 ? this.enemies : [this.p1];
          for (const foe of foes) {
            if (foe.action === 'ko') continue;
            if (Math.hypot(foe.pos.x - mid.x, foe.pos.y - f.pos.y) < 340) {
              this.applyDamage(f, foe, Math.round(20 * f.damageMult), 7, castDir * 720, -320, 0.11, 36, true, foe.pos, '咔嚓剪断!', supCastId, supCastCap);
            }
          }
        },
      });
    } else if (f.weapon === 'stapler') {
      // HEAVY STAPLER: Full-Auto 7-Staple Fan Barrage along aimed direction!
      this.sound.playStaplerSlam();
      for (let k = -3; k <= 3; k++) {
        const ang = aimBase + k * 0.13;
        const projFacing: 1 | -1 = Math.cos(ang) >= 0 ? 1 : -1;
        this.delayedEvents.push({
          timer: (k + 3) * 0.045,
          fn: () => {
            if (this.phase !== 'fighting') return;
            this.sound.playStaplerSlam();
            const spawnPos: Vec2 = {
              x: f.pos.x + Math.cos(ang) * 35,
              y: f.pos.y - 46 + Math.sin(ang) * 18,
            };
            pushSuperProj(
              createProjectile(f.index, 'staple_bolt', spawnPos, projFacing, '#3f506e', '#d93636', 0.8, ang)
            );
          },
        });
      }
    } else if (f.weapon === 'highlighter') {
      // DUAL HIGHLIGHTERS: Giant Neon Boost Zone + Multi-Angle Blink Flurry (zero leftover drift!)
      this.arenaObjects.highlighterZone = {
        active: true,
        x: clamp(f.pos.x - 190, 60, this.stage.worldWidth - 440),
        y: this.stage.floorY,
        w: 380,
        color: 'rgba(255, 102, 181, 0.34)',
        life: 10,
        maxLife: 10,
      };
      this.fx.spawnSuperCalligraphySlashes(target.pos, '#f5da22');
      for (let step = 1; step <= 3; step++) {
        this.delayedEvents.push({
          timer: step * 0.095,
          fn: () => {
            if (this.phase !== 'fighting' || target.action === 'ko') return;
            this.fx.spawnAfterimage(f.getPose(), '#f5da22', '#ff66b5');
            const side = step % 2 === 0 ? -1 : 1;
            f.pos.x = clamp(target.pos.x + side * 62, 85, this.stage.worldWidth - 85);
            f.facing = (-side) as 1 | -1;
            // Cancel residual lunge velocity on teleport so fighter doesn't skate backwards!
            f.vel.x = 0;
            f.vel.y = 0;
            this.sound.playWhoosh(0.65);
          },
        });
      }
    } else {
      // GOLD-NIB FOUNTAIN PEN: Hurls 5 arcing Ink Blob Bombs along aimed direction (capped safely by supCastCap!)
      this.sound.playInkSplashBomb();
      this.fx.spawnCompassRings(mid, '#d42c2c');
      const penBase = f.lastAimAngle !== null ? f.lastAimAngle : castDir > 0 ? -0.28 : Math.PI + 0.28;
      for (let k = -2; k <= 2; k++) {
        const ang = penBase + k * 0.18;
        const projFacing: 1 | -1 = Math.cos(ang) >= 0 ? 1 : -1;
        pushSuperProj(
          createProjectile(f.index, 'ink_bomb', { x: f.pos.x, y: f.pos.y - 54 }, projFacing, '#141720', '#d99a1e', 0.85, ang)
        );
      }
    }
  }

  private handleBossSkill(boss: Fighter, kind: 'spikes' | 'eraser', targetX: number): void {
    if (kind === 'spikes') {
      this.sound.playPencilSketch();
      this.fx.spawnPopText('墨刺绘阵!', { x: boss.pos.x, y: boss.pos.y - 105 }, '#d99a1e', 1.15);
      for (const offset of [-90, 0, 90]) {
        const sx = clamp(targetX + offset, 95, this.stage.worldWidth - 95);
        this.projectiles.push(
          createProjectile(1, 'boss_spike', { x: sx, y: this.stage.floorY }, -1, '#0c0d11', '#d99a1e', 0.5)
        );
      }
    } else {
      this.sound.playEraserRub();
      this.fx.spawnPopText('橡皮抹除!', { x: boss.pos.x, y: boss.pos.y - 105 }, '#e85a82', 1.2);
      const fromRight = boss.pos.x >= this.p1.pos.x;
      const startX = fromRight ? this.stage.worldWidth - 90 : 90;
      const dir: 1 | -1 = fromRight ? -1 : 1;
      this.projectiles.push(
        createProjectile(1, 'boss_eraser', { x: startX, y: this.stage.floorY - 38 }, dir, '#e87fa0', '#4c86d6', 0.5)
      );
    }
  }

  private resolveFighterSeparations(): void {
    const all = this.getAllFighters();
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i];
        const b = all[j];
        if (a.action === 'ko' || b.action === 'ko' || a.action === 'dash' || b.action === 'dash') continue;
        if (Math.abs(a.pos.y - b.pos.y) > 65) continue;
        const dx = b.pos.x - a.pos.x;
        const minDist = 34;
        if (Math.abs(dx) < minDist) {
          const push = (minDist - Math.abs(dx)) * 0.45;
          const sign = dx >= 0 ? 1 : -1;
          a.pos.x -= sign * push;
          b.pos.x += sign * push;
        }
      }
    }
  }

  private updateProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.life -= dt;
      p.age += dt;
      if (p.life <= 0 || p.pos.x < -200 || p.pos.x > this.stage.worldWidth + 200 || p.pos.y > this.stage.worldHeight + 160) {
        this.projectiles.splice(i, 1);
        continue;
      }

      // Telegraphed hazards & mines
      if (p.telegraphTime !== undefined && p.telegraphTime > 0) {
        p.telegraphTime -= dt;
        if (p.telegraphTime <= 0 && !p.erupted) {
          p.erupted = true;
          if (p.kind === 'boss_spike' || p.kind === 'ink_pillar') {
            this.sound.playPaperTear();
            this.fx.spawnInkBurst(p.pos, p.color, 14, 0, -1, 340);
            this.paper.addInkSplatter(p.pos, p.color, 18, 0, -0.5);
            this.shakeCamera(8, 0, -1);
          } else if (p.kind === 'echo_bomb') {
            this.sound.playHit(16, true);
            this.fx.spawnInkBurst(p.pos, p.accent, 18, 0, -0.5, 400);
            this.fx.spawnRing(p.pos, 92, p.accent, 4);
            this.shakeCamera(7);
          } else if (p.kind === 'stapler_hazard') {
            this.sound.playStaplerSlam();
            this.fx.spawnPaperShards(p.pos, '#2b3242', 14);
            this.shakeCamera(12, 0, 1);
          }
        }
        continue;
      }

      // Boomerang smooth return arc!
      if (p.kind === 'boomerang') {
        const owner = p.ownerIndex === 0 ? this.p1 : this.enemies.find((e) => e.action !== 'ko') ?? this.enemies[0];
        if (!p.returning && p.age > 0.46) {
          p.returning = true;
          p.hitIds.clear(); // Can slice enemies AGAIN on the way back!
          this.sound.playBoomerangSpin();
        }
        if (p.returning && owner) {
          const tx = owner.pos.x;
          const ty = owner.pos.y - 46;
          const dx = tx - p.pos.x;
          const dy = ty - p.pos.y;
          const d = Math.hypot(dx, dy) || 1;
          p.vel.x += (dx / d) * 2400 * dt;
          p.vel.y += (dy / d) * 2400 * dt;
          const spd = Math.hypot(p.vel.x, p.vel.y);
          if (spd > 820) {
            p.vel.x = (p.vel.x / spd) * 820;
            p.vel.y = (p.vel.y / spd) * 820;
          }
          if (d < 36 && p.age > 0.65) {
            this.projectiles.splice(i, 1);
            continue;
          }
        } else {
          p.vel.x *= 0.975;
          p.vel.y *= 0.975;
        }
      }

      if (p.gravity) {
        p.vel.y += p.gravity * dt;
      }

      p.pos.x += p.vel.x * dt;
      p.pos.y += p.vel.y * dt;

      // Fountain-Pen Ink Bomb explodes on hitting the floor!
      if (p.kind === 'ink_bomb' && p.pos.y >= this.stage.floorY - 10) {
        this.sound.playInkSplashBomb();
        this.paper.addInkSplatter(p.pos, p.color, 34, 0, -0.3);
        this.fx.spawnInkBurst(p.pos, p.color, 20, 0, -0.6, 360);
        this.fx.spawnRing(p.pos, 96, p.accent, 4);
        const splashTargets = p.ownerIndex === 0 ? this.enemies : [this.p1];
        const atk = p.ownerIndex === 0 ? this.p1 : this.enemies[0];
        for (const def of splashTargets) {
          if (def.action !== 'ko' && Math.hypot(def.pos.x - p.pos.x, def.pos.y - p.pos.y) < 110) {
            this.applyDamage(atk, def, Math.round(p.damage * 0.8), 3, Math.sign(def.pos.x - p.pos.x || 1) * 420, -280, 0.06, 20, false, p.pos, '墨爆!', p.castId, p.castCap);
          }
        }
        this.projectiles.splice(i, 1);
        continue;
      }

      // Correction Tape White-Out Beam WIPES OUT opposing projectiles on contact!
      if (p.kind === 'whiteout_beam') {
        const wb = getProjectileHitbox(p);
        if (wb) {
          for (let j = this.projectiles.length - 1; j >= 0; j--) {
            if (j === i) continue;
            const other = this.projectiles[j];
            if (other.ownerIndex === p.ownerIndex || other.kind === 'stapler_hazard') continue;
            const ob = getProjectileHitbox(other);
            if (ob && rectsOverlap(wb, ob)) {
              this.fx.spawnPopText('涂白抹除!', other.pos, '#2685d9', 0.95);
              this.fx.spawnDust(other.pos, 0, 7);
              this.projectiles.splice(j, 1);
              if (j < i) i--;
            }
          }
        }
      }

      if (p.kind === 'boss_eraser' && Math.random() < 0.45) {
        this.fx.spawnDust({ x: p.pos.x, y: p.pos.y + 24 }, -p.facing, 1);
      }

      const pb = getProjectileHitbox(p);
      if (!pb) continue;

      // Determine targets (stapler hits everyone; otherwise opposing team!)
      const targets =
        p.kind === 'stapler_hazard'
          ? this.getAllFighters()
          : p.ownerIndex === 0
            ? this.enemies
            : [this.p1];
      const attacker = p.ownerIndex === 0 ? this.p1 : this.enemies[0];

      let consumed = false;
      for (const defender of targets) {
        if (defender.action === 'ko' || p.hitIds.has(defender.uid)) continue;
        if (!rectsOverlap(pb, defender.getHurtbox())) continue;

        if (defender.dashInvulnFrames > 0) {
          this.triggerPerfectDodge(defender);
          continue;
        }
        if (defender.invulnFrames > 0) continue;

        // Perfect Parry reflects standard projectiles back!
        if (
          defender.action === 'block' &&
          defender.parryWindowFrames > 0 &&
          (p.kind === 'wave' ||
            p.kind === 'shuriken' ||
            p.kind === 'boomerang' ||
            p.kind === 'compass_arc' ||
            p.kind === 'whiteout_beam' ||
            p.kind === 'staple_bolt' ||
            p.kind === 'ink_bomb')
        ) {
          p.ownerIndex = defender.index;
          p.facing = (-p.facing) as 1 | -1;
          p.vel.x = -p.vel.x * 1.25;
          p.vel.y = -p.vel.y * 1.25;
          p.angle = Math.atan2(p.vel.y, p.vel.x);
          p.life = p.maxLife;
          p.hitIds.clear();
          defender.action = 'parry_success';
          defender.actionFrames = 0;
          defender.addInk(20);
          if (defender.index === 0) {
            this.stats.p1Parries++;
            this.addStylePoints(38);
          } else {
            this.stats.p2Parries++;
          }
          this.sound.playParry();
          this.fx.spawnParrySparks(p.pos, '#f2a918', 22);
          this.fx.spawnPopText('弹返!', p.pos, '#d98a00', 1.25);
          this.fx.triggerImpactFrame(3, p.pos, 0.22, 'parry');
          this.hitstopTimer = 0.09;
          this.camera.punchFocus(p.pos, 1.24, 0.24);
          break;
        }

        p.hitIds.add(defender.uid);
        const dirSign = p.vel.x !== 0 ? Math.sign(p.vel.x) : p.facing;
        this.applyDamage(
          attacker,
          defender,
          Math.round(p.damage * (p.ownerIndex === 0 ? this.p1.damageMult : 1)),
          3,
          p.knockbackX * dirSign,
          p.knockbackY,
          0.06,
          20,
          p.kind === 'boss_eraser' || p.kind === 'shockwave' || p.kind === 'ink_pillar' || p.kind === 'stapler_hazard',
          p.pos,
          p.kind === 'boss_eraser' ? '擦!' : p.kind === 'boomerang' ? '旋斩!' : p.kind === 'echo_bomb' ? '爆墨!' : '斩!',
          p.castId,
          p.castCap
        );

        if (
          p.kind === 'wave' ||
          p.kind === 'shuriken' ||
          p.kind === 'falling_pin' ||
          p.kind === 'compass_arc' ||
          p.kind === 'staple_bolt' ||
          p.kind === 'ink_bomb'
        ) {
          if (p.kind === 'ink_bomb') {
            this.sound.playInkSplashBomb();
            this.paper.addInkSplatter(p.pos, p.color, 30);
            this.fx.spawnRing(p.pos, 86, p.accent, 4);
          }
          consumed = true;
          break;
        }
      }

      if (consumed) {
        this.projectiles.splice(i, 1);
      }
    }
  }

  private resolveCombat(): void {
    const h1 = this.p1.getActiveAttackHitbox();

    // 1. Check WEAPON CLASH against any enemy swinging simultaneously!
    if (h1) {
      for (const enemy of this.enemies) {
        if (enemy.action === 'ko') continue;
        const h2 = enemy.getActiveAttackHitbox();
        if (h2 && rectsOverlap(h1, h2) && !this.p1.attackHitIds.has(`clash_${enemy.uid}`)) {
          this.p1.attackHitIds.add(`clash_${enemy.uid}`);
          this.p1.attackHitIds.add(enemy.uid);
          enemy.attackHitIds.add(this.p1.uid);
          this.stats.clashes++;
          this.addStylePoints(28);

          const mid: Vec2 = {
            x: (this.p1.pos.x + enemy.pos.x) * 0.5,
            y: (this.p1.pos.y + enemy.pos.y) * 0.5 - 46,
          };
          this.p1.vel.x = -this.p1.facing * 420;
          enemy.vel.x = -enemy.facing * 420;
          this.p1.addInk(12);
          enemy.addInk(12);

          this.sound.playClash();
          this.fx.spawnParrySparks(mid, '#f7ba2a', 26);
          this.fx.spawnPopText('对撞!!', mid, '#d97706', 1.35);
          this.emitLanFx({ kind: 'clash', x: Math.round(mid.x), y: Math.round(mid.y) });
          this.emitLanFx({ kind: 'pop', x: Math.round(mid.x), y: Math.round(mid.y), text: '对撞!!', color: '#d97706', scale: 1.35 });
          this.fx.triggerImpactFrame(0, mid, 0.24, 'normal');
          this.fx.blowLeaves(mid, 0);
          this.hitstopTimer = 0.11;
          this.shakeCamera(12);
          this.input.triggerRumble(0, 140, 0.65, 0.45);
          if (this.mode === 'versus') this.input.triggerRumble(1, 140, 0.65, 0.45);
          this.camera.punchFocus(mid, 1.28, 0.26);
          return;
        }
      }
    }

    // 2. Evaluate all attacks (P1 -> enemies, enemies -> P1, plus arena crates/bridges!)
    const allFighters = this.getAllFighters();
    for (const atk of allFighters) {
      if (atk.action === 'ko') continue;
      const box = atk.getActiveAttackHitbox();
      if (!box) continue;
      const move = atk.getCurrentMove();
      if (!move) continue;

      if (this.stage.hasBambooLeaves && atk.actionFrames === move.startup) {
        this.fx.blowLeaves(atk.pos, atk.facing);
      }

      if ((move.guardBreak || move.spike) && !atk.attackHitIds.has('bridge')) {
        atk.attackHitIds.add('bridge');
        this.arenaObjects.damageBridgeAt(
          box.x + box.w * 0.5,
          atk.pos.y,
          move.damage * 1.15,
          this.stage.platforms,
          (plat) => {
            this.sound.playPaperTear();
            this.fx.spawnPaperShards({ x: plat.x + plat.w * 0.5, y: plat.y }, this.theme.inkPrimary, 16);
            this.fx.spawnPopText('断裂!', { x: plat.x + plat.w * 0.5, y: plat.y - 24 }, '#c93838', 1.1);
            this.shakeCamera(10, 0, 1);
          }
        );
      }

      // Crates
      for (const c of this.arenaObjects.crates) {
        if (c.broken || atk.attackHitIds.has(c.id)) continue;
        if (rectsOverlap(box, this.arenaObjects.getCrateRect(c))) {
          atk.attackHitIds.add(c.id);
          c.hp -= move.damage;
          c.hitShake = 1;
          this.sound.playCrateBreak();
          this.fx.spawnInkBurst(c.pos, this.theme.inkPrimary, 8, atk.facing, -0.4, 220);
          if (c.hp <= 0) {
            c.broken = true;
            this.paper.addInkSplatter(c.pos, this.theme.inkPrimary, 18);
            this.fx.spawnPaperShards(c.pos, this.theme.inkPrimary, 12);
            this.arenaObjects.spawnInkOrbs(c.pos, 2);
            if (Math.random() < 0.45) {
              this.arenaObjects.spawnWeaponDrop(c.pos.x, c.pos.y - 30, () => this.sound.playPencilSketch());
            }
          }
        }
      }

      const targets = atk.index === 0 ? this.enemies : [this.p1];
      for (const def of targets) {
        if (def.action === 'ko' || atk.attackHitIds.has(def.uid)) continue;
        if (!rectsOverlap(box, def.getHurtbox())) continue;

        if (def.dashInvulnFrames > 0) {
          atk.attackHitIds.add(def.uid);
          this.triggerPerfectDodge(def);
          continue;
        }
        if (def.invulnFrames > 0) continue;

        atk.attackHitIds.add(def.uid);
        const hitPos: Vec2 = {
          x: (atk.pos.x + def.pos.x) * 0.5,
          y: def.pos.y - 46,
        };

        // Balanced charge scaling + multiHit 55% per-hit split (prevents accidental 200% damage on 2-hit moves!)
        const chargeMult = atk.attackKind === 'heavy' ? 1 + atk.lastChargeRatio * 0.28 : 1;
        const chargeKb = atk.attackKind === 'heavy' ? 1 + atk.lastChargeRatio * 0.22 : 1;
        const multiHitScale = move.multiHit && move.multiHit > 1 ? 0.55 : 1;
        const dmg = Math.max(1, Math.round(move.damage * multiHitScale * chargeMult * atk.damageMult));
        const kbMult = atk.index === 0 && this.hasBuff('heavy_ink') ? 1.18 : 1.0;

        // Paperclip Chain Whip pulls target right in front of attacker!
        const kbX = move.pullEnemy
          ? (atk.pos.x + atk.facing * 74 - def.pos.x) * 4.4
          : move.knockbackX * chargeKb * kbMult * atk.facing;
        const kbY = move.knockbackY * (move.launcher ? 1 : chargeKb);

        const extraGuardBreak =
          atk.index === 0 && atk.attackKind === 'light3' && this.hasBuff('iron_nib');

        const castId =
          atk.attackKind === 'heavy'
            ? atk.activeHeavyCastId ?? undefined
            : atk.attackKind === 'super'
              ? atk.activeSuperCastId ?? undefined
              : undefined;
        const castCap =
          atk.attackKind === 'heavy'
            ? atk.activeHeavyCastCap
            : atk.attackKind === 'super'
              ? atk.activeSuperCastCap
              : undefined;

        this.applyDamage(
          atk,
          def,
          dmg,
          move.chipDamage,
          kbX,
          kbY,
          move.hitstop,
          move.hitstun,
          !!move.guardBreak || extraGuardBreak || (atk.attackKind === 'heavy' && atk.lastChargeRatio > 0.5),
          hitPos,
          move.onomatopoeia,
          castId,
          castCap
        );

        // Damp attacker's forward lunge velocity on melee contact so combos feel planted & never skate past the target!
        if (atk.action === 'attack' || atk.action === 'super_active') {
          atk.vel.x *= 0.32;
        }

        // Roguelike Buff: 「塑料尺静电雷」 calls down comic lightning on Heavy Hits (+12 independent bonus dmg)!
        if (atk.index === 0 && atk.attackKind === 'heavy' && this.hasBuff('ink_lightning') && def.hp > 0) {
          this.sound.playInkLightning();
          this.fx.spawnLightningBolt(def.pos.x, this.stage.floorY, '#f2b818');
          def.hp = Math.max(1, def.hp - 12);
          this.fx.spawnPopText('静电雷 -12', { x: def.pos.x, y: def.pos.y - 95 }, '#d48c17', 1.05);
        }

        // Roguelike Buff: 「巨型图钉雨」 every 5th P1 hit rains 3 giant thumbtacks!
        if (atk.index === 0 && this.hasBuff('pin_rain')) {
          this.p1HitCounterForPins++;
          if (this.p1HitCounterForPins >= 5) {
            this.p1HitCounterForPins = 0;
            this.sound.playShurikenThrow();
            for (const ox of [-55, 0, 55]) {
              this.projectiles.push(
                createProjectile(0, 'falling_pin', { x: def.pos.x + ox, y: -30 - Math.abs(ox) }, 1, '#191b24', '#d93636', 0.5)
              );
            }
            this.fx.spawnPopText('图钉雨!', { x: def.pos.x, y: 120 }, '#1c7c54', 1.1);
          }
        }
      }
    }
  }

  private triggerPerfectDodge(dodger: Fighter): void {
    if (dodger.perfectDodgeCooldown > 0) return;
    dodger.perfectDodgeCooldown = 36;
    dodger.addInk(16);
    if (dodger.index === 0) this.addStylePoints(30);
    this.sound.playPerfectDodge();
    this.sound.setSlowMoFilter(true);
    this.slowMoTimer = 0.28;
    this.timeScale = 0.35;
    this.fx.spawnPopText('残影闪!', { x: dodger.pos.x, y: dodger.pos.y - 76 }, dodger.scarfColor, 1.15);
    this.fx.spawnRing({ x: dodger.pos.x, y: dodger.pos.y - 44 }, 90, dodger.scarfColor, 3.5);
    this.emitLanFx({ kind: 'pop', x: Math.round(dodger.pos.x), y: Math.round(dodger.pos.y - 76), text: '残影闪!', color: dodger.scarfColor, scale: 1.15 });
    this.emitLanFx({ kind: 'sfx', name: 'dodge' });
  }

  private applyDamage(
    atk: Fighter,
    def: Fighter,
    damage: number,
    chipDamage: number,
    kbX: number,
    kbY: number,
    hitstop: number,
    hitstun: number,
    guardBreak: boolean,
    hitPos: Vec2,
    ono: string,
    castId?: string,
    castCap?: number
  ): void {
    // Single-player PvE AI damage scaling (Arcade & Roguelike feel fair; PvP Versus/LAN stay 100% symmetrical!)
    let aiPvEScale = 1.0;
    if (atk.index === 1 && def.index === 0) {
      if (this.mode === 'arcade') {
        aiPvEScale = this.arcadeStageIndex >= 3 ? 0.88 : 0.84;
      } else if (this.mode === 'roguelike') {
        aiPvEScale = atk.isBoss ? 0.82 : 0.72;
      }
    }
    const scaledIncoming = Math.max(1, Math.round(damage * aiPvEScale));
    const scaledCap = castCap && castCap > 0 ? Math.max(1, Math.round(castCap * aiPvEScale)) : castCap;

    // Enforce per-cast Heavy / Super cap so melee + spawned projectiles never double-dip into a 70~120 DMG one-shot!
    let effectiveDamage = scaledIncoming;
    if (castId && scaledCap && scaledCap > 0) {
      const dealt = this.heavyCastDealt.get(castId) ?? 0;
      const rem = Math.max(0, scaledCap - dealt);
      if (rem <= 0) return;
      effectiveDamage = Math.min(scaledIncoming, rem);
    }

    const facingAttacker = (atk.pos.x - def.pos.x) * def.facing >= -18;
    const isBlocking = def.action === 'block' && facingAttacker;

    // 1. PERFECT PARRY!
    if (isBlocking && def.parryWindowFrames > 0) {
      def.action = 'parry_success';
      def.actionFrames = 0;
      def.parryWindowFrames = 0;
      const isPvEAi = def.index === 1 && (this.mode === 'arcade' || this.mode === 'roguelike');
      def.addInk(isPvEAi ? 16 : 26);
      def.guardMeter = Math.min(100, def.guardMeter + 35);

      if (def.index === 0) {
        this.stats.p1Parries++;
        this.addStylePoints(38);
        // Roguelike Buff: 「弹反回血」 heals +16 HP & releases shockwave!
        if (this.hasBuff('parry_vamp')) {
          def.hp = Math.min(def.maxHp, def.hp + 16);
          this.fx.spawnPopText('+16 弹反回血!', { x: def.pos.x, y: def.pos.y - 95 }, '#1c9654', 1.1);
          this.fx.spawnRing(def.pos, 240, '#f2a918', 6);
          for (const foe of this.enemies) {
            if (foe.action !== 'ko' && Math.hypot(foe.pos.x - def.pos.x, foe.pos.y - def.pos.y) < 260) {
              foe.vel.x = Math.sign(foe.pos.x - def.pos.x || 1) * 560;
              foe.vel.y = -240;
            }
          }
        }
      } else {
        this.stats.p2Parries++;
      }

      if (atk.action !== 'super_active') {
        atk.action = 'hitstun';
        atk.actionFrames = 0;
        atk.hitstunFrames = 26;
        atk.attackKind = null;
        atk.vel.x = -atk.facing * 360;
      }

      this.sound.playParry();
      this.fx.spawnParrySparks(hitPos, '#f2a918', 24);
      this.fx.spawnPopText('弹反!!', hitPos, '#d48200', 1.38);
      this.emitLanFx({ kind: 'parry', x: Math.round(hitPos.x), y: Math.round(hitPos.y), color: '#f2a918' });
      this.emitLanFx({ kind: 'pop', x: Math.round(hitPos.x), y: Math.round(hitPos.y), text: '弹反!!', color: '#d48200', scale: 1.38 });
      this.fx.triggerImpactFrame(4, hitPos, 0.26, 'parry');
      this.hitstopTimer = 0.115;
      this.shakeCamera(10);
      if (def.index === 0 || this.mode === 'versus') {
        this.input.triggerRumble(def.index === 0 ? 0 : 1, 120, 0.85, 0.35);
      }
      this.camera.punchFocus(hitPos, 1.28, 0.3);
      return;
    }

    // 2. REGULAR BLOCK / GUARD BREAK
    if (isBlocking) {
      def.guardMeter -= effectiveDamage * (guardBreak ? 2.8 : 1.45);
      if (guardBreak || def.guardMeter <= 0) {
        def.guardMeter = 0;
        def.action = 'guard_break';
        def.actionFrames = 0;
        def.hitstunFrames = 44;
        const gbBleed = Math.round(effectiveDamage * 0.5);
        if (castId && scaledCap && scaledCap > 0) {
          this.heavyCastDealt.set(castId, (this.heavyCastDealt.get(castId) ?? 0) + gbBleed);
        }
        def.hp = Math.max(1, def.hp - gbBleed);
        def.vel.x = kbX * 0.55;
        def.vel.y = -180;
        atk.addInk(18);
        if (atk.index === 0) this.addStylePoints(26);

        this.sound.playHit(effectiveDamage, true, true);
        this.fx.spawnPaperShards(hitPos, def.scarfColor, 14);
        this.fx.spawnPopText('破防!!', hitPos, '#d92828', 1.4);
        this.emitLanFx({ kind: 'hit', x: Math.round(hitPos.x), y: Math.round(hitPos.y), color: def.scarfColor, dmg: effectiveDamage, heavy: true, guardBreak: true, dirX: Math.sign(kbX) });
        this.emitLanFx({ kind: 'pop', x: Math.round(hitPos.x), y: Math.round(hitPos.y), text: '破防!!', color: '#d92828', scale: 1.4 });
        this.fx.triggerImpactFrame(4, hitPos, 0.28, 'parry');
        this.hitstopTimer = 0.11;
        this.shakeCamera(14, Math.sign(kbX), 0);
        if (def.index === 0 || this.mode === 'versus') {
          this.input.triggerRumble(def.index === 0 ? 0 : 1, 200, 0.5, 0.88);
        }
        this.camera.punchFocus(hitPos, 1.26, 0.28);
        return;
      }

      def.hp = Math.max(1, def.hp - chipDamage);
      def.vel.x = Math.sign(kbX) * 240;
      atk.addInk(6);
      def.addInk(8);
      this.sound.playBlock();
      this.fx.spawnParrySparks(hitPos, '#8fa3bf', 8);
      this.fx.spawnPopText('挡!', hitPos, '#465873', 0.9);
      this.emitLanFx({ kind: 'sfx', name: 'block' });
      this.emitLanFx({ kind: 'pop', x: Math.round(hitPos.x), y: Math.round(hitPos.y), text: '挡!', color: '#465873', scale: 0.9 });
      this.hitstopTimer = 0.04;
      this.shakeCamera(5, Math.sign(kbX), 0);
      return;
    }

    // 3. CLEAN HIT!
    if (castId && castCap && castCap > 0) {
      this.heavyCastDealt.set(castId, (this.heavyCastDealt.get(castId) ?? 0) + effectiveDamage);
      if (this.heavyCastDealt.size > 40) {
        const firstKey = this.heavyCastDealt.keys().next().value;
        if (firstKey) this.heavyCastDealt.delete(firstKey);
      }
    }
    const isHeavy = effectiveDamage >= 15 || guardBreak;
    def.hp = Math.max(0, def.hp - effectiveDamage);
    def.hurtFlashFrames = 6;
    def.comboReceived++;

    if (atk.index === 0) {
      this.stats.p1DamageDealt += effectiveDamage;
      this.stats.p1MaxCombo = Math.max(this.stats.p1MaxCombo, def.comboReceived);
      this.addStylePoints(isHeavy ? 18 : 11);
    } else {
      this.stats.p2DamageDealt += effectiveDamage;
      this.stats.p2MaxCombo = Math.max(this.stats.p2MaxCombo, def.comboReceived);
      // Taking clean damage lowers Stylish Rank!
      this.styleScore = Math.max(0, this.styleScore - 22);
      this.styleRank = scoreToStyleRank(this.styleScore);
    }

    atk.addInk(Math.round(effectiveDamage * 0.95));
    def.addInk(Math.round(effectiveDamage * 0.55));

    this.paper.addInkSplatter(hitPos, def.inkColor, isHeavy ? 22 : 12, Math.sign(kbX), Math.sign(kbY));
    if (isHeavy) {
      this.paper.addPaperScratch(
        hitPos.x - Math.sign(kbX) * 40,
        hitPos.y - 26,
        hitPos.x + Math.sign(kbX) * 52,
        hitPos.y + 22,
        atk.scarfColor,
        3.5
      );
    }

    // Per-player haptic rumble on clean hits (only during active matches, not title demo!)
    if (this.phase === 'fighting') {
      if (def.index === 0 || (this.mode === 'versus' && def.index === 1)) {
        this.input.triggerRumble(def.index === 0 ? 0 : 1, isHeavy ? 150 : 70, isHeavy ? 0.45 : 0.22, isHeavy ? 0.72 : 0.32);
      }
      if (atk.index === 0 || (this.mode === 'versus' && atk.index === 1)) {
        this.input.triggerRumble(atk.index === 0 ? 0 : 1, isHeavy ? 90 : 45, isHeavy ? 0.38 : 0.18, isHeavy ? 0.32 : 0.12);
      }
    }

    // Check KO! (Skip real KOs during Title Screen live attract-mode demo!)
    if (def.hp <= 0 && this.mode !== 'training' && this.phase !== 'menu') {
      this.input.triggerRumble(0, 320, 0.7, 0.95);
      if (this.mode === 'versus') this.input.triggerRumble(1, 320, 0.7, 0.95);
      def.triggerKO(kbX * 1.15, Math.min(-340, kbY * 1.15));
      if (atk.index === 0) {
        this.career.totalKOs++;
        this.addStylePoints(32);
      }

      this.sound.playHit(damage * 1.4, true, true);
      this.sound.playPaperTear();
      this.fx.spawnInkBurst(hitPos, def.inkColor, 34, Math.sign(kbX), -0.4, 520);
      this.fx.spawnInkBurst(hitPos, def.scarfColor, 18, Math.sign(kbX), -0.3, 460);
      this.fx.spawnPopText('绝杀!', hitPos, '#cc1f1f', 1.65);
      this.emitLanFx({ kind: 'hit', x: Math.round(hitPos.x), y: Math.round(hitPos.y), color: def.inkColor, dmg: Math.round(damage * 1.4), heavy: true, guardBreak: true, dirX: Math.sign(kbX), dirY: -0.4 });
      this.emitLanFx({ kind: 'pop', x: Math.round(hitPos.x), y: Math.round(hitPos.y), text: '绝杀!', color: '#cc1f1f', scale: 1.65 });
      this.emitLanFx({ kind: 'sfx', name: 'tear' });
      this.fx.triggerImpactFrame(8, hitPos, 0.55, 'ko');
      this.hitstopTimer = 0.16;
      this.shakeCamera(20, Math.sign(kbX), -0.4);

      if (this.mode === 'roguelike') {
        if (def.index === 0) {
          this.slowMoTimer = 0.9;
          this.timeScale = 0.28;
          this.sound.setSlowMoFilter(true);
          this.captureKoPhoto(atk.name, '力竭');
          this.finishRoguelikeRun();
        } else {
          // Check if ALL enemies in current wave are defeated!
          const anyAlive = this.enemies.some((e) => e.action !== 'ko');
          if (!anyAlive) {
            this.slowMoTimer = 0.85;
            this.timeScale = 0.3;
            this.sound.setSlowMoFilter(true);
            this.camera.punchFocus(hitPos, 1.35, 0.8);
            this.captureKoPhoto(this.p1.name, `第${this.roguelikeWave}层清场`);
            this.finishRoguelikeWave();
          }
        }
        return;
      }

      this.slowMoTimer = 0.9;
      this.timeScale = 0.28;
      this.sound.setSlowMoFilter(true);
      this.camera.punchFocus(hitPos, 1.38, 0.85);
      this.captureKoPhoto(atk.name, 'K.O.');
      this.finishRound(atk.index, 'K.O.');
      return;
    } else if (def.hp <= 0 && this.mode === 'training') {
      def.hp = def.maxHp;
    }

    if (!def.hasSuperArmor()) {
      def.action = 'hitstun';
      def.actionFrames = 0;
      def.attackKind = null;
      def.hitstunFrames = hitstun;
      def.vel.x = kbX;
      def.vel.y = kbY;
      if (kbY < -80) def.onGround = false;
    } else {
      this.fx.spawnPopText('霸体!', { x: def.pos.x, y: def.pos.y - 78 }, '#7a2520', 0.95);
    }

    this.sound.playHit(damage, isHeavy, false);
    this.fx.spawnInkBurst(hitPos, def.inkColor, isHeavy ? 18 : 9, Math.sign(kbX), -0.25, isHeavy ? 420 : 280);
    this.fx.spawnRing(hitPos, isHeavy ? 96 : 56, isHeavy ? atk.scarfColor : atk.inkColor, isHeavy ? 4.5 : 2.8);
    this.fx.spawnPopText(ono, hitPos, isHeavy ? '#c92222' : atk.inkColor, isHeavy ? 1.3 : 1.0);
    this.emitLanFx({
      kind: 'hit',
      x: Math.round(hitPos.x),
      y: Math.round(hitPos.y),
      color: isHeavy ? atk.scarfColor : def.inkColor,
      dmg: effectiveDamage,
      heavy: isHeavy,
      dirX: Math.sign(kbX),
      dirY: Math.sign(kbY) * 0.3,
    });
    this.emitLanFx({
      kind: 'pop',
      x: Math.round(hitPos.x),
      y: Math.round(hitPos.y),
      text: ono,
      color: isHeavy ? '#c92222' : atk.inkColor,
      scale: isHeavy ? 1.3 : 1.0,
    });

    if (isHeavy) {
      this.fx.triggerImpactFrame(0, hitPos, 0.2, 'normal');
      this.camera.punchFocus(hitPos, 1.2, 0.18);
    }

    this.hitstopTimer = Math.max(this.hitstopTimer, hitstop);
    this.shakeCamera(isHeavy ? 13 : 6, Math.sign(kbX), Math.sign(kbY) * 0.4);
  }

  private captureKoPhoto(winnerName: string, stamp: string): void {
    // Wait 1 tiny moment so canvas renders the dramatic non-inverted KO launch frame!
    window.setTimeout(() => {
      try {
        this.koSnapshotDataUrl = buildKoComicSnapshot(this.canvas, winnerName, stamp);
      } catch {
        // ignore canvas errors
      }
    }, 110);
  }

  private resolvePickupsAndOrbs(): void {
    for (const f of this.getAllFighters()) {
      if (f.action === 'ko') continue;

      for (let i = this.arenaObjects.pickups.length - 1; i >= 0; i--) {
        const pk = this.arenaObjects.pickups[i];
        if (pk.sketchProgress < 0.85) continue;
        if (Math.hypot(pk.pos.x - f.pos.x, pk.pos.y - (f.pos.y - 42)) < 44) {
          f.weapon = pk.weapon;
          f.addInk(12);
          this.sound.playUiSelect();
          this.fx.spawnPopText(`装备 ${WEAPONS[pk.weapon].name}!`, { x: f.pos.x, y: f.pos.y - 88 }, f.scarfColor, 1.0);
          this.fx.spawnRing(pk.pos, 64, WEAPONS[pk.weapon].accentColor, 3);
          this.arenaObjects.pickups.splice(i, 1);
        }
      }

      for (let i = this.arenaObjects.orbs.length - 1; i >= 0; i--) {
        const orb = this.arenaObjects.orbs[i];
        if (Math.hypot(orb.pos.x - f.pos.x, orb.pos.y - (f.pos.y - 42)) < 42) {
          f.addInk(orb.value);
          this.sound.playUiClick();
          this.fx.spawnPopText('+墨意', orb.pos, '#d93636', 0.85);
          this.arenaObjects.orbs.splice(i, 1);
        }
      }
    }
  }

  private checkPitfalls(): void {
    if (!this.stage.pitKillY) return;
    for (const f of this.getAllFighters()) {
      if (f.action === 'ko') continue;
      if (f.pos.y > this.stage.pitKillY) {
        if (this.mode === 'training') {
          const sp = f.index === 0 ? this.stage.spawnP1 : this.stage.spawnP2;
          f.resetForRound({ x: sp.x, y: sp.y - 180 }, f.facing);
          continue;
        }
        f.hp = 0;
        f.action = 'ko';
        this.sound.playPaperTear();
        this.fx.spawnPopText(
          this.stage.inkSeaY ? '坠入墨海!' : '坠落出局!',
          { x: f.pos.x, y: this.stage.worldHeight - 100 },
          '#d92828',
          1.45
        );

        if (this.mode === 'roguelike') {
          if (f.index === 0) {
            this.finishRoguelikeRun();
          } else if (!this.enemies.some((e) => e.action !== 'ko')) {
            this.finishRoguelikeWave();
          }
          return;
        }
        const winner: 0 | 1 = f.index === 0 ? 1 : 0;
        this.finishRound(winner, 'RING OUT');
        return;
      }
    }
  }

  private finishRoguelikeWave(): void {
    if (this.phase !== 'fighting') return;
    this.phase = 'round_over';
    this.phaseTimer = 1.85;
    this.input.clearAll();
    this.p1.action = 'victory';
    this.p1.actionFrames = 0;
    this.bannerText = `第 ${this.roguelikeWave} 层清场!`;
    this.bannerSub = '挑选一张手绘强化贴纸…';
    this.bannerStamp = true;

    window.setTimeout(() => {
      if (this.phase === 'round_over') {
        this.sound.playStamp();
        this.fx.triggerStamp('清场!', `第 ${this.roguelikeWave} 层制霸`, this.theme.stampColor);
      }
    }, 320);
  }

  private finishRoguelikeRun(): void {
    if (this.phase !== 'fighting') return;
    this.phase = 'match_over';
    this.input.clearAll();
    this.winnerIndex = 1;
    this.stats.roguelikeWave = this.roguelikeWave;
    this.stats.koSnapshotDataUrl = this.koSnapshotDataUrl;
    this.commitCareerProgress(false);

    window.setTimeout(() => {
      this.sound.playStamp();
      this.fx.triggerStamp('力竭', `止步第 ${this.roguelikeWave} 层`, this.theme.stampColor);
    }, 280);

    window.setTimeout(() => {
      this.stats.koSnapshotDataUrl = this.koSnapshotDataUrl;
      this.uiCallbacks.onMatchEnd(1, this.stats, false, false);
    }, 1500);
  }

  private finishRound(winnerIndex: 0 | 1, stampText: string): void {
    if (this.phase !== 'fighting') return;
    this.phase = 'round_over';
    this.phaseTimer = 2.3;
    this.input.clearAll();

    if (winnerIndex === 0) this.p1Wins++;
    else this.p2Wins++;

    const winner = winnerIndex === 0 ? this.p1 : this.enemies[0];
    if (winner.action !== 'ko') {
      winner.action = 'victory';
      winner.actionFrames = 0;
    }

    const stampSub = `${winner.name} 胜出!`;
    this.bannerText = stampText;
    this.bannerSub = stampSub;
    this.bannerStamp = true;

    window.setTimeout(() => {
      if (this.phase === 'round_over' || this.phase === 'match_over') {
        this.sound.playStamp();
        this.fx.triggerStamp(stampText, stampSub, this.theme.stampColor);
        this.shakeCamera(10);
      }
    }, 360);
  }

  private emitHud(): void {
    const f1 = this.p1;
    const f2 = this.getPrimaryHudEnemy();
    const aliveEnemies = this.enemies.filter((e) => e.action !== 'ko').length;

    this.uiCallbacks.onHudUpdate({
      mode: this.mode,
      round: this.round,
      maxRounds: this.lanRole !== 'none' ? this.lanBestOf : 3,
      p1Wins: this.p1Wins,
      p2Wins: this.p2Wins,
      timer: Math.ceil(this.roundTimer),
      p1: {
        name: f1.name,
        title: f1.title,
        hp: f1.hp,
        maxHp: f1.maxHp,
        delayedHp: f1.delayedHp,
        ink: f1.ink,
        maxInk: f1.maxInk,
        weapon: f1.weapon,
        weaponName: WEAPONS[f1.weapon].name,
        inkColor: f1.inkColor,
        scarfColor: f1.scarfColor,
        guardMeter: f1.guardMeter,
        isCharging: f1.action === 'charge',
        chargeRatio: f1.chargeFrames / f1.maxChargeFrames,
        superReady: f1.ink >= f1.maxInk,
      },
      p2: {
        name: f2.name,
        title: f2.title,
        hp: f2.hp,
        maxHp: f2.maxHp,
        delayedHp: f2.delayedHp,
        ink: f2.ink,
        maxInk: f2.maxInk,
        weapon: f2.weapon,
        weaponName: WEAPONS[f2.weapon].name,
        inkColor: f2.inkColor,
        scarfColor: f2.scarfColor,
        guardMeter: f2.guardMeter,
        isCharging: f2.action === 'charge',
        chargeRatio: f2.chargeFrames / f2.maxChargeFrames,
        superReady: f2.ink >= f2.maxInk,
      },
      bannerText: this.bannerText,
      bannerSub: this.bannerSub,
      bannerStamp: this.bannerStamp,
      matchOver: this.phase === 'match_over',
      winnerIndex: this.winnerIndex,
      arcadeStage: this.arcadeStageIndex + 1,
      arcadeTotal: ARCADE_MASTERS.length,
      bossName: f2.isBoss ? f2.name : undefined,
      comboP1: Math.max(...this.enemies.map((e) => e.comboReceived), 0),
      comboP2: f1.comboReceived,
      styleRank: this.styleRank,
      styleScore: this.styleScore,
      roguelikeWave: this.roguelikeWave,
      roguelikeAliveEnemies: aliveEnemies,
      roguelikeBuffs: [...this.roguelikeBuffs],
      trainingDummy: this.trainingDummy,
      trainingInfInk: this.trainingInfInk,
      showHitboxes: this.showHitboxes,
    });
  }

  private renderFrame(): void {
    const p1MouseAim = this.input.doesPlayerUseMouseAim(0);
    const p2MouseAim = this.mode === 'versus' && this.lanRole === 'none' && this.input.doesPlayerUseMouseAim(1);
    const mouseOwner: 0 | 1 = this.lanRole === 'guest' ? 1 : p1MouseAim ? 0 : 1;
    const showAimReticle =
      (p1MouseAim || p2MouseAim) &&
      this.input.mouseHasMoved &&
      this.phase === 'fighting' &&
      !this.paused;
    const mouseWorld = showAimReticle
      ? this.camera.screenToWorld(this.input.mouseCanvasPos)
      : null;

    const stickAimIndicators: Array<{ fighter: Fighter; angle: number }> = [];
    if (this.phase === 'fighting' && !this.paused) {
      const s1 = this.input.getPlayerStickAim(0);
      if (s1.aimAngle !== null) {
        const localOwner = this.lanRole === 'guest' && this.enemies[0] ? this.enemies[0] : this.p1;
        stickAimIndicators.push({ fighter: localOwner, angle: s1.aimAngle });
      }
      if (this.mode === 'versus' && this.lanRole === 'none' && this.enemies[0]) {
        const s2 = this.input.getPlayerStickAim(1);
        if (s2.aimAngle !== null) {
          stickAimIndicators.push({ fighter: this.enemies[0], angle: s2.aimAngle });
        }
      }
    }

    this.canvas.style.cursor = showAimReticle ? 'none' : 'default';

    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.renderer.render(this.ctx, {
      theme: this.theme,
      stage: this.stage,
      fighters: this.getAllFighters(),
      projectiles: this.projectiles,
      arenaObjects: this.arenaObjects,
      paper: this.paper,
      fx: this.fx,
      camera: this.camera,
      boilFrame: this.boilFrame,
      time: this.elapsedTime,
      viewW: this.viewW,
      viewH: this.viewH,
      showHitboxes: this.showHitboxes,
      aimReticleWorld: mouseWorld,
      aimReticleOwnerIndex: mouseOwner,
      stickAimIndicators,
    });
  }

  public destroy(): void {
    cancelAnimationFrame(this.rafId);
    window.removeEventListener('resize', this.boundResize);
    this.bgm.stop();
    this.input.destroy();
  }
}
