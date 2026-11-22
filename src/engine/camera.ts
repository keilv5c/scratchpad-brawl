import { Vec2 } from '../types';
import { clamp, lerp } from './math';

export class Camera {
  public x = 720;
  public y = 390;
  public zoom = 1.0;

  public viewW = 1280;
  public viewH = 720;
  public worldW = 1440;
  public worldH = 780;

  private shakeMag = 0;
  private shakeDirX = 0;
  private shakeDirY = 0;
  private shakeTimer = 0;
  private focusPoint: Vec2 | null = null;
  private focusZoom = 1.0;
  private focusTimer = 0;

  public offsetX = 0;
  public offsetY = 0;

  public setViewport(w: number, h: number): void {
    this.viewW = Math.max(320, w);
    this.viewH = Math.max(240, h);
  }

  public setWorldSize(w: number, h: number): void {
    this.worldW = Math.max(960, w);
    this.worldH = Math.max(600, h);
  }

  public screenToWorld(screenPos: Vec2): Vec2 {
    return {
      x: (screenPos.x - (this.viewW * 0.5 + this.offsetX)) / this.zoom + this.x,
      y: (screenPos.y - (this.viewH * 0.5 + this.offsetY)) / this.zoom + this.y,
    };
  }

  public reset(): void {
    this.x = this.worldW * 0.5;
    this.y = this.worldH * 0.55;
    this.zoom = Math.max(this.viewW / this.worldW, this.viewH / this.worldH, 1.0);
    this.shakeMag = 0;
    this.shakeTimer = 0;
    this.focusTimer = 0;
    this.focusPoint = null;
    this.offsetX = 0;
    this.offsetY = 0;
  }

  public shake(magnitude: number, dirX = 0, dirY = 0): void {
    this.shakeMag = Math.max(this.shakeMag, magnitude);
    this.shakeDirX = dirX;
    this.shakeDirY = dirY;
    this.shakeTimer = Math.max(this.shakeTimer, 0.24);
  }

  public punchFocus(point: Vec2, zoomBoost: number, duration: number): void {
    this.focusPoint = { x: point.x, y: point.y };
    const coverMin = Math.max(this.viewW / this.worldW, this.viewH / this.worldH);
    this.focusZoom = clamp(Math.max(coverMin, zoomBoost * (this.viewW / 1280)), coverMin, coverMin * 1.85);
    this.focusTimer = Math.max(this.focusTimer, duration);
  }

  /**
   * Smart viewport-filling camera:
   * - Never shows void outside the paper (minZoom >= cover ratio).
   * - Smoothly tracks fighters across huge 2400px or 4-story vertical maps.
   * - In anchorP1 mode (Roguelike 1vMany), weights framing toward P1 while keeping nearby threat visible.
   */
  public update(dt: number, p1: Vec2, p2: Vec2, anchorP1 = false): void {
    const coverMinZoom = Math.max(this.viewW / this.worldW, this.viewH / this.worldH);
    const scaleBase = Math.min(this.viewW / 1280, this.viewH / 720);
    const maxZoom = Math.max(coverMinZoom * 1.25, 1.32 * scaleBase);

    let targetX: number;
    let targetY: number;
    let targetZoom: number;

    if (this.focusTimer > 0 && this.focusPoint) {
      this.focusTimer -= dt;
      targetX = this.focusPoint.x;
      targetY = this.focusPoint.y - 30;
      targetZoom = Math.max(coverMinZoom, this.focusZoom);
    } else {
      const weightP1 = anchorP1 ? 0.72 : 0.5;
      const midX = p1.x * weightP1 + p2.x * (1 - weightP1);
      const midY = p1.y * weightP1 + p2.y * (1 - weightP1) - 60;
      const spanX = Math.abs(p1.x - p2.x) + 420;
      const spanY = Math.abs(p1.y - p2.y) + 320;

      const desiredZoom = Math.min(this.viewW / spanX, this.viewH / spanY);
      targetZoom = clamp(desiredZoom, coverMinZoom, maxZoom);
      targetX = midX;
      targetY = midY;
    }

    // Clamp camera center strictly inside world paper bounds so zero void ever appears!
    const halfViewW = (this.viewW * 0.5) / targetZoom;
    const halfViewH = (this.viewH * 0.5) / targetZoom;

    if (halfViewW * 2 >= this.worldW) {
      targetX = this.worldW * 0.5;
    } else {
      targetX = clamp(targetX, halfViewW, this.worldW - halfViewW);
    }

    if (halfViewH * 2 >= this.worldH) {
      targetY = this.worldH * 0.5;
    } else {
      targetY = clamp(targetY, halfViewH, this.worldH - halfViewH);
    }

    const rate = 1 - Math.exp(-7.5 * dt);
    this.x = lerp(this.x, targetX, rate);
    this.y = lerp(this.y, targetY, rate);
    this.zoom = lerp(this.zoom, targetZoom, rate);

    if (this.shakeTimer > 0) {
      this.shakeTimer -= dt;
      const decay = Math.max(0, this.shakeTimer / 0.24);
      const amp = this.shakeMag * decay;
      const randX = (Math.random() * 2 - 1) * amp;
      const randY = (Math.random() * 2 - 1) * amp;
      this.offsetX = randX + this.shakeDirX * amp * 0.45;
      this.offsetY = randY + this.shakeDirY * amp * 0.45;
      this.shakeDirX *= 0.78;
      this.shakeDirY *= 0.78;
      if (this.shakeTimer <= 0) {
        this.shakeMag = 0;
        this.offsetX = 0;
        this.offsetY = 0;
      }
    } else {
      this.offsetX = 0;
      this.offsetY = 0;
    }
  }
}
