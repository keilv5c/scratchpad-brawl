import { PaperTheme, StageDef, Vec2 } from '../types';

/**
 * Dynamically sized tactile sketchbook paper generator + Persistent Battle-Damage Ink Layer
 * + Full-Viewport Physical Page-Flip Transition!
 * Adapts to any stage world size (from standard 1440×780 up to 2400×960 Twin-Page Spread & 1680×1240 Tower!).
 */
export class PaperLayer {
  public bgCanvas: HTMLCanvasElement;
  public stainCanvas: HTMLCanvasElement;
  private stainCtx: CanvasRenderingContext2D;
  private flipSnapshot: HTMLCanvasElement;
  private flipCtx: CanvasRenderingContext2D;

  public worldW = 1440;
  public worldH = 780;
  public flipProgress = 1;
  private currentBakeKey = '';

  constructor() {
    this.bgCanvas = document.createElement('canvas');
    this.stainCanvas = document.createElement('canvas');
    this.flipSnapshot = document.createElement('canvas');
    this.resizeWorld(1440, 780);
    this.stainCtx = this.stainCanvas.getContext('2d')!;
    this.flipCtx = this.flipSnapshot.getContext('2d')!;
  }

  private resizeWorld(w: number, h: number): void {
    this.worldW = w;
    this.worldH = h;
    this.bgCanvas.width = w;
    this.bgCanvas.height = h;
    this.stainCanvas.width = w;
    this.stainCanvas.height = h;
    this.stainCtx = this.stainCanvas.getContext('2d')!;
  }

  public setThemeAndStage(theme: PaperTheme, stage: StageDef, force = false): void {
    const key = `${theme.id}_${stage.id}_${stage.worldWidth}x${stage.worldHeight}`;
    if (!force && this.currentBakeKey === key) return;
    this.currentBakeKey = key;
    if (this.worldW !== stage.worldWidth || this.worldH !== stage.worldHeight) {
      this.resizeWorld(stage.worldWidth, stage.worldHeight);
    }
    this.bakePaperBackground(theme, stage);
  }

  public clearStains(): void {
    this.stainCtx.clearRect(0, 0, this.worldW, this.worldH);
  }

  /**
   * Capture current viewport canvas for a crisp full-screen 3D page-flip transition!
   */
  public triggerPageFlip(sourceScreenCanvas?: HTMLCanvasElement): void {
    if (sourceScreenCanvas && sourceScreenCanvas.width > 0 && sourceScreenCanvas.height > 0) {
      this.flipSnapshot.width = sourceScreenCanvas.width;
      this.flipSnapshot.height = sourceScreenCanvas.height;
      this.flipCtx = this.flipSnapshot.getContext('2d')!;
      this.flipCtx.drawImage(sourceScreenCanvas, 0, 0);
    } else {
      this.flipSnapshot.width = this.worldW;
      this.flipSnapshot.height = this.worldH;
      this.flipCtx = this.flipSnapshot.getContext('2d')!;
      this.flipCtx.drawImage(this.bgCanvas, 0, 0);
      this.flipCtx.drawImage(this.stainCanvas, 0, 0);
    }
    this.clearStains();
    this.flipProgress = 0;
  }

  public update(dt: number): void {
    if (this.flipProgress < 1) {
      this.flipProgress = Math.min(1, this.flipProgress + dt * 2.0);
    }
  }

  public addInkSplatter(pos: Vec2, color: string, size = 14, dirX = 0, dirY = 0): void {
    const ctx = this.stainCtx;
    ctx.save();
    ctx.fillStyle = color;

    const dropCount = Math.floor(4 + size * 0.45);
    for (let i = 0; i < dropCount; i++) {
      const spread = size * (0.4 + Math.random() * 1.8);
      const ang = Math.random() * Math.PI * 2;
      const ox = Math.cos(ang) * spread + dirX * Math.random() * size * 1.4;
      const oy = Math.sin(ang) * spread + dirY * Math.random() * size * 0.9;
      const r = (1.2 + Math.random() * (size * 0.28)) * (i === 0 ? 1.4 : 1);

      ctx.globalAlpha = 0.22 + Math.random() * 0.36;
      ctx.beginPath();
      ctx.ellipse(
        pos.x + ox,
        pos.y + oy,
        r * (0.8 + Math.random() * 0.7),
        r * (0.7 + Math.random() * 0.5),
        Math.random() * Math.PI,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
    ctx.restore();
  }

  public addPaperScratch(x1: number, y1: number, x2: number, y2: number, color: string, width = 2.4): void {
    const ctx = this.stainCtx;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.32;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  public drawPageFlipOverlay(ctx: CanvasRenderingContext2D, viewW: number, viewH: number): void {
    if (this.flipProgress >= 1) return;
    const t = this.flipProgress;
    const ease = 1 - Math.pow(1 - t, 3);
    const edgeX = viewW * (1 - ease);

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, edgeX, viewH);
    ctx.clip();
    ctx.drawImage(this.flipSnapshot, 0, 0, viewW, viewH);
    ctx.restore();

    const curlW = Math.min(200, edgeX * 0.45 + 40) * Math.sin(t * Math.PI);
    ctx.save();
    const shadowGrad = ctx.createLinearGradient(edgeX, 0, edgeX + curlW * 0.7, 0);
    shadowGrad.addColorStop(0, 'rgba(20, 18, 15, 0.34)');
    shadowGrad.addColorStop(1, 'rgba(20, 18, 15, 0)');
    ctx.fillStyle = shadowGrad;
    ctx.fillRect(edgeX, 0, curlW * 0.7, viewH);

    const pageGrad = ctx.createLinearGradient(edgeX - curlW, 0, edgeX, 0);
    pageGrad.addColorStop(0, 'rgba(225, 218, 202, 0.92)');
    pageGrad.addColorStop(0.7, 'rgba(248, 244, 234, 0.98)');
    pageGrad.addColorStop(1, 'rgba(205, 198, 182, 0.95)');
    ctx.fillStyle = pageGrad;
    ctx.fillRect(edgeX - curlW, 0, curlW, viewH);

    ctx.strokeStyle = 'rgba(40, 36, 30, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(edgeX, 0);
    ctx.lineTo(edgeX, viewH);
    ctx.stroke();
    ctx.restore();
  }

  private bakePaperBackground(theme: PaperTheme, stage: StageDef): void {
    const ctx = this.bgCanvas.getContext('2d')!;
    const W = this.worldW;
    const H = this.worldH;
    const visual = stage.visualKind ?? 'standard';

    // 1. Base paper gradient (Special Twin-Page Spread has distinct Left & Right paper!)
    if (visual === 'spread') {
      ctx.fillStyle = '#f6f3eb';
      ctx.fillRect(0, 0, W * 0.5, H);
      ctx.fillStyle = '#ebdab9';
      ctx.fillRect(W * 0.5, 0, W * 0.5, H);

      // Left math grid
      const cell = 32;
      ctx.strokeStyle = 'rgba(84, 134, 189, 0.16)';
      ctx.lineWidth = 1;
      for (let x = 0; x < W * 0.5; x += cell) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
      }
      for (let y = 0; y < H; y += cell) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W * 0.5, y); ctx.stroke();
      }
      // Right ruled kraft lines
      ctx.strokeStyle = 'rgba(110, 74, 38, 0.17)';
      ctx.lineWidth = 1.25;
      for (let y = 76; y < H; y += 36) {
        ctx.beginPath(); ctx.moveTo(W * 0.5, y); ctx.lineTo(W, y); ctx.stroke();
      }

      // Shaded 3D Center Book Gutter + Giant Spiral Wire Rings!
      const gutterGrad = ctx.createLinearGradient(W * 0.5 - 110, 0, W * 0.5 + 110, 0);
      gutterGrad.addColorStop(0, 'rgba(30, 24, 16, 0)');
      gutterGrad.addColorStop(0.45, 'rgba(30, 24, 16, 0.24)');
      gutterGrad.addColorStop(0.5, 'rgba(20, 16, 10, 0.36)');
      gutterGrad.addColorStop(0.55, 'rgba(30, 24, 16, 0.24)');
      gutterGrad.addColorStop(1, 'rgba(30, 24, 16, 0)');
      ctx.fillStyle = gutterGrad;
      ctx.fillRect(W * 0.5 - 110, 0, 220, H);

      // Spiral metal binding rings along the canyon spine!
      ctx.strokeStyle = '#333845';
      ctx.lineWidth = 4;
      for (let ry = 70; ry < H - 40; ry += 68) {
        ctx.beginPath();
        ctx.ellipse(W * 0.5, ry, 34, 11, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.fillStyle = 'rgba(28, 25, 20, 0.22)';
        ctx.beginPath(); ctx.arc(W * 0.5 - 32, ry, 5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(W * 0.5 + 32, ry, 5, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      const bgGrad = ctx.createRadialGradient(W * 0.5, H * 0.45, 100, W * 0.5, H * 0.5, Math.max(W, H) * 0.72);
      bgGrad.addColorStop(0, theme.paperBg);
      bgGrad.addColorStop(1, theme.paperTint);
      ctx.fillStyle = bgGrad;
      ctx.fillRect(0, 0, W, H);

      if (theme.hasGrid) {
        const cell = 32;
        ctx.strokeStyle = theme.gridSecondary;
        ctx.lineWidth = 1;
        for (let x = 0; x <= W; x += cell) {
          ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke();
        }
        for (let y = 0; y <= H; y += cell) {
          ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke();
        }
        ctx.strokeStyle = theme.gridColor;
        ctx.lineWidth = 1.25;
        for (let x = 0; x <= W; x += cell * 4) {
          ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, H); ctx.stroke();
        }
        for (let y = 0; y <= H; y += cell * 4) {
          ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(W, y + 0.5); ctx.stroke();
        }
      }

      if (theme.hasRuledLines) {
        ctx.strokeStyle = theme.gridColor;
        ctx.lineWidth = 1.2;
        for (let y = 78; y < H; y += 34) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
        }
      }

      if (theme.hasBambooWash || visual === 'sea') {
        ctx.save();
        ctx.fillStyle = visual === 'sea' ? 'rgba(26, 36, 48, 0.08)' : 'rgba(42, 48, 45, 0.065)';
        ctx.beginPath();
        ctx.moveTo(0, H);
        ctx.quadraticCurveTo(W * 0.2, H * 0.45, W * 0.42, H * 0.65);
        ctx.quadraticCurveTo(W * 0.65, H * 0.38, W * 0.85, H * 0.62);
        ctx.quadraticCurveTo(W * 0.94, H * 0.48, W, H * 0.58);
        ctx.lineTo(W, H);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      }
    }

    // 2. Subtle procedural paper grain scaled to area
    const grainCount = Math.min(9000, Math.floor((W * H) / 220));
    ctx.save();
    for (let i = 0; i < grainCount; i++) {
      const gx = Math.random() * W;
      const gy = Math.random() * H;
      const dark = Math.random() > 0.5;
      ctx.fillStyle = dark
        ? `rgba(40, 30, 18, ${theme.grainAlpha * Math.random()})`
        : `rgba(255, 255, 255, ${theme.grainAlpha * 1.4 * Math.random()})`;
      ctx.fillRect(gx, gy, 1.5 + Math.random() * 2.5, 1.2);
    }
    ctx.restore();

    // 3. Special stage ambient doodles (Tower floor markers, Desk ruler ticks, Ship moon!)
    if (visual === 'tower') {
      ctx.save();
      ctx.fillStyle = 'rgba(178, 42, 36, 0.34)';
      ctx.font = '900 32px "STKaiti", "KaiTi", serif';
      ctx.fillText('壹层 · 1F', 74, 1080);
      ctx.fillText('贰层 · 2F', 74, 845);
      ctx.fillText('叁层 · 3F', 74, 600);
      ctx.fillText('凌霄顶 · 4F', 74, 345);
      ctx.restore();
    } else if (visual === 'desk') {
      ctx.save();
      ctx.strokeStyle = 'rgba(65, 50, 35, 0.22)';
      ctx.lineWidth = 1.6;
      for (let rx = 80; rx < W - 80; rx += 40) {
        const tall = rx % 200 === 0 ? 22 : 11;
        ctx.beginPath(); ctx.moveTo(rx, 0); ctx.lineTo(rx, tall); ctx.stroke();
      }
      ctx.restore();
    } else if (visual === 'sea') {
      // Ink-wash full moon behind the ship sails!
      ctx.save();
      ctx.fillStyle = 'rgba(255, 252, 238, 0.65)';
      ctx.beginPath();
      ctx.arc(W * 0.5, 210, 92, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(40, 44, 52, 0.25)';
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.restore();
    }

    // 4. Vertical red notebook margin bounds
    ctx.save();
    ctx.strokeStyle = theme.marginColor;
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(54, 0); ctx.lineTo(54, H);
    ctx.moveTo(W - 54, 0); ctx.lineTo(W - 54, H);
    ctx.stroke();

    if (theme.hasHoles && visual !== 'spread') {
      for (let hy = 140; hy < H - 80; hy += 220) {
        ctx.beginPath();
        ctx.arc(25, hy, 11, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(40, 38, 35, 0.16)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(40, 38, 35, 0.28)';
        ctx.lineWidth = 1.6;
        ctx.stroke();
      }
    }
    ctx.restore();
  }
}
