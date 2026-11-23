import { AttackKind, FighterAction, StageId, StyleRank, ThemeId, WeaponId } from '../types';
import { ProjectileKind } from '../combat/projectiles';
import { GridWarp, MathEntityKind, MathOperatorId, MathSchoolId, MathThemeId } from '../geometry/mathTypes';

export type LanGameKind = 'scratchpad' | 'geometry';
export type LanRole = 'none' | 'host' | 'guest';
export type LanBestOf = 1 | 3 | 5;

export interface LanDiscoveredRoom {
  roomId: string;
  roomName: string;
  hostName: string;
  hostIp: string;
  port: number;
  mode: LanGameKind;
  version: string;
}

export interface LanLobbyState {
  gameKind: LanGameKind;
  stageId: StageId;
  themeId: ThemeId;
  geoThemeId: MathThemeId;
  bestOf: LanBestOf;
  hostName: string;
  guestName: string;
  hostWeapon: WeaponId;
  guestWeapon: WeaponId;
  hostSchool: MathSchoolId;
  guestSchool: MathSchoolId;
  hostReady: boolean;
  guestReady: boolean;
}

export interface LanInputPacket {
  t: 'inp';
  seq: number;
  l: 0 | 1;
  r: 0 | 1;
  u: 0 | 1;
  d: 0 | 1;
  lt: 0 | 1;
  hv: 0 | 1;
  bl: 0 | 1;
  da: 0 | 1;
  su: 0 | 1;
  jSeq: number;
  ltSeq: number;
  hvSeq: number;
  hvRelSeq: number;
  blSeq: number;
  daSeq: number;
  suSeq: number;
  drSeq: number;
  ad: -1 | 0 | 1;
  aa: number | null;
}

export interface LanSpFighterState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fc: 1 | -1;
  act: FighterAction;
  af: number;
  ak: AttackKind | null;
  hp: number;
  mhp: number;
  dhp: number;
  ink: number;
  gm: number;
  ch: number;
  hf: number;
  pw: number;
  wep: WeaponId;
  cs: number;
  onG: boolean;
  cr: number;
}

export interface LanSpProjState {
  id: string;
  oi: 0 | 1;
  k: ProjectileKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ang: number;
  fc: 1 | -1;
  r: number;
  w: number;
  h: number;
  col: string;
  acc: string;
  life: number;
  ml: number;
  rot: number;
  tt?: number;
  age: number;
}

export interface LanScratchpadSnapshot {
  t: 'sp_snap';
  seq: number;
  ts: number;
  phase: 'intro' | 'fighting' | 'round_over' | 'match_over';
  round: number;
  maxRounds: number;
  p1Wins: number;
  p2Wins: number;
  timer: number;
  bannerText: string;
  bannerSub: string;
  bannerStamp: boolean;
  styleScore: number;
  styleRank: StyleRank;
  f: [LanSpFighterState, LanSpFighterState];
  pr: LanSpProjState[];
  pl: Array<{ id: string; x: number; y: number }>;
  br: string[];
  pk: Array<{ id: string; x: number; y: number; wep: WeaponId; life: number }>;
  cr: Array<{ id: string; x: number; y: number; hp: number }>;
  hz: { active: boolean; x: number; y: number; w: number; color: string; life: number; maxLife: number } | null;
}

export interface LanGeoFighterState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  fc: 1 | -1;
  act: string;
  af: number;
  ak: string | null;
  hp: number;
  mhp: number;
  dhp: number;
  en: number;
  gm: number;
  ch: number;
  hf: number;
  pw: number;
  sh: number;
  dh: number;
  pd: number;
  ops: MathOperatorId[];
  sc: MathSchoolId;
  cs: number;
  onG: boolean;
}

export interface LanGeoEntityState {
  id: string;
  oi: 0 | 1;
  k: MathEntityKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ang: number;
  fc: 1 | -1;
  r: number;
  w: number;
  h: number;
  col: string;
  scol: string;
  life: number;
  ml: number;
  age: number;
  gl?: string;
  amp?: number;
  wl?: number;
  sl?: number;
  sld?: boolean;
  sc?: number;
  neg?: boolean;
  imp?: boolean;
}

export interface LanGeometrySnapshot {
  t: 'geo_snap';
  seq: number;
  ts: number;
  phase: 'intro' | 'fighting' | 'match_over';
  timer: number;
  bannerText: string;
  bannerSub: string;
  theme: MathThemeId;
  f: [LanGeoFighterState, LanGeoFighterState];
  en: LanGeoEntityState[];
  pk: Array<{ id: string; op: MathOperatorId; x: number; y: number; baseY: number; bobPhase: number; life: number; maxLife: number }>;
  wp: GridWarp[];
  p1Wins: number;
  p2Wins: number;
  bestOf: LanBestOf;
}

export type LanFxEventPayload =
  | { kind: 'pop'; x: number; y: number; text: string; color: string; scale?: number; sub?: string }
  | { kind: 'hit'; x: number; y: number; color: string; dmg: number; heavy?: boolean; guardBreak?: boolean; dirX?: number; dirY?: number }
  | { kind: 'parry'; x: number; y: number; color: string }
  | { kind: 'clash'; x: number; y: number }
  | { kind: 'cutin'; fighterName: string; icon: string; weaponName: string; title: string; formula?: string; sub?: string; color: string; facing: 1 | -1; dimDur?: number; fxX?: number; fxY?: number }
  | { kind: 'sfx'; name: string; arg?: number }
  | { kind: 'shake'; mag: number; dx?: number; dy?: number }
  | { kind: 'burst'; x: number; y: number; color: string; count: number }
  | { kind: 'match_end'; winnerIdx: 0 | 1; p1Wins: number; p2Wins: number; bestOf: LanBestOf };

export type LanPeerMessage =
  | { t: 'hello'; name: string; version: string }
  | { t: 'lobby'; state: LanLobbyState }
  | { t: 'guest_pick'; name?: string; weapon?: WeaponId; school?: MathSchoolId; ready?: boolean }
  | { t: 'start_match'; lobby: LanLobbyState }
  | { t: 'back_lobby' }
  | { t: 'ping'; id: number; sentAt: number }
  | { t: 'pong'; id: number; sentAt: number }
  | LanInputPacket
  | LanScratchpadSnapshot
  | LanGeometrySnapshot
  | { t: 'fx'; mode: LanGameKind; ev: LanFxEventPayload };
