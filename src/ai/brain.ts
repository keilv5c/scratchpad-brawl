import { ArcadeMaster, InputState, PlatformDef, TrainingDummyMode } from '../types';
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
  private platformActionCd = 0;
  private climbTargetY: number | null = null;
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
    this.bossSkillTimer = 6.8;
    this.trainingAttackTimer = 1.2;
    this.platformActionCd = 0.4;
    this.climbTargetY = null;
  }

  public update(
    dt: number,
    self: Fighter,
    target: Fighter,
    pickups: WeaponPickup[],
    isTraining: boolean,
    dummyMode: TrainingDummyMode,
    onBossSkill?: (trigger: BossAbilityTrigger) => void,
    platforms: PlatformDef[] = [],
    brokenPlatforms?: Set<string>
  ): InputState {
    // Clear one-frame edge buffers before writing new decisions
    this.input.left = false;
    this.input.right = false;
    this.input.up = false;
    this.input.down = false;
    this.input.light = false;
    this.input.dash = false;
    this.input.superBtn = false;
    if (this.input.dropThroughPressed > 0) this.input.dropThroughPressed--;
    if (this.platformActionCd > 0) this.platformActionCd -= dt;

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
        this.bossSkillTimer = 7.5 + Math.random() * 3.0;
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

    // Avoid pitfall gaps (only when actually falling below floor level y > 658, never on normal jumps!)
    if (self.pos.y > 658 && self.vel.y > 0 && !self.onGround && self.jumpsLeft > 0) {
      this.input.up = true;
      this.input.jumpPressed = 6;
      if (self.pos.x < 640) this.input.right = true;
      else this.input.left = true;
      return this.input;
    }

    // Clear climb target once we land or rise above it
    if (self.onGround || (this.climbTargetY !== null && self.pos.y <= this.climbTargetY - 10)) {
      this.climbTargetY = null;
    }

    // Mid-air double-jump follow-up when climbing up to clear a platform (Jump #1 peaks ~120px, platforms are ~150px!)
    if (
      !self.onGround &&
      self.jumpsLeft > 0 &&
      self.vel.y > -120 &&
      (dy < -12 || (this.climbTargetY !== null && self.pos.y > this.climbTargetY - 8))
    ) {
      this.input.up = true;
      this.input.jumpPressed = 6;
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
        if (Math.hypot(pk.pos.x - self.pos.x, pk.pos.y - self.pos.y) < 230) {
          this.strafeDir = pk.pos.x > self.pos.x ? 1 : -1;
          if (pk.pos.y < self.pos.y - 60 && self.onGround) {
            this.input.up = true;
            this.input.jumpPressed = 6;
            this.climbTargetY = pk.pos.y;
          } else if (pk.pos.y > self.pos.y + 68 && self.onGround && self.onOneWayPlatform && this.platformActionCd <= 0) {
            this.input.dropThroughPressed = 6;
            this.platformActionCd = 0.55;
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

      // Smart Platform Navigation: actively DROP DOWN or CLIMB UP one-way platforms!
      const usableOneWay = platforms.filter(
        (p) => p.oneWay && !p.pillar && !p.bouncePad && !(brokenPlatforms?.has(p.id))
      );
      if (self.onGround && this.platformActionCd <= 0) {
        if (self.onOneWayPlatform && dy > 70 && Math.random() < 0.72 + diff * 0.22) {
          // Target is below us: drop cleanly through the platform!
          this.input.dropThroughPressed = 6;
          this.platformActionCd = 0.52;
        } else if (dy < -65) {
          // Target is higher: jump onto an intermediate/target platform!
          let bestPlat: PlatformDef | null = null;
          let bestScore = Infinity;
          for (const p of usableOneWay) {
            if (p.y < self.pos.y - 35 && p.y > self.pos.y - 255) {
              const cx = p.x + p.w * 0.5;
              const score = Math.abs(cx - target.pos.x) * 0.65 + Math.abs(cx - self.pos.x) * 0.5;
              if (score < bestScore) {
                bestScore = score;
                bestPlat = p;
              }
            }
          }
          if (bestPlat) {
            const margin = 48;
            if (self.pos.x < bestPlat.x - margin) {
              this.strafeDir = 1;
            } else if (self.pos.x > bestPlat.x + bestPlat.w + margin) {
              this.strafeDir = -1;
            } else if (Math.random() < 0.72 + diff * 0.2) {
              this.input.up = true;
              this.input.jumpPressed = 6;
              this.climbTargetY = bestPlat.y;
              this.platformActionCd = 0.48;
            }
          } else if (Math.random() < 0.65) {
            this.input.up = true;
            this.input.jumpPressed = 6;
            this.climbTargetY = target.pos.y;
            this.platformActionCd = 0.48;
          }
        } else if (self.onOneWayPlatform && Math.random() < 0.14) {
          // Occasional tactical drop-down to keep vertical spacing dynamic
          this.input.dropThroughPressed = 6;
          this.platformActionCd = 1.6;
        } else if (!self.onOneWayPlatform && Math.random() < 0.18) {
          // Proactively hop up onto a nearby overhead platform to take high ground!
          const overhead = usableOneWay.find(
            (p) =>
              p.y < self.pos.y - 55 &&
              p.y > self.pos.y - 210 &&
              self.pos.x >= p.x - 42 &&
              self.pos.x <= p.x + p.w + 42
          );
          if (overhead) {
            this.input.up = true;
            this.input.jumpPressed = 6;
            this.climbTargetY = overhead.y;
            this.platformActionCd = 2.0;
          }
        }
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
