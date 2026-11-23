import {
  AttackKind,
  FighterAction,
  InputState,
  MoveDef,
  MoveProjectileSpawn,
  PlatformDef,
  UpdraftZone,
  Vec2,
  WeaponId,
} from '../types';
import { clamp, Rect } from '../engine/math';
import { WEAPONS } from '../config/weapons';
import { WORLD_WIDTH } from '../config/stages';
import { ProceduralSkeleton, StickmanPose } from '../physics/skeleton';
import { ScarfChain } from '../physics/scarf';
import { StickmanRagdoll } from '../physics/ragdoll';
import { SoundEngine } from '../audio/soundEngine';

export interface SmearSample {
  base: Vec2;
  tip: Vec2;
  life: number;
  maxLife: number;
  color: string;
  heavy: boolean;
}

export interface FighterCallbacks {
  onSpawnAfterimage: (fighter: Fighter, isDash: boolean) => void;
  onSpawnDust: (pos: Vec2, dir: number, count: number) => void;
  onSkidMark: (pos: Vec2, facing: number) => void;
  onSpawnProjectile: (
    owner: Fighter,
    kind: MoveProjectileSpawn,
    pos: Vec2,
    facing: number,
    chargeRatio: number,
    aimAngle?: number | null
  ) => void;
  onSuperTrigger: (fighter: Fighter) => void;
  onRagdollBounce: (pos: Vec2, speed: number, color: string) => void;
  onBouncePad?: (pos: Vec2) => void;
}

let fighterUid = 1;

export class Fighter {
  public readonly uid: string = `f_${fighterUid++}`;
  public readonly index: 0 | 1;
  public name: string;
  public title: string;
  public isBoss = false;
  public rainbowSkin = false;

  // Dynamic multipliers (for Roguelike buffs & Highlighter boost zone!)
  public moveSpeedMult = 1.0;
  public dashCooldownMult = 1.0;
  public damageMult = 1.0;
  public inkGainMult = 1.0;
  public lastAimAngle: number | null = null;

  public pos: Vec2;
  public vel: Vec2 = { x: 0, y: 0 };
  public facing: 1 | -1 = 1;

  public hp = 120;
  public maxHp = 120;
  public delayedHp = 120;
  public ink = 25;
  public readonly maxInk = 100;
  public guardMeter = 100;

  public inkColor: string;
  public scarfColor: string;
  public weapon: WeaponId;

  public action: FighterAction = 'idle';
  public actionFrames = 0;
  public animPhase = 0;

  // Physics state
  public onGround = false;
  public onOneWayPlatform = false;
  public coyoteFrames = 0;
  public jumpsLeft = 2;
  public wallDir: -1 | 0 | 1 = 0; // -1 left wall, +1 right wall
  public dropThroughFrames = 0;

  // Combat state
  public attackKind: AttackKind | null = null;
  public attackHitIds = new Set<string>();
  public activeHeavyCastId: string | null = null;
  public activeHeavyCastCap = 0;
  public activeSuperCastId: string | null = null;
  public activeSuperCastCap = 0;
  public attackMultiHitStep = 0;
  public comboStep = 0;
  public comboWindowFrames = 0;
  public queuedCombo: AttackKind | null = null;
  public hasPlayedWhoosh = false;
  public hasSpawnedProj = false;

  public chargeFrames = 0;
  public readonly maxChargeFrames = 42;
  public lastChargeRatio = 0;
  private chargeSoundTick = 0;

  public parryWindowFrames = 0;
  public dashCooldown = 0;
  public dashInvulnFrames = 0;
  public perfectDodgeCooldown = 0;
  public hitstunFrames = 0;
  public invulnFrames = 0;
  public superFlashFrames = 0;
  public hurtFlashFrames = 0;
  public comboReceived = 0;

  private footstepTimer = 0;
  private afterimageTimer = 0;

  public skeleton: ProceduralSkeleton;
  public scarf: ScarfChain;
  public ragdoll: StickmanRagdoll;
  public smearTrail: SmearSample[] = [];

  constructor(
    index: 0 | 1,
    name: string,
    title: string,
    startPos: Vec2,
    facing: 1 | -1,
    weapon: WeaponId,
    inkColor: string,
    scarfColor: string,
    maxHp = 120
  ) {
    this.index = index;
    this.name = name;
    this.title = title;
    this.pos = { ...startPos };
    this.facing = facing;
    this.weapon = weapon;
    this.inkColor = inkColor;
    this.scarfColor = scarfColor;
    this.maxHp = maxHp;
    this.hp = maxHp;
    this.delayedHp = maxHp;

    this.skeleton = new ProceduralSkeleton(this.pos);
    this.scarf = new ScarfChain(this.pos.x, this.pos.y - 68);
    this.ragdoll = new StickmanRagdoll();
  }

  public resetForRound(startPos: Vec2, facing: 1 | -1): void {
    this.pos = { ...startPos };
    this.vel = { x: 0, y: 0 };
    this.facing = facing;
    this.hp = this.maxHp;
    this.delayedHp = this.maxHp;
    this.guardMeter = 100;
    this.ink = Math.max(this.ink, 25);
    this.action = 'idle';
    this.actionFrames = 0;
    this.onGround = false;
    this.jumpsLeft = 2;
    this.wallDir = 0;
    this.attackKind = null;
    this.attackHitIds.clear();
    this.comboStep = 0;
    this.comboWindowFrames = 0;
    this.queuedCombo = null;
    this.chargeFrames = 0;
    this.parryWindowFrames = 0;
    this.dashCooldown = 0;
    this.dashInvulnFrames = 0;
    this.hitstunFrames = 0;
    this.invulnFrames = 0;
    this.hurtFlashFrames = 0;
    this.comboReceived = 0;
    this.lastAimAngle = null;
    this.smearTrail = [];
    this.ragdoll.deactivate();
    this.scarf.reset(this.pos.x, this.pos.y - 68);
  }

  public getCurrentMove(): MoveDef | null {
    if (!this.attackKind) return null;
    return WEAPONS[this.weapon].moves[this.attackKind];
  }

  public getPose(): StickmanPose {
    if (this.ragdoll.active) {
      return this.ragdoll.toPose();
    }
    return this.skeleton.pose;
  }

  public getHurtbox(): Rect {
    const crouching = this.action === 'crouch';
    const h = crouching ? 54 : 84;
    return {
      x: this.pos.x - 19,
      y: this.pos.y - h,
      w: 38,
      h,
    };
  }

  public getActiveAttackHitbox(): Rect | null {
    if (this.action !== 'attack' && this.action !== 'super_active') return null;
    const move = this.getCurrentMove();
    if (!move) return null;
    const f = this.actionFrames;
    if (f < move.startup || f >= move.startup + move.active) return null;

    const w = move.reach;
    const h = move.height;
    const x = this.facing > 0 ? this.pos.x - 8 : this.pos.x + 8 - w;
    const y = this.pos.y + move.offsetY - h * 0.5;
    return { x, y, w, h };
  }

  public hasSuperArmor(): boolean {
    if (this.action === 'super_startup' || this.action === 'super_active') return true;
    if (this.action === 'attack') {
      const m = this.getCurrentMove();
      if (m?.superArmor && this.actionFrames >= Math.floor(m.startup * 0.4)) return true;
    }
    if (this.action === 'charge' && this.chargeFrames > 22) return true;
    return false;
  }

  public addInk(amount: number): void {
    this.ink = clamp(this.ink + amount * this.inkGainMult, 0, this.maxInk);
  }

  public triggerKO(launchVx: number, launchVy: number): void {
    this.hp = 0;
    this.action = 'ko';
    this.actionFrames = 0;
    this.attackKind = null;
    this.ragdoll.spawnFromPose(this.skeleton.pose, launchVx, launchVy);
  }

  public update(
    dt: number,
    inp: InputState,
    opponent: Fighter,
    platforms: PlatformDef[],
    brokenPlatforms: Set<string>,
    sound: SoundEngine,
    cb: FighterCallbacks,
    canControl: boolean,
    worldWidth = WORLD_WIDTH,
    updraftZones?: UpdraftZone[]
  ): void {
    this.animPhase += dt;
    this.actionFrames++;

    // Delayed white/red damage bar easing
    if (this.delayedHp > this.hp) {
      this.delayedHp = Math.max(this.hp, this.delayedHp - 42 * dt);
    } else {
      this.delayedHp = this.hp;
    }

    // Cooldowns & timers
    if (this.dashCooldown > 0) this.dashCooldown--;
    if (this.dashInvulnFrames > 0) this.dashInvulnFrames--;
    if (this.perfectDodgeCooldown > 0) this.perfectDodgeCooldown--;
    if (this.invulnFrames > 0) this.invulnFrames--;
    if (this.parryWindowFrames > 0) this.parryWindowFrames--;
    if (this.comboWindowFrames > 0) this.comboWindowFrames--;
    if (this.hurtFlashFrames > 0) this.hurtFlashFrames--;
    if (this.dropThroughFrames > 0) this.dropThroughFrames--;

    // Guard meter recovery when not blocking
    if (this.action !== 'block' && this.action !== 'guard_break') {
      this.guardMeter = Math.min(100, this.guardMeter + 16 * dt);
    }

    // Update smear trail fade
    for (let i = this.smearTrail.length - 1; i >= 0; i--) {
      this.smearTrail[i].life -= dt;
      if (this.smearTrail[i].life <= 0) {
        this.smearTrail.splice(i, 1);
      }
    }

    // KO ragdoll path
    if (this.action === 'ko') {
      this.ragdoll.update(platforms, brokenPlatforms, worldWidth, (pos, spd) => {
        cb.onRagdollBounce(pos, spd, this.inkColor);
      });
      const rPose = this.ragdoll.toPose();
      this.pos.x = rPose.hip.x;
      this.pos.y = rPose.hip.y + 36;
      this.scarf.update(rPose.neck, this.facing, 0, this.animPhase);
      return;
    }

    // State machine logic
    if (canControl) {
      this.processStateMachine(dt, inp, opponent, sound, cb);
    } else if (this.action === 'run' || this.action === 'charge' || this.action === 'block') {
      this.action = 'idle';
      this.vel.x *= 0.8;
    }

    // Integrate physics
    this.integratePhysics(dt, platforms, brokenPlatforms, sound, cb, worldWidth, updraftZones);

    // Update procedural skeleton & scarf
    const move = this.getCurrentMove();
    let attackPhase: 'startup' | 'active' | 'recovery' = 'startup';
    let attackProgress = 0;
    if (move && (this.action === 'attack' || this.action === 'super_active')) {
      const total = Math.max(1, move.startup + move.active + move.recovery);
      attackProgress = clamp(this.actionFrames / total, 0, 1);
      if (this.actionFrames < move.startup) attackPhase = 'startup';
      else if (this.actionFrames < move.startup + move.active) attackPhase = 'active';
      else attackPhase = 'recovery';
    }

    const pose = this.skeleton.update(
      {
        pos: this.pos,
        vx: this.vel.x,
        vy: this.vel.y,
        facing: this.facing,
        action: this.action,
        actionTime: this.actionFrames / 60,
        animPhase: this.animPhase,
        weapon: this.weapon,
        attackKind: this.attackKind,
        attackProgress,
        attackPhase,
        chargeRatio: clamp(this.chargeFrames / this.maxChargeFrames, 0, 1),
        onGround: this.onGround,
      },
      dt
    );

    this.scarf.update(pose.neck, this.facing, this.vel.x, this.animPhase);

    // Record weapon smear during active frames or super
    if (
      (this.action === 'attack' && attackPhase === 'active') ||
      this.action === 'super_active'
    ) {
      const isHeavy = this.attackKind === 'heavy' || this.attackKind === 'super' || this.attackKind === 'light3';
      const smearCol =
        this.weapon === 'tape'
          ? '#ffffff'
          : this.weapon === 'highlighter'
            ? '#f5da22'
            : this.attackKind === 'super'
              ? this.scarfColor
              : this.inkColor;
      this.smearTrail.push({
        base: { ...pose.weaponBase },
        tip: { ...pose.weaponTip },
        life: isHeavy ? 0.17 : 0.11,
        maxLife: isHeavy ? 0.17 : 0.11,
        color: smearCol,
        heavy: isHeavy,
      });
      if ((this.weapon === 'cutter' || this.weapon === 'highlighter') && pose.offhandWeaponTip) {
        this.smearTrail.push({
          base: { ...pose.lHand },
          tip: { ...pose.offhandWeaponTip },
          life: 0.11,
          maxLife: 0.11,
          color: this.weapon === 'highlighter' ? '#ff62b0' : this.scarfColor,
          heavy: false,
        });
      }
    }
  }

  /**
   * Visual-only update for LAN Guest interpolation: keeps skeleton animation,
   * weapon smear trails, scarf cloth physics, and KO ragdoll running at full 60/120fps!
   */
  public updateVisualsOnly(
    dt: number,
    platforms: PlatformDef[],
    brokenPlatforms: Set<string>,
    worldWidth = WORLD_WIDTH
  ): void {
    this.animPhase += dt;
    for (let i = this.smearTrail.length - 1; i >= 0; i--) {
      this.smearTrail[i].life -= dt;
      if (this.smearTrail[i].life <= 0) {
        this.smearTrail.splice(i, 1);
      }
    }

    if (this.action === 'ko') {
      if (this.ragdoll.active) {
        this.ragdoll.update(platforms, brokenPlatforms, worldWidth, () => {});
        const rPose = this.ragdoll.toPose();
        this.scarf.update(rPose.neck, this.facing, 0, this.animPhase);
        return;
      }
    }

    const move = this.getCurrentMove();
    let attackPhase: 'startup' | 'active' | 'recovery' = 'startup';
    let attackProgress = 0;
    if (move && (this.action === 'attack' || this.action === 'super_active')) {
      const total = Math.max(1, move.startup + move.active + move.recovery);
      attackProgress = clamp(this.actionFrames / total, 0, 1);
      if (this.actionFrames < move.startup) attackPhase = 'startup';
      else if (this.actionFrames < move.startup + move.active) attackPhase = 'active';
      else attackPhase = 'recovery';
    }

    const pose = this.skeleton.update(
      {
        pos: this.pos,
        vx: this.vel.x,
        vy: this.vel.y,
        facing: this.facing,
        action: this.action,
        actionTime: this.actionFrames / 60,
        animPhase: this.animPhase,
        weapon: this.weapon,
        attackKind: this.attackKind,
        attackProgress,
        attackPhase,
        chargeRatio: clamp(this.chargeFrames / this.maxChargeFrames, 0, 1),
        onGround: this.onGround,
      },
      dt
    );

    this.scarf.update(pose.neck, this.facing, this.vel.x, this.animPhase);

    if (
      (this.action === 'attack' && attackPhase === 'active') ||
      this.action === 'super_active'
    ) {
      const isHeavy = this.attackKind === 'heavy' || this.attackKind === 'super' || this.attackKind === 'light3';
      const smearCol =
        this.weapon === 'tape'
          ? '#ffffff'
          : this.weapon === 'highlighter'
            ? '#f5da22'
            : this.attackKind === 'super'
              ? this.scarfColor
              : this.inkColor;
      this.smearTrail.push({
        base: { ...pose.weaponBase },
        tip: { ...pose.weaponTip },
        life: isHeavy ? 0.17 : 0.11,
        maxLife: isHeavy ? 0.17 : 0.11,
        color: smearCol,
        heavy: isHeavy,
      });
    }
  }

  private processStateMachine(
    dt: number,
    inp: InputState,
    opponent: Fighter,
    sound: SoundEngine,
    cb: FighterCallbacks
  ): void {
    const wDef = WEAPONS[this.weapon];
    const moveSpeed = 390 * wDef.speedMult * this.moveSpeedMult;
    this.lastAimAngle = inp.aimAngle ?? null;

    // 1. Hitstun / Guard Break / Knockdown
    if (this.action === 'hitstun' || this.action === 'guard_break') {
      this.hitstunFrames--;
      this.vel.x *= this.onGround ? 0.86 : 0.98;
      if (this.hitstunFrames <= 0) {
        this.comboReceived = 0;
        this.action = this.onGround ? 'idle' : 'fall';
        this.actionFrames = 0;
      }
      return;
    }

    if (this.action === 'knockdown') {
      this.vel.x *= 0.85;
      if (this.actionFrames > 32) {
        this.invulnFrames = 14; // brief wakeup invuln
        this.comboReceived = 0;
        this.action = 'idle';
        this.actionFrames = 0;
      }
      return;
    }

    // 2. Parry Success pose
    if (this.action === 'parry_success') {
      this.vel.x *= 0.82;
      if (this.actionFrames > 14) {
        this.action = 'idle';
        this.actionFrames = 0;
      }
      // Allow instant counter-attack cancel out of parry!
      if (this.actionFrames > 4 && (inp.lightPressed > 0 || inp.heavyPressed > 0 || inp.superPressed > 0)) {
        this.tryStartOffense(inp, opponent, sound, cb);
      }
      return;
    }

    // 3. Super Startup & Active
    if (this.action === 'super_startup') {
      this.vel.x *= 0.75;
      this.vel.y = 0;
      if (this.actionFrames >= 14) {
        this.action = 'super_active';
        this.actionFrames = 0;
        this.attackKind = 'super';
        this.attackHitIds.clear();
        this.vel.x = this.facing * 720;
        sound.playWhoosh(1.3);
        sound.playPaperTear();
        cb.onSpawnAfterimage(this, false);
      }
      return;
    }

    if (this.action === 'super_active') {
      const move = WEAPONS[this.weapon].moves.super;
      this.afterimageTimer += dt;
      if (this.afterimageTimer >= 0.032) {
        this.afterimageTimer = 0;
        cb.onSpawnAfterimage(this, false);
      }
      this.vel.x *= 0.88;
      this.vel.y *= 0.5;
      if (this.actionFrames >= move.active + move.recovery) {
        const moveDir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
        if (moveDir === 0) {
          this.vel.x *= 0.22;
          if (Math.abs(this.vel.x) < 35) this.vel.x = 0;
        } else {
          this.vel.x = clamp(this.vel.x, -moveSpeed, moveSpeed);
        }
        this.action = this.onGround ? 'idle' : 'fall';
        this.actionFrames = 0;
        this.attackKind = null;
      }
      return;
    }

    // 4. Dash
    if (this.action === 'dash') {
      this.afterimageTimer += dt;
      if (this.afterimageTimer >= 0.035) {
        this.afterimageTimer = 0;
        cb.onSpawnAfterimage(this, false);
      }
      // Dash cancel into attack after 5 frames for snappy dash-slash!
      if (this.actionFrames >= 5 && (inp.lightPressed > 0 || inp.heavyPressed > 0)) {
        this.tryStartOffense(inp, opponent, sound, cb);
        return;
      }
      if (this.actionFrames >= 12) {
        const moveDir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
        if (moveDir !== 0 && Math.sign(moveDir) === Math.sign(this.vel.x)) {
          this.vel.x = clamp(this.vel.x * 0.45, -moveSpeed, moveSpeed);
        } else {
          // Crisp brake when player isn't holding dash direction — no post-dash skating!
          this.vel.x *= 0.2;
          if (Math.abs(this.vel.x) < 35) this.vel.x = 0;
        }
        this.action = this.onGround ? 'idle' : 'fall';
        this.actionFrames = 0;
      }
      return;
    }

    // 5. Charging Heavy
    if (this.action === 'charge') {
      this.vel.x *= 0.78;
      this.chargeFrames = Math.min(this.maxChargeFrames, this.chargeFrames + 1);
      const ratio = this.chargeFrames / this.maxChargeFrames;
      this.chargeSoundTick++;
      if (this.chargeSoundTick % 7 === 1 || this.chargeFrames === this.maxChargeFrames) {
        sound.playChargeScribble(ratio);
      }
      // Auto-face mouse aim (if enabled) or opponent while charging
      if (inp.aimDir) {
        this.facing = inp.aimDir;
      } else if (Math.abs(opponent.pos.x - this.pos.x) > 10) {
        this.facing = opponent.pos.x >= this.pos.x ? 1 : -1;
      }
      // Release or max charge hold -> unleash heavy!
      if (!inp.heavy || this.chargeFrames >= this.maxChargeFrames + 14) {
        this.lastChargeRatio = ratio;
        this.startAttack('heavy', sound);
      } else if (inp.dashPressed > 0 && this.dashCooldown <= 0) {
        // Dash cancel out of charge!
        this.startDash(inp, sound, cb);
      }
      return;
    }

    // 6. Active Attack
    if (this.action === 'attack') {
      const move = this.getCurrentMove();
      if (!move) {
        this.action = 'idle';
        return;
      }

      // Apply forward lunge right as active starts
      if (this.actionFrames === move.startup) {
        if (!this.hasPlayedWhoosh) {
          this.hasPlayedWhoosh = true;
          if (this.weapon === 'whip') sound.playWhipCrack();
          else if (this.weapon === 'tape') sound.playTapeWheel();
          else if (this.weapon === 'compass') sound.playCompassScratch();
          else if (this.weapon === 'scissors') sound.playScissorsSnip();
          else if (this.weapon === 'cutter') sound.playCutterClick();
          else if (this.weapon === 'pencil') sound.playPencilClick();
          else if (this.weapon === 'ruler' && this.attackKind === 'heavy') sound.playRulerTwang();
          else if (this.weapon === 'stapler') sound.playStaplerSlam();
          else sound.playWhoosh(move.whooshWeight);
        }
        const chargeBoost = this.attackKind === 'heavy' ? 1 + this.lastChargeRatio * 0.28 : 1;
        this.vel.x = this.facing * move.lungeX * chargeBoost;
        if (move.lungeY) {
          this.vel.y = move.lungeY;
          this.onGround = false;
        }
        if (move.spawnsProjectile && !this.hasSpawnedProj) {
          this.hasSpawnedProj = true;
          // Keep fighter facing & projectile spawn origin aligned with active 360° aim
          if (this.lastAimAngle !== null) {
            const aimCos = Math.cos(this.lastAimAngle);
            if (Math.abs(aimCos) > 0.12) {
              this.facing = aimCos >= 0 ? 1 : -1;
            }
          }
          const spawnAng = this.lastAimAngle ?? (this.facing > 0 ? 0 : Math.PI);
          const spawnPos: Vec2 = {
            x: this.pos.x + Math.cos(spawnAng) * 44,
            y: this.pos.y - 46 + Math.sin(spawnAng) * 20,
          };
          cb.onSpawnProjectile(
            this,
            move.spawnsProjectile,
            spawnPos,
            this.facing,
            this.lastChargeRatio,
            this.lastAimAngle
          );
        }
      }

      // Multi-hit reset mid-active window
      if (move.multiHit && move.multiHit > 1) {
        const halfActive = Math.floor(move.active / 2);
        if (this.actionFrames === move.startup + halfActive && this.attackMultiHitStep === 0) {
          this.attackMultiHitStep = 1;
          this.attackHitIds.clear();
          sound.playWhoosh(move.whooshWeight * 0.8);
        }
      }

      // Crisp horizontal damping during both ground AND air attacks (prevents post-lunge skating!)
      this.vel.x *= this.onGround ? 0.78 : 0.9;

      // Buffer next combo step during active / recovery
      if (inp.lightPressed > 0 && this.actionFrames >= move.startup) {
        if (this.attackKind === 'light1') this.queuedCombo = 'light2';
        else if (this.attackKind === 'light2') this.queuedCombo = 'light3';
        inp.lightPressed = 0;
      }

      // Dash cancel during recovery on hit for stylish juggles
      if (
        this.actionFrames >= move.startup + move.active &&
        inp.dashPressed > 0 &&
        this.dashCooldown <= 0
      ) {
        this.startDash(inp, sound, cb);
        return;
      }

      // Transition to queued combo near start of recovery
      if (
        this.queuedCombo &&
        this.actionFrames >= move.startup + move.active + 2
      ) {
        const next = this.queuedCombo;
        this.queuedCombo = null;
        if (inp.aimDir) {
          this.facing = inp.aimDir;
        } else if (Math.abs(opponent.pos.x - this.pos.x) > 12) {
          this.facing = opponent.pos.x >= this.pos.x ? 1 : -1;
        }
        this.startAttack(next, sound);
        return;
      }

      // End of move
      if (this.actionFrames >= move.startup + move.active + move.recovery) {
        const moveDir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
        if (moveDir === 0) {
          // Stop cleanly right after move finishes so stickman never drifts forward/backward!
          this.vel.x *= 0.25;
          if (Math.abs(this.vel.x) < 35) this.vel.x = 0;
        }
        this.action = this.onGround ? 'idle' : 'fall';
        this.actionFrames = 0;
        this.attackKind = null;
        this.comboWindowFrames = 18;
      }
      return;
    }

    // 7. Blocking & Parry window
    if (this.action === 'block') {
      this.vel.x *= 0.78;
      if (inp.aimDir) {
        this.facing = inp.aimDir;
      } else if (Math.abs(opponent.pos.x - this.pos.x) > 12) {
        this.facing = opponent.pos.x >= this.pos.x ? 1 : -1;
      }
      if (!inp.block) {
        this.action = this.onGround ? 'idle' : 'fall';
        this.actionFrames = 0;
      } else if (inp.dashPressed > 0 && this.dashCooldown <= 0) {
        this.startDash(inp, sound, cb);
      }
      return;
    }

    // 8. Neutral states: idle / run / jump / fall / wallslide / crouch
    // Check Super first
    if (inp.superPressed > 0 && this.ink >= this.maxInk) {
      inp.superPressed = 0;
      this.startSuper(inp, opponent, sound, cb);
      return;
    }

    // Check Dash
    if (inp.dashPressed > 0 && this.dashCooldown <= 0) {
      this.startDash(inp, sound, cb);
      return;
    }

    // Check Block / Parry (ground only or quick air-guard)
    if (inp.blockPressed > 0 || (inp.block && this.onGround)) {
      if (inp.blockPressed > 0) {
        this.parryWindowFrames = 10; // ~166ms generous crisp parry timing!
        inp.blockPressed = 0;
      }
      this.action = 'block';
      this.actionFrames = 0;
      return;
    }

    // Check Offense (Light / Heavy)
    if (inp.lightPressed > 0 || inp.heavyPressed > 0) {
      this.tryStartOffense(inp, opponent, sound, cb);
      return;
    }

    // Horizontal Movement (supports mouse-aim facing override!)
    const moveDir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
    if (inp.aimDir) {
      this.facing = inp.aimDir;
    }
    if (moveDir !== 0) {
      const prevFacing = this.facing;
      if (!inp.aimDir) {
        this.facing = moveDir > 0 ? 1 : -1;
      }
      const accel = this.onGround ? 2800 : 1750;
      this.vel.x += moveDir * accel * dt;
      this.vel.x = clamp(this.vel.x, -moveSpeed, moveSpeed);

      // Paper skid sound & smudge when sharply reversing direction at speed!
      if (this.onGround && prevFacing !== this.facing && Math.abs(this.vel.x) > 150) {
        sound.playPaperSkid();
        cb.onSkidMark(this.pos, this.facing);
        cb.onSpawnDust(this.pos, -this.facing, 4);
      }
    } else {
      // Snappy neutral stopping friction — zero ice-skating drift after attacks or clashes!
      this.vel.x *= this.onGround ? 0.64 : 0.92;
      if (Math.abs(this.vel.x) < 18) this.vel.x = 0;
    }

    // Drop through one-way platform (Double-tap Down S×2/↓×2 OR Down + Jump!)
    if (
      this.onGround &&
      this.onOneWayPlatform &&
      (inp.dropThroughPressed > 0 || (inp.down && inp.jumpPressed > 0))
    ) {
      if (inp.dropThroughPressed > 0) {
        inp.dropThroughPressed = 0;
      } else {
        inp.jumpPressed = 0;
      }
      this.dropThroughFrames = 16;
      this.pos.y += 5;
      this.onGround = false;
      this.onOneWayPlatform = false;
      this.vel.y = 140;
      this.action = 'fall';
      this.actionFrames = 0;
      return;
    }

    // Jump / Double Jump / Wall-Kick!
    if (inp.jumpPressed > 0) {
      if (this.wallDir !== 0 && !this.onGround) {
        // Wall kick!
        inp.jumpPressed = 0;
        this.vel.x = -this.wallDir * 440;
        this.vel.y = -610;
        this.facing = (-this.wallDir) as 1 | -1;
        this.jumpsLeft = 1;
        this.wallDir = 0;
        this.action = 'jump';
        this.actionFrames = 0;
        sound.playJump(true);
        cb.onSpawnDust({ x: this.pos.x + this.facing * -14, y: this.pos.y - 36 }, this.facing, 6);
        return;
      } else if (this.onGround || this.coyoteFrames > 0) {
        inp.jumpPressed = 0;
        this.vel.y = -650;
        this.onGround = false;
        this.coyoteFrames = 0;
        this.jumpsLeft = 1;
        this.action = 'jump';
        this.actionFrames = 0;
        sound.playJump(false);
        cb.onSpawnDust(this.pos, -this.facing, 5);
        return;
      } else if (this.jumpsLeft > 0) {
        inp.jumpPressed = 0;
        this.vel.y = -580;
        this.jumpsLeft--;
        this.action = 'jump';
        this.actionFrames = 0;
        sound.playJump(false);
        cb.onSpawnDust(this.pos, 0, 6);
        return;
      }
    }

    // Assign neutral visual action
    if (this.onGround) {
      if (inp.down) {
        this.action = 'crouch';
        this.vel.x *= 0.76;
      } else if (moveDir !== 0 && Math.abs(this.vel.x) > 25) {
        // Only enter visual 'run' when directional movement is genuinely pressed!
        this.action = 'run';
        this.footstepTimer += dt;
        if (this.footstepTimer > 0.21) {
          this.footstepTimer = 0;
          sound.playFootstep(0.65);
          cb.onSpawnDust(this.pos, -this.facing, 2);
        }
      } else {
        this.action = 'idle';
      }
    } else {
      if (this.wallDir !== 0 && this.vel.y > 40) {
        this.action = 'wallslide';
      } else {
        this.action = this.vel.y < 0 ? 'jump' : 'fall';
      }
    }
  }

  private tryStartOffense(
    inp: InputState,
    opponent: Fighter,
    sound: SoundEngine,
    cb: FighterCallbacks
  ): void {
    if (inp.superPressed > 0 && this.ink >= this.maxInk) {
      inp.superPressed = 0;
      this.startSuper(inp, opponent, sound, cb);
      return;
    }

    // Face mouse cursor if Mouse Aim is active, otherwise directional key or auto-face opponent
    if (inp.aimDir) {
      this.facing = inp.aimDir;
    } else if (!inp.left && !inp.right && Math.abs(opponent.pos.x - this.pos.x) > 14) {
      this.facing = opponent.pos.x >= this.pos.x ? 1 : -1;
    } else if (inp.left && !inp.right) {
      this.facing = -1;
    } else if (inp.right && !inp.left) {
      this.facing = 1;
    }

    if (inp.heavyPressed > 0) {
      inp.heavyPressed = 0;
      if (this.onGround && inp.heavy) {
        this.action = 'charge';
        this.actionFrames = 0;
        this.chargeFrames = 0;
        this.chargeSoundTick = 0;
        this.lastChargeRatio = 0;
      } else {
        this.lastChargeRatio = 0.25;
        this.startAttack('heavy', sound);
      }
      return;
    }

    if (inp.lightPressed > 0) {
      inp.lightPressed = 0;
      if (!this.onGround) {
        this.startAttack('air_light', sound);
      } else if (inp.up) {
        this.startAttack('up_light', sound);
      } else {
        let kind: AttackKind = 'light1';
        if (this.comboWindowFrames > 0) {
          if (this.comboStep === 1) kind = 'light2';
          else if (this.comboStep === 2) kind = 'light3';
        }
        this.startAttack(kind, sound);
      }
    }
  }

  public startAttack(kind: AttackKind, sound: SoundEngine): void {
    this.action = 'attack';
    this.actionFrames = 0;
    this.attackKind = kind;
    this.attackHitIds.clear();
    this.attackMultiHitStep = 0;
    this.queuedCombo = null;
    this.hasPlayedWhoosh = false;
    this.hasSpawnedProj = false;

    if (kind === 'light1') this.comboStep = 1;
    else if (kind === 'light2') this.comboStep = 2;
    else this.comboStep = 0;

    if (kind === 'heavy') {
      this.activeHeavyCastId = `${this.uid}_hvy_${Math.floor(performance.now() * 10)}_${Math.floor(Math.random() * 1000)}`;
      const baseCap = this.weapon === 'scissors' || this.weapon === 'eraser' ? 24 : 21;
      this.activeHeavyCastCap = Math.round((baseCap + this.lastChargeRatio * 6) * this.damageMult);
      if (this.lastChargeRatio > 0.65) {
        sound.playPaperSkid();
      }
    } else {
      this.activeHeavyCastId = null;
      this.activeHeavyCastCap = 0;
    }
  }

  private startDash(inp: InputState, sound: SoundEngine, cb: FighterCallbacks): void {
    inp.dashPressed = 0;
    if (inp.left && !inp.right) this.facing = -1;
    else if (inp.right && !inp.left) this.facing = 1;
    else if (inp.aimDir) this.facing = inp.aimDir;

    this.action = 'dash';
    this.actionFrames = 0;
    this.attackKind = null;
    this.dashCooldown = Math.round(28 * this.dashCooldownMult);
    this.dashInvulnFrames = 10;
    this.vel.x = this.facing * 790;
    this.vel.y = this.onGround ? 0 : Math.min(this.vel.y, -40);
    this.afterimageTimer = 0;

    sound.playDash();
    cb.onSpawnAfterimage(this, true);
    cb.onSpawnDust(this.pos, -this.facing, 7);
    if (this.onGround) cb.onSkidMark(this.pos, this.facing);
  }

  private startSuper(inp: InputState, opponent: Fighter, sound: SoundEngine, cb: FighterCallbacks): void {
    this.ink = 0;
    if (inp.aimDir) {
      this.facing = inp.aimDir;
    } else if (inp.left && !inp.right) {
      this.facing = -1;
    } else if (inp.right && !inp.left) {
      this.facing = 1;
    } else if (Math.abs(opponent.pos.x - this.pos.x) > 10) {
      this.facing = opponent.pos.x >= this.pos.x ? 1 : -1;
    }
    this.lastAimAngle = inp.aimAngle ?? null;
    this.action = 'super_startup';
    this.actionFrames = 0;
    this.attackKind = 'super';
    this.attackHitIds.clear();
    this.invulnFrames = 34;
    this.vel.x = 0;
    this.vel.y = 0;
    const superCapTable: Record<WeaponId, number> = {
      compass: 40,
      tape: 38,
      ruler: 40,
      eraser: 42,
      cutter: 38,
      pencil: 38,
      whip: 39,
      boomerang: 38,
      scissors: 42,
      stapler: 38,
      highlighter: 38,
      fountain_pen: 42,
    };
    this.activeSuperCastId = `${this.uid}_sup_${Math.floor(performance.now() * 10)}_${Math.floor(Math.random() * 1000)}`;
    this.activeSuperCastCap = Math.round((superCapTable[this.weapon] ?? 40) * this.damageMult);
    sound.playSuperActivate();
    cb.onSuperTrigger(this);
  }

  private integratePhysics(
    dt: number,
    platforms: PlatformDef[],
    brokenPlatforms: Set<string>,
    sound: SoundEngine,
    cb: FighterCallbacks,
    worldWidth: number,
    updraftZones?: UpdraftZone[]
  ): void {
    const prevY = this.pos.y;
    const prevOnGround = this.onGround;

    // Gravity (gentler during wallslide or super)
    let gravity = 1750;
    if (this.action === 'wallslide') gravity = 520;
    else if (this.action === 'dash' || this.action === 'super_startup') gravity = 180;

    this.vel.y += gravity * dt;

    // Spine Canyon Wind Updraft Buoyancy!
    if (updraftZones) {
      for (const z of updraftZones) {
        if (
          this.pos.x >= z.x &&
          this.pos.x <= z.x + z.w &&
          this.pos.y >= z.y &&
          this.pos.y <= z.y + z.h
        ) {
          this.vel.y = Math.max(-520, this.vel.y - z.force * dt);
          this.jumpsLeft = Math.max(this.jumpsLeft, 1);
          this.onGround = false;
        }
      }
    }

    if (this.action === 'wallslide') {
      this.vel.y = Math.min(this.vel.y, 170);
    } else {
      this.vel.y = Math.min(this.vel.y, 1150);
    }

    this.pos.x += this.vel.x * dt;
    this.pos.y += this.vel.y * dt;

    // Wall detection (dynamic stage world bounds + pillars!)
    this.wallDir = 0;
    const leftBound = 68;
    const rightBound = worldWidth - 68;
    if (this.pos.x <= leftBound) {
      this.pos.x = leftBound;
      if (this.action === 'hitstun' && Math.abs(this.vel.x) > 340) {
        // Wall bounce on heavy knockback!
        this.vel.x = Math.abs(this.vel.x) * 0.55;
        this.vel.y = Math.min(this.vel.y, -220);
        sound.playHit(12, true);
        cb.onSpawnDust({ x: leftBound, y: this.pos.y - 40 }, 1, 8);
      } else {
        this.vel.x = Math.max(0, this.vel.x);
        this.wallDir = -1;
      }
    } else if (this.pos.x >= rightBound) {
      this.pos.x = rightBound;
      if (this.action === 'hitstun' && Math.abs(this.vel.x) > 340) {
        this.vel.x = -Math.abs(this.vel.x) * 0.55;
        this.vel.y = Math.min(this.vel.y, -220);
        sound.playHit(12, true);
        cb.onSpawnDust({ x: rightBound, y: this.pos.y - 40 }, -1, 8);
      } else {
        this.vel.x = Math.min(0, this.vel.x);
        this.wallDir = 1;
      }
    }

    // Bamboo pillar wall-kickable surfaces
    for (const p of platforms) {
      if (!p.pillar || brokenPlatforms.has(p.id)) continue;
      if (this.pos.y > p.y && this.pos.y - 76 < p.y + p.h) {
        if (Math.abs(this.pos.x - p.x) < 18 && !this.onGround) {
          this.wallDir = 1;
        } else if (Math.abs(this.pos.x - (p.x + p.w)) < 18 && !this.onGround) {
          this.wallDir = -1;
        }
      }
    }

    // Platform top collisions (including Rubber Eraser Bounce Pads & Elevators!)
    this.onGround = false;
    this.onOneWayPlatform = false;
    if (this.vel.y >= 0) {
      for (const p of platforms) {
        if (p.pillar || brokenPlatforms.has(p.id)) continue;
        if (p.oneWay && this.dropThroughFrames > 0) continue;
        if (this.pos.x + 14 >= p.x && this.pos.x - 14 <= p.x + p.w) {
          const snapTol = p.elevator ? 22 : 12;
          if (prevY <= p.y + snapTol && this.pos.y >= p.y - (p.elevator ? 6 : 0)) {
            if (p.bouncePad) {
              // High-elasticity Rubber Eraser Trampoline!
              this.pos.y = p.y;
              this.vel.y = -980;
              this.onGround = false;
              this.onOneWayPlatform = false;
              this.jumpsLeft = 2;
              this.action = 'jump';
              this.actionFrames = 0;
              sound.playBouncePad();
              cb.onBouncePad?.({ x: this.pos.x, y: p.y });
              break;
            }
            this.pos.y = p.y;
            if (!prevOnGround && this.vel.y > 260) {
              sound.playFootstep(Math.min(1.1, this.vel.y / 650));
              cb.onSpawnDust(this.pos, 0, 5);
            }
            this.vel.y = 0;
            this.onGround = true;
            this.onOneWayPlatform = Boolean(p.oneWay);
            this.jumpsLeft = 2;
            this.coyoteFrames = 6;
            break;
          }
        }
      }
    }

    if (!this.onGround && prevOnGround && this.coyoteFrames === 0) {
      this.coyoteFrames = 6;
    }
    if (!this.onGround && this.coyoteFrames > 0) {
      this.coyoteFrames--;
    }
  }
}
