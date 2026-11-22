import { AttackKind, FighterAction, Vec2, WeaponId } from '../types';
import { clamp, lerp, lerpVec, solveTwoBoneIK } from '../engine/math';
import { WEAPONS } from '../config/weapons';

export interface StickmanPose {
  head: Vec2;
  neck: Vec2;
  chest: Vec2;
  hip: Vec2;
  lShoulder: Vec2;
  lElbow: Vec2;
  lHand: Vec2;
  rShoulder: Vec2;
  rElbow: Vec2;
  rHand: Vec2;
  lKnee: Vec2;
  lFoot: Vec2;
  rKnee: Vec2;
  rFoot: Vec2;
  weaponBase: Vec2;
  weaponTip: Vec2;
  offhandWeaponTip: Vec2 | null;
  headTilt: number;
}

interface LocalPoseSpec {
  hipOffset: Vec2;
  torsoAngle: number; // radians from vertical (0 = upright, positive = lean forward)
  lFoot: Vec2;
  rFoot: Vec2;
  lHand: Vec2;
  rHand: Vec2;
  weaponAngle: number; // relative to facing horizontal (0 = pointing forward, -PI/2 = up)
  offhandAngle?: number;
}

const UPPER_LEG = 21;
const LOWER_LEG = 21;
const UPPER_ARM = 17;
const LOWER_ARM = 17;
const TORSO_LEN = 30;
const HEAD_DIST = 13;

export interface PoseBuildInput {
  pos: Vec2;
  vx: number;
  vy: number;
  facing: number;
  action: FighterAction;
  actionTime: number;
  animPhase: number;
  weapon: WeaponId;
  attackKind: AttackKind | null;
  attackProgress: number; // 0..1 across entire move
  attackPhase: 'startup' | 'active' | 'recovery';
  chargeRatio: number;
  onGround: boolean;
}

/**
 * Procedural 2-Bone IK Stickman Animator.
 * Generates expressive martial-arts stances, crisp weapon swings with anticipation & follow-through,
 * and smooth interpolation between states.
 */
export class ProceduralSkeleton {
  private current: LocalPoseSpec = {
    hipOffset: { x: 0, y: -42 },
    torsoAngle: 0.08,
    lFoot: { x: -13, y: 0 },
    rFoot: { x: 14, y: 0 },
    lHand: { x: -8, y: -56 },
    rHand: { x: 16, y: -58 },
    weaponAngle: -0.65,
  };

  public pose: StickmanPose;

  constructor(startPos: Vec2) {
    this.pose = this.buildWorldPose(startPos, 1, 'ruler', this.current);
  }

  public update(input: PoseBuildInput, dt: number): StickmanPose {
    const target = this.computeTargetLocalPose(input);
    // Snappier blend during attacks/parries, smoother during movement
    const snapRate =
      input.action === 'attack' || input.action === 'parry_success' || input.action === 'super_active'
        ? 34
        : input.action === 'dash' || input.action === 'hitstun'
          ? 28
          : 18;
    const t = 1 - Math.exp(-snapRate * dt);

    this.current.hipOffset = lerpVec(this.current.hipOffset, target.hipOffset, t);
    this.current.torsoAngle = lerp(this.current.torsoAngle, target.torsoAngle, t);
    this.current.lFoot = lerpVec(this.current.lFoot, target.lFoot, t);
    this.current.rFoot = lerpVec(this.current.rFoot, target.rFoot, t);
    this.current.lHand = lerpVec(this.current.lHand, target.lHand, t);
    this.current.rHand = lerpVec(this.current.rHand, target.rHand, t);
    this.current.weaponAngle = lerp(this.current.weaponAngle, target.weaponAngle, t);
    this.current.offhandAngle = target.offhandAngle;

    this.pose = this.buildWorldPose(input.pos, input.facing, input.weapon, this.current);
    return this.pose;
  }

  private computeTargetLocalPose(inp: PoseBuildInput): LocalPoseSpec {
    const t = inp.animPhase;
    const w = inp.weapon;

    switch (inp.action) {
      case 'idle': {
        const breathe = Math.sin(t * 3.6) * 2.2;
        if (w === 'eraser') {
          return {
            hipOffset: { x: -2, y: -39 + breathe * 0.6 },
            torsoAngle: 0.14,
            lFoot: { x: -16, y: 0 },
            rFoot: { x: 17, y: 0 },
            lHand: { x: 6, y: -68 + breathe },
            rHand: { x: -4, y: -74 + breathe },
            weaponAngle: -2.45 + Math.sin(t * 3.6) * 0.04, // giant eraser hammer resting on shoulder!
          };
        }
        if (w === 'pencil') {
          return {
            hipOffset: { x: 0, y: -40 + breathe * 0.5 },
            torsoAngle: 0.12,
            lFoot: { x: -17, y: 0 },
            rFoot: { x: 16, y: 0 },
            lHand: { x: -12, y: -58 + breathe },
            rHand: { x: 17, y: -52 + breathe },
            weaponAngle: -0.35 + Math.sin(t * 3.6) * 0.04,
          };
        }
        if (w === 'cutter' || w === 'highlighter') {
          return {
            hipOffset: { x: 2, y: -36 + breathe * 0.5 },
            torsoAngle: 0.34,
            lFoot: { x: -17, y: 0 },
            rFoot: { x: 18, y: 0 },
            lHand: { x: -16, y: -48 + breathe },
            rHand: { x: 20, y: -48 + breathe },
            weaponAngle: 0.25,
            offhandAngle: 2.75,
          };
        }
        if (w === 'stapler' || w === 'tape') {
          return {
            hipOffset: { x: 0, y: -39 + breathe * 0.6 },
            torsoAngle: 0.18,
            lFoot: { x: -15, y: 0 },
            rFoot: { x: 16, y: 0 },
            lHand: { x: 6, y: -56 + breathe },
            rHand: { x: 22, y: -54 - breathe * 0.4 },
            weaponAngle: -0.08,
          };
        }
        if (w === 'whip') {
          return {
            hipOffset: { x: -2, y: -40 + breathe * 0.5 },
            torsoAngle: 0.1,
            lFoot: { x: -16, y: 0 },
            rFoot: { x: 16, y: 0 },
            lHand: { x: -12, y: -56 + breathe },
            rHand: { x: 18, y: -54 + breathe },
            weaponAngle: 0.45 + Math.sin(t * 4.5) * 0.08,
          };
        }
        if (w === 'boomerang' || w === 'scissors' || w === 'compass') {
          return {
            hipOffset: { x: 1, y: -38 + breathe * 0.5 },
            torsoAngle: 0.22,
            lFoot: { x: -16, y: 0 },
            rFoot: { x: 17, y: 0 },
            lHand: { x: -10, y: -58 + breathe },
            rHand: { x: 20, y: -60 + breathe },
            weaponAngle: -0.65 + Math.sin(t * 4.0) * 0.06,
          };
        }
        // Steel Ruler / Fountain Pen classic poised stance
        return {
          hipOffset: { x: -1, y: -40 + breathe * 0.55 },
          torsoAngle: 0.16,
          lFoot: { x: -16, y: 0 },
          rFoot: { x: 16, y: 0 },
          lHand: { x: 8, y: -55 + breathe },
          rHand: { x: 17, y: -56 + breathe },
          weaponAngle: -0.68 + Math.sin(t * 3.6) * 0.04,
        };
      }

      case 'run': {
        const cycle = t * 13.5;
        const s1 = Math.sin(cycle);
        const c1 = Math.cos(cycle);
        const s2 = Math.sin(cycle + Math.PI);
        const c2 = Math.cos(cycle + Math.PI);
        const bounce = Math.abs(Math.sin(cycle)) * 5.5;
        return {
          hipOffset: { x: 4, y: -38 - bounce },
          torsoAngle: 0.44,
          lFoot: { x: s1 * 24, y: Math.min(0, -c1 * 14) },
          rFoot: { x: s2 * 24, y: Math.min(0, -c2 * 14) },
          lHand: { x: -14 + s2 * 16, y: -54 + Math.abs(c2) * 6 },
          rHand:
            w === 'ruler' || w === 'eraser' || w === 'fountain_pen'
              ? { x: -18, y: -50 - bounce * 0.5 }
              : { x: 12 + s1 * 16, y: -54 + Math.abs(c1) * 6 },
          weaponAngle:
            w === 'ruler' || w === 'fountain_pen'
              ? 2.65
              : w === 'eraser'
                ? 2.85
                : w === 'cutter' || w === 'highlighter'
                  ? 2.7
                  : -0.3 + s1 * 0.3,
          offhandAngle: 2.5,
        };
      }

      case 'jump': {
        return {
          hipOffset: { x: 2, y: -44 },
          torsoAngle: 0.2,
          lFoot: { x: -12, y: -14 },
          rFoot: { x: 15, y: -22 },
          lHand: { x: -16, y: -66 },
          rHand: { x: 18, y: -70 },
          weaponAngle: -0.9,
          offhandAngle: 2.4,
        };
      }

      case 'fall': {
        const fallStretch = clamp(inp.vy / 700, 0, 1);
        return {
          hipOffset: { x: 0, y: -42 },
          torsoAngle: 0.12 - fallStretch * 0.15,
          lFoot: { x: -14, y: -6 - fallStretch * 8 },
          rFoot: { x: 12, y: -16 },
          lHand: { x: -20, y: -74 - fallStretch * 6 },
          rHand: { x: 20, y: -72 - fallStretch * 6 },
          weaponAngle: -1.15,
          offhandAngle: -2.1,
        };
      }

      case 'wallslide': {
        return {
          hipOffset: { x: -4, y: -40 },
          torsoAngle: -0.15,
          lFoot: { x: 14, y: -6 },
          rFoot: { x: 12, y: -22 },
          lHand: { x: 16, y: -68 },
          rHand: { x: -14, y: -56 },
          weaponAngle: -2.2,
        };
      }

      case 'crouch': {
        return {
          hipOffset: { x: 2, y: -24 },
          torsoAngle: 0.45,
          lFoot: { x: -16, y: 0 },
          rFoot: { x: 16, y: 0 },
          lHand: { x: -6, y: -38 },
          rHand: { x: 18, y: -36 },
          weaponAngle: 0.05,
        };
      }

      case 'dash': {
        return {
          hipOffset: { x: 10, y: -34 },
          torsoAngle: 0.72,
          lFoot: { x: -28, y: -10 },
          rFoot: { x: 10, y: -8 },
          lHand: { x: -20, y: -52 },
          rHand: { x: 26, y: -48 },
          weaponAngle: 2.95,
          offhandAngle: 2.95,
        };
      }

      case 'block': {
        return {
          hipOffset: { x: -6, y: -36 },
          torsoAngle: -0.12,
          lFoot: { x: -18, y: 0 },
          rFoot: { x: 15, y: 0 },
          lHand: { x: 14, y: -62 },
          rHand: { x: 20, y: -56 },
          weaponAngle: -1.42, // vertical guard blade!
          offhandAngle: -1.65,
        };
      }

      case 'parry_success': {
        return {
          hipOffset: { x: 4, y: -39 },
          torsoAngle: 0.22,
          lFoot: { x: -20, y: 0 },
          rFoot: { x: 20, y: 0 },
          lHand: { x: -18, y: -66 },
          rHand: { x: 28, y: -74 },
          weaponAngle: -0.42,
        };
      }

      case 'charge': {
        const shake = Math.sin(t * 48) * (1.2 + inp.chargeRatio * 2.8);
        return {
          hipOffset: { x: -10 + shake * 0.4, y: -33 + inp.chargeRatio * 3 },
          torsoAngle: -0.22 - inp.chargeRatio * 0.2,
          lFoot: { x: -21, y: 0 },
          rFoot: { x: 18, y: 0 },
          lHand: { x: -14 + shake, y: -54 },
          rHand: { x: -22 + shake, y: -66 - inp.chargeRatio * 10 },
          weaponAngle: -2.4 - inp.chargeRatio * 0.45,
          offhandAngle: 2.6,
        };
      }

      case 'hitstun': {
        return {
          hipOffset: { x: -8, y: -39 },
          torsoAngle: -0.52,
          lFoot: { x: -10, y: -4 },
          rFoot: { x: 14, y: -12 },
          lHand: { x: -22, y: -64 },
          rHand: { x: 6, y: -74 },
          weaponAngle: -2.3,
        };
      }

      case 'guard_break': {
        return {
          hipOffset: { x: -10, y: -35 },
          torsoAngle: -0.62,
          lFoot: { x: -18, y: 0 },
          rFoot: { x: 14, y: 0 },
          lHand: { x: -24, y: -52 },
          rHand: { x: 24, y: -76 },
          weaponAngle: -1.9,
        };
      }

      case 'knockdown': {
        return {
          hipOffset: { x: 0, y: -14 },
          torsoAngle: -1.25,
          lFoot: { x: 22, y: -2 },
          rFoot: { x: 14, y: -8 },
          lHand: { x: -24, y: -18 },
          rHand: { x: -10, y: -24 },
          weaponAngle: -2.8,
        };
      }

      case 'super_startup': {
        // Classic anime Iai crouch coil!
        return {
          hipOffset: { x: -8, y: -27 },
          torsoAngle: 0.56,
          lFoot: { x: -22, y: 0 },
          rFoot: { x: 22, y: 0 },
          lHand: { x: 2, y: -38 },
          rHand: { x: -14, y: -42 },
          weaponAngle: 2.85,
        };
      }

      case 'super_active': {
        const spin = inp.animPhase * 28;
        return {
          hipOffset: { x: 12, y: -36 },
          torsoAngle: 0.65,
          lFoot: { x: -24, y: -8 },
          rFoot: { x: 22, y: 0 },
          lHand: { x: -16, y: -56 },
          rHand: { x: 30, y: -54 },
          weaponAngle: Math.sin(spin) * 1.6,
          offhandAngle: -Math.sin(spin) * 1.6,
        };
      }

      case 'victory': {
        const wave = Math.sin(t * 4) * 2;
        return {
          hipOffset: { x: 0, y: -42 },
          torsoAngle: -0.05,
          lFoot: { x: -14, y: 0 },
          rFoot: { x: 14, y: 0 },
          lHand: { x: -15, y: -46 },
          rHand: { x: 16, y: -82 + wave },
          weaponAngle: -1.52,
        };
      }

      case 'attack': {
        return this.computeAttackPose(inp);
      }

      default:
        return this.current;
    }
  }

  private computeAttackPose(inp: PoseBuildInput): LocalPoseSpec {
    const move = inp.attackKind ? WEAPONS[inp.weapon].moves[inp.attackKind] : null;
    const style = move ? move.smearStyle : 'slash_down';
    const p = inp.attackProgress;

    if (style === 'whip') {
      if (inp.attackPhase === 'startup') {
        return {
          hipOffset: { x: -10, y: -39 },
          torsoAngle: -0.26,
          lFoot: { x: -18, y: 0 },
          rFoot: { x: 14, y: 0 },
          lHand: { x: 12, y: -56 },
          rHand: { x: -24, y: -74 },
          weaponAngle: -2.6,
        };
      }
      return {
        hipOffset: { x: 10, y: -36 },
        torsoAngle: 0.42,
        lFoot: { x: -22, y: 0 },
        rFoot: { x: 24, y: 0 },
        lHand: { x: -18, y: -56 },
        rHand: { x: 34, y: -58 },
        weaponAngle: 0.04 + Math.sin(p * Math.PI * 4) * 0.16,
      };
    }

    if (style === 'snip') {
      if (inp.attackPhase === 'startup') {
        return {
          hipOffset: { x: -8, y: -38 },
          torsoAngle: -0.18,
          lFoot: { x: -18, y: 0 },
          rFoot: { x: 16, y: 0 },
          lHand: { x: 8, y: -62 },
          rHand: { x: -6, y: -64 },
          weaponAngle: -0.9,
        };
      }
      return {
        hipOffset: { x: 12, y: -35 },
        torsoAngle: 0.46,
        lFoot: { x: -22, y: 0 },
        rFoot: { x: 24, y: 0 },
        lHand: { x: 16, y: -52 },
        rHand: { x: 34, y: -50 },
        weaponAngle: 0.08,
      };
    }

    if (style === 'thrust') {
      if (inp.attackPhase === 'startup') {
        return {
          hipOffset: { x: -10, y: -36 },
          torsoAngle: -0.1,
          lFoot: { x: -18, y: 0 },
          rFoot: { x: 14, y: 0 },
          lHand: { x: 10, y: -56 },
          rHand: { x: -18, y: -54 },
          weaponAngle: 0.05,
        };
      }
      return {
        hipOffset: { x: 12, y: -36 },
        torsoAngle: 0.45,
        lFoot: { x: -22, y: 0 },
        rFoot: { x: 24, y: 0 },
        lHand: { x: -14, y: -54 },
        rHand: { x: 34, y: -56 },
        weaponAngle: 0.0,
      };
    }

    if (style === 'slash_up') {
      if (inp.attackPhase === 'startup') {
        return {
          hipOffset: { x: -6, y: -30 },
          torsoAngle: 0.35,
          lFoot: { x: -18, y: 0 },
          rFoot: { x: 16, y: 0 },
          lHand: { x: -10, y: -36 },
          rHand: { x: 8, y: -24 },
          weaponAngle: 1.45,
        };
      }
      return {
        hipOffset: { x: 8, y: -44 },
        torsoAngle: -0.22,
        lFoot: { x: -16, y: -4 },
        rFoot: { x: 18, y: -10 },
        lHand: { x: -16, y: -56 },
        rHand: { x: 24, y: -88 },
        weaponAngle: -1.45,
      };
    }

    if (style === 'hammer' || style === 'overhead') {
      if (inp.attackPhase === 'startup') {
        return {
          hipOffset: { x: -8, y: -44 },
          torsoAngle: -0.3,
          lFoot: { x: -18, y: 0 },
          rFoot: { x: 14, y: 0 },
          lHand: { x: -8, y: -84 },
          rHand: { x: -14, y: -90 },
          weaponAngle: -2.25,
        };
      }
      return {
        hipOffset: { x: 12, y: -31 },
        torsoAngle: 0.58,
        lFoot: { x: -20, y: 0 },
        rFoot: { x: 24, y: 0 },
        lHand: { x: 14, y: -36 },
        rHand: { x: 28, y: -26 },
        weaponAngle: 0.52,
      };
    }

    if (style === 'spin') {
      const a = p * Math.PI * 3.5;
      return {
        hipOffset: { x: 6, y: -39 },
        torsoAngle: 0.25 * Math.cos(a),
        lFoot: { x: -18 * Math.cos(a), y: -4 },
        rFoot: { x: 18 * Math.cos(a), y: -4 },
        lHand: { x: -Math.cos(a) * 20, y: -56 },
        rHand: { x: Math.cos(a) * 26, y: -56 + Math.sin(a) * 14 },
        weaponAngle: a,
      };
    }

    if (style === 'flurry') {
      const osc = Math.sin(p * Math.PI * 6);
      return {
        hipOffset: { x: 8, y: -36 },
        torsoAngle: 0.44,
        lFoot: { x: -20, y: 0 },
        rFoot: { x: 22, y: 0 },
        lHand: { x: 18 - osc * 14, y: -56 + osc * 12 },
        rHand: { x: 22 + osc * 14, y: -54 - osc * 12 },
        weaponAngle: -0.25 + osc * 0.7,
        offhandAngle: 0.25 - osc * 0.7,
      };
    }

    // Default slash_down
    if (inp.attackPhase === 'startup') {
      return {
        hipOffset: { x: -8, y: -40 },
        torsoAngle: -0.22,
        lFoot: { x: -18, y: 0 },
        rFoot: { x: 15, y: 0 },
        lHand: { x: -10, y: -74 },
        rHand: { x: -14, y: -82 },
        weaponAngle: -2.15,
      };
    }
    return {
      hipOffset: { x: 12, y: -34 },
      torsoAngle: 0.48,
      lFoot: { x: -22, y: 0 },
      rFoot: { x: 24, y: 0 },
      lHand: { x: -12, y: -50 },
      rHand: { x: 30, y: -38 },
      weaponAngle: 0.58,
    };
  }

  private buildWorldPose(
    origin: Vec2,
    facing: number,
    weapon: WeaponId,
    spec: LocalPoseSpec
  ): StickmanPose {
    const f = facing >= 0 ? 1 : -1;
    const toWorld = (local: Vec2): Vec2 => ({
      x: origin.x + local.x * f,
      y: origin.y + local.y,
    });

    const hip = toWorld(spec.hipOffset);
    const lean = spec.torsoAngle * f;
    const neck: Vec2 = {
      x: hip.x + Math.sin(lean) * TORSO_LEN,
      y: hip.y - Math.cos(lean) * TORSO_LEN,
    };
    const chest: Vec2 = lerpVec(hip, neck, 0.55);
    const head: Vec2 = {
      x: neck.x + Math.sin(lean * 0.75) * HEAD_DIST,
      y: neck.y - Math.cos(lean * 0.75) * HEAD_DIST,
    };

    const lFootTarget = toWorld(spec.lFoot);
    const rFootTarget = toWorld(spec.rFoot);
    const lHandTarget = toWorld(spec.lHand);
    const rHandTarget = toWorld(spec.rHand);

    // Legs bend forward (towards facing direction)
    const lLeg = solveTwoBoneIK(hip, lFootTarget, UPPER_LEG, LOWER_LEG, -f);
    const rLeg = solveTwoBoneIK(hip, rFootTarget, UPPER_LEG, LOWER_LEG, -f);

    // Arms bend slightly downward/backward
    const lArm = solveTwoBoneIK(neck, lHandTarget, UPPER_ARM, LOWER_ARM, f);
    const rArm = solveTwoBoneIK(neck, rHandTarget, UPPER_ARM, LOWER_ARM, f);

    const wLen = WEAPONS[weapon].length;
    const wx = Math.cos(spec.weaponAngle) * f;
    const wy = Math.sin(spec.weaponAngle);
    const weaponBase = rArm.end;
    const weaponTip: Vec2 = {
      x: weaponBase.x + wx * wLen,
      y: weaponBase.y + wy * wLen,
    };

    let offhandWeaponTip: Vec2 | null = null;
    if (weapon === 'cutter' || weapon === 'highlighter') {
      const oa = spec.offhandAngle ?? 2.6;
      offhandWeaponTip = {
        x: lArm.end.x + Math.cos(oa) * f * wLen * 0.9,
        y: lArm.end.y + Math.sin(oa) * wLen * 0.9,
      };
    }

    return {
      head,
      neck,
      chest,
      hip,
      lShoulder: neck,
      lElbow: lArm.mid,
      lHand: lArm.end,
      rShoulder: neck,
      rElbow: rArm.mid,
      rHand: rArm.end,
      lKnee: lLeg.mid,
      lFoot: lLeg.end,
      rKnee: rLeg.mid,
      rFoot: rLeg.end,
      weaponBase,
      weaponTip,
      offhandWeaponTip,
      headTilt: lean,
    };
  }
}
