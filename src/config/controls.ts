export type ControlPresetId = 'preset1' | 'preset2' | 'custom';

export type BindableAction =
  | 'left'
  | 'right'
  | 'jump'
  | 'down'
  | 'up'
  | 'light'
  | 'heavy'
  | 'block'
  | 'dash'
  | 'superBtn';

export interface ControlProfile {
  presetId: ControlPresetId;
  bindings: Record<BindableAction, string[]>; // primary is [0], optional secondary aliases [1..]
  mouseAim: boolean;
  disableWJump: boolean;
}

export interface StoredControls {
  activePreset: ControlPresetId;
  preset2DisableWJump: boolean;
  customProfile: ControlProfile;
}

// ==================== MULTI-DEVICE & GAMEPAD CONFIG (v0.2.0) ====================
export type PlayerInputDevice = 'auto' | 'kb_p1' | 'kb_p2' | 'gp0' | 'gp1' | 'gp2' | 'gp3';

export type GamepadPresetId = 'standard' | 'brawler' | 'custom';

export type GamepadBindableAction =
  | 'jump'
  | 'light'
  | 'heavy'
  | 'block'
  | 'dash'
  | 'superBtn'
  | 'pause';

export interface GamepadProfile {
  presetId: GamepadPresetId;
  bindings: Record<GamepadBindableAction, string[]>; // e.g. ['GP_3', 'GP_7']
  stickUpToJump: boolean;
  rightStickAim: boolean;
  rumbleEnabled: boolean;
  deadzone: number; // 0.10 .. 0.45
}

export interface StoredGamepadConfig {
  activePreset: GamepadPresetId;
  customProfile: GamepadProfile;
  stickUpToJump: boolean;
  rightStickAim: boolean;
  rumbleEnabled: boolean;
  deadzone: number;
  singleP1Device: PlayerInputDevice;
  versusP1Device: PlayerInputDevice;
  versusP2Device: PlayerInputDevice;
}

export interface ConnectedGamepadInfo {
  index: number;
  id: string;
  shortName: string;
  buttonsCount: number;
  axesCount: number;
}

export const ACTION_META: Array<{ key: BindableAction; label: string; tip: string }> = [
  { key: 'left', label: '向左移动', tip: '控制角色往左走' },
  { key: 'right', label: '向右移动', tip: '控制角色往右走' },
  { key: 'jump', label: '跳跃 / 蹬墙跳', tip: '二段跳与贴墙反跳' },
  { key: 'down', label: '下蹲 / 穿下平台', tip: '双击下蹲或下蹲+跳跃可从浮空台阶下落' },
  { key: 'up', label: '上挑方向', tip: '按住此键 + 快攻释放挑飞浮空技' },
  { key: 'light', label: '快攻 / 三连斩', tip: '连续按打出三段连招' },
  { key: 'heavy', label: '蓄力 / 破防重击', tip: '长按蓄力，松开破防并释放文具投射/机关' },
  { key: 'block', label: '格挡 / 精准弹反', tip: '受击前瞬间按下触发「铛!」弹反' },
  { key: 'dash', label: '瞬步残影步', tip: '高速无敌位移，擦身躲招触发慢动作' },
  { key: 'superBtn', label: '终极大招', tip: '灵感值满 100% 时释放文具专属大招' },
];

export const GAMEPAD_ACTION_META: Array<{
  key: GamepadBindableAction;
  label: string;
  tip: string;
}> = [
  { key: 'jump', label: '跳跃 / 蹬墙跳', tip: '左摇杆与十字键默认负责左右移动/下蹲/上挑' },
  { key: 'light', label: '快攻 / 三连斩', tip: '连续按打出三段连招，配合上推摇杆触发挑飞' },
  { key: 'heavy', label: '蓄力 / 破防重击', tip: '长按蓄力，可配合右摇杆 360° 瞄准松手发射' },
  { key: 'block', label: '格挡 / 精准弹反', tip: '受击前瞬间按下触发「铛!」完美弹反并震动' },
  { key: 'dash', label: '瞬步残影步', tip: '高速无敌残影位移，极限闪避触发慢动作' },
  { key: 'superBtn', label: '终极大招', tip: '灵感值满 100% 时单键瞬发文具终极大招' },
  { key: 'pause', label: '课间暂停', tip: '对战中随时呼出或关闭暂停菜单' },
];

export function createPreset1(): ControlProfile {
  return {
    presetId: 'preset1',
    bindings: {
      left: ['KeyA'],
      right: ['KeyD'],
      jump: ['KeyW'],
      down: ['KeyS'],
      up: ['KeyW'],
      light: ['KeyJ'],
      heavy: ['KeyK'],
      block: ['KeyL'],
      dash: ['KeyU', 'Space', 'ShiftLeft'],
      superBtn: ['KeyI', 'KeyO'],
    },
    mouseAim: false,
    disableWJump: false,
  };
}

export function createPreset2(disableWJump = true): ControlProfile {
  return {
    presetId: 'preset2',
    bindings: {
      left: ['KeyA'],
      right: ['KeyD'],
      jump: ['Space'],
      down: ['KeyS'],
      up: ['KeyW'],
      light: ['Mouse0'],
      heavy: ['KeyE'],
      block: ['Mouse2'],
      dash: ['ShiftLeft'],
      superBtn: ['KeyF'],
    },
    mouseAim: true,
    disableWJump,
  };
}

export function createDefaultCustom(): ControlProfile {
  return {
    presetId: 'custom',
    bindings: {
      left: ['KeyA'],
      right: ['KeyD'],
      jump: ['Space'],
      down: ['KeyS'],
      up: ['KeyW'],
      light: ['Mouse0'],
      heavy: ['KeyE'],
      block: ['Mouse2'],
      dash: ['ShiftLeft'],
      superBtn: ['KeyF'],
    },
    mouseAim: true,
    disableWJump: true,
  };
}

export function cloneProfile(p: ControlProfile): ControlProfile {
  const bindings = {} as Record<BindableAction, string[]>;
  for (const k of Object.keys(p.bindings) as BindableAction[]) {
    bindings[k] = [...p.bindings[k]];
  }
  return {
    presetId: p.presetId,
    bindings,
    mouseAim: p.mouseAim,
    disableWJump: p.disableWJump,
  };
}

// ==================== GAMEPAD PRESETS ====================
export function createGamepadStandard(): GamepadProfile {
  return {
    presetId: 'standard',
    bindings: {
      jump: ['GP_0'],             // A / ×
      light: ['GP_2'],            // X / □
      heavy: ['GP_3', 'GP_7'],    // Y / △  +  RT / R2 (twin-stick aim!)
      block: ['GP_4', 'GP_6'],    // LB / L1 + LT / L2
      dash: ['GP_1'],             // B / ○
      superBtn: ['GP_5', 'GP_11'],// RB / R1 + R3
      pause: ['GP_9'],            // Start / Options
    },
    stickUpToJump: false,
    rightStickAim: true,
    rumbleEnabled: true,
    deadzone: 0.22,
  };
}

export function createGamepadBrawler(): GamepadProfile {
  return {
    presetId: 'brawler',
    bindings: {
      jump: ['GP_0', 'GP_3'],     // A / Y
      light: ['GP_2'],            // X
      heavy: ['GP_1', 'GP_7'],    // B + RT
      block: ['GP_6'],            // LT / L2
      dash: ['GP_4'],             // LB / L1
      superBtn: ['GP_5', 'GP_11'],// RB + R3
      pause: ['GP_9'],            // Start
    },
    stickUpToJump: false,
    rightStickAim: true,
    rumbleEnabled: true,
    deadzone: 0.22,
  };
}

export function createGamepadCustomDefault(): GamepadProfile {
  const base = createGamepadStandard();
  base.presetId = 'custom';
  return base;
}

export function cloneGamepadProfile(p: GamepadProfile): GamepadProfile {
  const bindings = {} as Record<GamepadBindableAction, string[]>;
  for (const k of Object.keys(p.bindings) as GamepadBindableAction[]) {
    bindings[k] = [...p.bindings[k]];
  }
  return {
    presetId: p.presetId,
    bindings,
    stickUpToJump: p.stickUpToJump,
    rightStickAim: p.rightStickAim,
    rumbleEnabled: p.rumbleEnabled,
    deadzone: p.deadzone,
  };
}

export function getGamepadPresetShortName(id: GamepadPresetId): string {
  if (id === 'standard') return '默认动作双摇杆';
  if (id === 'brawler') return '街机大乱斗流';
  return '自定义手柄';
}

export function formatGamepadButtonLabel(code: string): string {
  switch (code) {
    case 'GP_0': return 'A / ×';
    case 'GP_1': return 'B / ○';
    case 'GP_2': return 'X / □';
    case 'GP_3': return 'Y / △';
    case 'GP_4': return 'LB / L1';
    case 'GP_5': return 'RB / R1';
    case 'GP_6': return 'LT / L2';
    case 'GP_7': return 'RT / R2';
    case 'GP_8': return 'Back / Share';
    case 'GP_9': return 'Start / Opt';
    case 'GP_10': return 'L3 (左摇杆按)';
    case 'GP_11': return 'R3 (右摇杆按)';
    case 'GP_12': return '十字键 ↑';
    case 'GP_13': return '十字键 ↓';
    case 'GP_14': return '十字键 ←';
    case 'GP_15': return '十字键 →';
    case 'GP_16': return 'Home 键';
    default:
      if (code.startsWith('GP_')) return `按键 #${code.slice(3)}`;
      return '未绑定';
  }
}

export function formatGamepadButtonShort(code: string): string {
  switch (code) {
    case 'GP_0': return 'A';
    case 'GP_1': return 'B';
    case 'GP_2': return 'X';
    case 'GP_3': return 'Y';
    case 'GP_4': return 'LB';
    case 'GP_5': return 'RB';
    case 'GP_6': return 'LT';
    case 'GP_7': return 'RT';
    case 'GP_8': return 'Back';
    case 'GP_9': return 'Start';
    case 'GP_10': return 'L3';
    case 'GP_11': return 'R3';
    case 'GP_12': return '↑';
    case 'GP_13': return '↓';
    case 'GP_14': return '←';
    case 'GP_15': return '→';
    default: return code.replace('GP_', 'B');
  }
}

export function shortenGamepadName(rawId: string, index: number): string {
  const lower = rawId.toLowerCase();
  if (lower.includes('xbox') || lower.includes('xinput') || lower.includes('045e')) {
    return `Xbox 手柄 #${index + 1}`;
  }
  if (lower.includes('dualsense') || lower.includes('054c')) {
    return `PS 手柄 #${index + 1}`;
  }
  if (lower.includes('dualshock') || lower.includes('wireless controller')) {
    return `PS 手柄 #${index + 1}`;
  }
  if (lower.includes('pro controller') || lower.includes('nintendo') || lower.includes('057e')) {
    return `Switch 手柄 #${index + 1}`;
  }
  const clean = rawId.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  if (!clean) return `手柄 #${index + 1}`;
  return clean.length > 16 ? `${clean.slice(0, 15)}… #${index + 1}` : `${clean} #${index + 1}`;
}

export function gamepadIndexFromDevice(dev: PlayerInputDevice): number | null {
  if (dev === 'gp0') return 0;
  if (dev === 'gp1') return 1;
  if (dev === 'gp2') return 2;
  if (dev === 'gp3') return 3;
  return null;
}

export function deviceFromGamepadIndex(idx: number): PlayerInputDevice {
  if (idx === 1) return 'gp1';
  if (idx === 2) return 'gp2';
  if (idx === 3) return 'gp3';
  return 'gp0';
}

export function formatDeviceLabel(dev: PlayerInputDevice, pads: ConnectedGamepadInfo[] = []): string {
  if (dev === 'auto') return '自动（键鼠 + 手柄 #1）';
  if (dev === 'kb_p1') return '键鼠 / 左侧键盘';
  if (dev === 'kb_p2') return '右侧键盘（方向键+NM,.）';
  const idx = gamepadIndexFromDevice(dev);
  if (idx !== null) {
    const found = pads.find((p) => p.index === idx);
    return found ? `🎮 ${found.shortName}` : `🎮 手柄 #${idx + 1} (未连接)`;
  }
  return dev;
}

export function formatCodeLabel(code: string): string {
  if (!code) return '未绑定';
  if (code.startsWith('GP_')) return formatGamepadButtonLabel(code);
  if (code === 'Mouse0') return '鼠标左键';
  if (code === 'Mouse1') return '鼠标中键';
  if (code === 'Mouse2') return '鼠标右键';
  if (code === 'Mouse3') return '鼠标侧键1';
  if (code === 'Mouse4') return '鼠标侧键2';
  if (code === 'Space') return '空格';
  if (code === 'ShiftLeft') return '左 Shift';
  if (code === 'ShiftRight') return '右 Shift';
  if (code === 'ControlLeft') return '左 Ctrl';
  if (code === 'ControlRight') return '右 Ctrl';
  if (code === 'AltLeft') return '左 Alt';
  if (code === 'AltRight') return '右 Alt';
  if (code === 'Tab') return 'Tab';
  if (code === 'Enter') return '回车';
  if (code === 'Backspace') return '退格';
  if (code === 'ArrowLeft') return '←';
  if (code === 'ArrowRight') return '→';
  if (code === 'ArrowUp') return '↑';
  if (code === 'ArrowDown') return '↓';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `小键盘 ${code.slice(6)}`;
  return code;
}

export function getPresetShortName(id: ControlPresetId): string {
  if (id === 'preset1') return '方案一 · 经典键盘';
  if (id === 'preset2') return '方案二 · 键鼠动作';
  return '方案三 · 自定义';
}

export function buildKeyHintSummary(profile: ControlProfile, label: 'P1' | 'P2' = 'P1'): string {
  const b = profile.bindings;
  const k = (act: BindableAction) => formatCodeLabel(b[act][0] ?? '');
  const jumpText = profile.disableWJump ? `${k('jump')}跳(禁W跳)` : `${k('jump')}跳`;
  const aimText = profile.mouseAim ? ' · 鼠标360°控向' : '';
  return `<b>${label}</b> ${k('left')}/${k('right')}移动 · ${jumpText} · <b>${k('light')}</b>快攻 · <b>${k('heavy')}</b>蓄力 · <b>${k('block')}</b>弹反 · <b>${k('dash')}</b>残影 · <b>${k('superBtn')}</b>大招${aimText}`;
}

export function buildGamepadHintSummary(
  gpProfile: GamepadProfile,
  label: 'P1' | 'P2',
  padNum: number
): string {
  const g = (act: GamepadBindableAction) => {
    const arr = gpProfile.bindings[act] ?? [];
    return arr.slice(0, 2).map(formatGamepadButtonShort).join('/') || '未设';
  };
  const rStick = gpProfile.rightStickAim ? ' · 右摇杆360°瞄准' : '';
  return `<b>${label} 🎮手柄#${padNum}</b> 摇杆/十字键移动 · <b>${g('jump')}</b>跳 · <b>${g('light')}</b>快攻 · <b>${g('heavy')}</b>蓄力 · <b>${g('block')}</b>弹反 · <b>${g('dash')}</b>残影 · <b>${g('superBtn')}</b>大招${rStick}`;
}

export function buildDeviceKeyHintSummary(
  label: 'P1' | 'P2',
  dev: PlayerInputDevice,
  kbProfile: ControlProfile,
  gpProfile: GamepadProfile,
  hasConnectedGamepad: boolean
): string {
  if (dev === 'kb_p2') {
    return `<b>${label} ⌨️右键盘</b> 方向键移动跳 · <b>N/1</b>快攻 · <b>M/2</b>蓄力 · <b>,/3</b>弹反 · <b>./4</b>残影 · <b>//5</b>大招`;
  }
  const gpIdx = gamepadIndexFromDevice(dev);
  if (gpIdx !== null) {
    return buildGamepadHintSummary(gpProfile, label, gpIdx + 1);
  }
  if (dev === 'auto') {
    const kbText = buildKeyHintSummary(kbProfile, label);
    return hasConnectedGamepad ? `${kbText} ｜ 🎮手柄#1 即插即用` : kbText;
  }
  return buildKeyHintSummary(kbProfile, label);
}

// ==================== PERSISTENCE ====================
const STORAGE_KEY = 'inkblade_controls_v1';
const GAMEPAD_STORAGE_KEY = 'scratchpad_brawl_gamepad_v020';

export function loadStoredControls(): StoredControls {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<StoredControls>;
      const baseCustom = createDefaultCustom();
      if (parsed.customProfile?.bindings) {
        for (const meta of ACTION_META) {
          const arr = parsed.customProfile.bindings[meta.key];
          if (Array.isArray(arr) && arr.length > 0 && typeof arr[0] === 'string') {
            baseCustom.bindings[meta.key] = [arr[0]];
          }
        }
        if (typeof parsed.customProfile.mouseAim === 'boolean') {
          baseCustom.mouseAim = parsed.customProfile.mouseAim;
        }
        if (typeof parsed.customProfile.disableWJump === 'boolean') {
          baseCustom.disableWJump = parsed.customProfile.disableWJump;
        }
      }
      return {
        activePreset:
          parsed.activePreset === 'preset1' ||
          parsed.activePreset === 'preset2' ||
          parsed.activePreset === 'custom'
            ? parsed.activePreset
            : 'preset1',
        preset2DisableWJump:
          typeof parsed.preset2DisableWJump === 'boolean' ? parsed.preset2DisableWJump : true,
        customProfile: baseCustom,
      };
    }
  } catch {
    // ignore corrupted storage
  }
  return {
    activePreset: 'preset1',
    preset2DisableWJump: true,
    customProfile: createDefaultCustom(),
  };
}

export function saveStoredControls(data: StoredControls): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // ignore quota errors
  }
}

export function resolveActiveProfile(stored: StoredControls): ControlProfile {
  if (stored.activePreset === 'preset1') return createPreset1();
  if (stored.activePreset === 'preset2') return createPreset2(stored.preset2DisableWJump);
  return cloneProfile(stored.customProfile);
}

const VALID_DEVICES: PlayerInputDevice[] = ['auto', 'kb_p1', 'kb_p2', 'gp0', 'gp1', 'gp2', 'gp3'];

export function loadStoredGamepadConfig(): StoredGamepadConfig {
  try {
    const raw = localStorage.getItem(GAMEPAD_STORAGE_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<StoredGamepadConfig>;
      const baseCustom = createGamepadCustomDefault();
      if (p.customProfile?.bindings) {
        for (const meta of GAMEPAD_ACTION_META) {
          const arr = p.customProfile.bindings[meta.key];
          if (Array.isArray(arr)) {
            const clean = arr.filter((x): x is string => typeof x === 'string' && x.startsWith('GP_'));
            if (clean.length > 0) baseCustom.bindings[meta.key] = clean.slice(0, 2);
          }
        }
      }
      const preset: GamepadPresetId =
        p.activePreset === 'standard' || p.activePreset === 'brawler' || p.activePreset === 'custom'
          ? p.activePreset
          : 'standard';
      const deadzone =
        typeof p.deadzone === 'number' && p.deadzone >= 0.1 && p.deadzone <= 0.45
          ? p.deadzone
          : 0.22;
      const singleP1: PlayerInputDevice =
        p.singleP1Device && VALID_DEVICES.includes(p.singleP1Device) && p.singleP1Device !== 'kb_p2'
          ? p.singleP1Device
          : 'auto';
      const vsP1: PlayerInputDevice =
        p.versusP1Device && VALID_DEVICES.includes(p.versusP1Device) && p.versusP1Device !== 'auto'
          ? p.versusP1Device
          : 'kb_p1';
      const vsP2: PlayerInputDevice =
        p.versusP2Device && VALID_DEVICES.includes(p.versusP2Device) && p.versusP2Device !== 'auto'
          ? p.versusP2Device
          : 'kb_p2';
      return {
        activePreset: preset,
        customProfile: baseCustom,
        stickUpToJump: typeof p.stickUpToJump === 'boolean' ? p.stickUpToJump : false,
        rightStickAim: typeof p.rightStickAim === 'boolean' ? p.rightStickAim : true,
        rumbleEnabled: typeof p.rumbleEnabled === 'boolean' ? p.rumbleEnabled : true,
        deadzone,
        singleP1Device: singleP1,
        versusP1Device: vsP1,
        versusP2Device: vsP2 === vsP1 ? (vsP1 === 'kb_p2' ? 'kb_p1' : 'kb_p2') : vsP2,
      };
    }
  } catch {
    // ignore
  }
  return {
    activePreset: 'standard',
    customProfile: createGamepadCustomDefault(),
    stickUpToJump: false,
    rightStickAim: true,
    rumbleEnabled: true,
    deadzone: 0.22,
    singleP1Device: 'auto',
    versusP1Device: 'kb_p1',
    versusP2Device: 'kb_p2',
  };
}

export function saveStoredGamepadConfig(cfg: StoredGamepadConfig): void {
  try {
    localStorage.setItem(GAMEPAD_STORAGE_KEY, JSON.stringify(cfg));
  } catch {
    // ignore
  }
}

export function resolveActiveGamepadProfile(stored: StoredGamepadConfig): GamepadProfile {
  let base: GamepadProfile;
  if (stored.activePreset === 'standard') {
    base = createGamepadStandard();
  } else if (stored.activePreset === 'brawler') {
    base = createGamepadBrawler();
  } else {
    base = cloneGamepadProfile(stored.customProfile);
  }
  base.stickUpToJump = stored.stickUpToJump;
  base.rightStickAim = stored.rightStickAim;
  base.rumbleEnabled = stored.rumbleEnabled;
  base.deadzone = stored.deadzone;
  return base;
}
