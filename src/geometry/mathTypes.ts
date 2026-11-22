import { Vec2 } from '../types';

export type MathSchoolId = 'euler' | 'golden' | 'trig' | 'calculus' | 'algebra' | 'euclid';

export type MathOperatorId =
  | 'mul2'
  | 'pow2'
  | 'neg'
  | 'deriv'
  | 'integ'
  | 'pi'
  | 'imag'
  | 'div0';

export type IdentityComboId =
  | 'euler_zero'
  | 'pythagorean_one'
  | 'ftc_cycle'
  | 'div_zero';

export type MathThemeId = 'chalkboard' | 'blueprint';

export type GeoMode = 'trial' | 'sandbox' | 'versus';

export type GeoDummyMode = 'stand' | 'spar';

export interface MathSchoolDef {
  id: MathSchoolId;
  name: string;
  formula: string;
  symbol: string;
  badge: string;
  color: string;
  secondaryColor: string;
  desc: string;
  heavyName: string;
  superName: string;
  superFormula: string;
  speedMult: number;
  damageMult: number;
}

export interface MathOperatorDef {
  id: MathOperatorId;
  glyph: string;
  name: string;
  color: string;
  desc: string;
}

export interface IdentityComboDef {
  id: IdentityComboId;
  formula: string;
  title: string;
  desc: string;
  color: string;
}

export interface MathTrialMaster {
  stageIndex: number;
  name: string;
  title: string;
  quote: string;
  school: MathSchoolId;
  color: string;
  secondaryColor: string;
  maxHp: number;
  isBoss?: boolean;
  difficulty: number;
}

export type MathEntityKind =
  | 'euler_disc'
  | 'euler_echo'
  | 'euler_plane'
  | 'golden_spiral'
  | 'golden_grid'
  | 'sine_wave'
  | 'trig_circle'
  | 'tan_slash'
  | 'riemann_field'
  | 'taylor_lock'
  | 'exp_orb'
  | 'arith_glyph'
  | 'singularity'
  | 'fractal_tri'
  | 'tesseract';

export interface MathEntity {
  id: string;
  ownerIndex: 0 | 1;
  kind: MathEntityKind;
  pos: Vec2;
  vel: Vec2;
  angle: number;
  facing: 1 | -1;
  radius: number;
  width: number;
  height: number;
  damage: number;
  knockbackX: number;
  knockbackY: number;
  color: string;
  secondaryColor: string;
  life: number;
  maxLife: number;
  age: number;
  hitIds: Set<string>;
  // Special math parameters
  glyph?: string;
  amplitude?: number;
  wavelength?: number;
  phase?: number;
  splitDepth?: number;
  splitTimer?: number;
  sliceCount?: number;
  chargeRatio?: number;
  pullForce?: number;
  tickTimer?: number;
  scale?: number;
  negated?: boolean;
  piOrbit?: boolean;
  imagPhase?: boolean;
  guardBreak?: boolean;
  slammed?: boolean;
  stageStep?: number;
  castId?: string;
  castCap?: number;
}

export interface FloatingOperatorPickup {
  id: string;
  op: MathOperatorId;
  pos: Vec2;
  baseY: number;
  bobPhase: number;
  life: number;
  maxLife: number;
}

export interface GridWarp {
  x: number;
  y: number;
  strength: number; // positive = attract/pinch inward, negative = repel outward
  radius: number;
  life: number;
  maxLife: number;
  color: string;
}

export interface MathParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  life: number;
  maxLife: number;
  glyph?: string;
  rot: number;
  vrot: number;
  gravity: number;
}

export interface MathPopText {
  text: string;
  sub?: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  scale: number;
  life: number;
  maxLife: number;
}

export interface MathCutInBanner {
  active: boolean;
  age: number;
  duration: number;
  title: string;
  formula: string;
  sub: string;
  color: string;
  facing: 1 | -1;
}

export interface MathThemePalette {
  id: MathThemeId;
  name: string;
  bgTop: string;
  bgBottom: string;
  gridMinor: string;
  gridMajor: string;
  axisColor: string;
  axisLabel: string;
  platformFill: string;
  platformStroke: string;
  platformGlow: string;
  chalkCore: string;
  dimOverlay: string;
  isLight: boolean;
}

export interface GeoFighterHud {
  name: string;
  school: MathSchoolId;
  schoolName: string;
  schoolFormula: string;
  color: string;
  hp: number;
  maxHp: number;
  delayedHp: number;
  energy: number;
  maxEnergy: number;
  guardMeter: number;
  superReady: boolean;
  operators: MathOperatorId[];
  polyDegree: number; // Calculus derivative countdown (3 -> 2 -> 1 -> 0!)
  derivHasteTimer: number;
  shieldTimer: number;
}

export interface GeoHudSnapshot {
  mode: GeoMode;
  stageIndex: number;
  stageTotal: number;
  timer: number;
  p1: GeoFighterHud;
  p2: GeoFighterHud;
  comboP1: number;
  comboP2: number;
  bannerText: string;
  bannerSub: string;
  activeFormulaPreview: string;
  comboHint: string;
  theme: MathThemeId;
  sandboxInfEnergy: boolean;
  sandboxDummy: GeoDummyMode;
}
