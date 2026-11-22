import { Vec2 } from '../types';

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function smoothstep(t: number): number {
  const c = clamp(t, 0, 1);
  return c * c * (3 - 2 * c);
}

export function easeOutCubic(t: number): number {
  const c = clamp(t, 0, 1);
  return 1 - Math.pow(1 - c, 3);
}

export function easeOutBack(t: number): number {
  const c = clamp(t, 0, 1);
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(c - 1, 3) + c1 * Math.pow(c - 1, 2);
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function lerpVec(a: Vec2, b: Vec2, t: number): Vec2 {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

export function addVec(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

export function subVec(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

export function scaleVec(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

export function normVec(v: Vec2): Vec2 {
  const m = Math.hypot(v.x, v.y);
  if (m < 1e-6) return { x: 1, y: 0 };
  return { x: v.x / m, y: v.y / m };
}

export function randRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

export function randChoice<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Deterministic fast hash -> [-1, 1] used for consistent "boiling line" sketch jitter
 * that changes only when boilFrame increments (~10 FPS).
 */
export function sketchNoise(seed: number, boilFrame: number): number {
  let n = Math.imul((seed | 0) ^ Math.imul(boilFrame | 0, 0x27d4eb2d), 0x165667b1);
  n = (n ^ (n >>> 15)) >>> 0;
  return (n / 2147483647.5) - 1;
}

/**
 * Solve 2-bone inverse kinematics in 2D.
 * Returns the middle joint (elbow/knee) position given root, target, bone lengths, and bend direction (+1 or -1).
 */
export function solveTwoBoneIK(
  root: Vec2,
  target: Vec2,
  len1: number,
  len2: number,
  bendDir: number
): { mid: Vec2; end: Vec2 } {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const rawDist = Math.hypot(dx, dy);
  const maxReach = Math.max(0.001, len1 + len2 - 0.5);
  const minReach = Math.abs(len1 - len2) + 0.5;
  const d = clamp(rawDist, minReach, maxReach);

  const ux = rawDist > 1e-5 ? dx / rawDist : 1;
  const uy = rawDist > 1e-5 ? dy / rawDist : 0;

  const end: Vec2 = {
    x: root.x + ux * d,
    y: root.y + uy * d,
  };

  // Law of cosines
  const cosA = clamp((len1 * len1 + d * d - len2 * len2) / (2 * len1 * d), -1, 1);
  const sinA = Math.sqrt(Math.max(0, 1 - cosA * cosA)) * (bendDir >= 0 ? 1 : -1);

  const mid: Vec2 = {
    x: root.x + (ux * cosA - uy * sinA) * len1,
    y: root.y + (uy * cosA + ux * sinA) * len1,
  };

  return { mid, end };
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
