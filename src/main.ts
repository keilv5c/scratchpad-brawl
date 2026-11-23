import './style.css';
import './geometry/geo.css';
import {
  BgmPlayMode,
  FxIntensity,
  GameMode,
  HudSnapshot,
  MatchStats,
  RoguelikeBuffDef,
  ShakeLevel,
  StageId,
  ThemeId,
  TrainingDummyMode,
  WeaponCategory,
  WeaponId,
} from './types';
import { WEAPON_LIST, WEAPONS } from './config/weapons';
import { STAGE_LIST, STAGES } from './config/stages';
import { THEME_LIST } from './config/themes';
import { ARCADE_MASTERS } from './config/arcade';
import {
  ACTION_META,
  BindableAction,
  buildDeviceKeyHintSummary,
  cloneGamepadProfile,
  cloneProfile,
  ConnectedGamepadInfo,
  ControlPresetId,
  ControlProfile,
  createGamepadBrawler,
  createGamepadStandard,
  createPreset1,
  createPreset2,
  deviceFromGamepadIndex,
  formatCodeLabel,
  formatDeviceLabel,
  formatGamepadButtonLabel,
  GAMEPAD_ACTION_META,
  GamepadBindableAction,
  GamepadPresetId,
  GamepadProfile,
  gamepadIndexFromDevice,
  getGamepadPresetShortName,
  getPresetShortName,
  loadStoredControls,
  loadStoredGamepadConfig,
  PlayerInputDevice,
  resolveActiveGamepadProfile,
  resolveActiveProfile,
  saveStoredControls,
  saveStoredGamepadConfig,
  StoredControls,
  StoredGamepadConfig,
} from './config/controls';
import { getStyleRankMeta, INK_SKIN_LIST } from './config/cosmetics';
import { ROGUELIKE_BUFFS } from './config/roguelike';
import { BGM_TRACK_LIST, BgmTrackMeta } from './audio/bgmEngine';
import { GameManager } from './game/gameManager';
import { MathGameManager } from './geometry/mathGameManager';
import {
  ALL_OPERATORS_LIST,
  MATH_OPERATORS,
  MATH_SCHOOLS,
  MATH_SCHOOL_LIST,
  MATH_TRIAL_MASTERS,
} from './geometry/mathSchools';
import {
  GeoDummyMode,
  GeoHudSnapshot,
  GeoMode,
  MathSchoolId,
  MathThemeId,
} from './geometry/mathTypes';
import { LanLobbyController } from './net/lanLobbyController';

// Selected setup state
let selectedMode: GameMode = 'arcade';
let selectedP1Weapon: WeaponId = 'compass';
let selectedP2Weapon: WeaponId = 'tape';
let selectedWeaponCat: WeaponCategory = 'all';
let selectedStage: StageId = 'desk_city';
let selectedTheme: ThemeId = 'kraft';
let currentArcadeStage = 0;
let lastKoSnapshotUrl: string | null = null;

// Controls & Gamepad state (persisted in localStorage)
const storedControls: StoredControls = loadStoredControls();
let activeProfile: ControlProfile = resolveActiveProfile(storedControls);
let listeningAction: BindableAction | null = null;

const storedGamepad: StoredGamepadConfig = loadStoredGamepadConfig();
let activeGpProfile: GamepadProfile = resolveActiveGamepadProfile(storedGamepad);
let activeCtrlTab: 'kb' | 'gp' = 'kb';
let listeningGpTarget: { action: GamepadBindableAction; slot: 0 | 1 } | null = null;
let claimingPlayer: 0 | 1 | null = null;
let userManuallyPickedVersusDevices = false;
let gpLiveFlashTimer: number | null = null;

// DOM refs
const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const titleScreen = document.getElementById('title-screen')!;
const setupOverlay = document.getElementById('setup-overlay')!;
const hudEl = document.getElementById('hud')!;
const pauseOverlay = document.getElementById('pause-overlay')!;
const controlsOverlay = document.getElementById('controls-overlay')!;
const cosmeticsOverlay = document.getElementById('cosmetics-overlay')!;
const jukeboxOverlay = document.getElementById('jukebox-overlay')!;
const buffOverlay = document.getElementById('buff-overlay')!;
const resultOverlay = document.getElementById('result-overlay')!;
const trainingBar = document.getElementById('training-bar')!;
const p1KeyHint = document.getElementById('p1-key-hint')!;
const p2KeyHint = document.getElementById('p2-key-hint')!;
const menuControlsBtn = document.getElementById('menu-controls-btn')!;
const titleControlsBtn = document.getElementById('title-controls-btn')!;
const menuControlsSummary = document.getElementById('menu-controls-summary')!;

// HUD refs
const p1NameEl = document.getElementById('p1-name')!;
const p1WeaponEl = document.getElementById('p1-weapon')!;
const p1WinsEl = document.getElementById('p1-wins')!;
const p1HpDelayed = document.getElementById('p1-hp-delayed')!;
const p1HpFill = document.getElementById('p1-hp-fill')!;
const p1HpText = document.getElementById('p1-hp-text')!;
const p1InkFill = document.getElementById('p1-ink-fill')!;
const p1InkLabel = document.getElementById('p1-ink-label')!;
const p1GuardFill = document.getElementById('p1-guard-fill')!;
const p1ComboEl = document.getElementById('p1-combo')!;
const styleRankBadge = document.getElementById('style-rank-badge')!;
const srCnEl = document.getElementById('sr-cn')!;
const srSubEl = document.getElementById('sr-sub')!;
const rogueBuffStrip = document.getElementById('rogue-buff-strip')!;

const p2NameEl = document.getElementById('p2-name')!;
const p2WeaponEl = document.getElementById('p2-weapon')!;
const p2WinsEl = document.getElementById('p2-wins')!;
const p2HpDelayed = document.getElementById('p2-hp-delayed')!;
const p2HpFill = document.getElementById('p2-hp-fill')!;
const p2HpText = document.getElementById('p2-hp-text')!;
const p2InkFill = document.getElementById('p2-ink-fill')!;
const p2InkLabel = document.getElementById('p2-ink-label')!;
const p2GuardFill = document.getElementById('p2-guard-fill')!;
const p2ComboEl = document.getElementById('p2-combo')!;

const roundTagEl = document.getElementById('hud-round-tag')!;
const timerEl = document.getElementById('hud-timer')!;
const hudBanner = document.getElementById('hud-banner')!;
const bannerTitle = document.getElementById('banner-title')!;
const bannerSub = document.getElementById('banner-sub')!;

// Initialize GameManager
const game = new GameManager(canvas, {
  onHudUpdate: (hud) => updateHud(hud),
  onMatchEnd: (winner, stats, canNext, arcadeCleared) =>
    showResultModal(winner, stats, canNext, arcadeCleared),
  onPauseChanged: (paused) => {
    if (!paused) {
      const sub = document.getElementById('pause-sub');
      if (sub) {
        sub.textContent = '按 Esc 或手柄 Start 继续乱斗 · 按 F11 切换全屏';
        sub.style.color = '';
      }
    }
    pauseOverlay.classList.toggle('hidden', !paused);
  },
  onRoguelikeBuffChoices: (waveCleared, choices) => showBuffPicker(waveCleared, choices),
});

game.bgm.onTrackChanged = (track) => syncTrackLabels(track);

// Live Gamepad Hot-Plug, Button Tester & Disconnect Auto-Pause Guard!
game.input.onGamepadsChanged = (pads) => {
  handleGamepadsChanged(pads);
};
game.input.onGamepadLivePress = (gpIndex, btnCode) => {
  const chip = document.getElementById('gp-live-press');
  if (!chip) return;
  chip.textContent = `手柄 #${gpIndex + 1} 触发: ${formatGamepadButtonLabel(btnCode)}`;
  chip.classList.add('flash');
  if (gpLiveFlashTimer !== null) window.clearTimeout(gpLiveFlashTimer);
  gpLiveFlashTimer = window.setTimeout(() => {
    chip.classList.remove('flash');
  }, 420);
};
game.input.onActiveGamepadDisconnected = (playerIdx, padName) => {
  game.setPaused(true);
  const sub = document.getElementById('pause-sub');
  if (sub) {
    sub.textContent = `⚠️ 检测到 P${playerIdx + 1} 的「${padName}」已断开连接！重新连接手柄或前往操作设置切换设备后即可继续。`;
    sub.style.color = '#cf2a2a';
  }
};

// ==================== FULLSCREEN HELPER ====================
function toggleFullscreen(): void {
  game.sound.unlock();
  game.sound.playUiClick();
  (document.activeElement as HTMLElement | null)?.blur?.();
  const wv = (window as unknown as { chrome?: { webview?: { postMessage: (m: string) => void } } }).chrome?.webview;
  if (wv) {
    wv.postMessage('toggle-fullscreen');
    return;
  }
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen?.().catch(() => {});
  } else {
    document.exitFullscreen?.().catch(() => {});
  }
}

document.getElementById('title-fullscreen-btn')!.addEventListener('click', toggleFullscreen);
document.getElementById('menu-fullscreen-btn')!.addEventListener('click', toggleFullscreen);
document.getElementById('btn-hud-fullscreen')!.addEventListener('click', toggleFullscreen);

// ==================== STAGE A -> STAGE B FLOW ====================
const MODE_HEADINGS: Record<GameMode, [string, string]> = {
  arcade: ['⚔️ 课桌争霸赛 · 备战台', '从 12 件文具里挑一件趁手的，连战 5 位同学与执笔大魔王！'],
  roguelike: ['🃏 涂鸦生存战 · 备战台', '选定初始文具，1v多激战 8 大手绘战场与强化贴纸构筑！'],
  versus: ['🤝 课桌双人对决 · 备战台', '自由挑选 P1/P2 文具、8 张大中小地图与草稿纸风格！'],
  training: ['🎯 自由练习本 · 备战台', '任选 12 件文具与 8 张大地图，进场后可无限灵感随时切武器！'],
};

function openSetupScreen(mode: GameMode, withFlip = true): void {
  game.sound.unlock();
  if (game.bgm.isEnabled()) game.bgm.start();
  selectedMode = mode;

  if (withFlip) {
    game.triggerUiPageFlip();
  }

  titleScreen.classList.add('hidden');
  setupOverlay.classList.remove('hidden');
  resultOverlay.classList.add('hidden');
  hudEl.classList.add('hidden');

  const [t, sub] = MODE_HEADINGS[mode];
  document.getElementById('setup-mode-title')!.textContent = t;
  document.getElementById('setup-mode-sub')!.textContent = sub;

  if (mode === 'versus') {
    autoSuggestVersusDevicesIfNeeded(game.input.connectedGamepads);
  }
  syncActivePlayerDevices();
  updateSetupModeView();
  buildSetupOptions();
}

function showTitleScreen(): void {
  mathGame.stop();
  game.setSuspended(false);
  geoSetupOverlay.classList.add('hidden');
  geoHudEl.classList.add('hidden');
  geoResultOverlay.classList.add('hidden');
  hudEl.classList.add('hidden');
  setupOverlay.classList.add('hidden');
  pauseOverlay.classList.add('hidden');
  controlsOverlay.classList.add('hidden');
  cosmeticsOverlay.classList.add('hidden');
  jukeboxOverlay.classList.add('hidden');
  buffOverlay.classList.add('hidden');
  resultOverlay.classList.add('hidden');
  document.getElementById('lan-overlay')?.classList.add('hidden');
  document.getElementById('lan-result-overlay')?.classList.add('hidden');
  document.getElementById('lan-live-bar')?.classList.add('hidden');
  titleScreen.classList.remove('hidden');
  game.returnToMenu();
}

document.querySelectorAll<HTMLButtonElement>('[data-enter-mode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.enterMode as GameMode;
    openSetupScreen(mode, true);
  });
});

document.getElementById('btn-setup-back')!.addEventListener('click', () => {
  game.triggerUiPageFlip();
  setupOverlay.classList.add('hidden');
  titleScreen.classList.remove('hidden');
});

// Weapon Category Filter
document.querySelectorAll<HTMLButtonElement>('[data-wcat]').forEach((btn) => {
  btn.addEventListener('click', () => {
    game.sound.unlock();
    game.sound.playUiClick();
    selectedWeaponCat = btn.dataset.wcat as WeaponCategory;
    document.querySelectorAll<HTMLButtonElement>('[data-wcat]').forEach((b) => {
      b.classList.toggle('active', b.dataset.wcat === selectedWeaponCat);
    });
    buildSetupOptions();
  });
});

// ==================== HUD RENDERING (DIRTY-CHECKED ZERO-THRASH!) ====================
function renderWinDots(el: HTMLElement, wins: number, totalNeeded = 2): void {
  let html = '';
  for (let i = 0; i < totalNeeded; i++) {
    html += `<span class="win-dot ${i < wins ? 'won' : ''}"></span>`;
  }
  el.innerHTML = html;
}

const hudCache = {
  p1Name: '',
  p1Weapon: '',
  p1HpW: '',
  p1DelW: '',
  p1Danger: false,
  p1HpText: '',
  p1InkW: '',
  p1Ready: false,
  p1InkLabel: '',
  p1GuardW: '',
  rankKey: '',
  buffsKey: '',
  p2Name: '',
  p2Weapon: '',
  p2HpW: '',
  p2DelW: '',
  p2Danger: false,
  p2HpText: '',
  p2InkW: '',
  p2Ready: false,
  p2InkLabel: '',
  p2GuardW: '',
  winsKey: '',
  roundTag: '',
  timerText: '',
  comboP1: -1,
  comboP2: -1,
  bannerKey: '',
};

function updateHud(hud: HudSnapshot): void {
  if (hudCache.p1Name !== hud.p1.name) {
    hudCache.p1Name = hud.p1.name;
    p1NameEl.textContent = hud.p1.name;
  }
  const p1WepTxt = `${WEAPONS[hud.p1.weapon].icon} ${hud.p1.weaponName}`;
  if (hudCache.p1Weapon !== p1WepTxt) {
    hudCache.p1Weapon = p1WepTxt;
    p1WeaponEl.textContent = p1WepTxt;
  }

  const p1Pct = Math.max(0, (hud.p1.hp / hud.p1.maxHp) * 100);
  const p1DelPct = Math.max(0, (hud.p1.delayedHp / hud.p1.maxHp) * 100);
  const p1HpW = `${p1Pct.toFixed(1)}%`;
  const p1DelW = `${p1DelPct.toFixed(1)}%`;
  if (hudCache.p1HpW !== p1HpW) {
    hudCache.p1HpW = p1HpW;
    p1HpFill.style.width = p1HpW;
  }
  if (hudCache.p1DelW !== p1DelW) {
    hudCache.p1DelW = p1DelW;
    p1HpDelayed.style.width = p1DelW;
  }
  const p1Danger = p1Pct < 30;
  if (hudCache.p1Danger !== p1Danger) {
    hudCache.p1Danger = p1Danger;
    p1HpFill.classList.toggle('danger', p1Danger);
  }
  const p1HpTxt = `${Math.ceil(hud.p1.hp)} / ${hud.p1.maxHp}`;
  if (hudCache.p1HpText !== p1HpTxt) {
    hudCache.p1HpText = p1HpTxt;
    p1HpText.textContent = p1HpTxt;
  }
  const p1InkW = `${((hud.p1.ink / hud.p1.maxInk) * 100).toFixed(1)}%`;
  if (hudCache.p1InkW !== p1InkW) {
    hudCache.p1InkW = p1InkW;
    p1InkFill.style.width = p1InkW;
  }
  if (hudCache.p1Ready !== hud.p1.superReady) {
    hudCache.p1Ready = hud.p1.superReady;
    p1InkFill.classList.toggle('ready', hud.p1.superReady);
  }
  const superKeyLabel = formatCodeLabel(activeProfile.bindings.superBtn[0] ?? 'KeyI');
  const p1InkTxt = hud.p1.superReady
    ? `★ 大招就绪 [按 ${superKeyLabel}] ★`
    : `灵感 ${Math.floor(hud.p1.ink)}%`;
  if (hudCache.p1InkLabel !== p1InkTxt) {
    hudCache.p1InkLabel = p1InkTxt;
    p1InkLabel.textContent = p1InkTxt;
  }
  const p1GuardW = `${hud.p1.guardMeter.toFixed(1)}%`;
  if (hudCache.p1GuardW !== p1GuardW) {
    hudCache.p1GuardW = p1GuardW;
    p1GuardFill.style.width = p1GuardW;
  }

  if (hudCache.rankKey !== hud.styleRank) {
    hudCache.rankKey = hud.styleRank;
    const rankMeta = getStyleRankMeta(hud.styleRank);
    if (rankMeta) {
      styleRankBadge.classList.remove('hidden');
      styleRankBadge.style.borderColor = rankMeta.color;
      srCnEl.textContent = rankMeta.cn;
      srCnEl.style.color = rankMeta.color;
      srSubEl.textContent = rankMeta.sub;
    } else {
      styleRankBadge.classList.add('hidden');
    }
  }

  const buffsKey = hud.mode === 'roguelike' ? hud.roguelikeBuffs.join(',') : '';
  if (hudCache.buffsKey !== buffsKey) {
    hudCache.buffsKey = buffsKey;
    if (hud.mode === 'roguelike' && hud.roguelikeBuffs.length > 0) {
      rogueBuffStrip.innerHTML = hud.roguelikeBuffs
        .map((id) => {
          const b = ROGUELIKE_BUFFS[id];
          return `<span class="rogue-buff-chip" title="${b.desc}">${b.icon}${b.name}</span>`;
        })
        .join('');
    } else {
      rogueBuffStrip.innerHTML = '';
    }
  }

  if (hudCache.p2Name !== hud.p2.name) {
    hudCache.p2Name = hud.p2.name;
    p2NameEl.textContent = hud.p2.name;
  }
  const p2WepTxt = `${WEAPONS[hud.p2.weapon].icon} ${hud.p2.weaponName}`;
  if (hudCache.p2Weapon !== p2WepTxt) {
    hudCache.p2Weapon = p2WepTxt;
    p2WeaponEl.textContent = p2WepTxt;
  }
  const p2Pct = Math.max(0, (hud.p2.hp / hud.p2.maxHp) * 100);
  const p2DelPct = Math.max(0, (hud.p2.delayedHp / hud.p2.maxHp) * 100);
  const p2HpW = `${p2Pct.toFixed(1)}%`;
  const p2DelW = `${p2DelPct.toFixed(1)}%`;
  if (hudCache.p2HpW !== p2HpW) {
    hudCache.p2HpW = p2HpW;
    p2HpFill.style.width = p2HpW;
  }
  if (hudCache.p2DelW !== p2DelW) {
    hudCache.p2DelW = p2DelW;
    p2HpDelayed.style.width = p2DelW;
  }
  const p2Danger = p2Pct < 30;
  if (hudCache.p2Danger !== p2Danger) {
    hudCache.p2Danger = p2Danger;
    p2HpFill.classList.toggle('danger', p2Danger);
  }
  const p2HpTxt = `${Math.ceil(hud.p2.hp)} / ${hud.p2.maxHp}`;
  if (hudCache.p2HpText !== p2HpTxt) {
    hudCache.p2HpText = p2HpTxt;
    p2HpText.textContent = p2HpTxt;
  }
  const p2InkW = `${((hud.p2.ink / hud.p2.maxInk) * 100).toFixed(1)}%`;
  if (hudCache.p2InkW !== p2InkW) {
    hudCache.p2InkW = p2InkW;
    p2InkFill.style.width = p2InkW;
  }
  if (hudCache.p2Ready !== hud.p2.superReady) {
    hudCache.p2Ready = hud.p2.superReady;
    p2InkFill.classList.toggle('ready', hud.p2.superReady);
  }
  const p2InkTxt = hud.p2.superReady ? '★ 大招就绪 ★' : `灵感 ${Math.floor(hud.p2.ink)}%`;
  if (hudCache.p2InkLabel !== p2InkTxt) {
    hudCache.p2InkLabel = p2InkTxt;
    p2InkLabel.textContent = p2InkTxt;
  }
  const p2GuardW = `${hud.p2.guardMeter.toFixed(1)}%`;
  if (hudCache.p2GuardW !== p2GuardW) {
    hudCache.p2GuardW = p2GuardW;
    p2GuardFill.style.width = p2GuardW;
  }

  const winsKey =
    hud.mode === 'training'
      ? 'train'
      : hud.mode === 'roguelike'
        ? `rogue:${hud.roguelikeAliveEnemies}`
        : `dots:${hud.p1Wins}:${hud.p2Wins}:${hud.maxRounds}`;
  if (hudCache.winsKey !== winsKey) {
    hudCache.winsKey = winsKey;
    if (hud.mode === 'training') {
      p1WinsEl.innerHTML = '';
      p2WinsEl.innerHTML = '';
    } else if (hud.mode === 'roguelike') {
      p1WinsEl.innerHTML = '';
      p2WinsEl.innerHTML = `<span class="weapon-pill">余敌 ${hud.roguelikeAliveEnemies}</span>`;
    } else {
      const needed = Math.max(1, Math.ceil((hud.maxRounds || 3) / 2));
      renderWinDots(p1WinsEl, hud.p1Wins, needed);
      renderWinDots(p2WinsEl, hud.p2Wins, needed);
    }
  }

  const nextRoundTag =
    hud.mode === 'training'
      ? '自由练习本'
      : hud.mode === 'roguelike'
        ? `涂鸦生存战 · 第 ${hud.roguelikeWave} 波`
        : hud.mode === 'arcade'
          ? `第 ${hud.arcadeStage}/${hud.arcadeTotal} 关 · R${hud.round}`
          : `第 ${hud.round} 回合`;
  if (hudCache.roundTag !== nextRoundTag) {
    hudCache.roundTag = nextRoundTag;
    roundTagEl.textContent = nextRoundTag;
  }

  const nextTimer = hud.mode === 'training' ? '∞' : `${hud.timer}`;
  if (hudCache.timerText !== nextTimer) {
    hudCache.timerText = nextTimer;
    timerEl.textContent = nextTimer;
  }

  if (hudCache.comboP1 !== hud.comboP1) {
    hudCache.comboP1 = hud.comboP1;
    if (hud.comboP1 >= 2) {
      p1ComboEl.textContent = `${hud.comboP1} 连击!!`;
      p1ComboEl.classList.remove('hidden');
    } else {
      p1ComboEl.classList.add('hidden');
    }
  }
  if (hudCache.comboP2 !== hud.comboP2) {
    hudCache.comboP2 = hud.comboP2;
    if (hud.comboP2 >= 2) {
      p2ComboEl.textContent = `${hud.comboP2} 连击!!`;
      p2ComboEl.classList.remove('hidden');
    } else {
      p2ComboEl.classList.add('hidden');
    }
  }

  const bannerKey = hud.bannerText && !hud.bannerStamp ? `${hud.bannerText}|${hud.bannerSub}` : '';
  if (hudCache.bannerKey !== bannerKey) {
    hudCache.bannerKey = bannerKey;
    if (bannerKey) {
      bannerTitle.textContent = hud.bannerText;
      bannerSub.textContent = hud.bannerSub;
      hudBanner.classList.remove('hidden');
    } else {
      hudBanner.classList.add('hidden');
    }
  }
}

function showBuffPicker(waveCleared: number, choices: RoguelikeBuffDef[]): void {
  game.input.clearAll();
  const titleEl = document.getElementById('buff-title')!;
  const cardsEl = document.getElementById('buff-cards')!;
  titleEl.textContent = `🃏 第 ${waveCleared} 波清场！挑选一张文具强化贴纸`;
  cardsEl.innerHTML = '';

  for (const buff of choices) {
    const card = document.createElement('button');
    card.className = 'buff-card';
    card.innerHTML = `
      <div class="bc-icon">${buff.icon}</div>
      <div class="bc-tag" style="background:${buff.accent}">${buff.tag}</div>
      <div class="bc-name">${buff.name}</div>
      <div class="bc-desc">${buff.desc}</div>
    `;
    card.addEventListener('click', () => {
      buffOverlay.classList.add('hidden');
      game.pickRoguelikeBuff(buff.id);
    });
    cardsEl.appendChild(card);
  }

  buffOverlay.classList.remove('hidden');
}

function showResultModal(
  winnerIndex: 0 | 1,
  stats: MatchStats,
  canNextArcade: boolean,
  arcadeCleared: boolean
): void {
  const stamp = document.getElementById('result-stamp')!;
  const title = document.getElementById('result-title')!;
  const sub = document.getElementById('result-sub')!;
  const statsEl = document.getElementById('result-stats')!;
  const nextBtn = document.getElementById('btn-next-arcade')!;
  const koWrap = document.getElementById('ko-photo-wrap')!;
  const koImg = document.getElementById('ko-photo-img') as HTMLImageElement;

  const rankMeta = getStyleRankMeta(stats.highestStyleRank);
  const rankStr = rankMeta ? `${rankMeta.cn} (${rankMeta.sub})` : 'C (涂鸦起步)';

  if (selectedMode === 'roguelike') {
    const w = stats.roguelikeWave ?? 1;
    stamp.textContent = `第${w}波`;
    title.textContent = `涂鸦生存战 · 撑到了第 ${w} 波！`;
    sub.textContent =
      w >= 6
        ? '红笔批注：12 件文具炉火纯青，全班第一学神！'
        : '红笔批注：多利用修正带涂白消弹与强化贴纸，下次冲更高波次！';
  } else if (arcadeCleared) {
    stamp.textContent = '100分';
    title.textContent = '课桌争霸赛 · 全满分通关！';
    sub.textContent = '红笔批注：成功击败「执笔大魔王·黑金钢笔」，特颁满分红星！(100分)';
  } else if (selectedMode === 'arcade') {
    stamp.textContent = winnerIndex === 0 ? '优+' : '重做!';
    title.textContent = winnerIndex === 0 ? '挑战成功！晋级下一关' : '差点就过了，重写一页！';
    sub.textContent =
      winnerIndex === 0
        ? '红笔批注：文具用得出神入化，动作干脆利落！'
        : '红笔批注：试试用精准弹反「铛！」反制对手或换把顺手文具！';
  } else {
    stamp.textContent = winnerIndex === 0 ? 'P1 满分' : 'P2 满分';
    title.textContent = winnerIndex === 0 ? '1P 小墨 赢得课桌对决！' : '2P 小蓝 赢得课桌对决！';
    sub.textContent = '红笔批注：同桌切磋精彩绝伦，作业本都要画满了！';
  }

  lastKoSnapshotUrl = stats.koSnapshotDataUrl ?? null;
  if (lastKoSnapshotUrl) {
    koImg.src = lastKoSnapshotUrl;
    koWrap.classList.remove('hidden');
  } else {
    koWrap.classList.add('hidden');
  }

  statsEl.innerHTML = `
    <div class="stat-box"><div class="stat-k">P1 总输出伤害</div><div class="stat-v">${stats.p1DamageDealt}</div></div>
    <div class="stat-box"><div class="stat-k">本场最高打分</div><div class="stat-v">${rankStr}</div></div>
    <div class="stat-box"><div class="stat-k">完美弹反次数 (P1 / 敌)</div><div class="stat-v">${stats.p1Parries} / ${stats.p2Parries}</div></div>
    <div class="stat-box"><div class="stat-k">最高连击 / 文具对撞</div><div class="stat-v">${Math.max(stats.p1MaxCombo, stats.p2MaxCombo)} 连 / ${stats.clashes} 次</div></div>
  `;

  nextBtn.classList.toggle('hidden', !canNextArcade);
  resultOverlay.classList.remove('hidden');
}

document.getElementById('btn-download-ko')!.addEventListener('click', () => {
  if (!lastKoSnapshotUrl) return;
  game.sound.playUiSelect();
  const a = document.createElement('a');
  a.href = lastKoSnapshotUrl;
  a.download = `scratchpad-brawl-ko-${Date.now()}.png`;
  a.click();
});

// ==================== BUILD SETUP SELECTORS (12 STATIONERY + 8 STAGES!) ====================
function buildSetupOptions(): void {
  const p1List = document.getElementById('p1-weapon-list')!;
  p1List.innerHTML = '';
  const visibleWeapons =
    selectedWeaponCat === 'all'
      ? WEAPON_LIST
      : WEAPON_LIST.filter((w) => w.category === selectedWeaponCat);

  for (const w of visibleWeapons) {
    const card = document.createElement('button');
    card.className = `weapon-card ${w.id === selectedP1Weapon ? 'selected' : ''}`;
    card.innerHTML = `
      <div class="wc-head">
        <span class="wc-name">${w.icon} ${w.name}</span>
        <span class="wc-tag">${w.tag}</span>
      </div>
      <div class="wc-desc">${w.desc}</div>
    `;
    card.addEventListener('click', () => {
      game.sound.unlock();
      game.sound.playUiSelect();
      selectedP1Weapon = w.id;
      game.previewSetupScene(selectedStage, selectedTheme, selectedP1Weapon);
      buildSetupOptions();
    });
    p1List.appendChild(card);
  }

  const ladderEl = document.getElementById('arcade-ladder')!;
  ladderEl.innerHTML = '';
  for (const m of ARCADE_MASTERS) {
    const row = document.createElement('div');
    row.className = `ladder-row ${m.isBoss ? 'boss' : ''}`;
    row.innerHTML = `
      <span class="ladder-num" style="background:${m.inkColor}">${m.stageIndex + 1}</span>
      <div class="ladder-info">
        <div class="ladder-name">${m.name} <span style="font-weight:600;font-size:11px;color:${m.scarfColor}">[${WEAPONS[m.weapon].icon} ${WEAPONS[m.weapon].name}]</span></div>
        <div class="ladder-sub">${m.title} · ${STAGES[m.stage].name}</div>
      </div>
    `;
    ladderEl.appendChild(row);
  }

  const bestRec = document.getElementById('rogue-best-record');
  if (bestRec) {
    bestRec.textContent = `历史最高生存记录：第 ${game.career.highestWave} 波 ｜ 累计击倒：${game.career.totalKOs} 敌`;
  }

  const stageList = document.getElementById('stage-list')!;
  stageList.innerHTML = '';
  for (const st of STAGE_LIST) {
    const card = document.createElement('button');
    card.className = `stage-card ${st.id === selectedStage ? 'selected' : ''}`;
    const sizeClass =
      st.sizeTag === '超大战场'
        ? 'grand'
        : st.sizeTag === '大地图'
          ? 'large'
          : st.sizeTag === '纵深竖图'
            ? 'tall'
            : '';
    card.innerHTML = `
      <div class="sc-head">
        <span class="sc-name">${st.name}</span>
        <span class="sc-tags">
          <span class="size-pill ${sizeClass}">${st.sizeTag}</span>
          <span class="size-pill">${st.category}</span>
        </span>
      </div>
      <div class="sc-desc">${st.desc}</div>
    `;
    card.addEventListener('click', () => {
      game.sound.unlock();
      game.sound.playUiClick();
      selectedStage = st.id;
      selectedTheme = st.recommendedTheme;
      game.previewSetupScene(selectedStage, selectedTheme, selectedP1Weapon);
      buildSetupOptions();
    });
    stageList.appendChild(card);
  }

  const p2List = document.getElementById('p2-weapon-list')!;
  p2List.innerHTML = '';
  for (const w of WEAPON_LIST) {
    const btn = document.createElement('button');
    btn.className = `pill-btn ${w.id === selectedP2Weapon ? 'selected' : ''}`;
    btn.textContent = `${w.icon}${w.name}`;
    btn.addEventListener('click', () => {
      game.sound.unlock();
      game.sound.playUiClick();
      selectedP2Weapon = w.id;
      buildSetupOptions();
    });
    p2List.appendChild(btn);
  }

  const themeList = document.getElementById('theme-list')!;
  themeList.innerHTML = '';
  for (const th of THEME_LIST) {
    const btn = document.createElement('button');
    btn.className = `pill-btn ${th.id === selectedTheme ? 'selected' : ''}`;
    btn.textContent = th.name;
    btn.addEventListener('click', () => {
      game.sound.unlock();
      game.sound.playUiClick();
      selectedTheme = th.id;
      game.setTheme(selectedTheme);
      buildSetupOptions();
    });
    themeList.appendChild(btn);
  }
}

function updateSetupModeView(): void {
  document.getElementById('arcade-preview-wrap')!.classList.toggle('hidden', selectedMode !== 'arcade');
  document.getElementById('roguelike-preview-wrap')!.classList.toggle('hidden', selectedMode !== 'roguelike');
  document.getElementById('custom-setup-wrap')!.classList.toggle(
    'hidden',
    selectedMode === 'arcade' || selectedMode === 'roguelike'
  );
  document.getElementById('versus-controller-box')!.classList.toggle('hidden', selectedMode !== 'versus');
  document.getElementById('p2-weapon-label')!.textContent =
    selectedMode === 'training' ? '木桩文具' : '对手文具（P2）';
  renderVersusControllerBox();
}

function launchConfiguredMatch(arcadeIdx = 0): void {
  claimingPlayer = null;
  game.input.cancelAllCaptures();
  game.input.clearAll();
  (document.activeElement as HTMLElement | null)?.blur?.();
  syncActivePlayerDevices();
  currentArcadeStage = arcadeIdx;
  titleScreen.classList.add('hidden');
  setupOverlay.classList.add('hidden');
  pauseOverlay.classList.add('hidden');
  controlsOverlay.classList.add('hidden');
  cosmeticsOverlay.classList.add('hidden');
  jukeboxOverlay.classList.add('hidden');
  buffOverlay.classList.add('hidden');
  resultOverlay.classList.add('hidden');
  hudEl.classList.remove('hidden');
  trainingBar.classList.toggle('hidden', selectedMode !== 'training');
  p2KeyHint.classList.toggle('hidden', selectedMode !== 'versus');

  if (selectedMode === 'training') {
    (document.getElementById('tb-weapon') as HTMLSelectElement).value = selectedP1Weapon;
  }

  game.startMatch({
    mode: selectedMode,
    p1Weapon: selectedP1Weapon,
    p2Weapon: selectedP2Weapon,
    stageId: selectedStage,
    themeId: selectedTheme,
    arcadeStageIndex: currentArcadeStage,
  });
}

document.getElementById('btn-start-game')!.addEventListener('click', () => {
  game.sound.unlock();
  game.sound.playStamp();
  launchConfiguredMatch(0);
});

// ==================== 6-TRACK JUKEBOX & AUDIO CONTROLS ====================
function syncTrackLabels(track: BgmTrackMeta): void {
  document.getElementById('mj-track-name')!.textContent = track.name;
  document.getElementById('hud-track-short')!.textContent = track.name.replace(/[《》]/g, '');
  if (!jukeboxOverlay.classList.contains('hidden')) {
    renderJukeboxModal();
  }
}

function syncAudioButtons(): void {
  const sfxOff = game.sound.muted;
  const bgmOff = !game.bgm.isEnabled();

  const hudSfx = document.getElementById('btn-mute-sfx')!;
  const hudBgm = document.getElementById('btn-mute-bgm')!;
  const mjMute = document.getElementById('mj-mute-bgm')!;
  const jbToggle = document.getElementById('jb-toggle-enable')!;

  hudSfx.classList.toggle('muted', sfxOff);
  hudSfx.textContent = sfxOff ? '🔇' : '🔊';

  hudBgm.classList.toggle('muted', bgmOff);
  mjMute.textContent = bgmOff ? '🔇' : '🔊';
  jbToggle.textContent = bgmOff ? '🎵 乐章：已静音' : '🎵 乐章：已开启';
}

const toggleSfx = () => {
  game.sound.unlock();
  game.sound.setMuted(!game.sound.muted);
  if (!game.sound.muted) game.sound.playUiClick();
  syncAudioButtons();
};

const toggleBgm = () => {
  game.sound.unlock();
  game.sound.playUiClick();
  game.bgm.setEnabled(!game.bgm.isEnabled());
  syncAudioButtons();
};

document.getElementById('btn-mute-sfx')!.addEventListener('click', (e) => {
  toggleSfx();
  (e.currentTarget as HTMLElement).blur();
});
document.getElementById('btn-mute-bgm')!.addEventListener('click', (e) => {
  toggleBgm();
  (e.currentTarget as HTMLElement).blur();
});
document.getElementById('mj-mute-bgm')!.addEventListener('click', toggleBgm);
document.getElementById('jb-toggle-enable')!.addEventListener('click', toggleBgm);

document.getElementById('mj-prev')!.addEventListener('click', () => {
  game.sound.unlock();
  game.sound.playUiClick();
  if (game.bgm.isEnabled()) game.bgm.start();
  game.bgm.prevTrack();
});
document.getElementById('mj-next')!.addEventListener('click', () => {
  game.sound.unlock();
  game.sound.playUiClick();
  if (game.bgm.isEnabled()) game.bgm.start();
  game.bgm.nextTrack();
});
document.getElementById('btn-hud-next-track')!.addEventListener('click', (e) => {
  game.sound.unlock();
  game.sound.playUiClick();
  if (game.bgm.isEnabled()) game.bgm.start();
  game.bgm.nextTrack();
  (e.currentTarget as HTMLElement).blur();
});

function renderJukeboxModal(): void {
  const curId = game.bgm.currentTrackId;
  document.querySelectorAll<HTMLButtonElement>('[data-playmode]').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.playmode === game.bgm.playMode);
  });

  const grid = document.getElementById('jukebox-grid')!;
  grid.innerHTML = '';
  for (const t of BGM_TRACK_LIST) {
    const card = document.createElement('button');
    card.className = `track-card ${t.id === curId ? 'playing' : ''}`;
    card.innerHTML = `
      <div class="tc-head">
        <span class="tc-name">${t.id === curId ? '▶ ' : ''}${t.name}</span>
        <span class="tc-bpm">${t.bpm} BPM</span>
      </div>
      <div class="tc-style">${t.style}</div>
      <div class="tc-desc">${t.desc}</div>
    `;
    card.addEventListener('click', () => {
      game.sound.unlock();
      game.sound.playUiSelect();
      if (!game.bgm.isEnabled()) game.bgm.setEnabled(true);
      game.bgm.start();
      game.bgm.selectTrack(t.id, true);
      syncAudioButtons();
      renderJukeboxModal();
    });
    grid.appendChild(card);
  }
}

function openJukeboxModal(): void {
  game.sound.unlock();
  game.sound.playUiClick();
  game.input.clearAll();
  if (game.bgm.isEnabled()) game.bgm.start();
  renderJukeboxModal();
  jukeboxOverlay.classList.remove('hidden');
}

document.getElementById('title-jukebox-btn')!.addEventListener('click', openJukeboxModal);
document.getElementById('menu-jukebox-btn')!.addEventListener('click', openJukeboxModal);
document.getElementById('mj-open')!.addEventListener('click', openJukeboxModal);
document.getElementById('btn-pause-jukebox')!.addEventListener('click', openJukeboxModal);
document.getElementById('btn-close-jukebox-x')!.addEventListener('click', () => {
  game.sound.playUiClick();
  jukeboxOverlay.classList.add('hidden');
});
document.getElementById('btn-close-jukebox')!.addEventListener('click', () => {
  game.sound.playUiSelect();
  jukeboxOverlay.classList.add('hidden');
});

document.querySelectorAll<HTMLButtonElement>('[data-playmode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    game.sound.playUiClick();
    game.bgm.setPlayMode(btn.dataset.playmode as BgmPlayMode);
    renderJukeboxModal();
  });
});

// ==================== PAUSE, RESULT & TRAINING HANDLERS ====================
document.getElementById('btn-pause')!.addEventListener('click', (e) => {
  game.sound.playUiClick();
  (e.currentTarget as HTMLElement).blur();
  game.setPaused(!game.isPaused());
});
document.getElementById('btn-resume')!.addEventListener('click', (e) => {
  game.sound.playUiClick();
  (e.currentTarget as HTMLElement).blur();
  if (mathGame.isActive()) {
    mathGame.setPaused(false);
  } else {
    game.setPaused(false);
  }
});
document.getElementById('btn-restart-round')!.addEventListener('click', () => {
  game.sound.playUiSelect();
  if (mathGame.isActive()) {
    launchGeoMatch(geoTrialStage);
  } else {
    launchConfiguredMatch(currentArcadeStage);
  }
});

document.getElementById('btn-back-menu')!.addEventListener('click', showTitleScreen);
document.getElementById('btn-result-menu')!.addEventListener('click', showTitleScreen);
document.getElementById('tb-exit')!.addEventListener('click', showTitleScreen);
document.getElementById('btn-result-setup')!.addEventListener('click', () => {
  game.returnToMenu();
  openSetupScreen(selectedMode, false);
});

document.getElementById('btn-rematch')!.addEventListener('click', () => {
  game.sound.playStamp();
  launchConfiguredMatch(currentArcadeStage);
});
document.getElementById('btn-next-arcade')!.addEventListener('click', () => {
  game.sound.playPageFlip();
  launchConfiguredMatch(Math.min(ARCADE_MASTERS.length - 1, currentArcadeStage + 1));
});

// Training Toolbar (always blur controls immediately so keyboard focus never stays trapped!)
document.getElementById('tb-weapon')!.addEventListener('change', (e) => {
  const sel = e.target as HTMLSelectElement;
  const val = sel.value as WeaponId;
  selectedP1Weapon = val;
  game.setP1WeaponLive(val);
  sel.blur();
  game.input.clearAll();
});
document.getElementById('tb-dummy')!.addEventListener('change', (e) => {
  game.sound.playUiClick();
  const sel = e.target as HTMLSelectElement;
  game.trainingDummy = sel.value as TrainingDummyMode;
  sel.blur();
  game.input.clearAll();
});
document.getElementById('tb-inf-ink')!.addEventListener('click', (e) => {
  game.sound.playUiClick();
  game.trainingInfInk = !game.trainingInfInk;
  const btn = e.currentTarget as HTMLButtonElement;
  btn.textContent = `无限灵感: ${game.trainingInfInk ? '开' : '关'}`;
  btn.classList.toggle('active', game.trainingInfInk);
  btn.blur();
});
document.getElementById('tb-hitbox')!.addEventListener('click', (e) => {
  game.sound.playUiClick();
  game.showHitboxes = !game.showHitboxes;
  const btn = e.currentTarget as HTMLButtonElement;
  btn.textContent = `判定框: ${game.showHitboxes ? '开' : '关'}`;
  btn.classList.toggle('active', game.showHitboxes);
  btn.blur();
});
document.getElementById('tb-reset')!.addEventListener('click', (e) => {
  (e.currentTarget as HTMLElement).blur();
  game.resetTrainingState();
});

// ==================== MULTI-DEVICE & GAMEPAD PAIRING (v0.2.0) ====================
function autoSuggestVersusDevicesIfNeeded(pads: ConnectedGamepadInfo[]): void {
  if (userManuallyPickedVersusDevices) return;
  if (pads.length >= 2) {
    storedGamepad.versusP1Device = deviceFromGamepadIndex(pads[0].index);
    storedGamepad.versusP2Device = deviceFromGamepadIndex(pads[1].index);
    saveStoredGamepadConfig(storedGamepad);
  } else if (
    pads.length === 1 &&
    storedGamepad.versusP1Device === 'kb_p1' &&
    storedGamepad.versusP2Device === 'kb_p2'
  ) {
    // 1 gamepad plugged in: smartly pair P1 (KB/Mouse) + P2 (Gamepad #1)!
    storedGamepad.versusP1Device = 'kb_p1';
    storedGamepad.versusP2Device = deviceFromGamepadIndex(pads[0].index);
    saveStoredGamepadConfig(storedGamepad);
  }
}

function handleGamepadsChanged(pads: ConnectedGamepadInfo[]): void {
  const titleBadge = document.getElementById('title-gp-badge');
  if (titleBadge) {
    titleBadge.classList.toggle('hidden', pads.length === 0);
    if (pads.length > 0) {
      titleBadge.textContent =
        pads.length === 1
          ? `🎮 已连 1 把手柄（${pads[0].shortName}）`
          : `🎮 已连 ${pads.length} 把手柄（支持双人双手柄同屏！）`;
    }
  }

  const tabDot = document.getElementById('gp-tab-dot');
  if (tabDot) {
    tabDot.textContent = String(pads.length);
    tabDot.classList.toggle('has-pad', pads.length > 0);
  }

  const gpBtn = document.getElementById('title-gamepad-btn');
  if (gpBtn) {
    gpBtn.textContent =
      pads.length > 0 ? `🎮 手柄 (${pads.length}已连) · 改键` : '🎮 手柄与自定义';
  }

  if (selectedMode === 'versus' && !setupOverlay.classList.contains('hidden')) {
    autoSuggestVersusDevicesIfNeeded(pads);
  }
  syncActivePlayerDevices();
  renderVersusControllerBox();
  if (!controlsOverlay.classList.contains('hidden')) {
    renderControlsModal();
  }
}

function syncActivePlayerDevices(): void {
  const pads = game.input.connectedGamepads;
  const inGeoVersus = mathGame?.isActive() && selectedGeoMode === 'versus';
  const p1Dev: PlayerInputDevice =
    selectedMode === 'versus' || inGeoVersus ? storedGamepad.versusP1Device : storedGamepad.singleP1Device;
  const p2Dev: PlayerInputDevice =
    selectedMode === 'versus' || inGeoVersus ? storedGamepad.versusP2Device : 'kb_p2';

  game.setPlayerDevices(p1Dev, p2Dev);

  const p1Summary = buildDeviceKeyHintSummary(
    'P1',
    p1Dev,
    activeProfile,
    activeGpProfile,
    pads.length > 0
  );
  const p2Summary = buildDeviceKeyHintSummary(
    'P2',
    p2Dev,
    activeProfile,
    activeGpProfile,
    pads.length > 0
  );
  p1KeyHint.innerHTML = p1Summary;
  p2KeyHint.innerHTML = p2Summary;
  const geoHintEl = document.getElementById('geo-key-hint');
  if (geoHintEl) {
    geoHintEl.innerHTML = inGeoVersus ? `${p1Summary} &nbsp;｜&nbsp; ${p2Summary}` : p1Summary;
  }
  const geoNoteEl = document.getElementById('geo-setup-ctrl-note');
  if (geoNoteEl) {
    geoNoteEl.innerHTML = `当前操作共用：${p1Summary}`;
  }

  const shortLabel = getPresetShortName(storedControls.activePreset);
  if (selectedMode === 'versus') {
    const p1Lbl = formatDeviceLabel(p1Dev, pads);
    const p2Lbl = formatDeviceLabel(p2Dev, pads);
    menuControlsSummary.innerHTML = `<strong>双人同屏设备：</strong><b>P1 小墨</b> <code>${p1Lbl}</code> <b>VS</b> <b>P2 小蓝</b> <code>${p2Lbl}</code>｜手柄预设：<code>${getGamepadPresetShortName(storedGamepad.activePreset)}</code>`;
  } else {
    const kBlock = formatCodeLabel(activeProfile.bindings.block[0] ?? 'KeyL');
    const kHeavy = formatCodeLabel(activeProfile.bindings.heavy[0] ?? 'KeyK');
    const kSuper = formatCodeLabel(activeProfile.bindings.superBtn[0] ?? 'KeyI');
    const kDash = formatCodeLabel(activeProfile.bindings.dash[0] ?? 'KeyU');
    const aimHint = activeProfile.mouseAim ? '｜移动 <code>鼠标</code> 360° 瞄准' : '';
    const gpHint = pads.length > 0 ? '｜<code>🎮 手柄即插即用</code>' : '';
    menuControlsSummary.innerHTML = `<strong>当前操作（${shortLabel}）：</strong><code>${kBlock}</code> <b>弹反「铛！」</b>｜长按 <code>${kHeavy}</code> <b>蓄力</b>｜<code>${kDash}</code> <b>残影</b>｜满灵感 <code>${kSuper}</code> <b>大招</b>${aimHint}${gpHint}`;
  }
}

function setVersusDevice(playerIdx: 0 | 1, nextDev: PlayerInputDevice): void {
  userManuallyPickedVersusDevices = true;
  if (playerIdx === 0) {
    const prev = storedGamepad.versusP1Device;
    storedGamepad.versusP1Device = nextDev;
    if (storedGamepad.versusP2Device === nextDev) {
      storedGamepad.versusP2Device = prev;
    }
  } else {
    const prev = storedGamepad.versusP2Device;
    storedGamepad.versusP2Device = nextDev;
    if (storedGamepad.versusP1Device === nextDev) {
      storedGamepad.versusP1Device = prev;
    }
  }
  saveStoredGamepadConfig(storedGamepad);
  syncActivePlayerDevices();
  renderVersusControllerBox();
}

function renderVersusControllerBox(): void {
  const box = document.getElementById('versus-controller-box');
  if (!box) return;
  const pads = game.input.connectedGamepads;
  const statusEl = document.getElementById('vs-gp-status')!;

  if (pads.length > 0) {
    statusEl.textContent = `🟢 已连 ${pads.length} 把：${pads.map((p) => p.shortName).join(' / ')}`;
    statusEl.classList.add('online');
  } else {
    statusEl.textContent = '⚪ 未检测到手柄（插上手柄按任意键即刻识别）';
    statusEl.classList.remove('online');
  }

  const p1Dev = storedGamepad.versusP1Device;
  const p2Dev = storedGamepad.versusP2Device;
  const p1IsGp = gamepadIndexFromDevice(p1Dev) !== null;
  const p2IsGp = gamepadIndexFromDevice(p2Dev) !== null;

  document
    .getElementById('btn-vs-combo-kb')!
    .classList.toggle('active', !p1IsGp && !p2IsGp);
  document
    .getElementById('btn-vs-combo-kbgp')!
    .classList.toggle('active', (p1IsGp && !p2IsGp) || (!p1IsGp && p2IsGp));
  document
    .getElementById('btn-vs-combo-2gp')!
    .classList.toggle('active', p1IsGp && p2IsGp);

  const deviceOptions: Array<{ value: PlayerInputDevice; label: string }> = [
    { value: 'kb_p1', label: `🖱️ 键鼠/左侧键盘 (${getPresetShortName(storedControls.activePreset)})` },
    { value: 'kb_p2', label: '⌨️ 右侧键盘 (方向键+NM,. / 小键盘)' },
    { value: 'gp0', label: formatDeviceLabel('gp0', pads) },
    { value: 'gp1', label: formatDeviceLabel('gp1', pads) },
    { value: 'gp2', label: formatDeviceLabel('gp2', pads) },
    { value: 'gp3', label: formatDeviceLabel('gp3', pads) },
  ];

  const selP1 = document.getElementById('sel-vs-p1-dev') as HTMLSelectElement;
  const selP2 = document.getElementById('sel-vs-p2-dev') as HTMLSelectElement;

  const populate = (sel: HTMLSelectElement, current: PlayerInputDevice) => {
    sel.innerHTML = '';
    for (const opt of deviceOptions) {
      const el = document.createElement('option');
      el.value = opt.value;
      el.textContent = opt.label;
      if (opt.value === current) el.selected = true;
      sel.appendChild(el);
    }
  };
  populate(selP1, p1Dev);
  populate(selP2, p2Dev);

  const claim1 = document.getElementById('btn-claim-p1')!;
  const claim2 = document.getElementById('btn-claim-p2')!;
  claim1.classList.toggle('claiming', claimingPlayer === 0);
  claim1.textContent = claimingPlayer === 0 ? '请按手柄键...' : '认领手柄';
  claim2.classList.toggle('claiming', claimingPlayer === 1);
  claim2.textContent = claimingPlayer === 1 ? '请按手柄键...' : '认领手柄';
}

document.getElementById('btn-vs-combo-kb')!.addEventListener('click', () => {
  game.sound.unlock();
  game.sound.playUiSelect();
  userManuallyPickedVersusDevices = true;
  storedGamepad.versusP1Device = 'kb_p1';
  storedGamepad.versusP2Device = 'kb_p2';
  saveStoredGamepadConfig(storedGamepad);
  syncActivePlayerDevices();
  renderVersusControllerBox();
});

document.getElementById('btn-vs-combo-kbgp')!.addEventListener('click', () => {
  game.sound.unlock();
  game.sound.playUiSelect();
  userManuallyPickedVersusDevices = true;
  const firstPadIdx = game.input.connectedGamepads[0]?.index ?? 0;
  storedGamepad.versusP1Device = 'kb_p1';
  storedGamepad.versusP2Device = deviceFromGamepadIndex(firstPadIdx);
  saveStoredGamepadConfig(storedGamepad);
  syncActivePlayerDevices();
  renderVersusControllerBox();
});

document.getElementById('btn-vs-combo-2gp')!.addEventListener('click', () => {
  game.sound.unlock();
  game.sound.playUiSelect();
  userManuallyPickedVersusDevices = true;
  const p1Idx = game.input.connectedGamepads[0]?.index ?? 0;
  const p2Idx = game.input.connectedGamepads[1]?.index ?? (p1Idx === 0 ? 1 : 0);
  storedGamepad.versusP1Device = deviceFromGamepadIndex(p1Idx);
  storedGamepad.versusP2Device = deviceFromGamepadIndex(p2Idx);
  saveStoredGamepadConfig(storedGamepad);
  syncActivePlayerDevices();
  renderVersusControllerBox();
});

document.getElementById('btn-vs-swap')!.addEventListener('click', () => {
  game.sound.unlock();
  game.sound.playUiSelect();
  userManuallyPickedVersusDevices = true;
  const tmp = storedGamepad.versusP1Device;
  storedGamepad.versusP1Device = storedGamepad.versusP2Device;
  storedGamepad.versusP2Device = tmp;
  saveStoredGamepadConfig(storedGamepad);
  syncActivePlayerDevices();
  renderVersusControllerBox();
});

document.getElementById('btn-vs-gp-config')!.addEventListener('click', () => {
  openControlsModal('gp');
});

(document.getElementById('sel-vs-p1-dev') as HTMLSelectElement).addEventListener('change', (e) => {
  game.sound.playUiClick();
  setVersusDevice(0, (e.target as HTMLSelectElement).value as PlayerInputDevice);
});

(document.getElementById('sel-vs-p2-dev') as HTMLSelectElement).addEventListener('change', (e) => {
  game.sound.playUiClick();
  setVersusDevice(1, (e.target as HTMLSelectElement).value as PlayerInputDevice);
});

const startClaimFor = (playerIdx: 0 | 1) => {
  game.sound.unlock();
  game.sound.playUiClick();
  if (claimingPlayer === playerIdx) {
    claimingPlayer = null;
    game.input.cancelDeviceClaim();
    renderVersusControllerBox();
    return;
  }
  claimingPlayer = playerIdx;
  renderVersusControllerBox();
  game.input.startDeviceClaim((gpIdx) => {
    claimingPlayer = null;
    if (gpIdx !== null) {
      game.sound.playUiSelect();
      setVersusDevice(playerIdx, deviceFromGamepadIndex(gpIdx));
      game.input.triggerRumble(playerIdx, 140, 0.5, 0.5);
    } else {
      renderVersusControllerBox();
    }
  });
};

document.getElementById('btn-claim-p1')!.addEventListener('click', () => startClaimFor(0));
document.getElementById('btn-claim-p2')!.addEventListener('click', () => startClaimFor(1));

// ==================== CONTROLS & GAMEPAD SETTINGS MODAL ====================
function applyActiveControls(): void {
  activeProfile = resolveActiveProfile(storedControls);
  game.setControlProfile(activeProfile);
  saveStoredControls(storedControls);

  const shortLabel = getPresetShortName(storedControls.activePreset);
  menuControlsBtn.textContent = `⌨️ ${shortLabel}`;
  titleControlsBtn.textContent = `⌨️ ${shortLabel}`;
  syncActivePlayerDevices();
  renderVersusControllerBox();
}

function applyActiveGamepadConfig(): void {
  activeGpProfile = resolveActiveGamepadProfile(storedGamepad);
  game.setGamepadProfile(activeGpProfile);
  saveStoredGamepadConfig(storedGamepad);
  syncActivePlayerDevices();
  renderVersusControllerBox();
}

function renderControlsModal(): void {
  // Update top tab switcher
  document.querySelectorAll<HTMLButtonElement>('[data-ctrl-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.ctrlTab === activeCtrlTab);
  });
  document.getElementById('ctrl-panel-kb')!.classList.toggle('hidden', activeCtrlTab !== 'kb');
  document.getElementById('ctrl-panel-gp')!.classList.toggle('hidden', activeCtrlTab !== 'gp');

  const noteEl = document.getElementById('controls-note')!;

  if (activeCtrlTab === 'kb') {
    const preview = resolveActiveProfile(storedControls);
    const preset = storedControls.activePreset;
    const isCustom = preset === 'custom';
    const isPreset2 = preset === 'preset2';

    document.querySelectorAll<HTMLButtonElement>('#preset-tabs .preset-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.preset === preset);
    });

    const chkDisableW = document.getElementById('chk-disable-w') as HTMLInputElement;
    const chkMouseAim = document.getElementById('chk-mouse-aim') as HTMLInputElement;
    const wrapW = document.getElementById('wrap-toggle-w')!;
    const wrapMouse = document.getElementById('wrap-toggle-mouse')!;
    const customTools = document.getElementById('custom-quick-tools')!;

    chkDisableW.checked = preview.disableWJump;
    chkMouseAim.checked = preview.mouseAim;
    chkDisableW.disabled = preset === 'preset1';
    wrapW.classList.toggle('disabled', preset === 'preset1');
    chkMouseAim.disabled = !isCustom;
    wrapMouse.classList.toggle('disabled', !isCustom);
    customTools.classList.toggle('hidden', !isCustom);

    if (listeningAction) {
      const meta = ACTION_META.find((m) => m.key === listeningAction);
      noteEl.textContent = `正在绑定「${meta?.label ?? ''}」：请按任意键盘键或点击鼠标键（按 Esc 取消）...`;
      noteEl.style.color = '#cf2a2a';
    } else if (isCustom) {
      noteEl.textContent = '自定义模式：点击右侧蓝色键位框即可自由改绑键盘键或鼠标左/右/中/侧键。';
      noteEl.style.color = '';
    } else if (isPreset2) {
      noteEl.textContent = '方案二已启用鼠标 360° 瞄准控向 + 左右键攻防；上方可随时切换是否禁用 W 跳跃。';
      noteEl.style.color = '';
    } else {
      noteEl.textContent = '方案一为经典纯键盘格斗预设；想改任意按键请切换到「方案三 · 自定义预设」。';
      noteEl.style.color = '';
    }

    const grid = document.getElementById('binding-grid')!;
    grid.innerHTML = '';

    for (const meta of ACTION_META) {
      const row = document.createElement('div');
      row.className = 'binding-row';

      const codes = preview.bindings[meta.key] ?? [];
      let displayText = codes.map((c) => formatCodeLabel(c)).join(' / ');
      if (meta.key === 'jump' && isPreset2 && !preview.disableWJump && !codes.includes('KeyW')) {
        displayText = `${displayText} / W`;
      }

      const isListening = listeningAction === meta.key;
      const btnClass = isListening
        ? 'bind-key-btn listening'
        : isCustom
          ? 'bind-key-btn editable'
          : 'bind-key-btn readonly';

      row.innerHTML = `
        <div class="bind-info">
          <span class="bind-label">${meta.label}</span>
          <span class="bind-tip">${meta.tip}</span>
        </div>
        <button class="${btnClass}" data-action="${meta.key}">${isListening ? '等待按键...' : displayText}</button>
      `;

      const keyBtn = row.querySelector<HTMLButtonElement>('button')!;
      if (isCustom) {
        keyBtn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          game.sound.unlock();
          game.sound.playUiClick();
          if (listeningAction === meta.key) {
            listeningAction = null;
            game.input.cancelCapture();
            renderControlsModal();
            return;
          }
          listeningAction = meta.key;
          renderControlsModal();
          game.input.startCapture((capturedCode) => {
            listeningAction = null;
            if (capturedCode) {
              storedControls.customProfile.bindings[meta.key] = [capturedCode];
              game.sound.playUiSelect();
              applyActiveControls();
            }
            renderControlsModal();
          });
        });
      }

      grid.appendChild(row);
    }
    return;
  }

  // ==================== TAB 2: GAMEPAD PRESETS & CUSTOM REBINDING ====================
  const pads = game.input.connectedGamepads;
  const gpBanner = document.getElementById('gp-live-banner')!;
  const gpConnText = document.getElementById('gp-connected-text')!;
  if (pads.length > 0) {
    gpBanner.classList.add('connected');
    gpConnText.textContent = `🟢 已识别 ${pads.length} 把手柄：${pads.map((p) => p.shortName).join(' ｜ ')}`;
  } else {
    gpBanner.classList.remove('connected');
    gpConnText.textContent = '⚪ 未检测到手柄 — 插上 Xbox / PS / Switch 手柄后按任意键即可唤醒识别';
  }

  const gpPreset = storedGamepad.activePreset;
  const isGpCustom = gpPreset === 'custom';
  const gpPreview = resolveActiveGamepadProfile(storedGamepad);

  document.querySelectorAll<HTMLButtonElement>('.gp-preset-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.gpPreset === gpPreset);
  });

  (document.getElementById('chk-gp-rumble') as HTMLInputElement).checked = storedGamepad.rumbleEnabled;
  (document.getElementById('chk-gp-raim') as HTMLInputElement).checked = storedGamepad.rightStickAim;
  (document.getElementById('chk-gp-upjump') as HTMLInputElement).checked = storedGamepad.stickUpToJump;
  const dzPct = Math.round(storedGamepad.deadzone * 100);
  (document.getElementById('rng-gp-dz') as HTMLInputElement).value = String(dzPct);
  document.getElementById('lbl-gp-dz')!.textContent = `${dzPct}%`;
  document.getElementById('gp-custom-tools')!.classList.toggle('hidden', !isGpCustom);

  if (listeningGpTarget) {
    const meta = GAMEPAD_ACTION_META.find((m) => m.key === listeningGpTarget!.action);
    const slotName = listeningGpTarget.slot === 0 ? '主键' : '副键';
    noteEl.textContent = `正在绑定手柄「${meta?.label ?? ''} · ${slotName}」：请按下手柄任意按键或扳机 (LT/RT)（按键盘 Esc 取消）...`;
    noteEl.style.color = '#cf2a2a';
  } else if (isGpCustom) {
    noteEl.textContent = '自定义手柄模式：点击任意「主键」或「+ 副键」槽，再按手柄按键/扳机即可绑定！所有手柄共用当前映射。';
    noteEl.style.color = '';
  } else {
    noteEl.textContent = '提示：手柄支持左摇杆/十字键移动 + 右摇杆 360° 弹幕瞄准；想自由改键请点「手柄方案三 · 自定义改键」。';
    noteEl.style.color = '';
  }

  const gpGrid = document.getElementById('gp-binding-grid')!;
  gpGrid.innerHTML = '';

  for (const meta of GAMEPAD_ACTION_META) {
    const row = document.createElement('div');
    row.className = 'binding-row';

    const codes = gpPreview.bindings[meta.key] ?? [];
    const primaryCode = codes[0] ?? '';
    const secondaryCode = codes[1] ?? '';

    const isListen0 =
      listeningGpTarget?.action === meta.key && listeningGpTarget.slot === 0;
    const isListen1 =
      listeningGpTarget?.action === meta.key && listeningGpTarget.slot === 1;

    const btn0Class = isListen0
      ? 'bind-key-btn gp-btn listening'
      : isGpCustom
        ? 'bind-key-btn gp-btn editable'
        : 'bind-key-btn gp-btn readonly';

    const btn1Class = isListen1
      ? 'bind-key-btn gp-sec-btn listening'
      : isGpCustom
        ? 'bind-key-btn gp-sec-btn editable'
        : 'bind-key-btn gp-sec-btn readonly';

    const secHtml =
      secondaryCode || isGpCustom
        ? `<button class="${btn1Class}" data-gp-act="${meta.key}" data-gp-slot="1" data-ignore-capture="true">${
            isListen1 ? '按手柄键…' : secondaryCode ? formatGamepadButtonLabel(secondaryCode) : '+ 副键'
          }</button>${
            isGpCustom && secondaryCode
              ? `<button class="gp-clear-sec" data-gp-clear="${meta.key}" data-ignore-capture="true" title="清除副键">×</button>`
              : ''
          }`
        : '';

    row.innerHTML = `
      <div class="bind-info">
        <span class="bind-label">${meta.label}</span>
        <span class="bind-tip">${meta.tip}</span>
      </div>
      <div class="gp-slot-group">
        <button class="${btn0Class}" data-gp-act="${meta.key}" data-gp-slot="0" data-ignore-capture="true">${
          isListen0 ? '按手柄键…' : formatGamepadButtonLabel(primaryCode)
        }</button>
        ${secHtml}
      </div>
    `;

    if (isGpCustom) {
      row.querySelectorAll<HTMLButtonElement>('[data-gp-act]').forEach((btn) => {
        btn.addEventListener('click', (ev) => {
          ev.stopPropagation();
          game.sound.unlock();
          game.sound.playUiClick();
          const act = btn.dataset.gpAct as GamepadBindableAction;
          const slot = Number(btn.dataset.gpSlot) as 0 | 1;
          if (listeningGpTarget?.action === act && listeningGpTarget.slot === slot) {
            listeningGpTarget = null;
            game.input.cancelGamepadCapture();
            renderControlsModal();
            return;
          }
          listeningGpTarget = { action: act, slot };
          renderControlsModal();
          game.input.startGamepadCapture((capturedGpCode) => {
            listeningGpTarget = null;
            if (capturedGpCode) {
              const cur = [...(storedGamepad.customProfile.bindings[act] ?? [])];
              if (slot === 0) {
                cur[0] = capturedGpCode;
                if (cur[1] === capturedGpCode) cur.splice(1, 1);
              } else {
                if (cur[0] !== capturedGpCode) {
                  cur[1] = capturedGpCode;
                }
              }
              storedGamepad.customProfile.bindings[act] = cur.filter(Boolean);
              game.sound.playUiSelect();
              applyActiveGamepadConfig();
            }
            renderControlsModal();
          });
        });
      });

      const clearBtn = row.querySelector<HTMLButtonElement>('[data-gp-clear]');
      clearBtn?.addEventListener('click', (ev) => {
        ev.stopPropagation();
        game.sound.playUiClick();
        const cur = [...(storedGamepad.customProfile.bindings[meta.key] ?? [])];
        if (cur.length > 1) {
          storedGamepad.customProfile.bindings[meta.key] = [cur[0]];
          applyActiveGamepadConfig();
          renderControlsModal();
        }
      });
    }

    gpGrid.appendChild(row);
  }
}

function openControlsModal(initialTab: 'kb' | 'gp' = 'kb'): void {
  game.sound.unlock();
  game.sound.playUiClick();
  game.input.clearAll();
  activeCtrlTab = initialTab;
  listeningAction = null;
  listeningGpTarget = null;
  game.input.cancelAllCaptures();
  renderControlsModal();
  controlsOverlay.classList.remove('hidden');
}

function closeControlsModal(): void {
  listeningAction = null;
  listeningGpTarget = null;
  game.input.cancelAllCaptures();
  applyActiveControls();
  applyActiveGamepadConfig();
  controlsOverlay.classList.add('hidden');
}

menuControlsBtn.addEventListener('click', () => openControlsModal('kb'));
titleControlsBtn.addEventListener('click', () => openControlsModal('kb'));
document.getElementById('title-gamepad-btn')!.addEventListener('click', () => openControlsModal('gp'));
document.getElementById('btn-pause-controls')!.addEventListener('click', () => openControlsModal('kb'));
document.getElementById('btn-close-controls-x')!.addEventListener('click', () => {
  game.sound.playUiClick();
  closeControlsModal();
});
document.getElementById('btn-save-controls')!.addEventListener('click', () => {
  game.sound.playUiSelect();
  closeControlsModal();
});

document.querySelectorAll<HTMLButtonElement>('[data-ctrl-tab]').forEach((tab) => {
  tab.addEventListener('click', () => {
    game.sound.unlock();
    game.sound.playUiClick();
    listeningAction = null;
    listeningGpTarget = null;
    game.input.cancelAllCaptures();
    activeCtrlTab = tab.dataset.ctrlTab as 'kb' | 'gp';
    renderControlsModal();
  });
});

document.querySelectorAll<HTMLButtonElement>('#preset-tabs .preset-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    game.sound.unlock();
    game.sound.playUiClick();
    listeningAction = null;
    game.input.cancelCapture();
    storedControls.activePreset = tab.dataset.preset as ControlPresetId;
    applyActiveControls();
    renderControlsModal();
  });
});

document.querySelectorAll<HTMLButtonElement>('.gp-preset-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    game.sound.unlock();
    game.sound.playUiClick();
    listeningGpTarget = null;
    game.input.cancelGamepadCapture();
    storedGamepad.activePreset = tab.dataset.gpPreset as GamepadPresetId;
    applyActiveGamepadConfig();
    renderControlsModal();
  });
});

(document.getElementById('chk-disable-w') as HTMLInputElement).addEventListener('change', (e) => {
  const checked = (e.target as HTMLInputElement).checked;
  game.sound.playUiClick();
  if (storedControls.activePreset === 'preset2') {
    storedControls.preset2DisableWJump = checked;
  } else if (storedControls.activePreset === 'custom') {
    storedControls.customProfile.disableWJump = checked;
  }
  applyActiveControls();
  renderControlsModal();
});

(document.getElementById('chk-mouse-aim') as HTMLInputElement).addEventListener('change', (e) => {
  const checked = (e.target as HTMLInputElement).checked;
  game.sound.playUiClick();
  if (storedControls.activePreset === 'custom') {
    storedControls.customProfile.mouseAim = checked;
    applyActiveControls();
    renderControlsModal();
  }
});

document.getElementById('btn-copy-p1')!.addEventListener('click', () => {
  game.sound.playUiSelect();
  listeningAction = null;
  game.input.cancelCapture();
  const base = createPreset1();
  const cloned = cloneProfile(base);
  cloned.presetId = 'custom';
  for (const meta of ACTION_META) {
    cloned.bindings[meta.key] = [cloned.bindings[meta.key][0]];
  }
  storedControls.customProfile = cloned;
  applyActiveControls();
  renderControlsModal();
});

document.getElementById('btn-copy-p2')!.addEventListener('click', () => {
  game.sound.playUiSelect();
  listeningAction = null;
  game.input.cancelCapture();
  const base = createPreset2(true);
  const cloned = cloneProfile(base);
  cloned.presetId = 'custom';
  storedControls.customProfile = cloned;
  applyActiveControls();
  renderControlsModal();
});

// Gamepad Options & Quick Loaders
(document.getElementById('chk-gp-rumble') as HTMLInputElement).addEventListener('change', (e) => {
  game.sound.playUiClick();
  storedGamepad.rumbleEnabled = (e.target as HTMLInputElement).checked;
  applyActiveGamepadConfig();
  if (storedGamepad.rumbleEnabled) {
    game.input.triggerRumble(0, 110, 0.45, 0.45);
  }
});

(document.getElementById('chk-gp-raim') as HTMLInputElement).addEventListener('change', (e) => {
  game.sound.playUiClick();
  storedGamepad.rightStickAim = (e.target as HTMLInputElement).checked;
  applyActiveGamepadConfig();
});

(document.getElementById('chk-gp-upjump') as HTMLInputElement).addEventListener('change', (e) => {
  game.sound.playUiClick();
  storedGamepad.stickUpToJump = (e.target as HTMLInputElement).checked;
  applyActiveGamepadConfig();
});

(document.getElementById('rng-gp-dz') as HTMLInputElement).addEventListener('input', (e) => {
  const pct = Number((e.target as HTMLInputElement).value);
  document.getElementById('lbl-gp-dz')!.textContent = `${pct}%`;
  storedGamepad.deadzone = pct / 100;
  applyActiveGamepadConfig();
});

document.getElementById('btn-gp-copy-std')!.addEventListener('click', () => {
  game.sound.playUiSelect();
  listeningGpTarget = null;
  game.input.cancelGamepadCapture();
  const cloned = cloneGamepadProfile(createGamepadStandard());
  cloned.presetId = 'custom';
  storedGamepad.customProfile = cloned;
  applyActiveGamepadConfig();
  renderControlsModal();
});

document.getElementById('btn-gp-copy-brawl')!.addEventListener('click', () => {
  game.sound.playUiSelect();
  listeningGpTarget = null;
  game.input.cancelGamepadCapture();
  const cloned = cloneGamepadProfile(createGamepadBrawler());
  cloned.presetId = 'custom';
  storedGamepad.customProfile = cloned;
  applyActiveGamepadConfig();
  renderControlsModal();
});

// ==================== COSMETICS, EYE-SAFE & CAREER MODAL ====================
function renderCosmeticsModal(): void {
  const av = game.avSettings;
  const skinList = document.getElementById('skin-list')!;
  skinList.innerHTML = '';

  for (const skin of INK_SKIN_LIST) {
    const card = document.createElement('button');
    card.className = `skin-card ${skin.id === av.skinId ? 'selected' : ''}`;
    const bgStyle = skin.rainbow
      ? 'background: linear-gradient(135deg, #ff3b3b, #ffbe0b, #10c488, #2589f5, #9c42c4);'
      : `background: linear-gradient(135deg, ${skin.inkColor} 50%, ${skin.scarfColor} 50%);`;
    card.innerHTML = `
      <div class="skin-head">
        <span class="skin-swatch" style="${bgStyle}"></span>
        <span>${skin.name}</span>
      </div>
      <div class="skin-desc">${skin.desc}</div>
    `;
    card.addEventListener('click', () => {
      game.sound.unlock();
      game.sound.playUiSelect();
      game.updateAudioVisualSettings({ skinId: skin.id });
      renderCosmeticsModal();
    });
    skinList.appendChild(card);
  }

  const sfxPct = Math.round(av.sfxVolume * 100);
  const bgmPct = Math.round(av.bgmVolume * 100);
  (document.getElementById('rng-sfx-vol') as HTMLInputElement).value = `${sfxPct}`;
  (document.getElementById('rng-bgm-vol') as HTMLInputElement).value = `${bgmPct}`;
  document.getElementById('lbl-sfx-vol')!.textContent = `${sfxPct}%`;
  document.getElementById('lbl-bgm-vol')!.textContent = `${bgmPct}%`;

  document.querySelectorAll<HTMLButtonElement>('[data-shake]').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.shake === av.shakeLevel);
  });

  document.querySelectorAll<HTMLButtonElement>('[data-fx]').forEach((btn) => {
    btn.classList.toggle('selected', btn.dataset.fx === av.fxIntensity);
  });
  const fxNote = document.getElementById('fx-intensity-note');
  if (fxNote) {
    if (av.fxIntensity === 'eyesafe') {
      fxNote.textContent = '🌿 柔和护眼：全程零反色定格，大招保留 20% 轻暖底晕 + 手绘毛笔 Cut-in 横幅。';
    } else if (av.fxIntensity === 'cinema') {
      fxNote.textContent = '🔥 热血动漫：大招、KO、完美弹反与破防均触发 66% 聚光暗幕与柔和墨韵定格（1.8s 防连闪冷却）。';
    } else {
      fxNote.textContent = '✨ 均衡演出：日常招式零频闪，仅终极大招 & KO 绝杀触发 56% 聚光暗幕、毛笔 Cut-in 与柔和定格（2.5s 防连闪冷却）。';
    }
  }

  const c = game.career;
  document.getElementById('career-grid')!.innerHTML = `
    <div class="stat-box"><div class="stat-k">累计击倒强敌</div><div class="stat-v">${c.totalKOs}</div></div>
    <div class="stat-box"><div class="stat-k">累计完美弹反</div><div class="stat-v">${c.totalParries}</div></div>
    <div class="stat-box"><div class="stat-k">历史最高连击</div><div class="stat-v">${c.maxCombo} 连</div></div>
    <div class="stat-box"><div class="stat-k">生存战最高波次</div><div class="stat-v">第 ${c.highestWave} 波</div></div>
    <div class="stat-box"><div class="stat-k">争霸赛满分通关</div><div class="stat-v">${c.arcadeClears} 次</div></div>
    <div class="stat-box"><div class="stat-k">文具对撞次数</div><div class="stat-v">${c.totalClashes} 次</div></div>
  `;
}

function openCosmeticsModal(): void {
  game.sound.unlock();
  game.sound.playUiClick();
  game.input.clearAll();
  renderCosmeticsModal();
  cosmeticsOverlay.classList.remove('hidden');
}

document.getElementById('title-cosmetics-btn')!.addEventListener('click', openCosmeticsModal);
document.getElementById('menu-cosmetics-btn')!.addEventListener('click', openCosmeticsModal);
document.getElementById('btn-pause-cosmetics')!.addEventListener('click', openCosmeticsModal);
document.getElementById('btn-close-cosmetics-x')!.addEventListener('click', () => {
  game.sound.playUiClick();
  cosmeticsOverlay.classList.add('hidden');
});
document.getElementById('btn-save-cosmetics')!.addEventListener('click', () => {
  game.sound.playUiSelect();
  cosmeticsOverlay.classList.add('hidden');
});

(document.getElementById('rng-sfx-vol') as HTMLInputElement).addEventListener('input', (e) => {
  const val = Number((e.target as HTMLInputElement).value);
  document.getElementById('lbl-sfx-vol')!.textContent = `${val}%`;
  game.updateAudioVisualSettings({ sfxVolume: val / 100 });
});

(document.getElementById('rng-bgm-vol') as HTMLInputElement).addEventListener('input', (e) => {
  const val = Number((e.target as HTMLInputElement).value);
  document.getElementById('lbl-bgm-vol')!.textContent = `${val}%`;
  game.updateAudioVisualSettings({ bgmVolume: val / 100 });
});

document.querySelectorAll<HTMLButtonElement>('[data-shake]').forEach((btn) => {
  btn.addEventListener('click', () => {
    game.sound.playUiClick();
    game.updateAudioVisualSettings({ shakeLevel: btn.dataset.shake as ShakeLevel });
    renderCosmeticsModal();
  });
});

document.querySelectorAll<HTMLButtonElement>('[data-fx]').forEach((btn) => {
  btn.addEventListener('click', () => {
    game.sound.playUiSelect();
    game.updateAudioVisualSettings({ fxIntensity: btn.dataset.fx as FxIntensity });
    renderCosmeticsModal();
  });
});

// ==================== GEOMETRY BRAWL (NEW MATH FORMULA MODE v0.3.0!) ====================
const geoSetupOverlay = document.getElementById('geo-setup-overlay')!;
const geoHudEl = document.getElementById('geo-hud')!;
const geoResultOverlay = document.getElementById('geo-result-overlay')!;
const geoSandboxBar = document.getElementById('geo-sandbox-bar')!;
const geoKeyHint = document.getElementById('geo-key-hint')!;

let selectedGeoMode: GeoMode = 'trial';
let selectedGeoP1School: MathSchoolId = 'euler';
let selectedGeoP2School: MathSchoolId = 'trig';
let selectedGeoTheme: MathThemeId = 'chalkboard';
let geoTrialStage = 0;

const mathGame = new MathGameManager(
  canvas,
  game.input,
  game.sound,
  game.bgm,
  () => game.avSettings,
  () => game.getViewport(),
  {
    onHudUpdate: (hud) => updateGeoHud(hud),
    onMatchEnd: (winnerIdx, mode, stageIdx, canAdvance, clearedAll) =>
      showGeoResultModal(winnerIdx, mode, stageIdx, canAdvance, clearedAll),
    onPauseChanged: (paused) => {
      pauseOverlay.classList.toggle('hidden', !paused);
    },
  }
);

game.externalGameplayActive = () => mathGame.isGameplayActive();
game.onExternalPauseToggle = () => {
  if (!mathGame.isActive()) return;
  if (!geoSetupOverlay.classList.contains('hidden')) return;
  if (!geoResultOverlay.classList.contains('hidden')) return;
  mathGame.setPaused(!mathGame.isPaused());
};

const geoHudCache = {
  p1HpW: '', p1DelW: '', p1HpTxt: '', p1EnW: '', p1EnTxt: '', p1Ready: false, p1GuardW: '', p1School: '', p1Ops: '', p1Formula: '',
  p2HpW: '', p2DelW: '', p2HpTxt: '', p2EnW: '', p2EnTxt: '', p2Ready: false, p2GuardW: '', p2School: '', p2Ops: '', p2Name: '',
  stageTag: '', timer: '', banner: '', comboHint: '',
};

function updateGeoHud(hud: GeoHudSnapshot): void {
  const p1Pct = Math.max(0, (hud.p1.hp / hud.p1.maxHp) * 100);
  const p1DelPct = Math.max(0, (hud.p1.delayedHp / hud.p1.maxHp) * 100);
  const p1HpW = `${p1Pct.toFixed(1)}%`;
  const p1DelW = `${p1DelPct.toFixed(1)}%`;
  if (geoHudCache.p1HpW !== p1HpW) { geoHudCache.p1HpW = p1HpW; document.getElementById('geo-p1-hp')!.style.width = p1HpW; }
  if (geoHudCache.p1DelW !== p1DelW) { geoHudCache.p1DelW = p1DelW; document.getElementById('geo-p1-hp-del')!.style.width = p1DelW; }
  const p1HpTxt = `${Math.ceil(hud.p1.hp)} / ${hud.p1.maxHp}`;
  if (geoHudCache.p1HpTxt !== p1HpTxt) { geoHudCache.p1HpTxt = p1HpTxt; document.getElementById('geo-p1-hp-txt')!.textContent = p1HpTxt; }

  const p1EnW = `${((hud.p1.energy / hud.p1.maxEnergy) * 100).toFixed(1)}%`;
  if (geoHudCache.p1EnW !== p1EnW) { geoHudCache.p1EnW = p1EnW; document.getElementById('geo-p1-en')!.style.width = p1EnW; }
  if (geoHudCache.p1Ready !== hud.p1.superReady) {
    geoHudCache.p1Ready = hud.p1.superReady;
    document.getElementById('geo-p1-en')!.classList.toggle('ready', hud.p1.superReady);
  }
  const superKeyLabel = formatCodeLabel(activeProfile.bindings.superBtn[0] ?? 'KeyI');
  const p1EnTxt = hud.p1.superReady ? `[ 终极公式就绪 · 按 ${superKeyLabel} ]` : `数理势能 ${Math.floor(hud.p1.energy)}%`;
  if (geoHudCache.p1EnTxt !== p1EnTxt) { geoHudCache.p1EnTxt = p1EnTxt; document.getElementById('geo-p1-en-txt')!.textContent = p1EnTxt; }

  const p1GuardW = `${hud.p1.guardMeter.toFixed(1)}%`;
  if (geoHudCache.p1GuardW !== p1GuardW) { geoHudCache.p1GuardW = p1GuardW; document.getElementById('geo-p1-guard')!.style.width = p1GuardW; }

  const p1SchoolTxt = `${MATH_SCHOOLS[hud.p1.school].symbol} ${hud.p1.schoolName}`;
  if (geoHudCache.p1School !== p1SchoolTxt) {
    geoHudCache.p1School = p1SchoolTxt;
    const el = document.getElementById('geo-p1-school')!;
    el.textContent = p1SchoolTxt;
    el.style.borderColor = '#ff7a1a';
  }
  if (geoHudCache.p1Formula !== hud.activeFormulaPreview) {
    geoHudCache.p1Formula = hud.activeFormulaPreview;
    document.getElementById('geo-p1-formula')!.textContent = hud.activeFormulaPreview;
  }
  const p1OpsKey = hud.p1.operators.join(',');
  if (geoHudCache.p1Ops !== p1OpsKey) {
    geoHudCache.p1Ops = p1OpsKey;
    document.getElementById('geo-p1-ops')!.innerHTML = hud.p1.operators
      .map((id) => `<span class="geo-op-chip" style="--op-col:${MATH_OPERATORS[id].color}">${MATH_OPERATORS[id].glyph}</span>`)
      .join('');
  }

  // P2 HUD
  if (geoHudCache.p2Name !== hud.p2.name) { geoHudCache.p2Name = hud.p2.name; document.getElementById('geo-p2-name')!.textContent = hud.p2.name; }
  const p2Pct = Math.max(0, (hud.p2.hp / hud.p2.maxHp) * 100);
  const p2DelPct = Math.max(0, (hud.p2.delayedHp / hud.p2.maxHp) * 100);
  const p2HpW = `${p2Pct.toFixed(1)}%`;
  const p2DelW = `${p2DelPct.toFixed(1)}%`;
  if (geoHudCache.p2HpW !== p2HpW) { geoHudCache.p2HpW = p2HpW; document.getElementById('geo-p2-hp')!.style.width = p2HpW; }
  if (geoHudCache.p2DelW !== p2DelW) { geoHudCache.p2DelW = p2DelW; document.getElementById('geo-p2-hp-del')!.style.width = p2DelW; }
  const p2HpTxt = `${Math.ceil(hud.p2.hp)} / ${hud.p2.maxHp}`;
  if (geoHudCache.p2HpTxt !== p2HpTxt) { geoHudCache.p2HpTxt = p2HpTxt; document.getElementById('geo-p2-hp-txt')!.textContent = p2HpTxt; }

  const p2EnW = `${((hud.p2.energy / hud.p2.maxEnergy) * 100).toFixed(1)}%`;
  if (geoHudCache.p2EnW !== p2EnW) { geoHudCache.p2EnW = p2EnW; document.getElementById('geo-p2-en')!.style.width = p2EnW; }
  if (geoHudCache.p2Ready !== hud.p2.superReady) {
    geoHudCache.p2Ready = hud.p2.superReady;
    document.getElementById('geo-p2-en')!.classList.toggle('ready', hud.p2.superReady);
  }
  const p2EnTxt = hud.p2.superReady ? '★ 终极公式就绪 ★' : `数理势能 ${Math.floor(hud.p2.energy)}%`;
  if (geoHudCache.p2EnTxt !== p2EnTxt) { geoHudCache.p2EnTxt = p2EnTxt; document.getElementById('geo-p2-en-txt')!.textContent = p2EnTxt; }

  const p2GuardW = `${hud.p2.guardMeter.toFixed(1)}%`;
  if (geoHudCache.p2GuardW !== p2GuardW) { geoHudCache.p2GuardW = p2GuardW; document.getElementById('geo-p2-guard')!.style.width = p2GuardW; }

  const p2SchoolTxt = `${MATH_SCHOOLS[hud.p2.school].symbol} ${hud.p2.schoolName}`;
  if (geoHudCache.p2School !== p2SchoolTxt) {
    geoHudCache.p2School = p2SchoolTxt;
    const el = document.getElementById('geo-p2-school')!;
    el.textContent = p2SchoolTxt;
    el.style.borderColor = hud.p2.color;
  }
  const p2OpsKey = hud.p2.operators.join(',');
  if (geoHudCache.p2Ops !== p2OpsKey) {
    geoHudCache.p2Ops = p2OpsKey;
    document.getElementById('geo-p2-ops')!.innerHTML = hud.p2.operators
      .map((id) => `<span class="geo-op-chip" style="--op-col:${MATH_OPERATORS[id].color}">${MATH_OPERATORS[id].glyph}</span>`)
      .join('');
  }

  const stageTag =
    hud.mode === 'sandbox'
      ? '自由公式沙盒'
      : hud.mode === 'versus'
        ? '双人几何对决'
        : `几何试炼 ${hud.stageIndex}/${hud.stageTotal}`;
  if (geoHudCache.stageTag !== stageTag) { geoHudCache.stageTag = stageTag; document.getElementById('geo-stage-tag')!.textContent = stageTag; }

  const timerStr = hud.mode === 'sandbox' ? '∞' : `${hud.timer}`;
  if (geoHudCache.timer !== timerStr) { geoHudCache.timer = timerStr; document.getElementById('geo-timer')!.textContent = timerStr; }

  if (geoHudCache.comboHint !== hud.comboHint) {
    geoHudCache.comboHint = hud.comboHint;
    document.getElementById('geo-combo-hint')!.textContent = hud.comboHint;
  }

  const bannerKey = `${hud.bannerText}|${hud.bannerSub}`;
  if (geoHudCache.banner !== bannerKey) {
    geoHudCache.banner = bannerKey;
    const bEl = document.getElementById('geo-center-banner')!;
    if (hud.bannerText) {
      document.getElementById('geo-banner-title')!.textContent = hud.bannerText;
      document.getElementById('geo-banner-sub')!.textContent = hud.bannerSub;
      bEl.classList.remove('hidden');
    } else {
      bEl.classList.add('hidden');
    }
  }
}

function buildGeoSetupUI(): void {
  // Mode tabs
  document.querySelectorAll<HTMLButtonElement>('[data-geomode]').forEach((b) => {
    b.classList.toggle('active', b.dataset.geomode === selectedGeoMode);
  });
  document.getElementById('geo-trial-ladder-wrap')!.classList.toggle('hidden', selectedGeoMode !== 'trial');
  document.getElementById('geo-p2-wrap')!.classList.toggle('hidden', selectedGeoMode === 'trial');
  document.getElementById('geo-p2-label')!.textContent =
    selectedGeoMode === 'sandbox' ? '数理木桩学派' : '选择 P2 对手学派';

  // P1 6 Math Schools
  const p1Grid = document.getElementById('geo-p1-schools')!;
  p1Grid.innerHTML = '';
  for (const s of MATH_SCHOOL_LIST) {
    const card = document.createElement('button');
    card.className = `geo-school-card ${s.id === selectedGeoP1School ? 'selected' : ''}`;
    card.style.setProperty('--sc-col', s.color);
    card.innerHTML = `
      <div class="gsc-top">
        <span class="gsc-name">${s.symbol} ${s.name}</span>
        <span class="gsc-formula">${s.formula}</span>
      </div>
      <div class="gsc-badge">${s.badge} · 大招：${s.superName}</div>
      <div class="gsc-desc">${s.desc}</div>
    `;
    card.addEventListener('click', () => {
      game.sound.unlock();
      game.sound.playUiSelect();
      selectedGeoP1School = s.id;
      mathGame.startPreview(selectedGeoP1School, selectedGeoTheme);
      buildGeoSetupUI();
    });
    p1Grid.appendChild(card);
  }

  // Trial 5 Bosses Ladder
  const ladder = document.getElementById('geo-trial-ladder')!;
  ladder.innerHTML = '';
  for (const m of MATH_TRIAL_MASTERS) {
    const row = document.createElement('div');
    row.className = `geo-ladder-row ${m.isBoss ? 'boss' : ''}`;
    row.innerHTML = `
      <span class="geo-ladder-idx" style="background:${m.color}">${m.stageIndex + 1}</span>
      <div class="geo-ladder-info">
        <div><strong>${m.name}</strong> <span style="color:${m.color};font-family:Georgia,serif;font-style:italic;">[${MATH_SCHOOLS[m.school].formula}]</span></div>
        <div class="geo-ladder-sub">${m.title} · HP ${m.maxHp}</div>
      </div>
    `;
    ladder.appendChild(row);
  }

  // P2 School Pills
  const p2Wrap = document.getElementById('geo-p2-schools')!;
  p2Wrap.innerHTML = '';
  for (const s of MATH_SCHOOL_LIST) {
    const pill = document.createElement('button');
    pill.className = `geo-pill ${s.id === selectedGeoP2School ? 'selected' : ''}`;
    pill.textContent = `${s.symbol} ${s.name}`;
    pill.addEventListener('click', () => {
      game.sound.playUiClick();
      selectedGeoP2School = s.id;
      buildGeoSetupUI();
    });
    p2Wrap.appendChild(pill);
  }

  // Theme Pills
  document.querySelectorAll<HTMLButtonElement>('[data-geotheme]').forEach((b) => {
    b.classList.toggle('active', b.dataset.geotheme === selectedGeoTheme);
  });

  // Shared controls summary
  const pads = game.input.connectedGamepads;
  const p1Dev: PlayerInputDevice =
    selectedGeoMode === 'versus' ? storedGamepad.versusP1Device : storedGamepad.singleP1Device;
  document.getElementById('geo-setup-ctrl-note')!.innerHTML =
    `当前操作共用：${buildDeviceKeyHintSummary('P1', p1Dev, activeProfile, activeGpProfile, pads.length > 0)}`;
}

function openGeometryHub(): void {
  game.sound.unlock();
  game.sound.playUiSelect();
  if (game.bgm.isEnabled()) game.bgm.start();
  game.setSuspended(true);
  titleScreen.classList.add('hidden');
  setupOverlay.classList.add('hidden');
  hudEl.classList.add('hidden');
  geoHudEl.classList.add('hidden');
  geoResultOverlay.classList.add('hidden');
  pauseOverlay.classList.add('hidden');
  geoSetupOverlay.classList.remove('hidden');
  mathGame.startPreview(selectedGeoP1School, selectedGeoTheme);
  buildGeoSetupUI();
}

function launchGeoMatch(stageIdx = 0): void {
  geoTrialStage = stageIdx;
  game.input.cancelAllCaptures();
  game.input.clearAll();
  (document.activeElement as HTMLElement | null)?.blur?.();

  // Sync P1/P2 devices for single-player vs local 2P geometry duel
  const pads = game.input.connectedGamepads;
  const p1Dev: PlayerInputDevice =
    selectedGeoMode === 'versus' ? storedGamepad.versusP1Device : storedGamepad.singleP1Device;
  const p2Dev: PlayerInputDevice =
    selectedGeoMode === 'versus' ? storedGamepad.versusP2Device : 'kb_p2';
  game.setPlayerDevices(p1Dev, p2Dev);

  geoKeyHint.innerHTML = buildDeviceKeyHintSummary('P1', p1Dev, activeProfile, activeGpProfile, pads.length > 0);
  if (selectedGeoMode === 'versus') {
    geoKeyHint.innerHTML += ` &nbsp;｜&nbsp; ${buildDeviceKeyHintSummary('P2', p2Dev, activeProfile, activeGpProfile, pads.length > 0)}`;
  }

  geoSetupOverlay.classList.add('hidden');
  geoResultOverlay.classList.add('hidden');
  pauseOverlay.classList.add('hidden');
  geoHudEl.classList.remove('hidden');
  geoHudEl.classList.toggle('light-stage', selectedGeoTheme === 'blueprint');
  geoSandboxBar.classList.toggle('hidden', selectedGeoMode !== 'sandbox');

  if (selectedGeoMode === 'sandbox') {
    (document.getElementById('geo-sb-school') as HTMLSelectElement).value = selectedGeoP1School;
    (document.getElementById('geo-sb-dummy') as HTMLSelectElement).value = mathGame.sandboxDummy;
    document.getElementById('geo-sb-theme')!.textContent = `底色: ${selectedGeoTheme === 'chalkboard' ? '纯黑' : '纯白'}`;
  }

  mathGame.startMatch({
    mode: selectedGeoMode,
    p1School: selectedGeoP1School,
    p2School: selectedGeoP2School,
    theme: selectedGeoTheme,
    trialStageIndex: geoTrialStage,
  });
}

function showGeoResultModal(
  winnerIdx: 0 | 1,
  mode: GeoMode,
  stageIdx: number,
  canAdvance: boolean,
  clearedAll: boolean
): void {
  const badge = document.getElementById('geo-result-badge')!;
  const title = document.getElementById('geo-result-title')!;
  const sub = document.getElementById('geo-result-sub')!;
  const nextBtn = document.getElementById('btn-geo-next')!;

  if (clearedAll) {
    badge.textContent = 'e^(iπ)+1=0 · 终极证毕';
    title.textContent = '全通关！你已征服欧拉奇点大魔王！';
    sub.textContent = '五常数共鸣，六大数学学派任你驰骋，欢迎前往公式沙盒自由实验极限连携！';
  } else if (mode === 'trial') {
    badge.textContent = winnerIdx === 0 ? 'Q.E.D. 证毕' : '无解 · 重试';
    title.textContent = winnerIdx === 0 ? `通过第 ${stageIdx + 1} 试炼！` : '本道难题还差一步！';
    sub.textContent =
      winnerIdx === 0
        ? '漂亮！多利用完美弹反拆解算子，迎接下一位数学大师！'
        : '提示：拾取 π + i 触发欧拉归零，或 d/dx + ∫ 瞬间回满大招势能！';
  } else {
    badge.textContent = winnerIdx === 0 ? 'P1 证毕' : 'P2 证毕';
    title.textContent = winnerIdx === 0 ? 'P1 小墨 赢得几何对决！' : 'P2 小蓝 赢得几何对决！';
    sub.textContent = '精彩的公式博弈，再来一局换个数学学派试试！';
  }

  nextBtn.classList.toggle('hidden', !canAdvance);
  geoResultOverlay.classList.remove('hidden');
}

// Geometry Brawl Event Bindings
document.getElementById('btn-enter-geometry')!.addEventListener('click', openGeometryHub);
document.getElementById('btn-geo-back')!.addEventListener('click', showTitleScreen);
document.getElementById('geo-btn-controls')!.addEventListener('click', () => openControlsModal('kb'));
document.getElementById('geo-btn-cosmetics')!.addEventListener('click', openCosmeticsModal);
document.getElementById('geo-btn-fullscreen')!.addEventListener('click', toggleFullscreen);

document.querySelectorAll<HTMLButtonElement>('[data-geomode]').forEach((btn) => {
  btn.addEventListener('click', () => {
    game.sound.playUiClick();
    selectedGeoMode = btn.dataset.geomode as GeoMode;
    buildGeoSetupUI();
  });
});

document.querySelectorAll<HTMLButtonElement>('[data-geotheme]').forEach((btn) => {
  btn.addEventListener('click', () => {
    game.sound.playUiClick();
    selectedGeoTheme = btn.dataset.geotheme as MathThemeId;
    mathGame.setThemeLive(selectedGeoTheme);
    buildGeoSetupUI();
  });
});

document.getElementById('btn-geo-start')!.addEventListener('click', () => {
  game.sound.unlock();
  launchGeoMatch(0);
});

document.getElementById('geo-btn-hud-fs')!.addEventListener('click', toggleFullscreen);
document.getElementById('geo-btn-hud-pause')!.addEventListener('click', (e) => {
  game.sound.playUiClick();
  (e.currentTarget as HTMLElement).blur();
  mathGame.setPaused(!mathGame.isPaused());
});

// Sandbox Toolbar (all controls blur immediately to preserve v0.2.3 zero-stuck-key hygiene!)
document.getElementById('geo-sb-school')!.addEventListener('change', (e) => {
  const sel = e.target as HTMLSelectElement;
  selectedGeoP1School = sel.value as MathSchoolId;
  mathGame.setP1SchoolLive(selectedGeoP1School);
  sel.blur();
  game.input.clearAll();
});
document.getElementById('geo-sb-dummy')!.addEventListener('change', (e) => {
  const sel = e.target as HTMLSelectElement;
  mathGame.sandboxDummy = sel.value as GeoDummyMode;
  sel.blur();
  game.input.clearAll();
});
document.getElementById('geo-sb-inf')!.addEventListener('click', (e) => {
  mathGame.sandboxInfEnergy = !mathGame.sandboxInfEnergy;
  const btn = e.currentTarget as HTMLButtonElement;
  btn.textContent = `无限势能: ${mathGame.sandboxInfEnergy ? '开' : '关'}`;
  btn.classList.toggle('active', mathGame.sandboxInfEnergy);
  btn.blur();
});
document.getElementById('geo-sb-theme')!.addEventListener('click', (e) => {
  selectedGeoTheme = selectedGeoTheme === 'chalkboard' ? 'blueprint' : 'chalkboard';
  mathGame.setThemeLive(selectedGeoTheme);
  geoHudEl.classList.toggle('light-stage', selectedGeoTheme === 'blueprint');
  const btn = e.currentTarget as HTMLButtonElement;
  btn.textContent = `底色: ${selectedGeoTheme === 'chalkboard' ? '纯黑' : '纯白'}`;
  btn.blur();
});
document.getElementById('geo-sb-reset')!.addEventListener('click', (e) => {
  (e.currentTarget as HTMLElement).blur();
  mathGame.resetSandbox();
});
document.getElementById('geo-sb-exit')!.addEventListener('click', (e) => {
  (e.currentTarget as HTMLElement).blur();
  openGeometryHub();
});
document.getElementById('geo-sb-clear-ops')!.addEventListener('click', (e) => {
  (e.currentTarget as HTMLElement).blur();
  mathGame.clearP1Operators();
});

// Populate Sandbox One-Click Operator Injector Pills!
const geoOpInjectWrap = document.getElementById('geo-sb-op-btns')!;
for (const op of ALL_OPERATORS_LIST) {
  const b = document.createElement('button');
  b.className = 'geo-op-inject-btn';
  b.style.setProperty('--op-col', op.color);
  b.title = `${op.name}：${op.desc}`;
  b.textContent = `+ ${op.glyph}`;
  b.addEventListener('click', (e) => {
    mathGame.injectSandboxOperator(op.id);
    (e.currentTarget as HTMLElement).blur();
  });
  geoOpInjectWrap.appendChild(b);
}

// Result Modal Buttons
document.getElementById('btn-geo-next')!.addEventListener('click', () => {
  launchGeoMatch(Math.min(MATH_TRIAL_MASTERS.length - 1, geoTrialStage + 1));
});
document.getElementById('btn-geo-rematch')!.addEventListener('click', () => {
  launchGeoMatch(geoTrialStage);
});
document.getElementById('btn-geo-to-hub')!.addEventListener('click', openGeometryHub);
document.getElementById('btn-geo-to-title')!.addEventListener('click', showTitleScreen);

// ==================== LAN MULTIPLAYER LOBBY CONTROLLER ====================
const lanLobby = new LanLobbyController({
  game,
  mathGame,
  onReturnToTitle: () => showTitleScreen(),
  onOpenControls: () => openControlsModal('kb'),
  onApplySingleP1Device: () => {
    const pads = game.input.connectedGamepads;
    const p1Dev: PlayerInputDevice = storedGamepad.singleP1Device;
    game.setPlayerDevices(p1Dev, 'kb_p2');
    return buildDeviceKeyHintSummary('P1', p1Dev, activeProfile, activeGpProfile, pads.length > 0);
  },
  onHideAllMainViews: () => {
    titleScreen.classList.add('hidden');
    setupOverlay.classList.add('hidden');
    hudEl.classList.add('hidden');
    geoSetupOverlay.classList.add('hidden');
    geoHudEl.classList.add('hidden');
    geoResultOverlay.classList.add('hidden');
    pauseOverlay.classList.add('hidden');
    resultOverlay.classList.add('hidden');
    buffOverlay.classList.add('hidden');
  },
  hudEl,
  geoHudEl,
  trainingBarEl: trainingBar,
  geoSandboxBarEl: geoSandboxBar,
  p1KeyHintEl: p1KeyHint,
  p2KeyHintEl: p2KeyHint,
  geoKeyHintEl: geoKeyHint,
});

document.getElementById('btn-enter-lan')!.addEventListener('click', () => {
  lanLobby.open('scratchpad');
});
document.getElementById('btn-geo-lan')!.addEventListener('click', () => {
  lanLobby.open('geometry');
});

// Init UI
buildSetupOptions();
syncAudioButtons();
syncTrackLabels(game.bgm.getCurrentTrack());
applyActiveGamepadConfig();
applyActiveControls();
handleGamepadsChanged(game.input.connectedGamepads);
