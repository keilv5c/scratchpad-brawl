import { PlatformDef, Vec2 } from '../types';
import { StickmanPose } from './skeleton';
import { WORLD_WIDTH } from '../config/stages';

interface RagNode {
  id: string;
  x: number;
  y: number;
  px: number;
  py: number;
  radius: number;
}

interface RagStick {
  a: number;
  b: number;
  len: number;
}

/**
 * Verlet stickman ragdoll activated upon KO or massive launch.
 * Bounces off sketchbook margins and platforms, leaving real ink trails!
 */
export class StickmanRagdoll {
  public active = false;
  public nodes: RagNode[] = [];
  public sticks: RagStick[] = [];
  private indexMap: Record<string, number> = {};

  public spawnFromPose(pose: StickmanPose, launchVx: number, launchVy: number): void {
    this.active = true;
    this.nodes = [];
    this.sticks = [];
    this.indexMap = {};

    const pts: Array<[string, Vec2, number]> = [
      ['head', pose.head, 11],
      ['neck', pose.neck, 4],
      ['hip', pose.hip, 5],
      ['lElbow', pose.lElbow, 3],
      ['lHand', pose.lHand, 4],
      ['rElbow', pose.rElbow, 3],
      ['rHand', pose.rHand, 4],
      ['lKnee', pose.lKnee, 3],
      ['lFoot', pose.lFoot, 4],
      ['rKnee', pose.rKnee, 3],
      ['rFoot', pose.rFoot, 4],
    ];

    const stepVx = launchVx / 60;
    const stepVy = launchVy / 60;

    pts.forEach(([id, p, rad], idx) => {
      this.indexMap[id] = idx;
      // Add slight angular spin variation per joint so ragdoll tumbles dramatically
      const spinJitterX = (Math.random() - 0.5) * 3.5;
      const spinJitterY = (Math.random() - 0.5) * 3.5;
      this.nodes.push({
        id,
        x: p.x,
        y: p.y,
        px: p.x - stepVx - spinJitterX,
        py: p.y - stepVy - spinJitterY,
        radius: rad,
      });
    });

    const link = (a: string, b: string) => {
      const ia = this.indexMap[a];
      const ib = this.indexMap[b];
      const na = this.nodes[ia];
      const nb = this.nodes[ib];
      this.sticks.push({ a: ia, b: ib, len: Math.hypot(nb.x - na.x, nb.y - na.y) });
    };

    link('head', 'neck');
    link('neck', 'hip');
    link('neck', 'lElbow');
    link('lElbow', 'lHand');
    link('neck', 'rElbow');
    link('rElbow', 'rHand');
    link('hip', 'lKnee');
    link('lKnee', 'lFoot');
    link('hip', 'rKnee');
    link('rKnee', 'rFoot');
    // Structural spine brace so head doesn't collapse into hip
    link('head', 'hip');
  }

  public deactivate(): void {
    this.active = false;
    this.nodes = [];
    this.sticks = [];
  }

  public update(
    platforms: PlatformDef[],
    brokenIds: Set<string>,
    worldWidth = WORLD_WIDTH,
    onBounce?: (pos: Vec2, speed: number) => void
  ): void {
    if (!this.active) return;

    const gravity = 0.52;
    const damping = 0.992;

    for (const n of this.nodes) {
      const vx = (n.x - n.px) * damping;
      const vy = (n.y - n.py) * damping;
      n.px = n.x;
      n.py = n.y;
      n.x += vx;
      n.y += vy + gravity;
    }

    for (let iter = 0; iter < 6; iter++) {
      for (const s of this.sticks) {
        const a = this.nodes[s.a];
        const b = this.nodes[s.b];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.001;
        const diff = (d - s.len) / d * 0.5;
        a.x += dx * diff;
        a.y += dy * diff;
        b.x -= dx * diff;
        b.y -= dy * diff;
      }

      // World margin walls + platforms
      for (const n of this.nodes) {
        const vx = n.x - n.px;
        const vy = n.y - n.py;

        if (n.x < 56 + n.radius) {
          n.x = 56 + n.radius;
          n.px = n.x + vx * 0.65;
          if (iter === 0 && Math.abs(vx) > 5) onBounce?.({ x: n.x, y: n.y }, Math.abs(vx));
        } else if (n.x > worldWidth - 56 - n.radius) {
          n.x = worldWidth - 56 - n.radius;
          n.px = n.x + vx * 0.65;
          if (iter === 0 && Math.abs(vx) > 5) onBounce?.({ x: n.x, y: n.y }, Math.abs(vx));
        }

        for (const p of platforms) {
          if (p.pillar || brokenIds.has(p.id)) continue;
          if (n.x >= p.x && n.x <= p.x + p.w) {
            const top = p.y - n.radius;
            if (n.y > top && n.py <= p.y + 12 && vy >= 0) {
              n.y = top;
              n.py = n.y + vy * 0.45;
              // Paper floor friction
              n.px = n.x - vx * 0.84;
              if (iter === 0 && Math.abs(vy) > 4.5) {
                onBounce?.({ x: n.x, y: p.y }, Math.abs(vy));
              }
            }
          }
        }
      }
    }
  }

  public toPose(): StickmanPose {
    const get = (id: string): Vec2 => {
      const n = this.nodes[this.indexMap[id]];
      return n ? { x: n.x, y: n.y } : { x: 0, y: 0 };
    };
    const neck = get('neck');
    const hip = get('hip');
    const rHand = get('rHand');
    const rElbow = get('rElbow');
    return {
      head: get('head'),
      neck,
      chest: { x: (neck.x + hip.x) * 0.5, y: (neck.y + hip.y) * 0.5 },
      hip,
      lShoulder: neck,
      lElbow: get('lElbow'),
      lHand: get('lHand'),
      rShoulder: neck,
      rElbow,
      rHand,
      lKnee: get('lKnee'),
      lFoot: get('lFoot'),
      rKnee: get('rKnee'),
      rFoot: get('rFoot'),
      weaponBase: rHand,
      weaponTip: {
        x: rHand.x + (rHand.x - rElbow.x) * 2,
        y: rHand.y + (rHand.y - rElbow.y) * 2,
      },
      offhandWeaponTip: null,
      headTilt: 0,
    };
  }
}
