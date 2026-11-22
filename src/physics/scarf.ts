import { Vec2 } from '../types';

interface ScarfNode {
  x: number;
  y: number;
  px: number;
  py: number;
}

/**
 * Flowing martial-arts headband / scarf using Verlet rope integration.
 * Adds huge kinetic readability and silhouette polish!
 */
export class ScarfChain {
  public nodes: ScarfNode[] = [];
  private segLen = 9.5;

  constructor(startX: number, startY: number, count = 7) {
    this.reset(startX, startY, count);
  }

  public reset(startX: number, startY: number, count = 7): void {
    this.nodes = [];
    for (let i = 0; i < count; i++) {
      this.nodes.push({
        x: startX - i * this.segLen,
        y: startY + i * 2,
        px: startX - i * this.segLen,
        py: startY + i * 2,
      });
    }
  }

  public update(anchor: Vec2, facing: number, ownerVx: number, time: number): void {
    if (this.nodes.length === 0) return;

    this.nodes[0].x = anchor.x;
    this.nodes[0].y = anchor.y;
    this.nodes[0].px = anchor.x;
    this.nodes[0].py = anchor.y;

    const windX = -facing * 0.42 - ownerVx * 0.0022;

    for (let i = 1; i < this.nodes.length; i++) {
      const n = this.nodes[i];
      const vx = (n.x - n.px) * 0.86;
      const vy = (n.y - n.py) * 0.86;
      n.px = n.x;
      n.py = n.y;
      const flutter = Math.sin(time * 13 + i * 0.85) * 0.42;
      n.x += vx + windX;
      n.y += vy + 0.24 + flutter;
    }

    // Distance constraints
    for (let iter = 0; iter < 5; iter++) {
      this.nodes[0].x = anchor.x;
      this.nodes[0].y = anchor.y;
      for (let i = 1; i < this.nodes.length; i++) {
        const a = this.nodes[i - 1];
        const b = this.nodes[i];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy) || 0.0001;
        const diff = (d - this.segLen) / d;
        if (i === 1) {
          b.x -= dx * diff;
          b.y -= dy * diff;
        } else {
          a.x += dx * diff * 0.42;
          a.y += dy * diff * 0.42;
          b.x -= dx * diff * 0.58;
          b.y -= dy * diff * 0.58;
        }
      }
    }
  }

  public getPoints(): Vec2[] {
    return this.nodes.map((n) => ({ x: n.x, y: n.y }));
  }
}
