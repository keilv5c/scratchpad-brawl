import { Vec2, WeaponId } from '../types';
import { sketchNoise } from '../engine/math';
import { SmearSample } from '../combat/fighter';

/**
 * Hand-drawn boiling line primitive.
 * Draws slightly imperfect multi-pass ink strokes whose jitter updates at ~10 FPS (boilFrame).
 */
export function sketchLine(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  seed: number,
  boilFrame: number,
  wobble = 1.6,
  passes = 2
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 0.5) return;
  const nx = -dy / len;
  const ny = dx / len;
  const steps = Math.max(2, Math.min(8, Math.ceil(len / 28)));

  for (let p = 0; p < passes; p++) {
    ctx.beginPath();
    const ox0 = sketchNoise(seed + p * 31, boilFrame) * wobble * 0.5;
    const oy0 = sketchNoise(seed + p * 31 + 7, boilFrame) * wobble * 0.5;
    ctx.moveTo(x1 + ox0, y1 + oy0);

    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const jitter = sketchNoise(seed + p * 53 + i * 17, boilFrame) * wobble;
      const px = x1 + dx * t + nx * jitter;
      const py = y1 + dy * t + ny * jitter;
      ctx.lineTo(px, py);
    }

    const ox1 = sketchNoise(seed + p * 31 + 99, boilFrame) * wobble * 0.5;
    const oy1 = sketchNoise(seed + p * 31 + 107, boilFrame) * wobble * 0.5;
    ctx.lineTo(x2 + ox1, y2 + oy1);
    ctx.stroke();
  }
}

export function sketchPolyline(
  ctx: CanvasRenderingContext2D,
  pts: Vec2[],
  seed: number,
  boilFrame: number,
  wobble = 1.3
): void {
  if (pts.length < 2) return;
  ctx.beginPath();
  for (let i = 0; i < pts.length; i++) {
    const jx = sketchNoise(seed + i * 19, boilFrame) * wobble;
    const jy = sketchNoise(seed + i * 19 + 7, boilFrame) * wobble;
    if (i === 0) ctx.moveTo(pts[i].x + jx, pts[i].y + jy);
    else ctx.lineTo(pts[i].x + jx, pts[i].y + jy);
  }
  ctx.stroke();
}

export function sketchCircle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  seed: number,
  boilFrame: number,
  wobble = 1.4,
  fill?: string
): void {
  const segs = 16;
  ctx.beginPath();
  for (let i = 0; i <= segs + 1; i++) {
    const ang = (i / segs) * Math.PI * 2;
    const nr = r + sketchNoise(seed + (i % segs) * 13, boilFrame) * wobble;
    const x = cx + Math.cos(ang) * nr;
    const y = cy + Math.sin(ang) * nr;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  ctx.stroke();
}

export function sketchRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
  boilFrame: number,
  wobble = 1.8,
  fill?: string,
  hatch = false,
  hatchColor = 'rgba(30,30,35,0.18)',
  visMinX = -Infinity,
  visMaxX = Infinity
): void {
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fillRect(x, y, w, h);
  }

  if (hatch) {
    const step = 12;
    const rawStart = x - h;
    const rawEnd = x + w + h;
    const startX = Math.max(rawStart, Math.floor((visMinX - h) / step) * step);
    const endX = Math.min(rawEnd, visMaxX + h);

    if (endX > startX) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, w, h);
      ctx.clip();
      ctx.strokeStyle = hatchColor;
      ctx.lineWidth = 1.25;
      // Single batched path for all diagonal hatch strokes (~100x fewer draw calls!)
      ctx.beginPath();
      for (let hx = startX; hx < endX; hx += step) {
        const s = seed + Math.floor(hx);
        const j0 = sketchNoise(s, boilFrame) * 0.65;
        const j1 = sketchNoise(s + 37, boilFrame) * 0.65;
        ctx.moveTo(hx + j0, y + h);
        ctx.lineTo(hx + h * 0.75 + j1, y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  sketchLine(ctx, x, y, x + w, y, seed + 1, boilFrame, wobble, 2);
  sketchLine(ctx, x + w, y, x + w, y + h, seed + 2, boilFrame, wobble, 2);
  sketchLine(ctx, x + w, y + h, x, y + h, seed + 3, boilFrame, wobble, 2);
  sketchLine(ctx, x, y + h, x, y, seed + 4, boilFrame, wobble, 2);
}

/**
 * Renders calligraphic dry-brush weapon smear ribbon following real blade movement!
 */
export function drawSmearTrail(
  ctx: CanvasRenderingContext2D,
  samples: SmearSample[],
  boilFrame: number
): void {
  if (samples.length < 2) return;
  ctx.save();
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1];
    const b = samples[i];
    const alpha = Math.max(0, Math.min(1, b.life / b.maxLife));
    const taper = i / samples.length;

    ctx.beginPath();
    ctx.moveTo(a.base.x, a.base.y);
    ctx.lineTo(a.tip.x, a.tip.y);
    ctx.lineTo(b.tip.x, b.tip.y);
    ctx.lineTo(b.base.x, b.base.y);
    ctx.closePath();

    ctx.fillStyle = b.color;
    ctx.globalAlpha = alpha * (b.heavy ? 0.56 : 0.36) * taper;
    ctx.fill();

    // Crisp outer ink bristle edge
    ctx.strokeStyle = b.color;
    ctx.lineWidth = b.heavy ? 3.8 : 2.2;
    ctx.globalAlpha = alpha * 0.88;
    sketchLine(ctx, a.tip.x, a.tip.y, b.tip.x, b.tip.y, 700 + i * 13, boilFrame, 1.4, 1);

    // Inner dry-brush white streak on heavy cuts
    if (b.heavy) {
      const m1x = (a.base.x + a.tip.x) * 0.55;
      const m1y = (a.base.y + a.tip.y) * 0.55;
      const m2x = (b.base.x + b.tip.x) * 0.55;
      const m2y = (b.base.y + b.tip.y) * 0.55;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1.6;
      ctx.globalAlpha = alpha * 0.55;
      ctx.beginPath();
      ctx.moveTo(m1x, m1y);
      ctx.lineTo(m2x, m2y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * Draws all 12 iconic hand-sketched pure-stationery weapons directly along hand -> tip vector!
 */
export function drawSketchedWeapon(
  ctx: CanvasRenderingContext2D,
  weapon: WeaponId,
  base: Vec2,
  tip: Vec2,
  inkColor: string,
  accentColor: string,
  seed: number,
  boilFrame: number,
  offhandBase?: Vec2,
  offhandTip?: Vec2 | null
): void {
  const dx = tip.x - base.x;
  const dy = tip.y - base.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const nx = -uy;
  const ny = ux;
  const ang = Math.atan2(dy, dx);

  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  if (weapon === 'compass') {
    // Classic Metal Drafting Compass: top knob + splayed needle leg & pencil leg + center bar!
    ctx.translate(base.x, base.y);
    ctx.rotate(ang);
    const spread = 13 + Math.sin(boilFrame * 0.8) * 3;
    // Top handle knob
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(-14, 0); ctx.lineTo(0, 0); ctx.stroke();
    ctx.fillStyle = accentColor;
    ctx.beginPath(); ctx.arc(0, 0, 5.5, 0, Math.PI * 2); ctx.fill();
    ctx.stroke();
    // Leg 1: sharp steel needle
    ctx.strokeStyle = '#546175';
    ctx.lineWidth = 3.2;
    ctx.beginPath(); ctx.moveTo(2, -2); ctx.lineTo(len, -spread); ctx.stroke();
    // Leg 2: graphite lead clamp
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = 3.6;
    ctx.beginPath(); ctx.moveTo(2, 2); ctx.lineTo(len * 0.94, spread); ctx.stroke();
    // Center adjustment screw bar
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(len * 0.45, -spread * 0.5); ctx.lineTo(len * 0.45, spread * 0.5); ctx.stroke();
  } else if (weapon === 'tape') {
    // Translucent Plastic Correction Tape Dispenser with visible dual gear reels + white tape tip!
    ctx.translate(base.x, base.y);
    ctx.rotate(ang);
    ctx.fillStyle = 'rgba(72, 165, 240, 0.36)';
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.roundRect(-10, -14, len * 0.84, 28, 12);
    ctx.fill();
    ctx.stroke();
    // Twin internal tape spools (big white reel + small blue gear)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(len * 0.22, 0, 8.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#2685d9';
    ctx.beginPath(); ctx.arc(len * 0.56, 0, 5.5, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // White correction tape nozzle sticking out!
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#2685d9';
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(len * 0.72, -5);
    ctx.lineTo(len, -3);
    ctx.lineTo(len, 3);
    ctx.lineTo(len * 0.72, 5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (weapon === 'ruler') {
    // 30cm Silver Steel Ruler with centimeter tick marks & hanging hole!
    ctx.translate(base.x, base.y);
    ctx.rotate(ang);
    ctx.fillStyle = '#dfe5ee';
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.rect(-12, -6.5, len + 12, 13);
    ctx.fill();
    ctx.stroke();
    // Centimeter ruler ticks!
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = 1.4;
    for (let rx = 2; rx < len - 6; rx += 8) {
      const tickH = rx % 16 === 2 ? 5.5 : 3.2;
      ctx.beginPath(); ctx.moveTo(rx, -6.5); ctx.lineTo(rx, -6.5 + tickH); ctx.stroke();
    }
    // Red accent measurement stripe & hanging hole
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(-4, 2.5); ctx.lineTo(len - 10, 2.5); ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath(); ctx.arc(len - 6, 0, 2.3, 0, Math.PI * 2); ctx.fill();
  } else if (weapon === 'eraser') {
    // Giant Two-Tone Pink/Blue Rubber Eraser mounted on a sturdy wooden pencil shaft!
    ctx.translate(base.x, base.y);
    ctx.rotate(ang);
    // Wooden handle shaft
    ctx.strokeStyle = '#9c6e2c';
    ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(-22, 0); ctx.lineTo(len - 16, 0); ctx.stroke();
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = 2;
    ctx.strokeRect(-22, -3, len + 4, 6);
    // Massive Pink/Blue Rubber Eraser Hammer Head!
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = 2.8;
    sketchRect(ctx, len - 24, -22, 28, 30, seed + 21, boilFrame, 1.1, '#f089a4');
    sketchRect(ctx, len - 24, 8, 28, 14, seed + 22, boilFrame, 1.1, '#4c86d6');
  } else if (weapon === 'cutter') {
    // Yellow Snap-Off Utility Knife + Offhand Red Thumbtack!
    ctx.translate(base.x, base.y);
    ctx.rotate(ang);
    // Yellow plastic handle body
    ctx.fillStyle = '#f5c227';
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = 2.3;
    ctx.beginPath();
    ctx.roundRect(-12, -6, len * 0.65, 12, 3);
    ctx.fill();
    ctx.stroke();
    // Black slider thumb button
    ctx.fillStyle = '#1d2028';
    ctx.fillRect(len * 0.25, -4, 9, 8);
    // Gleaming segmented silver razor blade!
    ctx.fillStyle = '#e8eef5';
    ctx.beginPath();
    ctx.moveTo(len * 0.53, -4.5);
    ctx.lineTo(len, -4.5);
    ctx.lineTo(len - 6, 4.5);
    ctx.lineTo(len * 0.53, 4.5);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Draw offhand red thumbtack spike!
    if (offhandBase && offhandTip) {
      ctx.save();
      const odx = offhandTip.x - offhandBase.x;
      const ody = offhandTip.y - offhandBase.y;
      const olen = Math.hypot(odx, ody) || 1;
      ctx.translate(offhandBase.x, offhandBase.y);
      ctx.rotate(Math.atan2(ody, odx));
      ctx.fillStyle = '#e02f2f';
      ctx.strokeStyle = inkColor;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.ellipse(-4, 0, 5, 8, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(1, -2.5); ctx.lineTo(olen * 0.75, 0); ctx.lineTo(1, 2.5); ctx.closePath();
      ctx.fillStyle = '#c8d2de'; ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    return;
  } else if (weapon === 'pencil') {
    // Long Mechanical Pencil with pocket clip, top click cap & fine 2B graphite lead!
    const back = { x: base.x - ux * 32, y: base.y - uy * 32 };
    const totalLen = Math.hypot(tip.x - back.x, tip.y - back.y);
    ctx.translate(back.x, back.y);
    ctx.rotate(ang);
    // Clicker cap at tail
    ctx.fillStyle = '#d6dde6';
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = 2.2;
    ctx.fillRect(-8, -3.5, 10, 7);
    ctx.strokeRect(-8, -3.5, 10, 7);
    // Sleek teal barrel
    ctx.fillStyle = '#2a8c76';
    ctx.fillRect(2, -4.2, totalLen - 24, 8.4);
    ctx.strokeRect(2, -4.2, totalLen - 24, 8.4);
    // Metal pocket clip
    ctx.strokeStyle = '#cfd7e2';
    ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(8, -5.5); ctx.lineTo(32, -5.5); ctx.stroke();
    // Tapered metal tip + extended 2B lead!
    ctx.fillStyle = '#dbe2ec';
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(totalLen - 22, -4.2);
    ctx.lineTo(totalLen - 8, -1.4);
    ctx.lineTo(totalLen - 8, 1.4);
    ctx.lineTo(totalLen - 22, 4.2);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    ctx.strokeStyle = '#181b22';
    ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.moveTo(totalLen - 8, 0); ctx.lineTo(totalLen + 4, 0); ctx.stroke();
  } else if (weapon === 'whip') {
    // Oscillating chain of linked hand-sketched metal paperclips + binder clip claw!
    const links = 7;
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = 2.6;
    let prevX = base.x;
    let prevY = base.y;
    for (let i = 1; i <= links; i++) {
      const t = i / links;
      const wave = Math.sin(t * Math.PI * 2 + boilFrame * 0.9) * (6 + t * 8);
      const px = base.x + dx * t + nx * wave;
      const py = base.y + dy * t + ny * wave;
      const mx = (prevX + px) * 0.5;
      const my = (prevY + py) * 0.5;
      const segAng = Math.atan2(py - prevY, px - prevX);
      const segL = Math.hypot(px - prevX, py - prevY) * 0.55;

      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate(segAng);
      ctx.strokeStyle = i === links ? accentColor : inkColor;
      ctx.beginPath();
      ctx.roundRect(-segL, -3.5, segL * 2, 7, 3.5);
      ctx.stroke();
      ctx.restore();
      prevX = px;
      prevY = py;
    }
    // Binder clip claw at tip!
    ctx.fillStyle = '#1c1f28';
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(tip.x - nx * 7, tip.y - ny * 7);
    ctx.lineTo(tip.x + ux * 10, tip.y + uy * 10);
    ctx.lineTo(tip.x + nx * 7, tip.y + ny * 7);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (weapon === 'boomerang') {
    // Draftsman's translucent Set-Square Triangle Ruler!
    const side = 46;
    const p1 = base;
    const p2 = { x: base.x + ux * side, y: base.y + uy * side };
    const p3 = { x: base.x + nx * (side * 0.72), y: base.y + ny * (side * 0.72) };

    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.lineTo(p3.x, p3.y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(42, 178, 204, 0.32)';
    ctx.fill();
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = 2.8;
    ctx.stroke();

    const cx = (p1.x + p2.x + p3.x) / 3;
    const cy = (p1.y + p2.y + p3.y) / 3;
    ctx.beginPath();
    ctx.moveTo(cx + (p1.x - cx) * 0.45, cy + (p1.y - cy) * 0.45);
    ctx.lineTo(cx + (p2.x - cx) * 0.45, cy + (p2.y - cy) * 0.45);
    ctx.lineTo(cx + (p3.x - cx) * 0.45, cy + (p3.y - cy) * 0.45);
    ctx.closePath();
    ctx.strokeStyle = accentColor;
    ctx.lineWidth = 1.8;
    ctx.stroke();
  } else if (weapon === 'scissors') {
    // Red-Handled Double-Blade Craft Scissors!
    ctx.translate(base.x, base.y);
    ctx.rotate(ang);
    const open = 0.24 + Math.abs(Math.sin(boilFrame * 0.7)) * 0.14;
    // Two crossed silver blades
    ctx.fillStyle = '#dfe6f0';
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = 2.3;
    for (const dir of [-1, 1]) {
      ctx.save();
      ctx.rotate(dir * open);
      ctx.beginPath();
      ctx.moveTo(4, 0);
      ctx.lineTo(len, dir * -2);
      ctx.lineTo(len - 10, dir * 6);
      ctx.lineTo(4, dir * 4);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    // Pivot screw
    ctx.fillStyle = '#333';
    ctx.beginPath(); ctx.arc(8, 0, 3, 0, Math.PI * 2); ctx.fill();
    // Red oval finger loops!
    ctx.strokeStyle = '#d92828';
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.ellipse(-10, -8, 9, 5.5, -0.3, 0, Math.PI * 2); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(-10, 8, 9, 5.5, 0.3, 0, Math.PI * 2); ctx.stroke();
  } else if (weapon === 'stapler') {
    // Heavy Office Stapler Punch-Gun!
    ctx.translate(base.x, base.y);
    ctx.rotate(ang);
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = 2.5;
    // Steel baseplate
    ctx.fillStyle = '#53627a';
    ctx.beginPath(); ctx.roundRect(-8, 2, len + 4, 8, 2); ctx.fill(); ctx.stroke();
    // Hinged red/slate upper clamp arm
    ctx.fillStyle = '#d93636';
    ctx.beginPath(); ctx.roundRect(-6, -12, len, 13, 4); ctx.fill(); ctx.stroke();
    // Chrome staple mouth
    ctx.fillStyle = '#e4ebf5';
    ctx.fillRect(len - 10, -2, 8, 6);
  } else if (weapon === 'highlighter') {
    // Chunky Dual Neon Highlighters (Yellow main + Pink offhand!)
    const drawMarker = (b: Vec2, t: Vec2, bodyCol: string) => {
      const mdx = t.x - b.x;
      const mdy = t.y - b.y;
      const mlen = Math.hypot(mdx, mdy) || 1;
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(Math.atan2(mdy, mdx));
      ctx.fillStyle = bodyCol;
      ctx.strokeStyle = inkColor;
      ctx.lineWidth = 2.4;
      ctx.beginPath(); ctx.roundRect(-10, -7, mlen * 0.8, 14, 3); ctx.fill(); ctx.stroke();
      // Chisel felt tip!
      ctx.fillStyle = bodyCol;
      ctx.beginPath();
      ctx.moveTo(mlen * 0.72, -5);
      ctx.lineTo(mlen, -3);
      ctx.lineTo(mlen - 4, 5);
      ctx.lineTo(mlen * 0.72, 5);
      ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    };
    drawMarker(base, tip, '#f5da22');
    if (offhandBase && offhandTip) {
      drawMarker(offhandBase, offhandTip, '#ff66b5');
    }
    ctx.restore();
    return;
  } else if (weapon === 'fountain_pen') {
    // Noble Glossy Black & Gold-Nib Fountain Pen!
    ctx.translate(base.x, base.y);
    ctx.rotate(ang);
    // Sleek black lacquer barrel
    ctx.fillStyle = '#15171e';
    ctx.strokeStyle = inkColor;
    ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.roundRect(-18, -5.5, len * 0.78, 11, 5); ctx.fill(); ctx.stroke();
    // Gold cap ring
    ctx.fillStyle = '#e5aa22';
    ctx.fillRect(len * 0.45, -5.8, 6, 11.6);
    // Sculpted diamond Gold Fountain Nib!
    ctx.fillStyle = '#f2be38';
    ctx.strokeStyle = '#6b4706';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(len * 0.62, -4);
    ctx.lineTo(len * 0.82, -6.5);
    ctx.lineTo(len + 4, 0);
    ctx.lineTo(len * 0.82, 6.5);
    ctx.lineTo(len * 0.62, 4);
    ctx.closePath();
    ctx.fill(); ctx.stroke();
    // Center nib ink slit & breather hole
    ctx.strokeStyle = '#14161c';
    ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(len * 0.74, 0); ctx.lineTo(len + 2, 0); ctx.stroke();
    ctx.fillStyle = '#14161c';
    ctx.beginPath(); ctx.arc(len * 0.75, 0, 1.8, 0, Math.PI * 2); ctx.fill();
  }

  ctx.restore();
}

/**
 * Hand-sketched moving Origami Paper Airplane platform!
 */
export function drawOrigamiPlane(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  seed: number,
  boilFrame: number,
  strokeCol: string,
  fillCol: string
): void {
  ctx.save();
  // Top deck silhouette of folded paper glider
  ctx.beginPath();
  ctx.moveTo(x, y + 3);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w - 26, y + h + 10);
  ctx.lineTo(x + w * 0.48, y + h - 2);
  ctx.lineTo(x + 22, y + h + 12);
  ctx.closePath();
  ctx.fillStyle = fillCol;
  ctx.fill();

  ctx.strokeStyle = strokeCol;
  ctx.lineWidth = 2.8;
  sketchLine(ctx, x, y + 3, x + w, y, seed + 1, boilFrame, 1.2, 2);
  sketchLine(ctx, x + w, y, x + w - 26, y + h + 10, seed + 2, boilFrame, 1.1, 1);
  sketchLine(ctx, x + w - 26, y + h + 10, x + 16, y + h + 4, seed + 3, boilFrame, 1.1, 1);
  sketchLine(ctx, x, y + 3, x + 22, y + h + 12, seed + 4, boilFrame, 1.1, 1);
  // Central origami crease line
  ctx.lineWidth = 1.8;
  sketchLine(ctx, x + 12, y + 5, x + w - 10, y + 2, seed + 5, boilFrame, 0.8, 1);
  ctx.restore();
}

/**
 * Charming Giant Artist's Pencil that swoops in to sketch weapons & broken bridges onto the page!
 */
export function drawGiantPencil(
  ctx: CanvasRenderingContext2D,
  tipPos: Vec2,
  boilFrame: number
): void {
  ctx.save();
  ctx.translate(tipPos.x, tipPos.y);
  ctx.rotate(-0.68); // classic right-handed sketching slant

  // Graphite nib tip at (0, 0)
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(24, -11);
  ctx.lineTo(24, 11);
  ctx.closePath();
  ctx.fillStyle = '#ebd3ad';
  ctx.fill();
  ctx.strokeStyle = '#1b1d24';
  ctx.lineWidth = 2.5;
  ctx.stroke();

  // Dark graphite lead point
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(9, -4.2);
  ctx.lineTo(9, 4.2);
  ctx.closePath();
  ctx.fillStyle = '#1b1d24';
  ctx.fill();

  // Yellow #2 wooden hexagonal shaft
  sketchRect(ctx, 24, -11, 138, 22, 910, boilFrame, 1.3, '#f3c13a');
  ctx.strokeStyle = '#9c7112';
  ctx.lineWidth = 1.5;
  sketchLine(ctx, 24, -3.5, 162, -3.5, 911, boilFrame, 0.7, 1);
  sketchLine(ctx, 24, 3.5, 162, 3.5, 912, boilFrame, 0.7, 1);

  // Silver metal ferrule
  sketchRect(ctx, 162, -11, 16, 22, 913, boilFrame, 1.0, '#c6cdd6');

  // Pink rubber eraser top!
  sketchRect(ctx, 178, -10.5, 22, 21, 914, boilFrame, 1.1, '#ea8ba3');

  ctx.restore();
}
