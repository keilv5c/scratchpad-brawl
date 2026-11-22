import { Vec2 } from '../types';
import { Rect } from '../engine/math';

export type ProjectileKind =
  | 'wave'
  | 'shuriken'
  | 'shockwave'
  | 'boomerang'
  | 'compass_arc'
  | 'whiteout_beam'
  | 'staple_bolt'
  | 'ink_bomb'
  | 'echo_bomb'
  | 'falling_pin'
  | 'ink_lightning'
  | 'ink_pillar'
  | 'stapler_hazard'
  | 'boss_spike'
  | 'boss_eraser';

export interface Projectile {
  id: string;
  ownerIndex: 0 | 1;
  kind: ProjectileKind;
  pos: Vec2;
  vel: Vec2;
  facing: 1 | -1;
  angle: number;
  radius: number;
  width: number;
  height: number;
  damage: number;
  knockbackX: number;
  knockbackY: number;
  color: string;
  accent: string;
  life: number;
  maxLife: number;
  rotation: number;
  hitIds: Set<string>;
  telegraphTime?: number;
  erupted?: boolean;
  returning?: boolean;
  gravity?: number;
  age: number;
  castId?: string;
  castCap?: number;
}

let projCounter = 1;

export function createProjectile(
  ownerIndex: 0 | 1,
  kind: ProjectileKind,
  pos: Vec2,
  facing: 1 | -1,
  color: string,
  accent: string,
  chargeRatio = 0.5,
  aimAngle?: number | null
): Projectile {
  const id = `proj_${projCounter++}`;
  // Balanced charge scaling: full charge grants +25% damage & +20% speed/kb (rewarding, never overtuned)
  const dmgBoost = 1 + chargeRatio * 0.25;
  const spdBoost = 1 + chargeRatio * 0.2;
  const dirAngle = aimAngle !== undefined && aimAngle !== null ? aimAngle : facing > 0 ? 0 : Math.PI;
  const vxDir = Math.cos(dirAngle);
  const vyDir = Math.sin(dirAngle);

  switch (kind) {
    case 'wave':
      return {
        id, ownerIndex, kind, pos: { ...pos },
        vel: { x: vxDir * (650 * spdBoost), y: vyDir * (650 * spdBoost) },
        facing, angle: dirAngle, radius: 36, width: 48, height: 80,
        damage: Math.round(13 * dmgBoost), knockbackX: 430 * spdBoost, knockbackY: -180,
        color, accent, life: 0.72, maxLife: 0.72, rotation: dirAngle, hitIds: new Set(), age: 0,
      };
    case 'compass_arc':
      return {
        id, ownerIndex, kind, pos: { ...pos },
        vel: { x: vxDir * (620 * spdBoost), y: vyDir * (620 * spdBoost) },
        facing, angle: dirAngle, radius: 42, width: 64, height: 92,
        damage: Math.round(14 * dmgBoost), knockbackX: 450 * spdBoost, knockbackY: -200,
        color, accent, life: 0.78, maxLife: 0.78, rotation: dirAngle, hitIds: new Set(), age: 0,
      };
    case 'whiteout_beam':
      return {
        id, ownerIndex, kind, pos: { ...pos },
        vel: { x: vxDir * (700 * spdBoost), y: vyDir * (700 * spdBoost) },
        facing, angle: dirAngle, radius: 34, width: 92, height: 34,
        damage: Math.round(12 * dmgBoost), knockbackX: 460 * spdBoost, knockbackY: -160,
        color: '#ffffff', accent: '#2685d9', life: 0.75, maxLife: 0.75, rotation: dirAngle, hitIds: new Set(), age: 0,
      };
    case 'staple_bolt':
      return {
        id, ownerIndex, kind, pos: { ...pos },
        vel: { x: vxDir * 880, y: vyDir * 880 },
        facing, angle: dirAngle, radius: 14, width: 28, height: 18,
        damage: Math.round(7 * dmgBoost), knockbackX: 220, knockbackY: -90,
        color: '#3f506e', accent: '#1e2430', life: 0.72, maxLife: 0.72, rotation: dirAngle, hitIds: new Set(), age: 0,
      };
    case 'ink_bomb':
      return {
        id, ownerIndex, kind, pos: { ...pos },
        vel: { x: vxDir * (540 * spdBoost), y: vyDir * (540 * spdBoost) - 240 },
        facing, angle: dirAngle, radius: 26, width: 48, height: 48,
        damage: Math.round(16 * dmgBoost), knockbackX: 480, knockbackY: -340,
        color, accent, life: 1.25, maxLife: 1.25, rotation: 0, hitIds: new Set(), gravity: 980, age: 0,
      };
    case 'shuriken':
      return {
        id, ownerIndex, kind, pos: { ...pos },
        vel: { x: vxDir * 840, y: vyDir * 840 - (aimAngle == null ? 20 : 0) },
        facing, angle: dirAngle, radius: 16, width: 30, height: 30,
        damage: Math.round(9 * dmgBoost), knockbackX: 280, knockbackY: -140,
        color, accent, life: 0.85, maxLife: 0.85, rotation: 0, hitIds: new Set(), age: 0,
      };
    case 'boomerang':
      return {
        id, ownerIndex, kind, pos: { ...pos },
        vel: { x: vxDir * 720, y: vyDir * 720 },
        facing, angle: dirAngle, radius: 26, width: 52, height: 52,
        damage: Math.round(11 * dmgBoost), knockbackX: 300, knockbackY: -170,
        color, accent, life: 1.55, maxLife: 1.55, rotation: 0, hitIds: new Set(), returning: false, age: 0,
      };
    case 'shockwave':
      return {
        id, ownerIndex, kind, pos: { x: pos.x, y: pos.y + 32 },
        vel: { x: facing * 520, y: 0 },
        facing, angle: facing > 0 ? 0 : Math.PI, radius: 32, width: 68, height: 48,
        damage: Math.round(14 * dmgBoost), knockbackX: 460, knockbackY: -440,
        color, accent, life: 0.65, maxLife: 0.65, rotation: 0, hitIds: new Set(), age: 0,
      };
    case 'echo_bomb':
      return {
        id, ownerIndex, kind, pos: { ...pos }, vel: { x: 0, y: 0 },
        facing, angle: 0, radius: 68, width: 136, height: 136,
        damage: 14, knockbackX: 360, knockbackY: -320,
        color, accent, life: 0.72, maxLife: 0.72, rotation: 0, hitIds: new Set(), telegraphTime: 0.52, erupted: false, age: 0,
      };
    case 'falling_pin':
      return {
        id, ownerIndex, kind, pos: { ...pos }, vel: { x: 0, y: 920 },
        facing: 1, angle: Math.PI / 2, radius: 18, width: 28, height: 46,
        damage: 10, knockbackX: 160, knockbackY: -220,
        color, accent, life: 1.0, maxLife: 1.0, rotation: 0, hitIds: new Set(), age: 0,
      };
    case 'ink_lightning':
      return {
        id, ownerIndex, kind, pos: { ...pos }, vel: { x: 0, y: 0 },
        facing: 1, angle: 0, radius: 34, width: 64, height: 620,
        damage: 14, knockbackX: 200, knockbackY: -340,
        color, accent, life: 0.36, maxLife: 0.36, rotation: 0, hitIds: new Set(), telegraphTime: 0.08, erupted: false, age: 0,
      };
    case 'ink_pillar':
      return {
        id, ownerIndex, kind, pos: { ...pos }, vel: { x: 0, y: 0 },
        facing: 1, angle: 0, radius: 32, width: 62, height: 280,
        damage: 18, knockbackX: 260, knockbackY: -560,
        color, accent, life: 0.62, maxLife: 0.62, rotation: 0, hitIds: new Set(), telegraphTime: 0.14, erupted: false, age: 0,
      };
    case 'stapler_hazard':
      return {
        id, ownerIndex, kind, pos: { ...pos }, vel: { x: 0, y: 0 },
        facing: 1, angle: 0, radius: 44, width: 96, height: 76,
        damage: 15, knockbackX: 380, knockbackY: -360,
        color: '#2b3242', accent: '#d93636', life: 1.4, maxLife: 1.4, rotation: 0, hitIds: new Set(), telegraphTime: 0.85, erupted: false, age: 0,
      };
    case 'boss_spike':
      return {
        id, ownerIndex, kind, pos: { ...pos }, vel: { x: 0, y: 0 },
        facing, angle: 0, radius: 26, width: 48, height: 118,
        damage: 16, knockbackX: 220, knockbackY: -520,
        color, accent, life: 1.45, maxLife: 1.45, rotation: 0, hitIds: new Set(), telegraphTime: 0.62, erupted: false, age: 0,
      };
    case 'boss_eraser':
      return {
        id, ownerIndex, kind, pos: { ...pos }, vel: { x: facing * 420, y: 0 },
        facing, angle: facing > 0 ? 0 : Math.PI, radius: 42, width: 90, height: 64,
        damage: 14, knockbackX: 620, knockbackY: -260,
        color: '#e87fa0', accent: '#3e78c8', life: 1.65, maxLife: 1.65, rotation: 0, hitIds: new Set(), age: 0,
      };
  }
}

export function getProjectileHitbox(p: Projectile): Rect | null {
  if ((p.telegraphTime ?? 0) > 0) return null;
  if (p.kind === 'boss_spike' || p.kind === 'ink_pillar' || p.kind === 'stapler_hazard' || p.kind === 'ink_lightning') {
    return {
      x: p.pos.x - p.width * 0.5,
      y: p.pos.y - p.height,
      w: p.width,
      h: p.height,
    };
  }
  return {
    x: p.pos.x - p.width * 0.5,
    y: p.pos.y - p.height * 0.5,
    w: p.width,
    h: p.height,
  };
}
