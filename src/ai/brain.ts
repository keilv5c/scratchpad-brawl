import { ArcadeMaster, InputState, TrainingDummyMode, Vec2 } from '../types';
import { createEmptyInput } from '../engine/input';
import { Fighter } from '../combat/fighter';
import { WeaponPickup } from '../combat/arenaObjects';
import { WEAPONS } from '../config/weapons';

export interface BossAbilityTrigger {
  kind: 'spikes' | 'eraser';
  targetX: number;
}

export class AiBrain {
  public input: InputState = createEmptyInput();
  private thinkTimer = 0;
  private blockHoldTimer = 0;
  private chargeHoldTimer = 0;
  private attackCooldown = 0;
  private bossSkillTimer = 5.5;
  private trainingAttackTimer = 1.4;
  private strafeDir: -1 | 0 | 1 = 0;

  private profile: ArcadeMaster | null = null;

  public setProfile(master: ArcadeMaster | null): void {
    this.profile = master;
    this.reset();
  }

  public reset(): void {
    this.input = createEmptyInput();
    this.thinkTimer = 0.25;
    this.blockHoldTimer = 0;
    this.chargeHoldTimer = 0;
    this.attackCooldown = 0.35;
    this.bossSkillTimer = 5.0;
    this.trainingAttackTimer = 1.2;
  }

  public update(
    dt: number,
    self: Fighter,
    target: Fighter,
    pickups: WeaponPickup[],
    isTraining: boolean,
    dummyMode: TrainingDummyMode,
    onBossSkill?: (trigger: BossAbilityTrigger) => void
  ): InputState {
    // Clear one-frame edge buffers before writing new decisions
    this.input.left = false;
    this.input.right = false;
    this.input.up = false;
    this.input.down = false;
    this.input.light = false;
    this.input.dash = false;
    this.input.superBtn = false;

    // Training dummy specialized behaviors
    if (isTraining) {
      if (dummyMode === 'stand') {
        this.input.block = false;
        this.input.heavy = false;
        return this.input;
      }
      if (dummyMode === 'block') {
        this.input.block = true;
        this.input.heavy = false;
        return this.input;
      }
      if (dummyMode === 'attack') {
        this.input.block = false;
        this.input.heavy = false;
        const dx = target.pos.x - self.pos.x;
        if (Math.abs(dx) > 105) {
          if (dx > 0) this.input.right = true;
          else this.input.left = true;
        } else {
          this.trainingAttackTimer -= dt;
          if (this.trainingAttackTimer <= 0) {
            this.trainingAttackTimer = 1.15;
            this.input.light = true;
            this.input.lightPressed = 6;
          }
        }
        return this.input;
      }
      // 'spar' falls through to real AI at medium difficulty!
    }

    const diff = this.profile?.difficulty ?? 0.55;
    const aggro = this.profile?.aggression ?? 0.6;
    const parrySkill = this.profile?.parrySkill ?? 0.3;
    const dodgeSkill = this.profile?.dodgeSkill ?? 0.35;
    const isBoss = this.profile?.isBoss ?? false;

    const dx = target.pos.x - self.pos.x;
    const dy = target.pos.y - self.pos.y;
    const absDx = Math.abs(dx);
    const reach = WEAPONS[self.weapon].moves.light1.reach * 0.92;

    if (this.attackCooldown > 0) this.attackCooldown -= dt;

    // Continue holding heavy charge until timer finishes
    if (this.chargeHoldTimer > 0) {
      this.chargeHoldTimer -= dt;
      this.input.heavy = this.chargeHoldTimer > 0;
      if (this.chargeHoldTimer <= 0) {
        this.input.heavyReleased = 6;
      }
      return this.input;
    } else {
      this.input.heavy = false;
    }

    // Continue holding block if triggered
    if (this.blockHoldTimer > 0) {
      this.blockHoldTimer -= dt;
      this.input.block = this.blockHoldTimer > 0;
      return this.input;
    } else {
      this.input.block = false;
    }

    // Boss special "Author's Hand" Ink Spikes & Giant Eraser!
    if (isBoss && self.action !== 'ko' && self.action !== 'hitstun' && target.action !== 'ko') {
      this.bossSkillTimer -= dt;
      if (this.bossSkillTimer <= 0) {
        this.bossSkillTimer = 5.4 + Math.random() * 2.8;
        const kind = Math.random() < 0.58 ? 'spikes' : 'eraser';
        onBossSkill?.({ kind, targetX: target.pos.x });
      }
    }

    // Reactive defense when opponent attacks close by
    const oppThreat =
      (target.action === 'attack' || target.action === 'super_active') &&
      absDx < 155 &&
      Math.abs(dy) < 90;

    if (oppThreat && self.action !== 'attack' && self.action !== 'dash' && self.action !== 'hitstun') {
      this.thinkTimer -= dt * 3;
      if (this.thinkTimer <= 0) {
        this.thinkTimer = 0.16;
        const roll = Math.random();
        if (roll < parrySkill * 0.55) {
          // Attempt crisp Parry!
          this.input.block = true;
          this.input.blockPressed = 6;
          this.blockHoldTimer = 0.24;
          return this.input;
        } else if (roll < parrySkill * 0.55 + dodgeSkill * 0.45 && self.dashCooldown <= 0) {
          // Dash through / away!
          if (dx > 0) this.input.right = true;
          else this.input.left = true;
          this.input.dash = true;
          this.input.dashPressed = 6;
          return this.input;
        } else if (roll < diff * 0.8) {
          this.input.block = true;
          this.blockHoldTimer = 0.32;
          return this.input;
        }
      }
    }

    // Avoid pitfall gaps on bridge stage!
    if (self.pos.y > 590 && !self.onGround && self.jumpsLeft > 0) {
      this.input.up = true;
      this.input.jumpPressed = 6;
      if (self.pos.x < 640) this.input.right = true;
      else this.input.left = true;
      return this.input;
    }

    // Decision tick
    this.thinkTimer -= dt;
    if (this.thinkTimer <= 0) {
      this.thinkTimer = Math.max(0.08, 0.28 - diff * 0.17) + Math.random() * 0.08;

      // Check for Ink Super finisher!
      if (self.ink >= self.maxInk && absDx < 250 && Math.abs(dy) < 95 && Math.random() < 0.45 + diff * 0.35) {
        this.input.superBtn = true;
        this.input.superPressed = 6;
        return this.input;
      }

      // Check for nearby sketched weapon pickup opportunistically
      if (pickups.length > 0 && Math.random() < 0.22) {
        const pk = pickups[0];
        if (Math.hypot(pk.pos.x - self.pos.x, pk.pos.y - self.pos.y) < 220) {
          this.strafeDir = pk.pos.x > self.pos.x ? 1 : -1;
          if (pk.pos.y < self.pos.y - 60 && self.onGround) {
            this.input.jumpPressed = 6;
          }
          return this.input;
        }
      }

      // Choose movement spacing
      if (absDx > reach + 36) {
        this.strafeDir = dx > 0 ? 1 : -1;
        // Dash-in gap closer
        if (absDx > 240 && absDx < 460 && self.dashCooldown <= 0 && Math.random() < aggro * 0.38) {
          this.input.dash = true;
          this.input.dashPressed = 6;
        }
      } else if (absDx < 46 && Math.random() < 0.35) {
        this.strafeDir = dx > 0 ? -1 : 1;
      } else {
        this.strafeDir = Math.random() < 0.5 ? (dx > 0 ? 1 : -1) : 0;
      }

      // Jump to chase aerial target or climb platforms
      if (dy < -75 && self.onGround && Math.random() < 0.55) {
        this.input.up = true;
        this.input.jumpPressed = 6;
      }

      // Offense in range!
      if (absDx <= reach + 24 && Math.abs(dy) < 85 && this.attackCooldown <= 0) {
        const roll = Math.random();
        if (target.action === 'block' && roll < 0.62) {
          // Punish blocking player with guard-break Heavy Charge!
          this.input.heavy = true;
          this.input.heavyPressed = 6;
          this.chargeHoldTimer = 0.32 + Math.random() * 0.28;
          this.attackCooldown = 0.5;
        } else if (roll < aggro * 0.68) {
          // Light attack / combo continuation
          if (Math.random() < 0.2 && self.onGround) {
            this.input.up = true; // Launcher!
          }
          this.input.light = true;
          this.input.lightPressed = 6;
          this.attackCooldown = self.action === 'attack' ? 0.14 : Math.max(0.16, 0.42 - diff * 0.22);
        } else if (roll < aggro * 0.92) {
          // Heavy / ranged wave / shuriken
          this.input.heavy = true;
          this.input.heavyPressed = 6;
          this.chargeHoldTimer = 0.18 + Math.random() * 0.34;
          this.attackCooldown = 0.52;
        }
      } else if (
        absDx > 190 &&
        absDx < 480 &&
        WEAPONS[self.weapon].moves.heavy.spawnsProjectile &&
        this.attackCooldown <= 0 &&
        Math.random() < diff * 0.24
      ) {
        // Long range ink wave / shuriken / ground fissure poke!
        this.input.heavy = true;
        this.input.heavyPressed = 6;
        this.chargeHoldTimer = 0.24;
        this.attackCooldown = 0.85;
      }
    }

    // Apply continuous movement direction
    if (this.strafeDir < 0) this.input.left = true;
    else if (this.strafeDir > 0) this.input.right = true;

    // Follow up combo chain smoothly when already in active attack
    if (
      self.action === 'attack' &&
      (self.attackKind === 'light1' || self.attackKind === 'light2') &&
      absDx < reach + 25 &&
      Math.random() < diff * 0.28
    ) {
      this.input.light = true;
      this.input.lightPressed = 4;
    }

    return this.input;
  }
}
