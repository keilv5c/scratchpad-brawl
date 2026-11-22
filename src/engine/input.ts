import { InputState, Vec2 } from '../types';
import {
  BindableAction,
  ConnectedGamepadInfo,
  ControlProfile,
  GamepadBindableAction,
  GamepadProfile,
  PlayerInputDevice,
  createGamepadStandard,
  createPreset1,
  gamepadIndexFromDevice,
  shortenGamepadName,
} from '../config/controls';
import { WORLD_HEIGHT, WORLD_WIDTH } from '../config/stages';

const BUFFER_FRAMES = 9;
const TRIGGER_THRESHOLD = 0.35;

interface RawChannelState {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
  light: boolean;
  heavy: boolean;
  block: boolean;
  dash: boolean;
  superBtn: boolean;
  aimDir: -1 | 0 | 1;
  aimAngle: number | null;
}

function createEmptyRaw(): RawChannelState {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
    light: false,
    heavy: false,
    block: false,
    dash: false,
    superBtn: false,
    aimDir: 0,
    aimAngle: null,
  };
}

export function createEmptyInput(): InputState {
  return {
    left: false,
    right: false,
    up: false,
    down: false,
    light: false,
    heavy: false,
    block: false,
    dash: false,
    superBtn: false,
    aimDir: 0,
    aimAngle: null,
    jumpPressed: 0,
    lightPressed: 0,
    heavyPressed: 0,
    heavyReleased: 0,
    blockPressed: 0,
    dashPressed: 0,
    superPressed: 0,
  };
}

export function decayInputBuffers(inp: InputState): void {
  if (inp.jumpPressed > 0) inp.jumpPressed--;
  if (inp.lightPressed > 0) inp.lightPressed--;
  if (inp.heavyPressed > 0) inp.heavyPressed--;
  if (inp.heavyReleased > 0) inp.heavyReleased--;
  if (inp.blockPressed > 0) inp.blockPressed--;
  if (inp.dashPressed > 0) inp.dashPressed--;
  if (inp.superPressed > 0) inp.superPressed--;
}

export class KeyboardInputManager {
  public p1: InputState = createEmptyInput();
  public p2: InputState = createEmptyInput();
  public profile: ControlProfile = createPreset1();
  public gamepadProfile: GamepadProfile = createGamepadStandard();

  // Active per-player device routing (Single-player defaults P1 to 'auto'; Versus uses explicit pair)
  public p1Device: PlayerInputDevice = 'auto';
  public p2Device: PlayerInputDevice = 'kb_p2';

  public mouseCanvasPos: Vec2 = { x: WORLD_WIDTH * 0.5, y: WORLD_HEIGHT * 0.5 };
  public mouseHasMoved = false;

  // Separate raw channels merged cleanly per player every frame
  private kbP1Raw: RawChannelState = createEmptyRaw();
  private kbP2Raw: RawChannelState = createEmptyRaw();
  private gpRaws: Record<number, RawChannelState> = {
    0: createEmptyRaw(),
    1: createEmptyRaw(),
    2: createEmptyRaw(),
    3: createEmptyRaw(),
  };
  private prevGpButtons: Record<number, boolean[]> = {};
  private prevGpStickUp: Record<number, boolean> = {};
  private prevCompositeHeavy: [boolean, boolean] = [false, false];

  // Anti-ghost-walk & anti-stuck-axis telemetry
  private gpSeen = new Set<number>();
  private gpStuckAxes: Record<number, Set<number>> = {
    0: new Set(),
    1: new Set(),
    2: new Set(),
    3: new Set(),
  };
  private lastKbActivityMs = 0;
  private lastGpActivityMs: Record<number, number> = { 0: 0, 1: 0, 2: 0, 3: 0 };

  // Track connected gamepads for UI & disconnect guard
  public connectedGamepads: ConnectedGamepadInfo[] = [];
  private prevConnectedKey = '';

  private heldCodes = new Set<string>();
  private canvas: HTMLCanvasElement;
  private isGameplayActive: () => boolean;
  private captureCallback: ((code: string | null) => void) | null = null;
  private gpCaptureCallback: ((gpCode: string | null) => void) | null = null;
  private gpClaimCallback: ((gpIndex: number | null) => void) | null = null;

  public onAnyKey?: () => void;
  public onPauseToggle?: () => void;
  public onGamepadsChanged?: (pads: ConnectedGamepadInfo[]) => void;
  public onGamepadLivePress?: (gpIndex: number, btnCode: string) => void;
  public onActiveGamepadDisconnected?: (playerIdx: 0 | 1, padName: string) => void;

  private boundKeyDown: (e: KeyboardEvent) => void;
  private boundKeyUp: (e: KeyboardEvent) => void;
  private boundMouseDown: (e: MouseEvent) => void;
  private boundMouseUp: (e: MouseEvent) => void;
  private boundMouseMove: (e: MouseEvent) => void;
  private boundContextMenu: (e: MouseEvent) => void;
  private boundAuxClick: (e: MouseEvent) => void;
  private boundDragStart: (e: DragEvent) => void;
  private boundBlur: () => void;
  private boundFocus: () => void;
  private boundVisibilityChange: () => void;
  private boundComposition: () => void;
  private boundFocusIn: (e: FocusEvent) => void;
  private boundGpConnected: (e: GamepadEvent) => void;
  private boundGpDisconnected: (e: GamepadEvent) => void;

  constructor(canvas: HTMLCanvasElement, isGameplayActive: () => boolean) {
    this.canvas = canvas;
    this.isGameplayActive = isGameplayActive;

    this.boundKeyDown = (e) => this.handleKeyDown(e);
    this.boundKeyUp = (e) => this.handleKeyUp(e);
    this.boundMouseDown = (e) => this.handleMouseDown(e);
    this.boundMouseUp = (e) => this.handleMouseUp(e);
    this.boundMouseMove = (e) => this.handleMouseMove(e);
    this.boundContextMenu = (e) => this.handleContextMenu(e);
    this.boundAuxClick = (e) => this.handleAuxClick(e);
    this.boundDragStart = (e) => this.handleDragStart(e);
    this.boundBlur = () => this.clearAll();
    this.boundFocus = () => this.clearAll();
    this.boundVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.hidden) this.clearAll();
    };
    this.boundComposition = () => this.clearAll();
    this.boundFocusIn = (e) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === 'SELECT' || tag === 'INPUT' || tag === 'TEXTAREA') {
        this.clearAll();
      }
    };
    this.boundGpConnected = () => this.refreshConnectedGamepads(true);
    this.boundGpDisconnected = (e) => this.handleGamepadDisconnected(e);

    window.addEventListener('keydown', this.boundKeyDown);
    window.addEventListener('keyup', this.boundKeyUp);
    window.addEventListener('mousedown', this.boundMouseDown);
    window.addEventListener('mouseup', this.boundMouseUp);
    window.addEventListener('mousemove', this.boundMouseMove);
    window.addEventListener('contextmenu', this.boundContextMenu);
    window.addEventListener('auxclick', this.boundAuxClick);
    window.addEventListener('dragstart', this.boundDragStart);
    window.addEventListener('blur', this.boundBlur);
    window.addEventListener('focus', this.boundFocus);
    window.addEventListener('compositionstart', this.boundComposition);
    window.addEventListener('compositionend', this.boundComposition);
    window.addEventListener('focusin', this.boundFocusIn);
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.boundVisibilityChange);
    }
    window.addEventListener('gamepadconnected', this.boundGpConnected);
    window.addEventListener('gamepaddisconnected', this.boundGpDisconnected);

    this.refreshConnectedGamepads(false);
  }

  public destroy(): void {
    window.removeEventListener('keydown', this.boundKeyDown);
    window.removeEventListener('keyup', this.boundKeyUp);
    window.removeEventListener('mousedown', this.boundMouseDown);
    window.removeEventListener('mouseup', this.boundMouseUp);
    window.removeEventListener('mousemove', this.boundMouseMove);
    window.removeEventListener('contextmenu', this.boundContextMenu);
    window.removeEventListener('auxclick', this.boundAuxClick);
    window.removeEventListener('dragstart', this.boundDragStart);
    window.removeEventListener('blur', this.boundBlur);
    window.removeEventListener('focus', this.boundFocus);
    window.removeEventListener('compositionstart', this.boundComposition);
    window.removeEventListener('compositionend', this.boundComposition);
    window.removeEventListener('focusin', this.boundFocusIn);
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.boundVisibilityChange);
    }
    window.removeEventListener('gamepadconnected', this.boundGpConnected);
    window.removeEventListener('gamepaddisconnected', this.boundGpDisconnected);
  }

  public setProfile(profile: ControlProfile): void {
    this.profile = profile;
    this.clearAll();
  }

  public setGamepadProfile(gpProfile: GamepadProfile): void {
    this.gamepadProfile = gpProfile;
  }

  public setPlayerDevices(p1Dev: PlayerInputDevice, p2Dev: PlayerInputDevice): void {
    this.p1Device = p1Dev;
    this.p2Device = p2Dev;
    this.syncCompositeInputs();
  }

  public doesPlayerUseKbP1(playerIdx: 0 | 1): boolean {
    const dev = playerIdx === 0 ? this.p1Device : this.p2Device;
    return dev === 'kb_p1' || dev === 'auto';
  }

  public doesPlayerUseKbP2(playerIdx: 0 | 1): boolean {
    const dev = playerIdx === 0 ? this.p1Device : this.p2Device;
    return dev === 'kb_p2';
  }

  public getAssignedGamepadIndex(playerIdx: 0 | 1): number | null {
    const dev = playerIdx === 0 ? this.p1Device : this.p2Device;
    if (dev === 'auto') {
      return this.connectedGamepads.length > 0 ? this.connectedGamepads[0].index : null;
    }
    return gamepadIndexFromDevice(dev);
  }

  public doesPlayerUseMouseAim(playerIdx: 0 | 1): boolean {
    return this.profile.mouseAim && this.doesPlayerUseKbP1(playerIdx);
  }

  public getPlayerStickAim(playerIdx: 0 | 1): { aimDir: -1 | 0 | 1; aimAngle: number | null } {
    const gpIdx = this.getAssignedGamepadIndex(playerIdx);
    if (gpIdx === null) return { aimDir: 0, aimAngle: null };
    const raw = this.gpRaws[gpIdx];
    if (!raw) return { aimDir: 0, aimAngle: null };
    return { aimDir: raw.aimDir, aimAngle: raw.aimAngle };
  }

  // ==================== CAPTURE & CLAIM HELPERS ====================
  public startCapture(cb: (code: string | null) => void): void {
    this.cancelGamepadCapture();
    this.cancelDeviceClaim();
    this.captureCallback = cb;
  }

  public cancelCapture(): void {
    if (this.captureCallback) {
      const cb = this.captureCallback;
      this.captureCallback = null;
      cb(null);
    }
  }

  public startGamepadCapture(cb: (gpCode: string | null) => void): void {
    this.cancelCapture();
    this.cancelDeviceClaim();
    // Snapshot current pressed states so already-held buttons don't misfire
    this.snapshotCurrentGamepadButtons();
    this.gpCaptureCallback = cb;
  }

  public cancelGamepadCapture(): void {
    if (this.gpCaptureCallback) {
      const cb = this.gpCaptureCallback;
      this.gpCaptureCallback = null;
      cb(null);
    }
  }

  public startDeviceClaim(cb: (gpIndex: number | null) => void): void {
    this.cancelCapture();
    this.cancelGamepadCapture();
    this.snapshotCurrentGamepadButtons();
    this.gpClaimCallback = cb;
  }

  public cancelDeviceClaim(): void {
    if (this.gpClaimCallback) {
      const cb = this.gpClaimCallback;
      this.gpClaimCallback = null;
      cb(null);
    }
  }

  public cancelAllCaptures(): void {
    this.cancelCapture();
    this.cancelGamepadCapture();
    this.cancelDeviceClaim();
  }

  public isCapturing(): boolean {
    return (
      this.captureCallback !== null ||
      this.gpCaptureCallback !== null ||
      this.gpClaimCallback !== null
    );
  }

  public clearAll(): void {
    this.heldCodes.clear();
    this.kbP1Raw = createEmptyRaw();
    this.kbP2Raw = createEmptyRaw();
    this.gpRaws[0] = createEmptyRaw();
    this.gpRaws[1] = createEmptyRaw();
    this.gpRaws[2] = createEmptyRaw();
    this.gpRaws[3] = createEmptyRaw();
    this.prevCompositeHeavy = [false, false];
    this.p1 = createEmptyInput();
    this.p2 = createEmptyInput();
  }

  // ==================== GAMEPAD POLLING & HAPTIC RUMBLE ====================
  private safeGetGamepads(): Array<Gamepad | null> {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return [];
    }
    try {
      return Array.from(navigator.getGamepads() ?? []);
    } catch {
      return [];
    }
  }

  private isGpButtonDown(btn: GamepadButton | undefined): boolean {
    if (!btn) return false;
    return Boolean(btn.pressed) || (typeof btn.value === 'number' && btn.value > TRIGGER_THRESHOLD);
  }

  private snapshotCurrentGamepadButtons(): void {
    const pads = this.safeGetGamepads();
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      this.prevGpButtons[gp.index] = gp.buttons.map((b) => this.isGpButtonDown(b));
    }
  }

  public refreshConnectedGamepads(notify = true): ConnectedGamepadInfo[] {
    const pads = this.safeGetGamepads();
    const list: ConnectedGamepadInfo[] = [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      if (gp.index < 0 || gp.index > 3) continue;
      list.push({
        index: gp.index,
        id: gp.id || `Gamepad ${gp.index + 1}`,
        shortName: shortenGamepadName(gp.id || '', gp.index),
        buttonsCount: gp.buttons?.length ?? 0,
        axesCount: gp.axes?.length ?? 0,
      });
    }
    const key = list.map((p) => `${p.index}:${p.id}`).join('|');
    const changed = key !== this.prevConnectedKey;
    this.connectedGamepads = list;
    this.prevConnectedKey = key;
    if (notify && changed) {
      this.onGamepadsChanged?.(list);
    }
    return list;
  }

  private handleGamepadDisconnected(e: GamepadEvent): void {
    const idx = e.gamepad?.index ?? -1;
    const padName = shortenGamepadName(e.gamepad?.id || '', Math.max(0, idx));
    if (idx >= 0 && idx <= 3) {
      this.gpRaws[idx] = createEmptyRaw();
      delete this.prevGpButtons[idx];
      delete this.prevGpStickUp[idx];
      this.gpSeen.delete(idx);
      this.gpStuckAxes[idx].clear();
      this.lastGpActivityMs[idx] = 0;
    }

    const p1Gp = this.getAssignedGamepadIndex(0);
    const p2Gp = this.getAssignedGamepadIndex(1);

    this.refreshConnectedGamepads(true);
    this.syncCompositeInputs();

    if (this.isGameplayActive()) {
      if (p1Gp === idx && this.p1Device !== 'auto') {
        this.onActiveGamepadDisconnected?.(0, padName);
      } else if (p2Gp === idx) {
        this.onActiveGamepadDisconnected?.(1, padName);
      }
    }
  }

  private matchesGamepadAction(action: GamepadBindableAction, code: string): boolean {
    return (this.gamepadProfile.bindings[action] ?? []).includes(code);
  }

  private isGamepadActionHeld(action: GamepadBindableAction, buttons: boolean[]): boolean {
    const codes = this.gamepadProfile.bindings[action] ?? [];
    for (const c of codes) {
      if (!c.startsWith('GP_')) continue;
      const idx = Number(c.slice(3));
      if (Number.isInteger(idx) && buttons[idx]) return true;
    }
    return false;
  }

  private getPlayersListeningToGamepad(gpIndex: number): InputState[] {
    const targets: InputState[] = [];
    if (this.getAssignedGamepadIndex(0) === gpIndex) targets.push(this.p1);
    if (this.getAssignedGamepadIndex(1) === gpIndex) targets.push(this.p2);
    return targets;
  }

  private readCalibratedAxis(gIdx: number, axisIdx: number, rawVal: number): number {
    const stuckSet = this.gpStuckAxes[gIdx];
    if (stuckSet.has(axisIdx)) {
      if (Math.abs(rawVal) < 0.35) {
        stuckSet.delete(axisIdx);
      } else {
        return 0;
      }
    }
    return rawVal;
  }

  /**
   * Poll all connected gamepads once per animation frame (runs in menu, modal, pause & gameplay!).
   */
  public pollGamepads(): void {
    // 1-frame focus-loss watchdog: catches external overlays (desktop pets, IME popups, Alt-Tab)
    // that steal OS focus without reliably firing window.blur!
    if (typeof document !== 'undefined' && !document.hasFocus() && this.heldCodes.size > 0) {
      this.clearAll();
    }

    this.refreshConnectedGamepads(true);
    const pads = this.safeGetGamepads();
    const dz = this.gamepadProfile.deadzone;
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();

    // Clear disconnected gamepad channels
    const activeIndices = new Set<number>();

    for (const gp of pads) {
      if (!gp || !gp.connected || gp.index < 0 || gp.index > 3) continue;
      const gIdx = gp.index;
      activeIndices.add(gIdx);

      // First-connect calibration guard: ignore uncalibrated virtual HID axes resting at +/-1.0
      if (!this.gpSeen.has(gIdx)) {
        this.gpSeen.add(gIdx);
        this.gpStuckAxes[gIdx].clear();
        for (let a = 0; a < Math.min(4, gp.axes.length); a++) {
          if (Math.abs(gp.axes[a] ?? 0) > 0.72) {
            this.gpStuckAxes[gIdx].add(a);
          }
        }
      }

      const curButtons = gp.buttons.map((b) => this.isGpButtonDown(b));
      const prevButtons = this.prevGpButtons[gIdx] ?? [];

      // Detect fresh button presses for capture, claim, live test UI & gameplay edge buffers
      for (let bi = 0; bi < curButtons.length; bi++) {
        if (curButtons[bi] && !prevButtons[bi]) {
          this.lastGpActivityMs[gIdx] = nowMs;
          const gpCode = `GP_${bi}`;
          this.onAnyKey?.();
          this.onGamepadLivePress?.(gIdx, gpCode);

          // 1. Custom Gamepad Rebinding Capture Mode
          if (this.gpCaptureCallback) {
            const cb = this.gpCaptureCallback;
            this.gpCaptureCallback = null;
            this.prevGpButtons[gIdx] = curButtons;
            cb(gpCode);
            return;
          }

          // 2. Versus Setup "Press any gamepad button to claim P1/P2"
          if (this.gpClaimCallback) {
            const cb = this.gpClaimCallback;
            this.gpClaimCallback = null;
            this.prevGpButtons[gIdx] = curButtons;
            cb(gIdx);
            return;
          }

          // 3. Pause button works from any assigned gamepad
          if (this.matchesGamepadAction('pause', gpCode)) {
            this.onPauseToggle?.();
            continue;
          }

          // 4. Route edge presses to whichever player owns this gamepad
          const targets = this.getPlayersListeningToGamepad(gIdx);
          for (const target of targets) {
            if (this.matchesGamepadAction('jump', gpCode)) target.jumpPressed = BUFFER_FRAMES;
            if (this.matchesGamepadAction('light', gpCode)) target.lightPressed = BUFFER_FRAMES;
            if (this.matchesGamepadAction('heavy', gpCode)) target.heavyPressed = BUFFER_FRAMES;
            if (this.matchesGamepadAction('block', gpCode)) target.blockPressed = BUFFER_FRAMES;
            if (this.matchesGamepadAction('dash', gpCode)) target.dashPressed = BUFFER_FRAMES;
            if (this.matchesGamepadAction('superBtn', gpCode)) target.superPressed = BUFFER_FRAMES;
          }
        }
      }

      this.prevGpButtons[gIdx] = curButtons;

      // Movement from Left Stick + D-Pad (with stuck-axis & auto-mode passive drift suppression!)
      const lx = this.readCalibratedAxis(gIdx, 0, gp.axes[0] ?? 0);
      const ly = this.readCalibratedAxis(gIdx, 1, gp.axes[1] ?? 0);
      const dpadUp = Boolean(curButtons[12]);
      const dpadDown = Boolean(curButtons[13]);
      const dpadLeft = Boolean(curButtons[14]);
      const dpadRight = Boolean(curButtons[15]);

      const wakeThreshold = Math.max(0.55, dz + 0.3);
      if (Math.hypot(lx, ly) > wakeThreshold || dpadUp || dpadDown || dpadLeft || dpadRight) {
        this.lastGpActivityMs[gIdx] = nowMs;
      }

      // In 'auto' mode while actively using Keyboard/Mouse, require deliberate stick push (>0.55)
      // so an idle plugged-in controller with mild stick drift NEVER causes phantom self-walking!
      const isSharedAutoPad =
        this.p1Device === 'auto' &&
        this.getAssignedGamepadIndex(0) === gIdx &&
        this.getAssignedGamepadIndex(1) !== gIdx;
      const kbIsActive = this.lastKbActivityMs > this.lastGpActivityMs[gIdx];
      const effectiveDz = isSharedAutoPad && kbIsActive ? wakeThreshold : dz;

      const raw = this.gpRaws[gIdx];
      raw.left = lx < -effectiveDz || dpadLeft;
      raw.right = lx > effectiveDz || dpadRight;
      raw.up = ly < -effectiveDz || dpadUp;
      raw.down = ly > effectiveDz || dpadDown;

      // Optional Left-Stick-Up-to-Jump edge trigger
      const stickUpNow = ly < -Math.max(0.55, dz + 0.3) || dpadUp;
      const stickUpPrev = Boolean(this.prevGpStickUp[gIdx]);
      if (this.gamepadProfile.stickUpToJump && stickUpNow && !stickUpPrev) {
        const targets = this.getPlayersListeningToGamepad(gIdx);
        for (const target of targets) {
          target.jumpPressed = BUFFER_FRAMES;
        }
      }
      this.prevGpStickUp[gIdx] = stickUpNow;

      // Held combat buttons
      raw.light = this.isGamepadActionHeld('light', curButtons);
      raw.heavy = this.isGamepadActionHeld('heavy', curButtons);
      raw.block = this.isGamepadActionHeld('block', curButtons);
      raw.dash = this.isGamepadActionHeld('dash', curButtons);
      raw.superBtn = this.isGamepadActionHeld('superBtn', curButtons);

      // Right Stick 360° Aim & Facing!
      const rx = this.readCalibratedAxis(gIdx, 2, gp.axes[2] ?? 0);
      const ry = this.readCalibratedAxis(gIdx, 3, gp.axes[3] ?? 0);
      const rMag = Math.hypot(rx, ry);
      const rAimDz = isSharedAutoPad && kbIsActive ? wakeThreshold : Math.max(0.28, dz + 0.08);
      if (this.gamepadProfile.rightStickAim && rMag > rAimDz) {
        this.lastGpActivityMs[gIdx] = nowMs;
        raw.aimAngle = Math.atan2(ry, rx);
        raw.aimDir = rx >= 0 ? 1 : -1;
      } else {
        raw.aimAngle = null;
        raw.aimDir = 0;
      }
    }

    for (let i = 0; i < 4; i++) {
      if (!activeIndices.has(i)) {
        this.gpRaws[i] = createEmptyRaw();
        this.gpSeen.delete(i);
        this.gpStuckAxes[i].clear();
      }
    }

    this.syncCompositeInputs();
  }

  /**
   * Per-player dual-motor haptic rumble (isolated to the exact controller bound to P1 or P2!).
   */
  public triggerRumble(
    playerIdx: 0 | 1,
    durationMs: number,
    weakMagnitude: number,
    strongMagnitude: number
  ): void {
    if (!this.gamepadProfile.rumbleEnabled) return;
    const gpIdx = this.getAssignedGamepadIndex(playerIdx);
    if (gpIdx === null) return;
    const pads = this.safeGetGamepads();
    const gp = pads.find((p) => p && p.connected && p.index === gpIdx);
    if (!gp) return;

    try {
      const actuator = (gp as Gamepad & {
        vibrationActuator?: {
          playEffect?: (
            type: string,
            params: {
              startDelay: number;
              duration: number;
              weakMagnitude: number;
              strongMagnitude: number;
            }
          ) => Promise<void>;
        };
      }).vibrationActuator;

      if (actuator && typeof actuator.playEffect === 'function') {
        void actuator.playEffect('dual-rumble', {
          startDelay: 0,
          duration: Math.max(20, Math.round(durationMs)),
          weakMagnitude: Math.min(1, Math.max(0, weakMagnitude)),
          strongMagnitude: Math.min(1, Math.max(0, strongMagnitude)),
        });
      }
    } catch {
      // ignore unsupported browser rumble
    }
  }

  // ==================== COMPOSITE MERGING (KB + MOUSE + GAMEPADS) ====================
  private syncCompositeInputs(): void {
    this.mergePlayerState(0, this.p1);
    this.mergePlayerState(1, this.p2);
  }

  private mergePlayerState(playerIdx: 0 | 1, out: InputState): void {
    const channels: RawChannelState[] = [];
    if (this.doesPlayerUseKbP1(playerIdx)) channels.push(this.kbP1Raw);
    if (this.doesPlayerUseKbP2(playerIdx)) channels.push(this.kbP2Raw);
    const gpIdx = this.getAssignedGamepadIndex(playerIdx);
    if (gpIdx !== null && this.gpRaws[gpIdx]) {
      channels.push(this.gpRaws[gpIdx]);
    }

    let left = false;
    let right = false;
    let up = false;
    let down = false;
    let light = false;
    let heavy = false;
    let block = false;
    let dash = false;
    let superBtn = false;

    for (const ch of channels) {
      if (ch.left) left = true;
      if (ch.right) right = true;
      if (ch.up) up = true;
      if (ch.down) down = true;
      if (ch.light) light = true;
      if (ch.heavy) heavy = true;
      if (ch.block) block = true;
      if (ch.dash) dash = true;
      if (ch.superBtn) superBtn = true;
    }

    const wasHeavy = this.prevCompositeHeavy[playerIdx];
    out.left = left;
    out.right = right;
    out.up = up;
    out.down = down;
    out.light = light;
    out.heavy = heavy;
    out.block = block;
    out.dash = dash;
    out.superBtn = superBtn;

    if (wasHeavy && !heavy) {
      out.heavyReleased = BUFFER_FRAMES;
    }
    this.prevCompositeHeavy[playerIdx] = heavy;
  }

  // ==================== KEYBOARD & MOUSE HANDLING ====================
  private getEffectiveBindings(action: BindableAction): string[] {
    const raw = this.profile.bindings[action] ?? [];
    if (action === 'jump') {
      if (this.profile.disableWJump) {
        return raw.filter((c) => c !== 'KeyW');
      }
      if (this.profile.presetId === 'preset2' && !raw.includes('KeyW')) {
        return [...raw, 'KeyW'];
      }
    }
    return raw;
  }

  private isActionHeld(action: BindableAction): boolean {
    const codes = this.getEffectiveBindings(action);
    for (const c of codes) {
      if (this.heldCodes.has(c)) return true;
    }
    return false;
  }

  private matchesAction(action: BindableAction, code: string): boolean {
    return this.getEffectiveBindings(action).includes(code);
  }

  private syncKbP1Raw(): void {
    this.kbP1Raw.left = this.isActionHeld('left');
    this.kbP1Raw.right = this.isActionHeld('right');
    this.kbP1Raw.up = this.isActionHeld('up');
    this.kbP1Raw.down = this.isActionHeld('down');
    this.kbP1Raw.light = this.isActionHeld('light');
    this.kbP1Raw.heavy = this.isActionHeld('heavy');
    this.kbP1Raw.block = this.isActionHeld('block');
    this.kbP1Raw.dash = this.isActionHeld('dash');
    this.kbP1Raw.superBtn = this.isActionHeld('superBtn');
    this.syncCompositeInputs();
  }

  private syncKbP2Raw(): void {
    this.kbP2Raw.left = this.heldCodes.has('ArrowLeft');
    this.kbP2Raw.right = this.heldCodes.has('ArrowRight');
    this.kbP2Raw.up = this.heldCodes.has('ArrowUp');
    this.kbP2Raw.down = this.heldCodes.has('ArrowDown');
    this.kbP2Raw.light = this.heldCodes.has('Numpad1') || this.heldCodes.has('KeyN');
    this.kbP2Raw.heavy = this.heldCodes.has('Numpad2') || this.heldCodes.has('KeyM');
    this.kbP2Raw.block = this.heldCodes.has('Numpad3') || this.heldCodes.has('Comma');
    this.kbP2Raw.dash =
      this.heldCodes.has('Numpad4') ||
      this.heldCodes.has('Numpad0') ||
      this.heldCodes.has('Period') ||
      this.heldCodes.has('ShiftRight');
    this.kbP2Raw.superBtn =
      this.heldCodes.has('Numpad5') ||
      this.heldCodes.has('Slash') ||
      this.heldCodes.has('Semicolon');
    this.syncCompositeInputs();
  }

  private triggerKbP1EdgePress(code: string): void {
    const targets: InputState[] = [];
    if (this.doesPlayerUseKbP1(0)) targets.push(this.p1);
    if (this.doesPlayerUseKbP1(1)) targets.push(this.p2);

    for (const t of targets) {
      if (this.matchesAction('jump', code)) t.jumpPressed = BUFFER_FRAMES;
      if (this.matchesAction('light', code)) t.lightPressed = BUFFER_FRAMES;
      if (this.matchesAction('heavy', code)) t.heavyPressed = BUFFER_FRAMES;
      if (this.matchesAction('block', code)) t.blockPressed = BUFFER_FRAMES;
      if (this.matchesAction('dash', code)) t.dashPressed = BUFFER_FRAMES;
      if (this.matchesAction('superBtn', code)) t.superPressed = BUFFER_FRAMES;
    }
  }

  private triggerKbP2EdgePress(code: string): void {
    const targets: InputState[] = [];
    if (this.doesPlayerUseKbP2(0)) targets.push(this.p1);
    if (this.doesPlayerUseKbP2(1)) targets.push(this.p2);

    for (const t of targets) {
      switch (code) {
        case 'ArrowUp':
          t.jumpPressed = BUFFER_FRAMES;
          break;
        case 'Numpad1':
        case 'KeyN':
          t.lightPressed = BUFFER_FRAMES;
          break;
        case 'Numpad2':
        case 'KeyM':
          t.heavyPressed = BUFFER_FRAMES;
          break;
        case 'Numpad3':
        case 'Comma':
          t.blockPressed = BUFFER_FRAMES;
          break;
        case 'Numpad4':
        case 'Numpad0':
        case 'Period':
        case 'ShiftRight':
          t.dashPressed = BUFFER_FRAMES;
          break;
        case 'Numpad5':
        case 'Slash':
        case 'Semicolon':
          t.superPressed = BUFFER_FRAMES;
          break;
      }
    }
  }

  private reconcileModifiers(e: KeyboardEvent | MouseEvent, ignoreCode?: string): boolean {
    let changed = false;
    if (!e.shiftKey) {
      if (ignoreCode !== 'ShiftLeft' && this.heldCodes.delete('ShiftLeft')) changed = true;
      if (ignoreCode !== 'ShiftRight' && this.heldCodes.delete('ShiftRight')) changed = true;
    }
    if (!e.ctrlKey) {
      if (ignoreCode !== 'ControlLeft' && this.heldCodes.delete('ControlLeft')) changed = true;
      if (ignoreCode !== 'ControlRight' && this.heldCodes.delete('ControlRight')) changed = true;
    }
    if (!e.altKey) {
      if (ignoreCode !== 'AltLeft' && this.heldCodes.delete('AltLeft')) changed = true;
      if (ignoreCode !== 'AltRight' && this.heldCodes.delete('AltRight')) changed = true;
    }
    if (!e.metaKey) {
      if (ignoreCode !== 'MetaLeft' && this.heldCodes.delete('MetaLeft')) changed = true;
      if (ignoreCode !== 'MetaRight' && this.heldCodes.delete('MetaRight')) changed = true;
    }
    return changed;
  }

  private reconcileMouseButtons(buttons: number): boolean {
    let changed = false;
    if ((buttons & 1) === 0 && this.heldCodes.delete('Mouse0')) changed = true;
    if ((buttons & 4) === 0 && this.heldCodes.delete('Mouse1')) changed = true;
    if ((buttons & 2) === 0 && this.heldCodes.delete('Mouse2')) changed = true;
    return changed;
  }

  private blurActiveUiControl(): void {
    if (typeof document === 'undefined') return;
    const active = document.activeElement as HTMLElement | null;
    if (active && (active.tagName === 'BUTTON' || active.tagName === 'SELECT')) {
      active.blur();
    }
  }

  private markKbActivity(): void {
    this.lastKbActivityMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  private handleKeyDown(e: KeyboardEvent): void {
    const code = e.code;

    // Escape cancels gamepad capture or claim cleanly
    if (code === 'Escape' && (this.gpCaptureCallback || this.gpClaimCallback)) {
      e.preventDefault();
      e.stopPropagation();
      this.cancelGamepadCapture();
      this.cancelDeviceClaim();
      return;
    }

    // Keyboard/mouse rebinding capture intercepts any key press!
    if (this.captureCallback) {
      e.preventDefault();
      e.stopPropagation();
      const cb = this.captureCallback;
      this.captureCallback = null;
      cb(code === 'Escape' ? null : code);
      return;
    }

    // Active IME composition (Chinese Pinyin / Sogou candidate box) can swallow keyup events!
    if (e.isComposing) {
      this.clearAll();
      return;
    }

    this.reconcileModifiers(e, code);

    const gameplay = this.isGameplayActive();
    if (gameplay) {
      // Never let focused <select> or <button> hijack Space / A / D / Arrow keys mid-fight!
      this.blurActiveUiControl();
    }

    if (
      code.startsWith('Arrow') ||
      code === 'Space' ||
      code.startsWith('Numpad') ||
      code === 'Slash' ||
      (gameplay &&
        (code === 'ShiftLeft' ||
          code === 'ShiftRight' ||
          code === 'Tab' ||
          code === 'AltLeft' ||
          code === 'AltRight'))
    ) {
      e.preventDefault();
    }
    this.onAnyKey?.();
    this.markKbActivity();

    if (code === 'Escape' && !e.repeat) {
      this.onPauseToggle?.();
      return;
    }

    const isFresh = !this.heldCodes.has(code);
    this.heldCodes.add(code);

    if (isFresh) {
      this.triggerKbP1EdgePress(code);
      this.triggerKbP2EdgePress(code);
    }
    this.syncKbP1Raw();
    this.syncKbP2Raw();
  }

  private handleKeyUp(e: KeyboardEvent): void {
    const code = e.code;
    this.heldCodes.delete(code);
    this.reconcileModifiers(e);
    this.syncKbP1Raw();
    this.syncKbP2Raw();
  }

  private handleMouseMove(e: MouseEvent): void {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    this.mouseCanvasPos.x = e.clientX - rect.left;
    this.mouseCanvasPos.y = e.clientY - rect.top;
    this.mouseHasMoved = true;

    // Self-heal any mouse button or modifier whose up-event was lost outside the window!
    const modChanged = this.reconcileModifiers(e);
    const btnChanged = this.reconcileMouseButtons(e.buttons);
    if (modChanged || btnChanged) {
      this.syncKbP1Raw();
      this.syncKbP2Raw();
    }
  }

  private handleMouseDown(e: MouseEvent): void {
    const code = `Mouse${e.button}`;

    if (this.captureCallback) {
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-ignore-capture="true"]')) return;
      e.preventDefault();
      e.stopPropagation();
      const cb = this.captureCallback;
      this.captureCallback = null;
      cb(code);
      return;
    }

    if (!this.isGameplayActive()) return;

    // Globally block Windows middle-click autoscroll & right-click artifacts during gameplay!
    if (e.button === 1 || e.button === 2) {
      e.preventDefault();
    }

    const target = e.target as HTMLElement | null;
    if (target && target !== this.canvas) return;

    this.blurActiveUiControl();
    this.reconcileModifiers(e);
    this.reconcileMouseButtons(e.buttons);
    this.onAnyKey?.();
    this.markKbActivity();

    const isFresh = !this.heldCodes.has(code);
    this.heldCodes.add(code);
    if (isFresh) {
      this.triggerKbP1EdgePress(code);
    }
    this.syncKbP1Raw();
  }

  private handleMouseUp(e: MouseEvent): void {
    const code = `Mouse${e.button}`;
    const hadCode = this.heldCodes.delete(code);
    const modChanged = this.reconcileModifiers(e);
    const btnChanged = this.reconcileMouseButtons(e.buttons);
    if (hadCode || modChanged || btnChanged) {
      this.syncKbP1Raw();
      this.syncKbP2Raw();
    }
  }

  private handleContextMenu(e: MouseEvent): void {
    if (this.captureCallback || this.isGameplayActive() || e.target === this.canvas) {
      e.preventDefault();
    }
  }

  private handleAuxClick(e: MouseEvent): void {
    if (this.captureCallback || this.isGameplayActive()) {
      e.preventDefault();
    }
  }

  private handleDragStart(e: DragEvent): void {
    if (this.isGameplayActive()) {
      e.preventDefault();
    }
  }
}
