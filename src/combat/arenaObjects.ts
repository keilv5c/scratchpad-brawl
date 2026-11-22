import { PlatformDef, Vec2, WeaponId } from '../types';
import { DROPPABLE_WEAPONS } from '../config/weapons';
import { randChoice, Rect } from '../engine/math';

export interface DoodleCrate {
  id: string;
  pos: Vec2;
  w: number;
  h: number;
  hp: number;
  maxHp: number;
  hitShake: number;
  broken: boolean;
}

export interface WeaponPickup {
  id: string;
  weapon: WeaponId;
  pos: Vec2;
  vy: number;
  life: number;
  sketchProgress: number; // 0..1 while Giant Pencil is sketching it in!
  bobPhase: number;
}

export interface BreakableBridgeState {
  platformId: string;
  hp: number;
  broken: boolean;
  respawnTimer: number;
  redrawProgress: number; // 0..1 while Giant Pencil sketches it back!
}

export interface GiantPencilActor {
  active: boolean;
  pos: Vec2;
  target: Vec2;
  phase: 'entering' | 'drawing' | 'exiting';
  timer: number;
  purpose: 'weapon' | 'bridge';
}

export interface InkOrb {
  id: string;
  pos: Vec2;
  vel: Vec2;
  life: number;
  value: number;
}

export interface HighlighterZone {
  active: boolean;
  x: number;
  y: number;
  w: number;
  color: string;
  life: number;
  maxLife: number;
}

let objIdCounter = 1;

export class ArenaObjectManager {
  public crates: DoodleCrate[] = [];
  public pickups: WeaponPickup[] = [];
  public bridges: Map<string, BreakableBridgeState> = new Map();
  public orbs: InkOrb[] = [];
  public highlighterZone: HighlighterZone = {
    active: false,
    x: 500,
    y: 600,
    w: 240,
    color: 'rgba(248, 232, 62, 0.42)',
    life: 0,
    maxLife: 10,
  };
  public pencil: GiantPencilActor = {
    active: false,
    pos: { x: 640, y: -120 },
    target: { x: 640, y: 200 },
    phase: 'exiting',
    timer: 0,
    purpose: 'weapon',
  };

  private weaponDropTimer = 11;
  private eventTimer = 8.5;

  public reset(crateSpawns: Vec2[], platforms: PlatformDef[]): void {
    this.crates = crateSpawns.map((s) => ({
      id: `crate_${objIdCounter++}`,
      pos: { x: s.x, y: s.y },
      w: 44,
      h: 44,
      hp: 20,
      maxHp: 20,
      hitShake: 0,
      broken: false,
    }));

    this.pickups = [];
    this.orbs = [];
    this.highlighterZone.active = false;
    this.eventTimer = 7.5;
    this.bridges.clear();
    for (const p of platforms) {
      if (p.breakable) {
        this.bridges.set(p.id, {
          platformId: p.id,
          hp: 26,
          broken: false,
          respawnTimer: 0,
          redrawProgress: 1,
        });
      }
      if (p.origami) {
        p.x = p.origami.baseX;
        p.y = p.origami.baseY;
      }
      if (p.elevator) {
        p.y = p.elevator.baseY;
      }
    }

    this.pencil.active = false;
    this.weaponDropTimer = 10;
  }

  public isInHighlighterZone(pos: Vec2): boolean {
    if (!this.highlighterZone.active) return false;
    return (
      pos.x >= this.highlighterZone.x &&
      pos.x <= this.highlighterZone.x + this.highlighterZone.w &&
      Math.abs(pos.y - this.highlighterZone.y) < 36
    );
  }

  public getBrokenPlatformIds(): Set<string> {
    const s = new Set<string>();
    for (const [id, st] of this.bridges.entries()) {
      if (st.broken) s.add(id);
    }
    return s;
  }

  public damageBridgeAt(
    x: number,
    y: number,
    damage: number,
    platforms: PlatformDef[],
    onBreak: (p: PlatformDef) => void
  ): void {
    for (const p of platforms) {
      if (!p.breakable) continue;
      const st = this.bridges.get(p.id);
      if (!st || st.broken) continue;
      if (x >= p.x - 24 && x <= p.x + p.w + 24 && Math.abs(y - p.y) < 52) {
        st.hp -= damage;
        if (st.hp <= 0) {
          st.broken = true;
          st.respawnTimer = 4.5;
          st.redrawProgress = 0;
          onBreak(p);
        }
      }
    }
  }

  public spawnWeaponDrop(x: number, y: number, onPencilStart: () => void): void {
    const weapon = randChoice(DROPPABLE_WEAPONS);
    this.pickups.push({
      id: `pickup_${objIdCounter++}`,
      weapon,
      pos: { x, y },
      vy: 0,
      life: 16,
      sketchProgress: 0,
      bobPhase: 0,
    });
    this.summonPencil({ x, y }, 'weapon', onPencilStart);
  }

  public spawnInkOrbs(pos: Vec2, count: number): void {
    for (let i = 0; i < count; i++) {
      const ang = -Math.PI * 0.25 - Math.random() * Math.PI * 0.5;
      const spd = 160 + Math.random() * 180;
      this.orbs.push({
        id: `orb_${objIdCounter++}`,
        pos: { x: pos.x, y: pos.y - 16 },
        vel: { x: Math.cos(ang) * spd, y: Math.sin(ang) * spd - 80 },
        life: 9,
        value: 14,
      });
    }
  }

  private summonPencil(target: Vec2, purpose: 'weapon' | 'bridge', onStart: () => void): void {
    this.pencil.active = true;
    this.pencil.target = { ...target };
    this.pencil.pos = { x: target.x + 170, y: target.y - 240 };
    this.pencil.phase = 'entering';
    this.pencil.timer = 0;
    this.pencil.purpose = purpose;
    onStart();
  }

  public update(
    dt: number,
    time: number,
    platforms: PlatformDef[],
    weaponDropXs: number[],
    allowDrops: boolean,
    hasStationeryEvents: boolean,
    floorY: number,
    worldWidth: number,
    worldHeight: number,
    onPencilSound: () => void,
    onStaplerEvent?: (x: number) => void
  ): void {
    // Move Origami Paper Airplane platforms & Vertical Elevators!
    for (const p of platforms) {
      if (p.origami) {
        const o = p.origami;
        p.x = o.baseX + Math.sin(time * o.speed + o.phase) * o.rangeX;
        p.y = o.baseY + Math.cos(time * o.speed * 1.4 + o.phase) * o.rangeY;
      }
      if (p.elevator) {
        const el = p.elevator;
        p.y = el.baseY + Math.sin(time * el.speed + el.phase) * el.rangeY;
      }
    }

    // Highlighter Boost Zone countdown
    if (this.highlighterZone.active) {
      this.highlighterZone.life -= dt;
      if (this.highlighterZone.life <= 0) {
        this.highlighterZone.active = false;
      }
    }

    // Random Stationery Arena Events (Highlighter boost stripe OR Giant Stapler slam!)
    if (hasStationeryEvents && allowDrops) {
      this.eventTimer -= dt;
      if (this.eventTimer <= 0) {
        this.eventTimer = 10 + Math.random() * 5;
        const margin = 190;
        const span = Math.max(200, worldWidth - margin * 2 - 250);
        if (Math.random() < 0.55) {
          this.highlighterZone = {
            active: true,
            x: margin + Math.random() * span,
            y: floorY,
            w: 250,
            color: 'rgba(250, 232, 48, 0.44)',
            life: 9.5,
            maxLife: 9.5,
          };
          onPencilSound();
        } else if (onStaplerEvent) {
          onStaplerEvent(margin + Math.random() * span);
        }
      }
    }

    // Crates hitshake decay
    for (const c of this.crates) {
      if (c.hitShake > 0) c.hitShake = Math.max(0, c.hitShake - dt * 4);
    }

    // Breakable bridges respawn with Giant Pencil redraw!
    for (const p of platforms) {
      if (!p.breakable) continue;
      const st = this.bridges.get(p.id);
      if (!st || !st.broken) continue;

      if (st.respawnTimer > 0) {
        st.respawnTimer -= dt;
        if (st.respawnTimer <= 0) {
          this.summonPencil({ x: p.x + p.w * 0.5, y: p.y }, 'bridge', onPencilSound);
        }
      } else {
        st.redrawProgress = Math.min(1, st.redrawProgress + dt * 1.4);
        if (st.redrawProgress >= 1) {
          st.broken = false;
          st.hp = 26;
        }
      }
    }

    // Periodic Giant Pencil weapon drop
    if (allowDrops && this.pickups.length < 2 && weaponDropXs.length > 0) {
      this.weaponDropTimer -= dt;
      if (this.weaponDropTimer <= 0) {
        this.weaponDropTimer = 13 + Math.random() * 6;
        const dropX = randChoice(weaponDropXs);
        this.spawnWeaponDrop(dropX, 240, onPencilSound);
      }
    }

    // Update weapon pickups
    const brokenIds = this.getBrokenPlatformIds();
    for (let i = this.pickups.length - 1; i >= 0; i--) {
      const pk = this.pickups[i];
      pk.bobPhase += dt * 4.5;
      if (pk.sketchProgress < 1) {
        pk.sketchProgress = Math.min(1, pk.sketchProgress + dt * 1.7);
      } else {
        pk.life -= dt;
        pk.vy += 900 * dt;
        const prevY = pk.pos.y;
        pk.pos.y += pk.vy * dt;
        for (const p of platforms) {
          if (p.pillar || brokenIds.has(p.id)) continue;
          if (pk.pos.x >= p.x && pk.pos.x <= p.x + p.w && prevY <= p.y - 16 && pk.pos.y >= p.y - 20) {
            pk.pos.y = p.y - 20;
            pk.vy = 0;
          }
        }
      }
      if (pk.life <= 0 || pk.pos.y > worldHeight + 140) {
        this.pickups.splice(i, 1);
      }
    }

    // Update ink orbs
    for (let i = this.orbs.length - 1; i >= 0; i--) {
      const orb = this.orbs[i];
      orb.life -= dt;
      orb.vel.y += 980 * dt;
      const prevY = orb.pos.y;
      orb.pos.x += orb.vel.x * dt;
      orb.pos.y += orb.vel.y * dt;
      for (const p of platforms) {
        if (p.pillar || brokenIds.has(p.id)) continue;
        if (orb.pos.x >= p.x && orb.pos.x <= p.x + p.w && prevY <= p.y && orb.pos.y >= p.y - 8) {
          orb.pos.y = p.y - 8;
          orb.vel.y = -Math.abs(orb.vel.y) * 0.45;
          orb.vel.x *= 0.72;
        }
      }
      if (orb.life <= 0) this.orbs.splice(i, 1);
    }

    // Animate Giant Pencil Actor
    if (this.pencil.active) {
      this.pencil.timer += dt;
      if (this.pencil.phase === 'entering') {
        const t = Math.min(1, this.pencil.timer / 0.28);
        this.pencil.pos.x += (this.pencil.target.x - this.pencil.pos.x) * (1 - Math.exp(-14 * dt));
        this.pencil.pos.y += (this.pencil.target.y - this.pencil.pos.y) * (1 - Math.exp(-14 * dt));
        if (t >= 1) {
          this.pencil.phase = 'drawing';
          this.pencil.timer = 0;
        }
      } else if (this.pencil.phase === 'drawing') {
        const scribble = Math.sin(this.pencil.timer * 48) * 26;
        const scribbleY = Math.cos(this.pencil.timer * 34) * 10;
        this.pencil.pos.x = this.pencil.target.x + scribble;
        this.pencil.pos.y = this.pencil.target.y + scribbleY;
        if (this.pencil.timer >= 0.55) {
          this.pencil.phase = 'exiting';
          this.pencil.timer = 0;
        }
      } else {
        this.pencil.pos.x += 580 * dt;
        this.pencil.pos.y -= 760 * dt;
        if (this.pencil.timer >= 0.45) {
          this.pencil.active = false;
        }
      }
    }
  }

  public getCrateRect(c: DoodleCrate): Rect {
    return {
      x: c.pos.x - c.w * 0.5,
      y: c.pos.y - c.h * 0.5,
      w: c.w,
      h: c.h,
    };
  }
}
