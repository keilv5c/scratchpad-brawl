import { FxIntensity, PlatformDef, Vec2 } from '../types';
import { Camera } from '../engine/camera';
import { StickmanPose } from '../physics/skeleton';
import { MATH_OPERATORS } from './mathSchools';
import {
  FloatingOperatorPickup,
  GridWarp,
  MathCutInBanner,
  MathEntity,
  MathOperatorId,
  MathParticle,
  MathPopText,
  MathSchoolId,
  MathThemePalette,
} from './mathTypes';

export interface MathPlatformDef extends PlatformDef {
  label?: string;
}

export interface MathFighterRenderState {
  index: 0 | 1;
  name: string;
  isBoss: boolean;
  isVersusP2: boolean;
  pos: Vec2;
  facing: 1 | -1;
  school: MathSchoolId;
  color: string;
  secondaryColor: string;
  action: string;
  parryWindowFrames: number;
  hurtFlashFrames: number;
  shieldTimer: number;
  derivHasteTimer: number;
  polyDegree: number;
  operators: MathOperatorId[];
  comboStep: number;
  pose: StickmanPose;
  scarfPoints: Vec2[];
  afterimages: Array<{ pose: StickmanPose; color: string; life: number; maxLife: number }>;
  smears: Array<{ base: Vec2; tip: Vec2; color: string; life: number; maxLife: number; heavy: boolean }>;
}

export interface MathRenderFrameData {
  theme: MathThemePalette;
  worldWidth: number;
  worldHeight: number;
  floorY: number;
  platforms: MathPlatformDef[];
  fighters: MathFighterRenderState[];
  entities: MathEntity[];
  pickups: FloatingOperatorPickup[];
  warps: GridWarp[];
  particles: MathParticle[];
  popTexts: MathPopText[];
  cutIn: MathCutInBanner;
  dimAlpha: number;
  spotlightPos: Vec2 | null;
  fxIntensity: FxIntensity;
  camera: Camera;
  time: number;
  viewW: number;
  viewH: number;
  aimReticleWorld: Vec2 | null;
  aimReticleOwner: 0 | 1;
  stickAimIndicators: Array<{ pos: Vec2; angle: number; color: string }>;
}

// Precomputed 4D Tesseract (Hypercube) 16 vertices & 32 edges in R^4
const TESSERACT_VERTS: Array<[number, number, number, number]> = [];
for (let i = 0; i < 16; i++) {
  TESSERACT_VERTS.push([
    i & 1 ? 1 : -1,
    i & 2 ? 1 : -1,
    i & 4 ? 1 : -1,
    i & 8 ? 1 : -1,
  ]);
}
const TESSERACT_EDGES: Array<[number, number]> = [];
for (let i = 0; i < 16; i++) {
  for (let bit = 0; bit < 4; bit++) {
    const j = i ^ (1 << bit);
    if (j > i) TESSERACT_EDGES.push([i, j]);
  }
}

const POLY_LABELS = ['0!', '6', '6x', '3x²', 'x³'];
const MATH_SERIF = '"Cambria Math", "Times New Roman", Georgia, serif';
const UI_SANS = '"PingFang SC", "Noto Sans SC", "Microsoft YaHei", sans-serif';
const CJK_RE = /[\u4e00-\u9fff]/;
const NUM_DMG_RE = /^[−+-]?\d/;

/**
 * Resolves a math stroke color cleanly for dark black void vs light white stage.
 */
function inkStroke(theme: MathThemePalette, preferred?: string): string {
  if (!theme.isLight) {
    return preferred || '#ffffff';
  }
  if (!preferred || preferred === '#ffffff' || preferred === '#e6f0ff' || preferred === '#d8d8d8') {
    return '#141418';
  }
  if (preferred === '#ff7a1a') return '#d95800';
  if (preferred === '#f2c14e') return '#b87600';
  if (preferred === '#8ec5ff' || preferred === '#a8b8ff' || preferred === '#b8c8ff') return '#2b5ca8';
  return preferred;
}

export class MathRenderer {
  // Offscreen sprite cache for math particle glyphs: eliminates per-frame ctx.font & DirectWrite CPU stalls!
  private glyphCache = new Map<string, HTMLCanvasElement>();
  private warpOut: Vec2 = { x: 0, y: 0 };

  private getGlyphSprite(glyph: string, color: string): HTMLCanvasElement | null {
    if (typeof document === 'undefined') return null;
    const key = `${glyph}|${color}`;
    let cvs = this.glyphCache.get(key);
    if (cvs) return cvs;
    if (this.glyphCache.size > 96) this.glyphCache.clear();
    cvs = document.createElement('canvas');
    cvs.width = 40;
    cvs.height = 40;
    const c = cvs.getContext('2d');
    if (!c) return null;
    c.fillStyle = color;
    c.font = `italic 600 24px ${MATH_SERIF}`;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(glyph, 20, 20);
    this.glyphCache.set(key, cvs);
    return cvs;
  }

  public render(ctx: CanvasRenderingContext2D, data: MathRenderFrameData): void {
    const {
      theme,
      worldWidth,
      worldHeight,
      floorY,
      platforms,
      fighters,
      entities,
      pickups,
      warps,
      particles,
      popTexts,
      cutIn,
      dimAlpha,
      spotlightPos,
      camera,
      time,
      viewW,
      viewH,
      aimReticleWorld,
      stickAimIndicators,
    } = data;

    // 1. Flat Matte Alan Becker Void (Pure Black #08080a or Pure White Stage #f7f7f4)
    ctx.fillStyle = theme.bgTop;
    ctx.fillRect(0, 0, viewW, viewH);

    // 2. World-Space Coordinate Plane & Combat Layer
    ctx.save();
    ctx.translate(viewW * 0.5 + camera.offsetX, viewH * 0.5 + camera.offsetY);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.x, -camera.y);

    this.drawCoordinateSpace(ctx, theme, worldWidth, worldHeight, floorY, warps, time);
    this.drawPlatforms(ctx, theme, platforms, floorY);

    // Subtle Radial Focus Curtain during Supers (Zero-Strobe!)
    if (dimAlpha > 0.01) {
      ctx.save();
      const rgb = theme.isLight ? '20, 20, 24' : '0, 0, 0';
      if (spotlightPos) {
        const g = ctx.createRadialGradient(
          spotlightPos.x,
          spotlightPos.y,
          80,
          spotlightPos.x,
          spotlightPos.y,
          560
        );
        g.addColorStop(0, `rgba(${rgb}, ${(dimAlpha * 0.1).toFixed(3)})`);
        g.addColorStop(0.55, `rgba(${rgb}, ${(dimAlpha * 0.55).toFixed(3)})`);
        g.addColorStop(1, `rgba(${rgb}, ${(dimAlpha * 0.85).toFixed(3)})`);
        ctx.fillStyle = g;
      } else {
        ctx.fillStyle = `rgba(${rgb}, ${(dimAlpha * 0.7).toFixed(3)})`;
      }
      ctx.fillRect(-300, -300, worldWidth + 600, worldHeight + 600);
      ctx.restore();
    }

    // Background Large Super Math Constructs
    for (const ent of entities) {
      if (
        ent.kind === 'euler_plane' ||
        ent.kind === 'golden_grid' ||
        ent.kind === 'trig_circle' ||
        ent.kind === 'riemann_field' ||
        ent.kind === 'tesseract'
      ) {
        this.drawMathEntity(ctx, ent, time, theme);
      }
    }

    // Collectible Floating Operator Pickups
    for (const pk of pickups) {
      this.drawOperatorPickup(ctx, pk, time, theme);
    }

    // Crisp Vector Stickman Fighters (P1 = Solid Iconic Orange, Enemy = Crisp White/Ink or Blue!)
    for (const f of fighters) {
      this.drawMathFighter(ctx, f, time, theme);
    }

    // Foreground Math Projectiles & Fields
    for (const ent of entities) {
      if (
        ent.kind !== 'euler_plane' &&
        ent.kind !== 'golden_grid' &&
        ent.kind !== 'trig_circle' &&
        ent.kind !== 'riemann_field' &&
        ent.kind !== 'tesseract'
      ) {
        this.drawMathEntity(ctx, ent, time, theme);
      }
    }

    // Crisp Math Glyph Particles & Pop-Texts
    this.drawParticles(ctx, particles, theme);
    this.drawPopTexts(ctx, popTexts, theme);

    // Aim Reticle (P1 Orange!) & Stick Aim Arrows
    if (aimReticleWorld) {
      const owner = fighters[data.aimReticleOwner] ?? fighters[0];
      if (owner) {
        const retCol = owner.index === 0 ? '#ff7a1a' : '#2ea8ff';
        this.drawAimReticle(ctx, aimReticleWorld, owner.pos, retCol, time);
      }
    }
    for (const st of stickAimIndicators) {
      this.drawStickAimArrow(ctx, st.pos, st.angle, st.color);
    }

    ctx.restore();

    // 3. Clean Minimalist Vector Formula Cut-In Banner
    if (cutIn.active) {
      this.drawCutInBanner(ctx, cutIn, viewW, viewH, theme);
    }
  }

  private warpPoint(x: number, y: number, warps: GridWarp[]): Vec2 {
    let wx = x;
    let wy = y;
    for (let i = 0; i < warps.length; i++) {
      const w = warps[i];
      const dx = w.x - wx;
      const dy = w.y - wy;
      const dSq = dx * dx + dy * dy;
      const rSq = w.radius * w.radius;
      if (dSq < rSq && dSq > 1) {
        const d = Math.sqrt(dSq);
        const falloff = 1 - d / w.radius;
        const env = Math.min(1, w.life / Math.max(0.15, w.maxLife * 0.35));
        const pull = falloff * falloff * w.strength * env;
        wx += (dx / d) * pull;
        wy += (dy / d) * pull;
      }
    }
    this.warpOut.x = wx;
    this.warpOut.y = wy;
    return this.warpOut;
  }

  private drawCoordinateSpace(
    ctx: CanvasRenderingContext2D,
    theme: MathThemePalette,
    worldWidth: number,
    worldHeight: number,
    floorY: number,
    warps: GridWarp[],
    time: number
  ): void {
    const step = 64;
    const originX = worldWidth * 0.5;
    const originY = floorY;
    const hasWarp = warps.length > 0;

    ctx.save();
    ctx.lineWidth = 1;

    // Subtle Polar Unit-Circle Geometry Guide
    ctx.strokeStyle = theme.gridMinor;
    ctx.setLineDash([5, 7]);
    for (const r of [160, 320]) {
      ctx.beginPath();
      ctx.arc(originX, originY - 190, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);

    // Very Faint Chalk/Pencil Formula Background Notes
    ctx.fillStyle = theme.gridMajor;
    ctx.font = `italic 500 17px ${MATH_SERIF}`;
    ctx.textAlign = 'center';
    const ambientFormulas = [
      { txt: 'e^(iπ) + 1 = 0', x: originX, y: 126 },
      { txt: 'φ = (1 + √5) / 2', x: 245, y: 195 },
      { txt: '∫ f(x) dx', x: worldWidth - 245, y: 195 },
    ];
    for (const af of ambientFormulas) {
      ctx.fillText(af.txt, af.x, af.y + Math.sin(time * 0.5 + af.x * 0.01) * 2.5);
    }

    // Minimalist Cartesian Grid (bends cleanly during ÷0 Singularity / Euler Super)
    if (!hasWarp) {
      ctx.beginPath();
      ctx.strokeStyle = theme.gridMinor;
      for (let x = originX % step; x <= worldWidth; x += step) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, worldHeight);
      }
      for (let y = originY % step; y <= worldHeight; y += step) {
        ctx.moveTo(0, y);
        ctx.lineTo(worldWidth, y);
      }
      ctx.stroke();
    } else {
      const seg = 64;
      ctx.strokeStyle = theme.gridMajor;
      ctx.beginPath();
      for (let x = originX % step; x <= worldWidth; x += step) {
        for (let y = 0; y <= worldHeight; y += seg) {
          const pt = this.warpPoint(x, y, warps);
          if (y === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        }
      }
      for (let y = originY % step; y <= worldHeight; y += step) {
        for (let x = 0; x <= worldWidth; x += seg) {
          const pt = this.warpPoint(x, y, warps);
          if (x === 0) ctx.moveTo(pt.x, pt.y);
          else ctx.lineTo(pt.x, pt.y);
        }
      }
      ctx.stroke();
    }

    // Crisp Pure Vector Axes
    ctx.strokeStyle = theme.axisColor;
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(originX, 24);
    ctx.lineTo(originX, worldHeight - 16);
    ctx.moveTo(28, originY);
    ctx.lineTo(worldWidth - 28, originY);
    ctx.stroke();

    ctx.fillStyle = theme.axisLabel;
    ctx.font = `italic 600 13px ${MATH_SERIF}`;
    ctx.textAlign = 'left';
    ctx.fillText('Im (y)', originX + 10, 42);
    ctx.textAlign = 'right';
    ctx.fillText('Re (x)', worldWidth - 36, originY - 12);

    // Numeric ticks along X-axis
    ctx.font = `11px ${MATH_SERIF}`;
    ctx.textAlign = 'center';
    for (let k = -8; k <= 8; k++) {
      if (k === 0) continue;
      const tx = originX + k * step;
      if (tx < 50 || tx > worldWidth - 50) continue;
      ctx.beginPath();
      ctx.moveTo(tx, originY - 4);
      ctx.lineTo(tx, originY + 4);
      ctx.stroke();
      if (k % 2 === 0) {
        ctx.fillText(String(k), tx, originY + 18);
      }
    }

    ctx.restore();
  }

  private drawPlatforms(
    ctx: CanvasRenderingContext2D,
    theme: MathThemePalette,
    platforms: MathPlatformDef[],
    floorY: number
  ): void {
    ctx.save();
    for (const p of platforms) {
      const isFloor = p.y >= floorY - 2;
      if (isFloor) {
        // Clean flat vector floor baseline (like Alan Becker's infinite white floor line!)
        ctx.fillStyle = theme.platformFill;
        ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.strokeStyle = theme.platformStroke;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x + p.w, p.y);
        ctx.stroke();
      } else {
        // Floating white/ink geometric segment bar with endpoint circles
        ctx.fillStyle = theme.platformFill;
        ctx.fillRect(p.x, p.y, p.w, p.h);
        ctx.strokeStyle = theme.platformStroke;
        ctx.lineWidth = 2;
        ctx.strokeRect(p.x, p.y, p.w, p.h);

        ctx.fillStyle = theme.platformStroke;
        ctx.beginPath();
        ctx.arc(p.x, p.y + p.h * 0.5, 3.6, 0, Math.PI * 2);
        ctx.arc(p.x + p.w, p.y + p.h * 0.5, 3.6, 0, Math.PI * 2);
        ctx.fill();

        if (p.label) {
          ctx.fillStyle = theme.axisLabel;
          ctx.font = 'italic 600 12px Georgia, serif';
          ctx.textAlign = 'center';
          ctx.fillText(p.label, p.x + p.w * 0.5, p.y - 7);
        }
      }
    }
    ctx.restore();
  }

  private drawOperatorPickup(
    ctx: CanvasRenderingContext2D,
    pk: FloatingOperatorPickup,
    time: number,
    theme: MathThemePalette
  ): void {
    const def = MATH_OPERATORS[pk.op];
    const col = inkStroke(theme, def.color);
    const fade = pk.life < 2 ? Math.max(0.25, pk.life / 2) : 1;

    ctx.save();
    ctx.globalAlpha = fade;
    ctx.translate(pk.pos.x, pk.pos.y);

    // Crisp monochrome architectural diamond/circle pickup frame
    ctx.fillStyle = theme.bgTop;
    ctx.beginPath();
    ctx.arc(0, 0, 17, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = col;
    ctx.lineWidth = 1.8;
    ctx.stroke();

    // Subtle outer dashed orbit
    ctx.setLineDash([3, 4]);
    ctx.globalAlpha = fade * 0.55;
    ctx.beginPath();
    ctx.arc(0, 0, 22, time * 1.6, time * 1.6 + Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    ctx.globalAlpha = fade;
    ctx.fillStyle = col;
    ctx.font = def.glyph.length > 2 ? 'italic bold 11px Georgia, serif' : 'italic bold 16px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(def.glyph, 0, 1);

    ctx.restore();
  }

  private getStickmanBodyColor(f: MathFighterRenderState, theme: MathThemePalette): string {
    if (f.hurtFlashFrames > 0) return '#ef4747';
    if (f.index === 0) return '#ff7a1a'; // ALWAYS iconic Alan Becker Orange for P1 (YOU)!
    if (f.isVersusP2) return '#2ea8ff'; // Clean Sky Blue for P2 in 2P Versus!
    return theme.isLight ? '#16161a' : '#f2f2f4'; // Pure White Math Antagonist on black void (or Ink Black on white stage)!
  }

  private drawMathFighter(
    ctx: CanvasRenderingContext2D,
    f: MathFighterRenderState,
    time: number,
    theme: MathThemePalette
  ): void {
    const bodyCol = this.getStickmanBodyColor(f, theme);

    // 1. Clean Vector Afterimages
    for (const ai of f.afterimages) {
      const alpha = (ai.life / ai.maxLife) * 0.34;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = bodyCol;
      ctx.lineWidth = 3.2;
      ctx.lineCap = 'round';
      const p = ai.pose;
      ctx.beginPath();
      ctx.moveTo(p.neck.x, p.neck.y); ctx.lineTo(p.hip.x, p.hip.y);
      ctx.moveTo(p.hip.x, p.hip.y); ctx.lineTo(p.lKnee.x, p.lKnee.y); ctx.lineTo(p.lFoot.x, p.lFoot.y);
      ctx.moveTo(p.hip.x, p.hip.y); ctx.lineTo(p.rKnee.x, p.rKnee.y); ctx.lineTo(p.rFoot.x, p.rFoot.y);
      ctx.moveTo(p.neck.x, p.neck.y); ctx.lineTo(p.lElbow.x, p.lElbow.y); ctx.lineTo(p.lHand.x, p.lHand.y);
      ctx.moveTo(p.neck.x, p.neck.y); ctx.lineTo(p.rElbow.x, p.rElbow.y); ctx.lineTo(p.rHand.x, p.rHand.y);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(p.head.x, p.head.y, 11.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // 2. Crisp Flat-Vector Weapon Smear
    if (f.smears.length >= 2) {
      const smearCol = f.index === 0 ? '#ff7a1a' : inkStroke(theme, f.color);
      ctx.save();
      for (let i = 1; i < f.smears.length; i++) {
        const a = f.smears[i - 1];
        const b = f.smears[i];
        const alpha = Math.max(0, b.life / b.maxLife);
        ctx.beginPath();
        ctx.moveTo(a.base.x, a.base.y);
        ctx.lineTo(a.tip.x, a.tip.y);
        ctx.lineTo(b.tip.x, b.tip.y);
        ctx.lineTo(b.base.x, b.base.y);
        ctx.closePath();
        ctx.fillStyle = smearCol;
        ctx.globalAlpha = alpha * (b.heavy ? 0.32 : 0.18);
        ctx.fill();
        ctx.strokeStyle = theme.chalkCore;
        ctx.lineWidth = b.heavy ? 2.2 : 1.4;
        ctx.globalAlpha = alpha * 0.72;
        ctx.beginPath();
        ctx.moveTo(a.tip.x, a.tip.y);
        ctx.lineTo(b.tip.x, b.tip.y);
        ctx.stroke();
      }
      ctx.restore();
    }

    const pose = f.pose;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // 3. P1 Subtle Orange Coordinate Ground Locator Ring (instant visual anchor for YOU!)
    if (f.index === 0 && f.action !== 'ko') {
      ctx.strokeStyle = '#ff7a1a';
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = 0.65;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.ellipse(f.pos.x, f.pos.y, 26, 7, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }

    // 4. Crisp Flowing Scarf (Orange for P1, Gold/Red for Boss, White/Blue for P2)
    if (f.scarfPoints.length >= 2) {
      ctx.strokeStyle = f.index === 0 ? '#ff9d47' : f.isBoss ? '#f2c14e' : bodyCol;
      ctx.lineWidth = 3;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      f.scarfPoints.forEach((pt, idx) => (idx === 0 ? ctx.moveTo(pt.x, pt.y) : ctx.lineTo(pt.x, pt.y)));
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 5. Pure Solid Vector Stickman Limbs & Torso (Authentic Alan Becker Flash Vector Weight!)
    ctx.strokeStyle = bodyCol;
    // Back limbs
    ctx.lineWidth = 4.6;
    ctx.beginPath();
    ctx.moveTo(pose.hip.x, pose.hip.y); ctx.lineTo(pose.lKnee.x, pose.lKnee.y); ctx.lineTo(pose.lFoot.x, pose.lFoot.y);
    ctx.moveTo(pose.neck.x, pose.neck.y); ctx.lineTo(pose.lElbow.x, pose.lElbow.y); ctx.lineTo(pose.lHand.x, pose.lHand.y);
    ctx.stroke();

    // Core spine
    ctx.lineWidth = 5.4;
    ctx.beginPath();
    ctx.moveTo(pose.neck.x, pose.neck.y); ctx.lineTo(pose.hip.x, pose.hip.y);
    ctx.stroke();

    // Front limbs
    ctx.lineWidth = 4.8;
    ctx.beginPath();
    ctx.moveTo(pose.hip.x, pose.hip.y); ctx.lineTo(pose.rKnee.x, pose.rKnee.y); ctx.lineTo(pose.rFoot.x, pose.rFoot.y);
    ctx.moveTo(pose.neck.x, pose.neck.y); ctx.lineTo(pose.rElbow.x, pose.rElbow.y); ctx.lineTo(pose.rHand.x, pose.rHand.y);
    ctx.stroke();

    // 6. Iconic Hollow Ring Head for P1 (The Second Coming!), Solid Circle Head for Math Entities / P2!
    const headR = f.isBoss ? 14 : 12;
    if (f.index === 0) {
      ctx.fillStyle = theme.bgTop;
      ctx.beginPath();
      ctx.arc(pose.head.x, pose.head.y, headR, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = bodyCol;
      ctx.lineWidth = 4.5;
      ctx.stroke();
    } else {
      // Pure solid white/blue circle head (instantly contrasts with P1's hollow orange head!)
      ctx.fillStyle = bodyCol;
      ctx.beginPath();
      ctx.arc(pose.head.x, pose.head.y, headR, 0, Math.PI * 2);
      ctx.fill();
      if (f.isBoss) {
        ctx.strokeStyle = '#f2c14e';
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.arc(pose.head.x, pose.head.y, headR + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // 7. Hand-Held Pure Vector Mathematical Weapon
    if (f.action !== 'ko') {
      this.drawMathWeapon(ctx, f, pose.weaponBase, pose.weaponTip, time, theme);
    }

    // 8. Block / Parry Shield Arc
    if (f.action === 'block') {
      const parry = f.parryWindowFrames > 0;
      ctx.strokeStyle = parry ? '#f2c14e' : bodyCol;
      ctx.lineWidth = parry ? 4.2 : 2.6;
      const cx = pose.chest.x + f.facing * 24;
      const cy = pose.chest.y;
      ctx.beginPath();
      if (f.facing > 0) ctx.arc(cx - 16, cy, 38, -1.25, 1.25);
      else ctx.arc(cx + 16, cy, 38, Math.PI - 1.25, Math.PI + 1.25);
      ctx.stroke();
    }

    // 9. Pythagorean Absolute-One Shield (sin² + cos² = 1)
    if (f.shieldTimer > 0) {
      ctx.strokeStyle = theme.chalkCore;
      ctx.lineWidth = 2;
      ctx.globalAlpha = 0.72;
      ctx.beginPath();
      for (let i = 0; i < 6; i++) {
        const a = time * 1.5 + (i * Math.PI) / 3;
        const px = f.pos.x + Math.cos(a) * 45;
        const py = f.pos.y - 46 + Math.sin(a) * 45;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    // 10. Orbiting Equation Forge Operator Chips (subtle monochrome pills!)
    f.operators.forEach((opId, idx) => {
      const opDef = MATH_OPERATORS[opId];
      const ang = time * 2.4 + idx * Math.PI;
      const ox = pose.head.x + Math.cos(ang) * 32;
      const oy = pose.head.y - 8 + Math.sin(ang) * 10;
      const col = inkStroke(theme, opDef.color);
      ctx.fillStyle = theme.bgTop;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(ox, oy, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.font = 'italic bold 10px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(opDef.glyph, ox, oy + 0.5);
    });

    // 11. Unmistakable Overhead Player Indicator ("▼ 你" for P1!) + Calculus Countdown
    if (f.action !== 'ko') {
      if (f.index === 0) {
        const py = pose.head.y - 30;
        // Solid Orange downward triangle chevron + "你" tag
        ctx.fillStyle = '#ff7a1a';
        ctx.beginPath();
        ctx.moveTo(pose.head.x, py + 7);
        ctx.lineTo(pose.head.x - 6, py);
        ctx.lineTo(pose.head.x + 6, py);
        ctx.closePath();
        ctx.fill();
        ctx.font = 'bold 12px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('P1 · 你', pose.head.x, py - 5);
      } else if (f.isBoss) {
        ctx.fillStyle = '#f2c14e';
        ctx.font = 'italic bold 13px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.fillText('BOSS · e^(iπ)', pose.head.x, pose.head.y - 28);
      } else if (f.isVersusP2) {
        ctx.fillStyle = '#2ea8ff';
        ctx.font = 'bold 12px "Microsoft YaHei", sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('P2', pose.head.x, pose.head.y - 28);
      }

      if (f.polyDegree < 4) {
        const label = POLY_LABELS[Math.max(0, Math.min(4, f.polyDegree))];
        ctx.fillStyle = '#ef4747';
        ctx.font = 'italic bold 14px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.fillText(`d/dx: ${label}`, pose.head.x, pose.head.y - (f.index === 0 ? 50 : 44));
      }
    }

    ctx.restore();
  }

  private drawMathWeapon(
    ctx: CanvasRenderingContext2D,
    f: MathFighterRenderState,
    base: Vec2,
    tip: Vec2,
    time: number,
    theme: MathThemePalette
  ): void {
    const dx = tip.x - base.x;
    const dy = tip.y - base.y;
    const len = Math.hypot(dx, dy) || 1;
    const ang = Math.atan2(dy, dx);
    const wInk = theme.chalkCore;
    const gold = inkStroke(theme, '#f2c14e');
    const red = '#ef4747';

    ctx.save();
    ctx.translate(base.x, base.y);
    ctx.rotate(ang);

    if (f.school === 'euler') {
      // Crisp Vector White 'e' Arc-Staff with golden unit circle guard
      ctx.strokeStyle = wInk;
      ctx.lineWidth = 3.2;
      ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(len, 0); ctx.stroke();
      ctx.strokeStyle = gold;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(10, 0, 10, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = wInk;
      ctx.font = 'italic bold 20px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('e', len * 0.68, -12);
    } else if (f.school === 'golden') {
      // Crisp Golden Ratio Rectangle + Logarithmic Spiral Frame
      ctx.strokeStyle = gold;
      ctx.lineWidth = 2.4;
      const rw = len * 0.8;
      const rh = rw / 1.618;
      ctx.strokeRect(4, -rh * 0.5, rw, rh);
      ctx.strokeStyle = wInk;
      ctx.lineWidth = 1.8;
      ctx.beginPath();
      ctx.arc(4 + rw * 0.62, 0, rh * 0.48, 0, Math.PI * 1.5);
      ctx.stroke();
      ctx.fillStyle = gold;
      ctx.font = 'italic bold 16px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('φ', rw * 0.46, 0);
    } else if (f.school === 'trig') {
      // Clean White Unit-Circle Rod + Live Oscillating Sine Wave
      ctx.strokeStyle = wInk;
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.moveTo(-12, 0); ctx.lineTo(len, 0); ctx.stroke();
      ctx.strokeStyle = inkStroke(theme, '#8ec5ff');
      ctx.lineWidth = 2;
      ctx.beginPath();
      for (let x = 0; x <= len; x += 6) {
        const y = Math.sin(x * 0.16 - time * 13) * 7;
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.strokeStyle = wInk;
      ctx.lineWidth = 1.8;
      ctx.beginPath(); ctx.arc(len - 8, 0, 9.5, 0, Math.PI * 2); ctx.stroke();
    } else if (f.school === 'calculus') {
      // Tall Crisp Pure-White Integral Scythe '∫'
      ctx.strokeStyle = wInk;
      ctx.lineWidth = 3.8;
      ctx.beginPath();
      ctx.moveTo(-16, 4);
      ctx.bezierCurveTo(len * 0.28, -10, len * 0.72, 12, len, -14);
      ctx.stroke();
      ctx.strokeStyle = red;
      ctx.lineWidth = 3.2;
      ctx.beginPath();
      ctx.arc(len - 4, -7, 11, -Math.PI * 0.8, Math.PI * 0.25);
      ctx.stroke();
    } else if (f.school === 'algebra') {
      // Iconic Alan Becker White Minus-Sign Baton (morphs − / + / ×)
      ctx.strokeStyle = wInk;
      ctx.lineWidth = 4.6;
      ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(len * 0.92, 0); ctx.stroke();
      if (f.comboStep === 1) {
        // Plus cross!
        ctx.beginPath(); ctx.moveTo(len * 0.65, -14); ctx.lineTo(len * 0.65, 14); ctx.stroke();
      } else if (f.comboStep >= 2) {
        // Multiply X tip!
        ctx.strokeStyle = red;
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        ctx.moveTo(len * 0.58, -11); ctx.lineTo(len * 0.82, 11);
        ctx.moveTo(len * 0.82, -11); ctx.lineTo(len * 0.58, 11);
        ctx.stroke();
      }
    } else {
      // Pure Hollow Crisp Vector Triangle Prism
      ctx.strokeStyle = wInk;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.moveTo(4, -14);
      ctx.lineTo(len + 6, 0);
      ctx.lineTo(4, 14);
      ctx.closePath();
      ctx.stroke();
      ctx.lineWidth = 1.3;
      ctx.beginPath();
      ctx.moveTo(14, -7);
      ctx.lineTo(len * 0.62, 0);
      ctx.lineTo(14, 7);
      ctx.closePath();
      ctx.stroke();
    }

    ctx.restore();
  }

  private drawMathEntity(
    ctx: CanvasRenderingContext2D,
    e: MathEntity,
    time: number,
    theme: MathThemePalette
  ): void {
    const fade = Math.min(1, e.life / Math.min(0.22, e.maxLife * 0.4));
    const wInk = theme.chalkCore;
    const gold = inkStroke(theme, '#f2c14e');
    const red = '#ef4747';
    const accent = inkStroke(theme, e.secondaryColor);

    ctx.save();
    ctx.globalAlpha = fade;

    switch (e.kind) {
      case 'sine_wave': {
        ctx.translate(e.pos.x, e.pos.y);
        ctx.rotate(e.angle);
        const halfW = e.width * 0.5;
        const amp = e.amplitude ?? 32;
        const k = (Math.PI * 2) / (e.wavelength ?? 96);
        const phase = time * 17 + (e.phase ?? 0);

        ctx.strokeStyle = theme.axisColor;
        ctx.lineWidth = 1.2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath(); ctx.moveTo(-halfW, 0); ctx.lineTo(halfW, 0); ctx.stroke();
        ctx.setLineDash([]);

        ctx.strokeStyle = wInk;
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        for (let x = -halfW; x <= halfW; x += 6) {
          const env = Math.sin(((x + halfW) / e.width) * Math.PI);
          const y = Math.sin(x * k - phase) * amp * Math.pow(env, 0.45);
          if (x === -halfW) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        ctx.strokeStyle = accent;
        ctx.lineWidth = 1.6;
        ctx.globalAlpha = fade * 0.6;
        ctx.beginPath();
        for (let x = -halfW; x <= halfW; x += 8) {
          const env = Math.sin(((x + halfW) / e.width) * Math.PI);
          const y = Math.cos(x * k - phase) * amp * 0.5 * env;
          if (x === -halfW) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        ctx.globalAlpha = fade;
        const leadY = Math.sin(halfW * 0.7 * k - phase) * amp * 0.75;
        ctx.fillStyle = '#ff7a1a';
        ctx.beginPath(); ctx.arc(halfW * 0.7, leadY, 4.2, 0, Math.PI * 2); ctx.fill();
        break;
      }

      case 'euler_disc': {
        ctx.translate(e.pos.x, e.pos.y);
        const r = e.radius;
        const theta = time * 10 * e.facing;

        ctx.strokeStyle = wInk;
        ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();

        ctx.strokeStyle = theme.axisColor;
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.moveTo(-r - 10, 0); ctx.lineTo(r + 10, 0);
        ctx.moveTo(0, -r - 10); ctx.lineTo(0, r + 10);
        ctx.stroke();

        const vx = Math.cos(theta) * r;
        const vy = Math.sin(theta) * r;
        ctx.strokeStyle = wInk;
        ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(vx, 0); ctx.stroke();
        ctx.strokeStyle = red;
        ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.moveTo(vx, 0); ctx.lineTo(vx, vy); ctx.stroke();
        ctx.strokeStyle = gold;
        ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(vx, vy); ctx.stroke();
        ctx.fillStyle = wInk;
        ctx.beginPath(); ctx.arc(vx, vy, 4.5, 0, Math.PI * 2); ctx.fill();

        ctx.fillStyle = wInk;
        ctx.font = 'italic bold 13px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.fillText('e^(iθ)', 0, -r - 10);
        break;
      }

      case 'euler_echo': {
        ctx.translate(e.pos.x, e.pos.y);
        ctx.rotate(e.angle);
        ctx.strokeStyle = wInk;
        ctx.lineWidth = 2.8;
        ctx.beginPath(); ctx.arc(-6, 0, 21, -0.92, 0.92); ctx.stroke();
        ctx.save();
        if (Math.cos(e.angle) < 0) ctx.scale(-1, -1);
        ctx.fillStyle = gold;
        ctx.font = 'italic bold 13px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('eˣ', 0, 0);
        ctx.restore();
        break;
      }

      case 'euler_plane': {
        const progress = Math.min(1, e.age / Math.max(0.1, e.maxLife * 0.68));
        const sweepAngle = -progress * Math.PI;
        const R = e.radius;

        ctx.translate(e.pos.x, e.pos.y);
        ctx.strokeStyle = theme.axisColor;
        ctx.lineWidth = 1.8;
        ctx.beginPath();
        ctx.moveTo(-R - 55, 0); ctx.lineTo(R + 55, 0);
        ctx.moveTo(0, -R - 45); ctx.lineTo(0, R + 45);
        ctx.stroke();

        ctx.strokeStyle = wInk;
        ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.stroke();

        // Crisp Golden swept arc from +1 -> +i -> -1
        ctx.strokeStyle = gold;
        ctx.lineWidth = 5;
        ctx.beginPath(); ctx.arc(0, 0, R, 0, sweepAngle, true); ctx.stroke();

        const tipX = Math.cos(sweepAngle) * R;
        const tipY = Math.sin(sweepAngle) * R;
        ctx.strokeStyle = wInk;
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(tipX, tipY); ctx.stroke();
        ctx.fillStyle = gold;
        ctx.beginPath(); ctx.arc(tipX, tipY, 7, 0, Math.PI * 2); ctx.fill();

        ctx.fillStyle = wInk;
        ctx.font = 'italic bold 16px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.fillText('+1', R + 22, 6);
        ctx.fillText('+i', 0, -R - 14);
        ctx.fillText('−1', -R - 22, 6);
        ctx.fillText('−i', 0, R + 24);

        const stageText =
          progress < 0.35
            ? 'e^(iθ) = cos θ + i·sin θ'
            : progress < 0.85
              ? 'e^(iπ) = −1'
              : 'e^(iπ) + 1 = 0';
        ctx.fillStyle = progress >= 0.85 ? gold : wInk;
        ctx.font = 'italic bold 26px Georgia, serif';
        ctx.fillText(stageText, 0, -R - 42);
        break;
      }

      case 'golden_spiral': {
        ctx.translate(e.pos.x, e.pos.y);
        ctx.rotate(e.angle);
        const s = e.scale ?? 1;
        ctx.scale(s, s);
        const fibs = [8, 8, 16, 24, 38];
        let ox = -24;
        ctx.strokeStyle = gold;
        ctx.lineWidth = 1.8;
        fibs.forEach((sz, idx) => {
          ctx.globalAlpha = fade * (0.45 + idx * 0.11);
          ctx.strokeRect(ox, -sz * 0.5, sz, sz);
          ctx.beginPath();
          ctx.arc(ox + sz * 0.5, 0, sz * 0.5, idx % 2 === 0 ? 0 : Math.PI, idx % 2 === 0 ? Math.PI : Math.PI * 2);
          ctx.stroke();
          ox += sz * 0.56;
        });

        ctx.globalAlpha = fade;
        ctx.strokeStyle = wInk;
        ctx.lineWidth = 2.6;
        ctx.beginPath();
        for (let t = 0; t <= Math.PI * 3.1; t += 0.16) {
          const r = 4 * Math.exp(0.24 * t);
          const x = Math.cos(t + time * 9) * r;
          const y = Math.sin(t + time * 9) * r;
          if (t === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
        break;
      }

      case 'golden_grid': {
        ctx.translate(e.pos.x, e.pos.y);
        ctx.rotate(time * 1.2);
        const maxR = e.radius;
        ctx.strokeStyle = gold;
        ctx.lineWidth = 3;
        ctx.beginPath();
        for (let t = 0; t <= Math.PI * 4.5; t += 0.12) {
          const r = Math.min(maxR, 8 * Math.exp(0.26 * t));
          const x = Math.cos(t) * r;
          const y = Math.sin(t) * r;
          if (t === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        const fibNums = [2, 3, 5, 8, 13];
        fibNums.forEach((n, idx) => {
          const rr = (idx + 1) * (maxR / 5.2);
          ctx.strokeStyle = idx % 2 === 0 ? gold : wInk;
          ctx.lineWidth = 1.5;
          ctx.globalAlpha = fade * 0.52;
          ctx.strokeRect(-rr * 0.8, -rr * 0.5, rr * 1.6, rr);
          ctx.fillStyle = wInk;
          ctx.font = 'italic bold 13px Georgia, serif';
          ctx.fillText(String(n), rr * 0.65, -rr * 0.32);
        });
        break;
      }

      case 'trig_circle': {
        ctx.translate(e.pos.x, e.pos.y);
        const r = e.radius;
        const theta = e.age * 7;
        ctx.strokeStyle = wInk;
        ctx.lineWidth = 2.6;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.stroke();

        const cx = Math.cos(theta) * r;
        const cy = Math.sin(theta) * r;
        ctx.strokeStyle = wInk;
        ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(-380, cy); ctx.lineTo(380, cy); ctx.stroke();
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.moveTo(cx, -240); ctx.lineTo(cx, 240); ctx.stroke();
        ctx.fillStyle = '#ff7a1a';
        ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2); ctx.fill();
        break;
      }

      case 'tan_slash': {
        ctx.translate(e.pos.x, e.pos.y);
        ctx.strokeStyle = red;
        ctx.lineWidth = 1.8;
        ctx.setLineDash([6, 5]);
        ctx.beginPath(); ctx.moveTo(0, -175); ctx.lineTo(0, 175); ctx.stroke();
        ctx.setLineDash([]);

        ctx.strokeStyle = wInk;
        ctx.lineWidth = 3;
        for (const side of [-1, 1]) {
          ctx.beginPath();
          for (let i = 1; i <= 16; i++) {
            const dx = side * (4 + i * 3);
            const dy = side * (-160 / (i * 0.55));
            if (i === 1) ctx.moveTo(dx, dy);
            else ctx.lineTo(dx, dy);
          }
          ctx.stroke();
        }
        ctx.fillStyle = wInk;
        ctx.font = 'italic bold 13px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.fillText('tan(π/2)→∞', 0, -184);
        break;
      }

      case 'riemann_field': {
        const halfW = e.width * 0.5;
        const maxH = e.height;
        const slices = e.sliceCount ?? 10;
        const slamRatio = e.slammed ? 1 : Math.min(1, e.age / 0.24);
        const dxSlice = e.width / slices;

        ctx.translate(e.pos.x, e.pos.y);
        for (let i = 0; i < slices; i++) {
          const u = (i + 0.5) / slices;
          const h = Math.sin(u * Math.PI) * maxH * slamRatio;
          const rx = -halfW + i * dxSlice;
          ctx.fillStyle = e.slammed
            ? theme.isLight
              ? 'rgba(239, 71, 71, 0.22)'
              : 'rgba(255, 255, 255, 0.2)'
            : theme.isLight
              ? 'rgba(20, 20, 24, 0.1)'
              : 'rgba(255, 255, 255, 0.08)';
          ctx.fillRect(rx + 1, -h, dxSlice - 2, h);
          ctx.strokeStyle = e.slammed ? red : wInk;
          ctx.lineWidth = 1.6;
          ctx.strokeRect(rx + 1, -h, dxSlice - 2, h);
        }

        ctx.strokeStyle = wInk;
        ctx.lineWidth = 2.8;
        ctx.beginPath();
        for (let x = -halfW; x <= halfW; x += 6) {
          const u = (x + halfW) / e.width;
          const y = -Math.sin(u * Math.PI) * maxH * slamRatio;
          if (x === -halfW) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        ctx.fillStyle = wInk;
        ctx.font = 'italic bold 16px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.fillText(`∫ f(x) dx  (n=${slices})`, 0, -maxH * slamRatio - 14);
        break;
      }

      case 'taylor_lock': {
        ctx.translate(e.pos.x, e.pos.y);
        const span = e.width * 0.5;
        const orders = Math.min(5, 1 + Math.floor(e.age * 4.5));
        for (let ord = 1; ord <= orders; ord++) {
          ctx.strokeStyle = ord === orders ? red : wInk;
          ctx.lineWidth = ord === orders ? 3.2 : 1.5;
          ctx.globalAlpha = fade * (ord === orders ? 0.95 : 0.38);
          ctx.beginPath();
          for (let px = -span; px <= span; px += 8) {
            const x = (px / span) * 2.4;
            let yVal = x;
            if (ord >= 2) yVal -= (x * x * x) / 6;
            if (ord >= 3) yVal += Math.pow(x, 5) / 120;
            if (ord >= 4) yVal -= Math.pow(x, 7) / 5040;
            if (ord >= 5) yVal += Math.sin(x * 2 + time * 7) * 0.22;
            const py = Math.max(-120, Math.min(120, -yVal * 50));
            if (px === -span) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
          }
          ctx.stroke();
        }
        ctx.globalAlpha = fade;
        ctx.fillStyle = wInk;
        ctx.font = 'italic bold 15px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.fillText(`Σ Taylor P${orders}(x)`, 0, -90);
        break;
      }

      case 'exp_orb': {
        ctx.translate(e.pos.x, e.pos.y);
        const r = e.radius;
        ctx.fillStyle = theme.bgTop;
        ctx.strokeStyle = wInk;
        ctx.lineWidth = 2.4;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();

        ctx.fillStyle = wInk;
        ctx.font = `italic bold ${Math.round(r * 0.95)}px Georgia, serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(e.glyph ?? '2', 0, 1);
        break;
      }

      case 'arith_glyph': {
        ctx.translate(e.pos.x, e.pos.y);
        ctx.rotate(time * 10 * e.facing);
        ctx.fillStyle = wInk;
        ctx.font = 'bold 26px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(e.glyph ?? '+', 0, 0);
        break;
      }

      case 'singularity': {
        ctx.translate(e.pos.x, e.pos.y);
        const r = e.radius;
        const grad = ctx.createRadialGradient(0, 0, 10, 0, 0, r);
        grad.addColorStop(0, theme.isLight ? 'rgba(10, 10, 14, 0.85)' : 'rgba(0, 0, 0, 0.95)');
        grad.addColorStop(0.5, 'rgba(239, 71, 71, 0.25)');
        grad.addColorStop(1, 'rgba(239, 71, 71, 0)');
        ctx.fillStyle = grad;
        ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();

        for (let i = 0; i < 4; i++) {
          ctx.strokeStyle = i % 2 === 0 ? red : wInk;
          ctx.lineWidth = 2;
          const a0 = time * (3.6 + i) + (i * Math.PI) / 2;
          ctx.beginPath(); ctx.arc(0, 0, 26 + i * 18, a0, a0 + 1.65); ctx.stroke();
        }

        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(-34, 0); ctx.lineTo(34, 0); ctx.stroke();
        ctx.fillStyle = '#ffffff';
        ctx.font = 'italic bold 22px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.fillText('x', 0, -10);
        ctx.fillStyle = red;
        ctx.fillText('0', 0, 24);
        break;
      }

      case 'fractal_tri': {
        ctx.translate(e.pos.x, e.pos.y);
        ctx.rotate(time * 4.2 * e.facing + e.angle);
        const r = e.radius;
        const drawSierp = (ax: number, ay: number, bx: number, by: number, cx: number, cy: number, depth: number) => {
          if (depth <= 0) {
            ctx.beginPath();
            ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.lineTo(cx, cy);
            ctx.closePath();
            ctx.stroke();
            return;
          }
          const mabx = (ax + bx) * 0.5, maby = (ay + by) * 0.5;
          const mbcx = (bx + cx) * 0.5, mbcy = (by + cy) * 0.5;
          const mcax = (cx + ax) * 0.5, mcay = (cy + ay) * 0.5;
          drawSierp(ax, ay, mabx, maby, mcax, mcay, depth - 1);
          drawSierp(mabx, maby, bx, by, mbcx, mbcy, depth - 1);
          drawSierp(mcax, mcay, mbcx, mbcy, cx, cy, depth - 1);
        };
        const p1x = r, p1y = 0;
        const p2x = Math.cos((2 * Math.PI) / 3) * r, p2y = Math.sin((2 * Math.PI) / 3) * r;
        const p3x = Math.cos((4 * Math.PI) / 3) * r, p3y = Math.sin((4 * Math.PI) / 3) * r;
        ctx.strokeStyle = wInk;
        ctx.lineWidth = 1.8;
        drawSierp(p1x, p1y, p2x, p2y, p3x, p3y, 2);
        break;
      }

      case 'tesseract': {
        // Pure Crisp Monochrome 4D Hypercube Wireframe Projection!
        ctx.translate(e.pos.x, e.pos.y);
        const aXW = time * 1.35;
        const aYW = time * 0.9;
        const aXY = time * 0.55;
        const cXW = Math.cos(aXW), sXW = Math.sin(aXW);
        const cYW = Math.cos(aYW), sYW = Math.sin(aYW);
        const cXY = Math.cos(aXY), sXY = Math.sin(aXY);

        const projected: Array<{ x: number; y: number; wDepth: number }> = [];
        const baseScale = e.radius * 0.72;

        for (const [vx, vy, vz, vw] of TESSERACT_VERTS) {
          const x1 = vx * cXW - vw * sXW;
          const w1 = vx * sXW + vw * cXW;
          const y1 = vy * cYW - w1 * sYW;
          const w2 = vy * sYW + w1 * cYW;
          const x2 = x1 * cXY - y1 * sXY;
          const y2 = x1 * sXY + y1 * cXY;

          const p4 = 1 / (2.7 - w2);
          const x3 = x2 * p4;
          const y3 = y2 * p4;
          const z3 = vz * p4;
          const p3 = 1 / (2.5 - z3);

          projected.push({
            x: x3 * p3 * baseScale * 3.1,
            y: y3 * p3 * baseScale * 3.1,
            wDepth: (w2 + 1.4) / 2.8,
          });
        }

        for (const [i, j] of TESSERACT_EDGES) {
          const a = projected[i];
          const b = projected[j];
          const avgW = (a.wDepth + b.wDepth) * 0.5;
          ctx.strokeStyle = avgW > 0.6 ? wInk : accent;
          ctx.lineWidth = 1.3 + avgW * 1.9;
          ctx.globalAlpha = fade * (0.35 + avgW * 0.62);
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }

        ctx.globalAlpha = fade;
        ctx.fillStyle = wInk;
        for (const pt of projected) {
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 2 + pt.wDepth * 2, 0, Math.PI * 2);
          ctx.fill();
        }

        ctx.fillStyle = wInk;
        ctx.font = 'italic bold 15px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.fillText('Tesseract ℝ⁴ → ℝ²', 0, -e.radius - 12);
        break;
      }
    }

    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D, particles: MathParticle[], theme: MathThemePalette): void {
    ctx.save();
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const alpha = Math.max(0, p.life / p.maxLife);
      ctx.globalAlpha = alpha;
      const col = inkStroke(theme, p.color);
      if (p.glyph) {
        const sprite = this.getGlyphSprite(p.glyph, col);
        if (sprite) {
          const drawSz = p.size * 1.55;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.drawImage(sprite, -drawSz * 0.5, -drawSz * 0.5, drawSz, drawSz);
          ctx.restore();
        } else {
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = col;
          ctx.font = `italic 600 ${Math.round(p.size)}px ${MATH_SERIF}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText(p.glyph, 0, 0);
          ctx.restore();
        }
      } else {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawPopTexts(ctx: CanvasRenderingContext2D, popTexts: MathPopText[], theme: MathThemePalette): void {
    if (popTexts.length === 0) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = 0; i < popTexts.length; i++) {
      const t = popTexts[i];
      const alpha = Math.min(1, (t.life / t.maxLife) * 2.2);
      ctx.globalAlpha = alpha;
      const isCjk = CJK_RE.test(t.text);
      const isNum = !isCjk && NUM_DMG_RE.test(t.text);
      if (isCjk) {
        // Strictly upright, restrained sans for rare cues (弹反/破防/挡) — ZERO faux-italic, ZERO cartoon sticker border!
        ctx.font = `600 ${Math.round(13.5 * t.scale)}px ${UI_SANS}`;
      } else if (isNum) {
        ctx.font = `600 ${Math.round(14.5 * t.scale)}px ${MATH_SERIF}`;
      } else {
        // Authentic LaTeX / Alan Becker crisp mathematical serif (no thick outline!)
        ctx.font = `italic 600 ${Math.round(16 * t.scale)}px ${MATH_SERIF}`;
      }
      ctx.fillStyle = inkStroke(theme, t.color);
      ctx.fillText(t.text, t.x, t.y);
      if (t.sub) {
        ctx.globalAlpha = alpha * 0.78;
        const subCjk = CJK_RE.test(t.sub);
        ctx.font = subCjk ? `600 11.5px ${UI_SANS}` : `600 12px ${MATH_SERIF}`;
        ctx.fillStyle = theme.axisLabel;
        ctx.fillText(t.sub, t.x, t.y + 16);
      }
    }
    ctx.restore();
  }

  private drawAimReticle(
    ctx: CanvasRenderingContext2D,
    pos: Vec2,
    ownerPos: Vec2,
    color: string,
    time: number
  ): void {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.8;
    ctx.globalAlpha = 0.9;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 11, time * 1.8, time * 1.8 + Math.PI * 1.65);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(pos.x - 15, pos.y); ctx.lineTo(pos.x - 5, pos.y);
    ctx.moveTo(pos.x + 5, pos.y); ctx.lineTo(pos.x + 15, pos.y);
    ctx.moveTo(pos.x, pos.y - 15); ctx.lineTo(pos.x, pos.y - 5);
    ctx.moveTo(pos.x, pos.y + 5); ctx.lineTo(pos.x, pos.y + 15);
    ctx.stroke();

    ctx.setLineDash([4, 6]);
    ctx.globalAlpha = 0.28;
    ctx.beginPath();
    ctx.moveTo(ownerPos.x, ownerPos.y - 46);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();
  }

  private drawStickAimArrow(
    ctx: CanvasRenderingContext2D,
    pos: Vec2,
    angle: number,
    color: string
  ): void {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.2;
    ctx.globalAlpha = 0.85;
    const cx = pos.x;
    const cy = pos.y - 46;
    const ex = cx + Math.cos(angle) * 92;
    const ey = cy + Math.sin(angle) * 92;
    ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.moveTo(cx + Math.cos(angle) * 34, cy + Math.sin(angle) * 34); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(ex, ey, 3.8, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  private drawCutInBanner(
    ctx: CanvasRenderingContext2D,
    cutIn: MathCutInBanner,
    viewW: number,
    viewH: number,
    theme: MathThemePalette
  ): void {
    const p = cutIn.age / Math.max(0.1, cutIn.duration);
    const enter = Math.min(1, p / 0.16);
    const exit = p > 0.76 ? Math.max(0, 1 - (p - 0.76) / 0.24) : 1;
    const ease = 1 - Math.pow(1 - enter, 3);
    const alpha = Math.min(1, ease) * exit;
    if (alpha <= 0.01) return;

    const bandY = viewH * 0.22;
    const bandH = 74;
    const slideX = (1 - ease) * cutIn.facing * 200;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(slideX, 0);

    // Flat crisp Flash-animation monochrome formula banner (ZERO AI neon glow!)
    ctx.fillStyle = theme.isLight ? 'rgba(250, 250, 248, 0.94)' : 'rgba(8, 8, 10, 0.94)';
    ctx.fillRect(0, bandY, viewW, bandH);

    ctx.strokeStyle = theme.chalkCore;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, bandY); ctx.lineTo(viewW, bandY);
    ctx.moveTo(0, bandY + bandH); ctx.lineTo(viewW, bandY + bandH);
    ctx.stroke();

    // Signature thin orange accent slash bar at left/right margin
    ctx.fillStyle = '#ff7a1a';
    ctx.fillRect(0, bandY, 6, bandH);
    ctx.fillRect(viewW - 6, bandY, 6, bandH);

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = inkStroke(theme, cutIn.color);
    ctx.font = `italic 700 28px ${MATH_SERIF}`;
    ctx.fillText(cutIn.formula, viewW * 0.5, bandY + 28);

    ctx.fillStyle = theme.axisLabel;
    ctx.font = `600 13px ${UI_SANS}`;
    ctx.fillText(`${cutIn.title}  —  ${cutIn.sub}`, viewW * 0.5, bandY + 56);

    ctx.restore();
  }
}
