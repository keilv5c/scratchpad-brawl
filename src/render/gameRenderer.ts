import { PaperTheme, StageDef, Vec2 } from '../types';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../config/stages';
import { WEAPONS } from '../config/weapons';
import { Camera } from '../engine/camera';
import { Fighter } from '../combat/fighter';
import { Projectile, getProjectileHitbox } from '../combat/projectiles';
import { ArenaObjectManager } from '../combat/arenaObjects';
import { PaperLayer } from './paperLayer';
import { FxManager } from './fx';
import {
  drawGiantPencil,
  drawOrigamiPlane,
  drawSketchedWeapon,
  drawSmearTrail,
  sketchCircle,
  sketchLine,
  sketchPolyline,
  sketchRect,
} from './sketch';

export interface RenderContextData {
  theme: PaperTheme;
  stage: StageDef;
  fighters: Fighter[];
  projectiles: Projectile[];
  arenaObjects: ArenaObjectManager;
  paper: PaperLayer;
  fx: FxManager;
  camera: Camera;
  boilFrame: number;
  time: number;
  viewW: number;
  viewH: number;
  showHitboxes: boolean;
  aimReticleWorld?: Vec2 | null;
  aimReticleOwnerIndex?: 0 | 1;
  stickAimIndicators?: Array<{ fighter: Fighter; angle: number }>;
}

export class GameRenderer {
  private cachedVig: CanvasGradient | null = null;
  private cachedVigW = 0;
  private cachedVigH = 0;

  public render(ctx: CanvasRenderingContext2D, data: RenderContextData): void {
    const {
      theme,
      stage,
      fighters,
      projectiles,
      arenaObjects,
      paper,
      fx,
      camera,
      boilFrame,
      time,
      viewW,
      viewH,
    } = data;
    // Controlled Soft Ink-Silhouette Impact Frame (ONLY for Supers / KOs / Cinema-mode Parries, with anti-strobe cooldown!)
    const isImpactInvert = fx.impactFrames > 0 && fx.impactInvert;

    ctx.save();
    // 1. Calm paper base clear (or deep sumi-e ink navy during brief Super/KO silhouette freeze)
    ctx.fillStyle = isImpactInvert ? '#141822' : theme.paperBg;
    ctx.fillRect(0, 0, viewW, viewH);

    // 2. Camera transform centered on real full-viewport (viewW × viewH)!
    ctx.save();
    ctx.translate(viewW * 0.5 + camera.offsetX, viewH * 0.5 + camera.offsetY);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    // Compute visible world viewport bounds for fast culling & partial paper blitting!
    const halfVisW = (viewW * 0.5) / Math.max(0.25, camera.zoom) + 96;
    const halfVisH = (viewH * 0.5) / Math.max(0.25, camera.zoom) + 96;
    const visLeft = camera.x - halfVisW;
    const visRight = camera.x + halfVisW;
    const visTop = camera.y - halfVisH;
    const visBottom = camera.y + halfVisH;

    // 3. Viewport-culled Paper Background + Persistent Battle-Damage Ink Stain Layer
    if (!isImpactInvert) {
      const sx = Math.max(0, Math.floor(visLeft));
      const sy = Math.max(0, Math.floor(visTop));
      const sw = Math.min(paper.worldW, Math.ceil(visRight)) - sx;
      const sh = Math.min(paper.worldH, Math.ceil(visBottom)) - sy;
      if (sw > 0 && sh > 0) {
        ctx.drawImage(paper.bgCanvas, sx, sy, sw, sh, sx, sy, sw, sh);
        ctx.drawImage(paper.stainCanvas, sx, sy, sw, sh, sx, sy, sw, sh);
      }
    }

    // 4. Super-Art Smooth Radial Spotlight Curtain (silky ease-in/out around the casting fighter!)
    const dimAlpha = fx.getSuperDimAlpha();
    if (dimAlpha > 0.005 && !isImpactInvert) {
      ctx.save();
      const sp = fx.superSpotlightPos;
      if (sp) {
        const spotGrad = ctx.createRadialGradient(sp.x, sp.y, 95, sp.x, sp.y, 440);
        spotGrad.addColorStop(0, `rgba(18, 20, 28, ${(dimAlpha * 0.12).toFixed(3)})`);
        spotGrad.addColorStop(0.55, `rgba(18, 20, 28, ${(dimAlpha * 0.62).toFixed(3)})`);
        spotGrad.addColorStop(1, `rgba(18, 20, 28, ${dimAlpha.toFixed(3)})`);
        ctx.fillStyle = spotGrad;
      } else {
        ctx.fillStyle = `rgba(18, 20, 28, ${dimAlpha.toFixed(3)})`;
      }
      ctx.fillRect(visLeft - 60, visTop - 60, visRight - visLeft + 120, visBottom - visTop + 120);
      ctx.restore();
    }

    // 5. Stage Backdrops (Updraft Wind Streams, Ship Hull & Sails), Platforms, Bridges, Elevators & Bounce Pads!
    this.drawStage(ctx, stage, theme, arenaObjects, boilFrame, time, isImpactInvert, visLeft, visRight);

    // 6. Doodle Crates, Highlighter Zone, Weapon Pickups & Ink Orbs
    this.drawArenaObjects(ctx, arenaObjects, theme, boilFrame, time, isImpactInvert);

    // 7. World FX behind fighters (afterimages, rings)
    fx.drawWorldFx(ctx);

    // 8. Fighters (shadows, smears, scarves, skeletal limbs, weapons, expressive head!)
    for (const f of fighters) {
      this.drawFighter(ctx, f, theme, boilFrame, time, isImpactInvert);
    }

    // 9. Projectiles & Boss Hazards
    for (const p of projectiles) {
      this.drawProjectile(ctx, p, boilFrame, time, isImpactInvert);
    }

    // 9.5 Rolling Calligraphy Ink Sea Waves in front of Ship Hull!
    if (stage.inkSeaY && !isImpactInvert) {
      this.drawInkSea(ctx, stage.worldWidth, stage.worldHeight, stage.inkSeaY, time);
    }

    // 10. Giant Artist Pencil drawing weapons/bridges onto the page!
    if (arenaObjects.pencil.active) {
      drawGiantPencil(ctx, arenaObjects.pencil.pos, boilFrame);
    }

    // 11. Training Mode Hitbox/Hurtbox Visualizer
    if (data.showHitboxes) {
      this.drawDebugBoxes(ctx, fighters, projectiles);
    }

    // 11.5 Hand-drawn ink aim reticle when Mouse Aim mode is enabled (supports P1 or P2)!
    if (data.aimReticleWorld) {
      const owner = fighters[data.aimReticleOwnerIndex ?? 0] ?? fighters[0];
      if (owner) {
        this.drawAimReticle(ctx, data.aimReticleWorld, owner, boilFrame, isImpactInvert);
      }
    }

    // 11.6 Hand-drawn pencil directional sightline when Gamepad Right-Stick 360° Aim is active!
    if (data.stickAimIndicators && data.stickAimIndicators.length > 0) {
      for (const ind of data.stickAimIndicators) {
        this.drawStickAimArrow(ctx, ind.fighter, ind.angle, boilFrame);
      }
    }

    ctx.restore(); // end camera transform

    // 12. Screen-space FX (Manga Speed-Lines & Red Teacher's K.O. Stamp)
    fx.drawScreenFx(ctx, viewW, viewH);

    // 13. Physical Page-Flip Transition across full viewport
    paper.drawPageFlipOverlay(ctx, viewW, viewH);

    // 14. Subtle paper-edge vignette (gradient cached per viewport size to avoid 60 FPS allocations!)
    if (!isImpactInvert) {
      if (!this.cachedVig || this.cachedVigW !== viewW || this.cachedVigH !== viewH) {
        const vig = ctx.createRadialGradient(
          viewW * 0.5,
          viewH * 0.5,
          Math.min(viewW, viewH) * 0.42,
          viewW * 0.5,
          viewH * 0.5,
          Math.max(viewW, viewH) * 0.72
        );
        vig.addColorStop(0, 'rgba(0,0,0,0)');
        vig.addColorStop(1, 'rgba(30,22,12,0.14)');
        this.cachedVig = vig;
        this.cachedVigW = viewW;
        this.cachedVigH = viewH;
      }
      ctx.fillStyle = this.cachedVig;
      ctx.fillRect(0, 0, viewW, viewH);
    }

    ctx.restore();
  }

  private drawInkSea(
    ctx: CanvasRenderingContext2D,
    worldW: number,
    worldH: number,
    seaY: number,
    time: number
  ): void {
    ctx.save();
    for (let layer = 0; layer < 2; layer++) {
      ctx.beginPath();
      const yOff = seaY + layer * 22;
      ctx.moveTo(-80, worldH + 80);
      for (let x = -80; x <= worldW + 80; x += 48) {
        const wave = Math.sin(x * 0.014 + time * (2.6 + layer * 0.9) + layer * 2) * (12 + layer * 5);
        ctx.lineTo(x, yOff + wave);
      }
      ctx.lineTo(worldW + 80, worldH + 80);
      ctx.closePath();
      ctx.fillStyle = layer === 0 ? 'rgba(20, 28, 38, 0.72)' : 'rgba(10, 14, 20, 0.88)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(250, 246, 236, 0.55)';
      ctx.lineWidth = 2.4;
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawStage(
    ctx: CanvasRenderingContext2D,
    stage: StageDef,
    theme: PaperTheme,
    arenaObjects: ArenaObjectManager,
    boilFrame: number,
    time: number,
    invert: boolean,
    visLeft = -Infinity,
    visRight = Infinity
  ): void {
    const strokeCol = invert ? '#ffffff' : theme.platformStroke;
    const fillCol = invert ? '#1a1c22' : theme.platformFill;

    // 0A. Updraft Wind Ribbons inside Spine Canyon (Double-Spread Stage)!
    if (stage.updraftZones && !invert) {
      ctx.save();
      for (const z of stage.updraftZones) {
        const grad = ctx.createLinearGradient(0, z.y + z.h, 0, z.y);
        grad.addColorStop(0, 'rgba(62, 142, 224, 0.22)');
        grad.addColorStop(1, 'rgba(62, 142, 224, 0.02)');
        ctx.fillStyle = grad;
        ctx.fillRect(z.x, z.y, z.w, z.h);

        ctx.strokeStyle = 'rgba(54, 126, 204, 0.45)';
        ctx.lineWidth = 2.2;
        for (let k = 0; k < 6; k++) {
          const sx = z.x + 28 + k * ((z.w - 56) / 5);
          const flow = ((time * 240 + k * 145) % z.h);
          const sy = z.y + z.h - flow;
          ctx.beginPath();
          ctx.moveTo(sx + Math.sin(time * 5 + k) * 8, sy);
          ctx.lineTo(sx - Math.sin(time * 5 + k) * 8, sy - 65);
          ctx.stroke();
        }

        ctx.fillStyle = 'rgba(34, 96, 172, 0.65)';
        ctx.font = 'bold 13px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('▲ 翻页上升气流 ▲', z.x + z.w * 0.5, z.y + z.h - 140);
      }
      ctx.restore();
    }

    // 0B. Origami Battleship Hull & Billowing Ink Sails (`ink_ship`)!
    if (stage.visualKind === 'sea' && !invert) {
      ctx.save();
      // Giant origami boat hull underneath main deck
      ctx.beginPath();
      ctx.moveTo(95, 668);
      ctx.lineTo(290, 740);
      ctx.lineTo(1710, 740);
      ctx.lineTo(1905, 668);
      ctx.lineTo(1760, 865);
      ctx.lineTo(240, 865);
      ctx.closePath();
      ctx.fillStyle = 'rgba(218, 206, 184, 0.85)';
      ctx.fill();
      ctx.strokeStyle = strokeCol;
      ctx.lineWidth = 4;
      ctx.stroke();

      // Billowing calligraphy sails behind twin masts
      for (const mx of [663, 1337]) {
        const puff = Math.sin(time * 2.5 + mx) * 14;
        ctx.beginPath();
        ctx.moveTo(mx, 275);
        ctx.quadraticCurveTo(mx + 130 + puff, 420, mx + 12, 548);
        ctx.lineTo(mx, 548);
        ctx.closePath();
        ctx.fillStyle = 'rgba(252, 249, 240, 0.68)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(28, 32, 40, 0.42)';
        ctx.lineWidth = 2.6;
        ctx.stroke();
      }
      ctx.restore();
    }

    // Draw torn chasm edge hint on bridge stage
    if (stage.id === 'bridge' && !invert) {
      ctx.save();
      ctx.strokeStyle = theme.inkSecondary;
      ctx.globalAlpha = 0.25;
      ctx.setLineDash([7, 7]);
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(385, 680);
      ctx.lineTo(385, stage.worldHeight);
      ctx.moveTo(1135, 680);
      ctx.lineTo(1135, stage.worldHeight);
      ctx.stroke();
      ctx.restore();
    }

    for (let i = 0; i < stage.platforms.length; i++) {
      const p = stage.platforms[i];
      if (p.x + p.w < visLeft - 40 || p.x > visRight + 40) continue;
      const bridgeState = p.breakable ? arenaObjects.bridges.get(p.id) : null;

      if (bridgeState && bridgeState.broken) {
        ctx.save();
        ctx.strokeStyle = invert ? '#ffffff' : theme.inkSecondary;
        ctx.globalAlpha = 0.35 + bridgeState.redrawProgress * 0.5;
        ctx.setLineDash([8, 6]);
        ctx.lineWidth = 2;
        const drawW = p.w * Math.max(0.15, bridgeState.redrawProgress);
        ctx.strokeRect(p.x, p.y, drawW, p.h);
        ctx.restore();
        continue;
      }

      ctx.save();
      ctx.strokeStyle = strokeCol;
      ctx.lineCap = 'round';

      if (p.bouncePad) {
        // High-Elasticity Pink/Blue Rubber Eraser Bounce Pad!
        const pulse = Math.sin(time * 7 + i) * 2;
        ctx.lineWidth = 3;
        sketchRect(ctx, p.x, p.y + pulse, p.w * 0.65, p.h - pulse, 410 + i, boilFrame, 1.3, '#f089a4');
        sketchRect(ctx, p.x + p.w * 0.65, p.y + pulse, p.w * 0.35, p.h - pulse, 420 + i, boilFrame, 1.3, '#4c86d6');
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 12px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('▲ 弹跳橡皮 ▲', p.x + p.w * 0.5, p.y + 17 + pulse);
      } else if (p.bookDecor) {
        // Giant Stacked Textbook / Dictionary / Ruler Platform!
        ctx.lineWidth = 3.2;
        sketchRect(ctx, p.x, p.y, p.w, p.h, 450 + i * 7, boilFrame, 1.3, p.bookDecor.spineColor);
        // White paper page strips along top edge
        ctx.fillStyle = '#faf7ef';
        ctx.fillRect(p.x + 8, p.y + 3, p.w - 16, 5);
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 14px "STKaiti", "KaiTi", serif';
        ctx.textAlign = 'center';
        ctx.fillText(p.bookDecor.title, p.x + p.w * 0.5, p.y + p.h * 0.68);
      } else if (p.elevator) {
        // Vertical Elevator Guide Rail + Origami Lift Platform!
        ctx.save();
        ctx.strokeStyle = 'rgba(42, 48, 60, 0.25)';
        ctx.setLineDash([6, 6]);
        ctx.lineWidth = 2;
        const railX = p.x + p.w * 0.5;
        ctx.beginPath();
        ctx.moveTo(railX, p.elevator.baseY - p.elevator.rangeY - 20);
        ctx.lineTo(railX, p.elevator.baseY + p.elevator.rangeY + 20);
        ctx.stroke();
        ctx.restore();
        ctx.lineWidth = 3;
        sketchRect(ctx, p.x, p.y, p.w, p.h, 480 + i, boilFrame, 1.3, '#f3e7c9', true);
        ctx.fillStyle = strokeCol;
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('▲▼ 升降台', p.x + p.w * 0.5, p.y + 13);
      } else if (p.origami) {
        drawOrigamiPlane(ctx, p.x, p.y, p.w, p.h, 190 + i * 21, boilFrame, strokeCol, fillCol);
      } else if (p.pillar) {
        // Ink Bamboo Pole with joint rings & little twigs!
        ctx.lineWidth = 3.2;
        sketchRect(ctx, p.x, p.y, p.w, p.h, 200 + i * 20, boilFrame, 1.4, fillCol, false);
        ctx.lineWidth = 2.6;
        for (let by = p.y + 44; by < p.y + p.h - 20; by += 54) {
          sketchLine(ctx, p.x - 3, by, p.x + p.w + 3, by, 250 + by, boilFrame, 1.0, 2);
          // Tiny sketched bamboo leaf off the node
          const side = by % 108 === 0 ? 1 : -1;
          sketchLine(
            ctx,
            p.x + (side > 0 ? p.w : 0),
            by,
            p.x + (side > 0 ? p.w + 22 : -22),
            by - 12,
            260 + by,
            boilFrame,
            1.1,
            1
          );
        }
      } else if (p.oneWay) {
        // Sleek hand-sketched floating shelf with batched diagonal under-hatching
        ctx.lineWidth = 3;
        sketchRect(ctx, p.x, p.y, p.w, p.h, 100 + i * 17, boilFrame, 1.5, fillCol, true, 'rgba(30,30,35,0.18)', visLeft, visRight);
        // Little sketch bracket supports underneath
        ctx.lineWidth = 2;
        sketchLine(ctx, p.x + 14, p.y + p.h, p.x + 6, p.y + p.h + 14, 150 + i, boilFrame, 1.0, 1);
        sketchLine(ctx, p.x + p.w - 14, p.y + p.h, p.x + p.w - 6, p.y + p.h + 14, 160 + i, boilFrame, 1.0, 1);
      } else {
        // Solid ground floor or breakable bridge plank (batched & viewport-culled hatching!)
        ctx.lineWidth = 3.6;
        sketchRect(ctx, p.x, p.y, p.w, p.h, 40 + i * 19, boilFrame, 1.6, fillCol, true, 'rgba(30,30,35,0.18)', visLeft, visRight);

        // Show sketch cracks on damaged breakable bridge!
        if (bridgeState && bridgeState.hp < 24) {
          ctx.strokeStyle = invert ? '#ff5555' : theme.hazardColor;
          ctx.lineWidth = 2.4;
          const cx = p.x + p.w * 0.5;
          sketchLine(ctx, cx - 18, p.y, cx + 6, p.y + p.h, 301 + i, boilFrame, 2.2, 2);
          sketchLine(ctx, cx + 16, p.y, cx - 8, p.y + p.h, 302 + i, boilFrame, 2.2, 2);
        }
      }

      ctx.restore();
    }
  }

  private drawArenaObjects(
    ctx: CanvasRenderingContext2D,
    arena: ArenaObjectManager,
    theme: PaperTheme,
    boilFrame: number,
    time: number,
    invert: boolean
  ): void {
    const stroke = invert ? '#ffffff' : theme.inkPrimary;

    // 0. Glowing Neon Yellow Highlighter Speed/Damage Zone!
    if (arena.highlighterZone.active && !invert) {
      const hz = arena.highlighterZone;
      ctx.save();
      ctx.fillStyle = hz.color;
      ctx.fillRect(hz.x, hz.y - 22, hz.w, 24);
      ctx.strokeStyle = 'rgba(204, 174, 18, 0.8)';
      ctx.lineWidth = 2;
      sketchLine(ctx, hz.x, hz.y - 22, hz.x + hz.w, hz.y - 22, 970, boilFrame, 1.4, 1);
      ctx.fillStyle = '#856c00';
      ctx.font = 'bold 12px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('⚡ 荧光笔增幅区 (+移速/+伤害)', hz.x + hz.w * 0.5, hz.y - 28);
      ctx.restore();
    }

    // 1. Doodle Crates
    for (let i = 0; i < arena.crates.length; i++) {
      const c = arena.crates[i];
      if (c.broken) continue;
      ctx.save();
      const jx = c.hitShake > 0 ? (Math.random() - 0.5) * 8 * c.hitShake : 0;
      const jy = c.hitShake > 0 ? (Math.random() - 0.5) * 6 * c.hitShake : 0;
      const x = c.pos.x - c.w * 0.5 + jx;
      const y = c.pos.y - c.h * 0.5 + jy;
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2.6;
      sketchRect(
        ctx,
        x,
        y,
        c.w,
        c.h,
        500 + i * 11,
        boilFrame,
        1.6,
        invert ? '#222' : 'rgba(222, 200, 165, 0.72)',
        false
      );
      // Cross planks inside crate
      sketchLine(ctx, x + 4, y + 4, x + c.w - 4, y + c.h - 4, 530 + i, boilFrame, 1.1, 1);
      sketchLine(ctx, x + c.w - 4, y + 4, x + 4, y + c.h - 4, 540 + i, boilFrame, 1.1, 1);
      ctx.restore();
    }

    // 2. Ink Orbs (refill super gauge)
    for (let i = 0; i < arena.orbs.length; i++) {
      const orb = arena.orbs[i];
      ctx.save();
      const pulse = 1 + Math.sin(time * 10 + i) * 0.16;
      ctx.strokeStyle = invert ? '#ffffff' : '#d62e2e';
      ctx.lineWidth = 2;
      sketchCircle(ctx, orb.pos.x, orb.pos.y, 7 * pulse, 610 + i, boilFrame, 0.9, '#191b22');
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(orb.pos.x - 2, orb.pos.y - 2, 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 3. Sketched Weapon Pickups (with glowing halo + tag!)
    for (let i = 0; i < arena.pickups.length; i++) {
      const pk = arena.pickups[i];
      const wDef = WEAPONS[pk.weapon];
      const bobY = Math.sin(pk.bobPhase) * 6;
      const cx = pk.pos.x;
      const cy = pk.pos.y + bobY;

      ctx.save();
      ctx.globalAlpha = Math.min(1, pk.sketchProgress);

      // Sketchy dashed aura ring
      ctx.strokeStyle = wDef.accentColor;
      ctx.lineWidth = 2;
      sketchCircle(ctx, cx, cy, 26 + Math.sin(pk.bobPhase * 1.4) * 3, 660 + i, boilFrame, 1.5);

      // Draw mini weapon icon horizontally
      const halfL = Math.min(34, wDef.length * 0.42);
      drawSketchedWeapon(
        ctx,
        pk.weapon,
        { x: cx - halfL * 0.55, y: cy + 8 },
        { x: cx + halfL * 0.85, y: cy - 10 },
        stroke,
        wDef.accentColor,
        680 + i,
        boilFrame
      );

      // Label underneath
      ctx.font = 'bold 12px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = stroke;
      ctx.fillText(wDef.name, cx, cy - 34);
      ctx.restore();
    }
  }

  private drawFighter(
    ctx: CanvasRenderingContext2D,
    f: Fighter,
    theme: PaperTheme,
    boilFrame: number,
    time: number,
    invert: boolean
  ): void {
    const pose = f.getPose();
    const dynamicScarf = f.rainbowSkin
      ? `hsl(${Math.floor((time * 160) % 360)}, 85%, 52%)`
      : f.scarfColor;
    // Soft warm-ivory silhouette + vibrant glowing scarf during brief Super/KO impact freeze!
    const bodyColor = invert ? '#faf6ec' : f.hurtFlashFrames > 0 ? '#d92828' : f.inkColor;
    const scarfCol = dynamicScarf;
    const seedBase = f.index === 0 ? 1000 : 2000 + (parseInt(f.uid.slice(2), 10) % 10) * 100;

    // 1. Soft sketched floor contact shadow
    if (!invert && f.action !== 'ko') {
      ctx.save();
      ctx.fillStyle = 'rgba(20, 22, 28, 0.16)';
      ctx.beginPath();
      ctx.ellipse(f.pos.x, f.pos.y + 2, 24, 5.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 2. Calligraphic Motion Smear Trail behind stickman!
    drawSmearTrail(ctx, f.smearTrail, boilFrame);

    // 3. Frantic Sketched Aura Lines during Heavy Charge or Full Super!
    if (f.action === 'charge' || (f.ink >= f.maxInk && f.action !== 'ko')) {
      const intensity = f.action === 'charge' ? 0.5 + (f.chargeFrames / f.maxChargeFrames) * 0.8 : 0.35;
      ctx.save();
      ctx.strokeStyle = f.action === 'charge' ? scarfCol : bodyColor;
      ctx.lineWidth = f.action === 'charge' ? 2.4 : 1.5;
      ctx.globalAlpha = 0.5 * intensity;
      const lines = f.action === 'charge' ? 12 : 6;
      for (let i = 0; i < lines; i++) {
        const ang = (i / lines) * Math.PI * 2 + time * 4;
        const r1 = 30 + (i % 3) * 8;
        const r2 = r1 + 16 + intensity * 22;
        sketchLine(
          ctx,
          pose.chest.x + Math.cos(ang) * r1,
          pose.chest.y + Math.sin(ang) * r1,
          pose.chest.x + Math.cos(ang) * r2,
          pose.chest.y + Math.sin(ang) * r2,
          seedBase + 90 + i,
          boilFrame,
          1.4,
          1
        );
      }
      ctx.restore();
    }

    // 4. Flowing Verlet Scarf / Martial Arts Headband!
    const scarfPts = f.scarf.getPoints();
    if (scarfPts.length >= 2) {
      ctx.save();
      ctx.strokeStyle = scarfCol;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 1; i < scarfPts.length; i++) {
        ctx.lineWidth = Math.max(2, 7.2 - i * 0.82);
        sketchLine(
          ctx,
          scarfPts[i - 1].x,
          scarfPts[i - 1].y,
          scarfPts[i].x,
          scarfPts[i].y,
          seedBase + 300 + i,
          boilFrame,
          1.1,
          1
        );
      }
      ctx.restore();
    }

    // 5. Stickman Articulated Skeleton (boiling double-pass hand-inked limbs!)
    ctx.save();
    ctx.strokeStyle = bodyColor;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Back limbs slightly thinner for crisp 2.5D readability
    ctx.lineWidth = 4.2;
    sketchLine(ctx, pose.hip.x, pose.hip.y, pose.lKnee.x, pose.lKnee.y, seedBase + 10, boilFrame, 1.3, 2);
    sketchLine(ctx, pose.lKnee.x, pose.lKnee.y, pose.lFoot.x, pose.lFoot.y, seedBase + 11, boilFrame, 1.3, 2);
    sketchLine(ctx, pose.lShoulder.x, pose.lShoulder.y, pose.lElbow.x, pose.lElbow.y, seedBase + 12, boilFrame, 1.2, 2);
    sketchLine(ctx, pose.lElbow.x, pose.lElbow.y, pose.lHand.x, pose.lHand.y, seedBase + 13, boilFrame, 1.2, 2);

    // Core spine
    ctx.lineWidth = 5.4;
    sketchLine(ctx, pose.neck.x, pose.neck.y, pose.hip.x, pose.hip.y, seedBase + 14, boilFrame, 1.2, 2);

    // Front limbs
    ctx.lineWidth = 4.6;
    sketchLine(ctx, pose.hip.x, pose.hip.y, pose.rKnee.x, pose.rKnee.y, seedBase + 15, boilFrame, 1.3, 2);
    sketchLine(ctx, pose.rKnee.x, pose.rKnee.y, pose.rFoot.x, pose.rFoot.y, seedBase + 16, boilFrame, 1.3, 2);
    sketchLine(ctx, pose.rShoulder.x, pose.rShoulder.y, pose.rElbow.x, pose.rElbow.y, seedBase + 17, boilFrame, 1.2, 2);
    sketchLine(ctx, pose.rElbow.x, pose.rElbow.y, pose.rHand.x, pose.rHand.y, seedBase + 18, boilFrame, 1.2, 2);

    // Expressive Hand-Drawn Stickman Head!
    const headR = f.isBoss ? 13 : 11.5;
    ctx.lineWidth = 4.2;
    sketchCircle(
      ctx,
      pose.head.x,
      pose.head.y,
      headR,
      seedBase + 20,
      boilFrame,
      1.1,
      invert ? '#0e0f13' : theme.paperBg
    );

    // Headband stripe across forehead
    ctx.strokeStyle = scarfCol;
    ctx.lineWidth = 3.5;
    sketchLine(
      ctx,
      pose.head.x - headR * 0.9,
      pose.head.y - 3,
      pose.head.x + headR * 0.9,
      pose.head.y - 3,
      seedBase + 25,
      boilFrame,
      0.7,
      1
    );

    // Boss gold ink crown doodle!
    if (f.isBoss) {
      ctx.strokeStyle = invert ? '#ffffff' : '#d99a1e';
      ctx.lineWidth = 2.6;
      const hx = pose.head.x;
      const hy = pose.head.y - headR - 2;
      sketchPolyline(
        ctx,
        [
          { x: hx - 10, y: hy },
          { x: hx - 8, y: hy - 10 },
          { x: hx - 2, y: hy - 4 },
          { x: hx, y: hy - 13 },
          { x: hx + 2, y: hy - 4 },
          { x: hx + 8, y: hy - 10 },
          { x: hx + 10, y: hy },
        ],
        seedBase + 28,
        boilFrame,
        0.7
      );
    }

    // Minimalist anime eyes/brows for huge personality!
    ctx.strokeStyle = bodyColor;
    ctx.lineWidth = 2.1;
    const ex = pose.head.x + f.facing * 4;
    const ey = pose.head.y + 1.5;
    if (f.action === 'ko' || f.action === 'hitstun') {
      // Classic manga X-eye!
      ctx.beginPath();
      ctx.moveTo(ex - 3, ey - 3); ctx.lineTo(ex + 3, ey + 3);
      ctx.moveTo(ex + 3, ey - 3); ctx.lineTo(ex - 3, ey + 3);
      ctx.stroke();
    } else if (f.action === 'charge' || f.action === 'super_startup' || f.action === 'super_active') {
      // Fierce glowing battle eye glint!
      ctx.fillStyle = scarfCol;
      ctx.beginPath();
      ctx.arc(ex, ey, 2.8, 0, Math.PI * 2);
      ctx.fill();
    }

    // 6. Equipped Hand-Sketched Weapon
    if (f.action !== 'ko') {
      drawSketchedWeapon(
        ctx,
        f.weapon,
        pose.weaponBase,
        pose.weaponTip,
        bodyColor,
        scarfCol,
        seedBase + 50,
        boilFrame,
        pose.lHand,
        pose.offhandWeaponTip
      );
    }

    // 7. Guard / Parry Sketch Shield Arc
    if (f.action === 'block') {
      const isParryWindow = f.parryWindowFrames > 0;
      ctx.strokeStyle = isParryWindow ? '#f2a918' : scarfCol;
      ctx.lineWidth = isParryWindow ? 4.2 : 2.6;
      ctx.globalAlpha = isParryWindow ? 0.95 : 0.6;
      const cx = pose.chest.x + f.facing * 26;
      const cy = pose.chest.y;
      ctx.beginPath();
      if (f.facing > 0) {
        ctx.arc(cx - 18, cy, 38, -Math.PI * 0.42, Math.PI * 0.42);
      } else {
        ctx.arc(cx + 18, cy, 38, Math.PI * 0.58, Math.PI * 1.42);
      }
      ctx.stroke();
    }

    // 8. Guard Break spinning dizzy stars
    if (f.action === 'guard_break') {
      ctx.strokeStyle = '#d93636';
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const a = time * 6 + (i * Math.PI * 2) / 3;
        const sx = pose.head.x + Math.cos(a) * 18;
        const sy = pose.head.y - 20 + Math.sin(a) * 6;
        ctx.beginPath();
        ctx.arc(sx, sy, 3.2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // 9. P1 / P2 / Minion tiny hand-drawn marker & mini HP bar in multi-enemy mode!
    if (!invert && f.action !== 'ko') {
      ctx.fillStyle = scarfCol;
      ctx.font = 'bold 12px "Microsoft YaHei", sans-serif';
      ctx.textAlign = 'center';
      const tag = f.index === 0 ? 'P1' : f.isBoss ? 'BOSS' : f.name.length <= 5 ? f.name : '敌';
      ctx.fillText(tag, pose.head.x, pose.head.y - 28);

      if (f.index === 1) {
        const bw = 42;
        const pct = Math.max(0, f.hp / f.maxHp);
        ctx.fillStyle = 'rgba(255,255,255,0.85)';
        ctx.fillRect(pose.head.x - bw * 0.5, pose.head.y - 24, bw, 5);
        ctx.fillStyle = scarfCol;
        ctx.fillRect(pose.head.x - bw * 0.5, pose.head.y - 24, bw * pct, 5);
        ctx.strokeStyle = bodyColor;
        ctx.lineWidth = 1.2;
        ctx.strokeRect(pose.head.x - bw * 0.5, pose.head.y - 24, bw, 5);
      }
    }

    ctx.restore();
  }

  private drawProjectile(
    ctx: CanvasRenderingContext2D,
    p: Projectile,
    boilFrame: number,
    time: number,
    invert: boolean
  ): void {
    const col = invert ? '#ffffff' : p.color;
    const acc = invert ? '#ffffff' : p.accent;
    ctx.save();

    if (p.kind === 'wave') {
      // Sweeping calligraphic crescent ink slash wave oriented along 360° aim angle!
      ctx.translate(p.pos.x, p.pos.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.moveTo(-14, -44);
      ctx.quadraticCurveTo(32, 0, -14, 44);
      ctx.quadraticCurveTo(10, 0, -14, -44);
      ctx.closePath();
      ctx.fill();

      ctx.strokeStyle = acc;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-10, -40);
      ctx.quadraticCurveTo(28, 0, -10, 40);
      ctx.stroke();
    } else if (p.kind === 'compass_arc') {
      // Geometry Compass Pencil Arc with dashed radius line & upright "r" annotation!
      ctx.translate(p.pos.x, p.pos.y);
      ctx.rotate(p.angle);
      ctx.strokeStyle = '#1f6fd4';
      ctx.lineWidth = 4.5;
      ctx.beginPath();
      ctx.arc(-18, 0, 46, -0.95, 0.95);
      ctx.stroke();
      ctx.strokeStyle = col;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.moveTo(-18, 0);
      ctx.lineTo(28, 0);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.save();
      const leftFacing = Math.cos(p.angle) < 0;
      if (leftFacing) {
        ctx.scale(-1, -1);
      }
      ctx.fillStyle = '#1f6fd4';
      ctx.font = 'italic bold 14px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText('r', leftFacing ? -5 : 5, -6);
      ctx.restore();
    } else if (p.kind === 'whiteout_beam') {
      // Crisp Snow-White Correction Tape Strip with blue plastic trim & upright label!
      ctx.translate(p.pos.x, p.pos.y);
      ctx.rotate(p.angle);
      ctx.fillStyle = '#ffffff';
      ctx.strokeStyle = '#2685d9';
      ctx.lineWidth = 2.8;
      ctx.fillRect(-46, -13, 92, 26);
      ctx.strokeRect(-46, -13, 92, 26);
      ctx.save();
      if (Math.cos(p.angle) < 0) {
        ctx.scale(-1, -1);
      }
      ctx.fillStyle = '#2685d9';
      ctx.font = 'bold 11px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('WHITE-OUT', 0, 4);
      ctx.restore();
    } else if (p.kind === 'staple_bolt') {
      // Metallic U-Shaped Office Staple flying fast!
      ctx.translate(p.pos.x, p.pos.y);
      ctx.rotate(p.angle);
      ctx.strokeStyle = '#2b3446';
      ctx.lineWidth = 3.5;
      ctx.beginPath();
      ctx.moveTo(-12, -8);
      ctx.lineTo(10, -8);
      ctx.lineTo(10, 8);
      ctx.lineTo(-12, 8);
      ctx.stroke();
    } else if (p.kind === 'ink_bomb') {
      // Glossy Fountain-Pen Ink Blob Grenade!
      ctx.translate(p.pos.x, p.pos.y);
      ctx.fillStyle = col;
      ctx.strokeStyle = acc;
      ctx.lineWidth = 2.8;
      sketchCircle(ctx, 0, 0, 16, 988, boilFrame, 2.2, col);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(-5, -5, 3.5, 0, Math.PI * 2);
      ctx.fill();
    } else if (p.kind === 'boomerang') {
      // Rapidly spinning translucent draftsman set-square triangle!
      ctx.translate(p.pos.x, p.pos.y);
      ctx.rotate(time * 22 * p.facing);
      ctx.beginPath();
      ctx.moveTo(-24, -20);
      ctx.lineTo(28, 0);
      ctx.lineTo(-18, 24);
      ctx.closePath();
      ctx.fillStyle = invert ? '#ffffff' : 'rgba(38, 180, 206, 0.42)';
      ctx.fill();
      ctx.strokeStyle = col;
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-10, -8);
      ctx.lineTo(10, 0);
      ctx.lineTo(-7, 10);
      ctx.closePath();
      ctx.strokeStyle = acc;
      ctx.lineWidth = 2;
      ctx.stroke();
    } else if (p.kind === 'echo_bomb') {
      // Pulsing sketched ink bomb left by dash afterimage!
      const tele = p.telegraphTime ?? 0;
      const pulse = 1 + Math.sin(time * 36) * 0.2;
      ctx.strokeStyle = acc;
      ctx.lineWidth = 2.6;
      sketchCircle(ctx, p.pos.x, p.pos.y, tele > 0 ? 18 * pulse : 58, 921, boilFrame, 1.5, tele > 0 ? 'rgba(214,47,47,0.22)' : 'rgba(214,47,47,0.5)');
      if (tele > 0) {
        ctx.fillStyle = acc;
        ctx.font = 'bold 13px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('爆', p.pos.x, p.pos.y + 4);
      }
    } else if (p.kind === 'falling_pin') {
      // Giant falling red-capped thumbtack!
      ctx.translate(p.pos.x, p.pos.y);
      ctx.fillStyle = acc;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.ellipse(0, -18, 13, 6, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-4, -12);
      ctx.lineTo(0, 22);
      ctx.lineTo(4, -12);
      ctx.closePath();
      ctx.fillStyle = col;
      ctx.fill();
    } else if (p.kind === 'ink_pillar') {
      const tele = p.telegraphTime ?? 0;
      if (tele > 0) {
        ctx.strokeStyle = acc;
        ctx.lineWidth = 3;
        sketchLine(ctx, p.pos.x - 28, p.pos.y - 3, p.pos.x + 28, p.pos.y - 3, 931, boilFrame, 2, 2);
      } else {
        ctx.fillStyle = col;
        ctx.strokeStyle = acc;
        ctx.lineWidth = 3.5;
        sketchRect(ctx, p.pos.x - 26, p.pos.y - p.height, 52, p.height, 932, boilFrame, 2.2, col);
      }
    } else if (p.kind === 'stapler_hazard') {
      // Giant Office Desk Stapler slamming down from above!
      const tele = p.telegraphTime ?? 0;
      if (tele > 0) {
        ctx.strokeStyle = '#d92828';
        ctx.lineWidth = 3;
        ctx.setLineDash([7, 5]);
        ctx.strokeRect(p.pos.x - 48, p.pos.y - 84, 96, 84);
        ctx.setLineDash([]);
        ctx.fillStyle = '#d92828';
        ctx.font = 'bold 14px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('⚠ 巨型订书机空投!', p.pos.x, p.pos.y - 94);
      } else {
        ctx.strokeStyle = '#181a20';
        ctx.lineWidth = 3.2;
        sketchRect(ctx, p.pos.x - 48, p.pos.y - 26, 96, 26, 941, boilFrame, 1.4, '#3a4254');
        sketchRect(ctx, p.pos.x - 44, p.pos.y - 62, 88, 32, 942, boilFrame, 1.4, '#d93636');
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('STAPLER', p.pos.x, p.pos.y - 42);
      }
    } else if (p.kind === 'shuriken') {
      // High-speed Red-Capped Stationery Pushpin / Thumbtack flying needle-first along p.angle!
      ctx.translate(p.pos.x, p.pos.y);
      ctx.rotate(p.angle);

      const pinRed = invert ? '#ffffff' : '#e02f2f';
      const pinSteel = invert ? '#ffffff' : '#dde5f0';

      // Crisp aerodynamic speed lines trailing behind the thumbtack cap
      ctx.strokeStyle = pinRed;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.moveTo(-18, -6);
      ctx.lineTo(-30, -6);
      ctx.moveTo(-20, 0);
      ctx.lineTo(-34, 0);
      ctx.moveTo(-18, 6);
      ctx.lineTo(-30, 6);
      ctx.stroke();
      ctx.globalAlpha = 1;

      // Gleaming tapered silver steel needle pointing forward (+X)
      ctx.fillStyle = pinSteel;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.1;
      ctx.beginPath();
      ctx.moveTo(-2, -3.2);
      ctx.lineTo(22, 0);
      ctx.lineTo(-2, 3.2);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();

      // Classic pushpin hourglass red plastic cap (flange + grip waist + rear button)
      ctx.fillStyle = pinRed;
      ctx.strokeStyle = col;
      ctx.lineWidth = 2.2;
      // Front flange disk
      ctx.beginPath();
      ctx.ellipse(-3, 0, 3.8, 9.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      // Grip neck + rear thumb cap
      ctx.beginPath();
      ctx.roundRect(-14, -5.2, 11, 10.4, 2.5);
      ctx.fill();
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(-14.5, 0, 3.2, 8.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Glossy specular highlight on the red cap
      if (!invert) {
        ctx.fillStyle = 'rgba(255, 255, 255, 0.72)';
        ctx.beginPath();
        ctx.ellipse(-9, -3.2, 3.4, 1.4, 0, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (p.kind === 'shockwave') {
      // Rolling ground ink fissure wave!
      ctx.translate(p.pos.x, p.pos.y);
      ctx.scale(p.facing, 1);
      ctx.fillStyle = col;
      ctx.strokeStyle = acc;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(-34, 16);
      ctx.lineTo(-10, -28);
      ctx.lineTo(8, -10);
      ctx.lineTo(28, -36);
      ctx.lineTo(36, 16);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    } else if (p.kind === 'boss_spike') {
      const tele = p.telegraphTime ?? 0;
      if (tele > 0) {
        // Urgent red pencil warning X & bubbling ink pool on ground!
        const pulse = 0.5 + 0.5 * Math.sin(time * 32);
        ctx.strokeStyle = '#d92828';
        ctx.lineWidth = 3;
        ctx.globalAlpha = 0.5 + pulse * 0.5;
        sketchLine(ctx, p.pos.x - 24, p.pos.y - 4, p.pos.x + 24, p.pos.y - 4, 801, boilFrame, 2.2, 2);
        sketchLine(ctx, p.pos.x - 14, p.pos.y - 26, p.pos.x + 14, p.pos.y - 6, 802, boilFrame, 1.5, 1);
        sketchLine(ctx, p.pos.x + 14, p.pos.y - 26, p.pos.x - 14, p.pos.y - 6, 803, boilFrame, 1.5, 1);
      } else {
        // Erupting giant black fountain-pen nib ink spike!
        const grow = Math.min(1, (p.maxLife - p.life - 0.62) * 9);
        const h = p.height * Math.max(0.2, grow);
        ctx.fillStyle = col;
        ctx.strokeStyle = acc;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(p.pos.x - 22, p.pos.y);
        ctx.lineTo(p.pos.x - 10, p.pos.y - h * 0.65);
        ctx.lineTo(p.pos.x, p.pos.y - h);
        ctx.lineTo(p.pos.x + 10, p.pos.y - h * 0.65);
        ctx.lineTo(p.pos.x + 22, p.pos.y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
    } else if (p.kind === 'boss_eraser') {
      // Giant Classic Two-Tone Pink/Blue Rubber Eraser sweeping across the page!
      ctx.translate(p.pos.x, p.pos.y);
      ctx.rotate(Math.sin(time * 24) * 0.08);
      ctx.strokeStyle = '#181a20';
      ctx.lineWidth = 3;
      sketchRect(ctx, -45, -28, 60, 56, 880, boilFrame, 1.4, '#f089a4');
      sketchRect(ctx, 15, -28, 30, 56, 881, boilFrame, 1.4, '#4c86d6');
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('ERASER', -14, 4);
    }

    ctx.restore();
  }

  private drawDebugBoxes(
    ctx: CanvasRenderingContext2D,
    fighters: Fighter[],
    projectiles: Projectile[]
  ): void {
    ctx.save();
    ctx.lineWidth = 2;
    for (const f of fighters) {
      const hb = f.getHurtbox();
      ctx.strokeStyle = 'rgba(30, 180, 90, 0.85)';
      ctx.strokeRect(hb.x, hb.y, hb.w, hb.h);

      const ab = f.getActiveAttackHitbox();
      if (ab) {
        ctx.strokeStyle = 'rgba(235, 35, 35, 0.95)';
        ctx.fillStyle = 'rgba(235, 35, 35, 0.22)';
        ctx.fillRect(ab.x, ab.y, ab.w, ab.h);
        ctx.strokeRect(ab.x, ab.y, ab.w, ab.h);
      }
    }
    for (const p of projectiles) {
      const pb = getProjectileHitbox(p);
      if (pb) {
        ctx.strokeStyle = 'rgba(240, 140, 15, 0.9)';
        ctx.strokeRect(pb.x, pb.y, pb.w, pb.h);
      }
    }
    ctx.restore();
  }

  private drawAimReticle(
    ctx: CanvasRenderingContext2D,
    pos: Vec2,
    p1: Fighter,
    boilFrame: number,
    invert: boolean
  ): void {
    const col = invert ? '#ffffff' : p1.scarfColor;
    ctx.save();
    ctx.strokeStyle = col;
    ctx.fillStyle = col;
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.85;

    // Subtle dashed aim sightline hint near reticle
    sketchCircle(ctx, pos.x, pos.y, 11, 955, boilFrame, 0.9);
    sketchLine(ctx, pos.x - 16, pos.y, pos.x - 6, pos.y, 956, boilFrame, 0.5, 1);
    sketchLine(ctx, pos.x + 6, pos.y, pos.x + 16, pos.y, 957, boilFrame, 0.5, 1);
    sketchLine(ctx, pos.x, pos.y - 16, pos.x, pos.y - 6, 958, boilFrame, 0.5, 1);
    sketchLine(ctx, pos.x, pos.y + 6, pos.x, pos.y + 16, 959, boilFrame, 0.5, 1);

    // Center ink dot
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 2.4, 0, Math.PI * 2);
    ctx.fill();

    // Small directional chevron pointing from owner toward reticle
    const dir = pos.x >= p1.pos.x ? 1 : -1;
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(dir > 0 ? '▶' : '◀', pos.x + dir * 22, pos.y + 4);
    ctx.restore();
  }

  private drawStickAimArrow(
    ctx: CanvasRenderingContext2D,
    f: Fighter,
    angle: number,
    boilFrame: number
  ): void {
    if (f.action === 'ko') return;
    const cx = f.pos.x;
    const cy = f.pos.y - 46;
    const rStart = 42;
    const rEnd = 104;
    const sx = cx + Math.cos(angle) * rStart;
    const sy = cy + Math.sin(angle) * rStart;
    const ex = cx + Math.cos(angle) * rEnd;
    const ey = cy + Math.sin(angle) * rEnd;

    ctx.save();
    ctx.strokeStyle = f.scarfColor;
    ctx.fillStyle = f.scarfColor;
    ctx.globalAlpha = 0.78;
    ctx.lineWidth = 2.4;
    ctx.setLineDash([6, 5]);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    ctx.setLineDash([]);

    // Small hand-drawn arrowhead tip
    const headLen = 11;
    const a1 = angle + Math.PI * 0.82;
    const a2 = angle - Math.PI * 0.82;
    sketchLine(ctx, ex, ey, ex + Math.cos(a1) * headLen, ey + Math.sin(a1) * headLen, 961 + f.index, boilFrame, 0.5, 1);
    sketchLine(ctx, ex, ey, ex + Math.cos(a2) * headLen, ey + Math.sin(a2) * headLen, 963 + f.index, boilFrame, 0.5, 1);

    ctx.beginPath();
    ctx.arc(ex, ey, 3.2, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/**
 * Generates a framed Hand-Drawn Manga Panel PNG Snapshot of the exact KO moment!
 */
export function buildKoComicSnapshot(
  sourceCanvas: HTMLCanvasElement,
  winnerName: string,
  stampText: string
): string {
  const out = document.createElement('canvas');
  out.width = 640;
  out.height = 360;
  const ctx = out.getContext('2d')!;

  ctx.fillStyle = '#f7f3e8';
  ctx.fillRect(0, 0, out.width, out.height);

  // Draw crisp snapshot inside manga margin
  ctx.drawImage(sourceCanvas, 12, 12, out.width - 24, out.height - 24);

  // Thick ink comic panel border
  ctx.strokeStyle = '#14161c';
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, out.width - 20, out.height - 20);

  // Bottom-left sketchy title caption tag
  ctx.fillStyle = 'rgba(252, 249, 240, 0.94)';
  ctx.fillRect(22, out.height - 54, 240, 32);
  ctx.strokeStyle = '#14161c';
  ctx.lineWidth = 2.5;
  ctx.strokeRect(22, out.height - 54, 240, 32);
  ctx.fillStyle = '#14161c';
  ctx.font = 'bold 16px "STKaiti", "KaiTi", serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(`草稿纸瞬间 · ${winnerName}`, 32, out.height - 38);

  // Top-right red stamp badge
  ctx.save();
  ctx.translate(out.width - 82, 56);
  ctx.rotate(0.14);
  ctx.strokeStyle = '#cc2222';
  ctx.lineWidth = 3.5;
  ctx.beginPath();
  ctx.ellipse(0, 0, 52, 26, 0, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#cc2222';
  ctx.font = '900 24px "STKaiti", "KaiTi", serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(stampText, 0, 0);
  ctx.restore();

  return out.toDataURL('image/png');
}
