export interface Vec2 {
  x: number;
  y: number;
}

export type ThemeId = 'grid' | 'kraft' | 'xuan';
export type StageId =
  | 'notebook'
  | 'origami'
  | 'bridge'
  | 'bamboo'
  | 'desk_city'
  | 'double_spread'
  | 'ink_ship'
  | 'sketch_tower';

export type StageSizeTag = '标准' | '大地图' | '超大战场' | '纵深竖图';

export type BgmTrackId =
  | 'calligraphy'
  | 'bamboo_zen'
  | 'recess_rush'
  | 'storm_bridge'
  | 'ink_musou'
  | 'authors_finale';

export type BgmPlayMode = 'auto' | 'loop' | 'shuffle';

export type WeaponId =
  | 'compass'
  | 'tape'
  | 'ruler'
  | 'eraser'
  | 'cutter'
  | 'pencil'
  | 'whip'
  | 'boomerang'
  | 'scissors'
  | 'stapler'
  | 'highlighter'
  | 'fountain_pen';

export type WeaponCategory = 'all' | 'melee' | 'ranged' | 'trick';

export type GameMode = 'arcade' | 'roguelike' | 'versus' | 'training';
export type TrainingDummyMode = 'stand' | 'block' | 'attack' | 'spar';

export type InkSkinId = 'classic' | 'gold' | 'neon' | 'vermilion' | 'porcelain' | 'rainbow';
export type StyleRank = 'none' | 'D' | 'C' | 'B' | 'A' | 'S';
export type ShakeLevel = 'off' | 'soft' | 'strong';
export type FxIntensity = 'eyesafe' | 'balanced' | 'cinema';

export type RoguelikeBuffId =
  | 'echo_bomb'
  | 'triple_proj'
  | 'parry_vamp'
  | 'pin_rain'
  | 'heavy_ink'
  | 'sketch_haste'
  | 'thick_paper'
  | 'ink_fountain'
  | 'ink_lightning'
  | 'iron_nib';

export interface RoguelikeBuffDef {
  id: RoguelikeBuffId;
  name: string;
  tag: string;
  desc: string;
  accent: string;
  icon: string;
}

export interface AudioVisualSettings {
  sfxVolume: number; // 0..1
  bgmVolume: number; // 0..1
  shakeLevel: ShakeLevel;
  fxIntensity: FxIntensity;
  skinId: InkSkinId;
}

export interface CareerStats {
  totalKOs: number;
  totalParries: number;
  maxCombo: number;
  highestWave: number;
  arcadeClears: number;
  totalClashes: number;
}

export type FighterAction =
  | 'idle'
  | 'run'
  | 'jump'
  | 'fall'
  | 'wallslide'
  | 'crouch'
  | 'dash'
  | 'attack'
  | 'charge'
  | 'block'
  | 'parry_success'
  | 'hitstun'
  | 'guard_break'
  | 'knockdown'
  | 'super_startup'
  | 'super_active'
  | 'ko'
  | 'victory';

export type AttackKind =
  | 'light1'
  | 'light2'
  | 'light3'
  | 'up_light'
  | 'air_light'
  | 'heavy'
  | 'super';

export type MoveProjectileSpawn =
  | 'wave'
  | 'shuriken'
  | 'shockwave'
  | 'boomerang'
  | 'compass_arc'
  | 'whiteout_beam'
  | 'staple_bolt'
  | 'ink_bomb'
  | 'paint_zone';

export interface MoveDef {
  id: AttackKind;
  name: string;
  startup: number;
  active: number;
  recovery: number;
  damage: number;
  chipDamage: number;
  knockbackX: number;
  knockbackY: number;
  hitstop: number;
  hitstun: number;
  reach: number;
  height: number;
  offsetY: number;
  lungeX: number;
  lungeY?: number;
  guardBreak?: boolean;
  launcher?: boolean;
  spike?: boolean;
  superArmor?: boolean;
  pullEnemy?: boolean;
  multiHit?: number;
  spawnsProjectile?: MoveProjectileSpawn;
  smearStyle: 'slash_down' | 'slash_up' | 'thrust' | 'spin' | 'overhead' | 'flurry' | 'whip' | 'snip' | 'hammer';
  smearColor?: string;
  onomatopoeia: string;
  whooshWeight: number;
}

export interface WeaponDef {
  id: WeaponId;
  name: string;
  enName: string;
  icon: string;
  category: Exclude<WeaponCategory, 'all'>;
  tag: string;
  desc: string;
  length: number;
  weight: number;
  speedMult: number;
  accentColor: string;
  moves: Record<AttackKind, MoveDef>;
}

export interface PaperTheme {
  id: ThemeId;
  name: string;
  subtitle: string;
  paperBg: string;
  paperTint: string;
  grainAlpha: number;
  gridColor: string;
  gridSecondary: string;
  marginColor: string;
  inkPrimary: string;
  inkSecondary: string;
  platformFill: string;
  platformStroke: string;
  hazardColor: string;
  stampColor: string;
  p1Ink: string;
  p1Scarf: string;
  p2Ink: string;
  p2Scarf: string;
  hasHoles: boolean;
  hasGrid: boolean;
  hasRuledLines: boolean;
  hasBambooWash: boolean;
}

export interface PlatformDef {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  oneWay?: boolean;
  breakable?: boolean;
  pillar?: boolean;
  bouncePad?: boolean;
  bookDecor?: {
    title: string;
    spineColor: string;
  };
  origami?: {
    baseX: number;
    baseY: number;
    rangeX: number;
    rangeY: number;
    speed: number;
    phase: number;
  };
  elevator?: {
    baseY: number;
    rangeY: number;
    speed: number;
    phase: number;
  };
}

export interface UpdraftZone {
  x: number;
  y: number;
  w: number;
  h: number;
  force: number;
}

export interface StageDef {
  id: StageId;
  name: string;
  subtitle: string;
  sizeTag: StageSizeTag;
  category: string;
  desc: string;
  recommendedTheme: ThemeId;
  defaultTrack: BgmTrackId;
  visualKind?: 'standard' | 'spread' | 'sea' | 'tower' | 'desk';
  worldWidth: number;
  worldHeight: number;
  floorY: number;
  spawnP1: Vec2;
  spawnP2: Vec2;
  pitKillY?: number;
  inkSeaY?: number;
  updraftZones?: UpdraftZone[];
  platforms: PlatformDef[];
  crateSpawns: Vec2[];
  weaponDropXs: number[];
  hasBambooLeaves?: boolean;
  hasStationeryEvents?: boolean;
}

export interface ArcadeMaster {
  id: string;
  stageIndex: number;
  name: string;
  title: string;
  quote: string;
  weapon: WeaponId;
  stage: StageId;
  theme: ThemeId;
  inkColor: string;
  scarfColor: string;
  maxHp: number;
  difficulty: number;
  aggression: number;
  parrySkill: number;
  dodgeSkill: number;
  isBoss?: boolean;
}

export interface InputState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  light: boolean;
  heavy: boolean;
  block: boolean;
  dash: boolean;
  superBtn: boolean;
  aimDir?: -1 | 0 | 1;
  aimAngle?: number | null;
  jumpPressed: number;
  lightPressed: number;
  heavyPressed: number;
  heavyReleased: number;
  blockPressed: number;
  dashPressed: number;
  superPressed: number;
}

export interface HudSnapshot {
  mode: GameMode;
  round: number;
  maxRounds: number;
  p1Wins: number;
  p2Wins: number;
  timer: number;
  p1: FighterHudState;
  p2: FighterHudState;
  bannerText: string;
  bannerSub: string;
  bannerStamp: boolean;
  matchOver: boolean;
  winnerIndex: 0 | 1 | -1;
  arcadeStage: number;
  arcadeTotal: number;
  bossName?: string;
  comboP1: number;
  comboP2: number;
  styleRank: StyleRank;
  styleScore: number;
  roguelikeWave: number;
  roguelikeAliveEnemies: number;
  roguelikeBuffs: RoguelikeBuffId[];
  trainingDummy: TrainingDummyMode;
  trainingInfInk: boolean;
  showHitboxes: boolean;
}

export interface FighterHudState {
  name: string;
  title: string;
  hp: number;
  maxHp: number;
  delayedHp: number;
  ink: number;
  maxInk: number;
  weapon: WeaponId;
  weaponName: string;
  inkColor: string;
  scarfColor: string;
  guardMeter: number;
  isCharging: boolean;
  chargeRatio: number;
  superReady: boolean;
}

export interface MatchStats {
  p1DamageDealt: number;
  p2DamageDealt: number;
  p1Parries: number;
  p2Parries: number;
  p1MaxCombo: number;
  p2MaxCombo: number;
  clashes: number;
  durationSec: number;
  highestStyleRank: StyleRank;
  roguelikeWave?: number;
  koSnapshotDataUrl?: string | null;
}
