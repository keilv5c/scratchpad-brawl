import { STAGE_LIST } from '../config/stages';
import { THEME_LIST } from '../config/themes';
import { WEAPON_LIST, WEAPONS } from '../config/weapons';
import { MATH_SCHOOL_LIST, MATH_SCHOOLS } from '../geometry/mathSchools';
import { MathGameManager } from '../geometry/mathGameManager';
import { MathSchoolId, MathThemeId } from '../geometry/mathTypes';
import { GameManager } from '../game/gameManager';
import { StageId, ThemeId, WeaponId } from '../types';
import { formatPingBadge, LanClient } from './lanClient';
import {
  LanBestOf,
  LanDiscoveredRoom,
  LanGameKind,
  LanLobbyState,
  LanPeerMessage,
} from './lanTypes';

export interface LanLobbyDeps {
  game: GameManager;
  mathGame: MathGameManager;
  onReturnToTitle: () => void;
  onOpenControls: () => void;
  onApplySingleP1Device: () => string;
  onHideAllMainViews: () => void;
  hudEl: HTMLElement;
  geoHudEl: HTMLElement;
  trainingBarEl: HTMLElement;
  geoSandboxBarEl: HTMLElement;
  p1KeyHintEl: HTMLElement;
  p2KeyHintEl: HTMLElement;
  geoKeyHintEl: HTMLElement;
}

const NICK_STORAGE_KEY = 'inkblade_lan_nick_v1';

export class LanLobbyController {
  private deps: LanLobbyDeps;
  private client: LanClient;

  private initMode: LanGameKind = 'scratchpad';
  private inMatch = false;
  private localRoomAddr = '';
  private hostRoomName = '课桌联机房';

  private lobby: LanLobbyState = {
    gameKind: 'scratchpad',
    stageId: 'desk_city',
    themeId: 'kraft',
    geoThemeId: 'chalkboard',
    bestOf: 3,
    hostName: '小墨',
    guestName: '等待对手加入',
    hostWeapon: 'compass',
    guestWeapon: 'ruler',
    hostSchool: 'euler',
    guestSchool: 'golden',
    hostReady: true,
    guestReady: false,
  };

  // DOM refs
  private overlay = document.getElementById('lan-overlay')!;
  private resultOverlay = document.getElementById('lan-result-overlay')!;
  private liveBar = document.getElementById('lan-live-bar')!;
  private liveRoleEl = document.getElementById('lan-live-role')!;
  private livePingEl = document.getElementById('lan-live-ping')!;
  private envPill = document.getElementById('lan-env-pill')!;
  private statusBar = document.getElementById('lan-status-bar')!;
  private connectView = document.getElementById('lan-connect-view')!;
  private roomView = document.getElementById('lan-room-view')!;

  private nickInput = document.getElementById('lan-nick-input') as HTMLInputElement;
  private roomNameInput = document.getElementById('lan-room-name-input') as HTMLInputElement;
  private localIpsPreview = document.getElementById('lan-local-ips-preview')!;
  private roomListEl = document.getElementById('lan-room-list')!;
  private ipInput = document.getElementById('lan-ip-input') as HTMLInputElement;
  private portInput = document.getElementById('lan-port-input') as HTMLInputElement;

  private roomRoleBadge = document.getElementById('lan-room-role-badge')!;
  private roomAddrEl = document.getElementById('lan-room-addr')!;
  private roomPingEl = document.getElementById('lan-room-ping')!;
  private settingsStrip = document.getElementById('lan-settings-strip')!;
  private spStageGroup = document.getElementById('lan-sp-stage-group')!;
  private geoThemeGroup = document.getElementById('lan-geo-theme-group')!;
  private stageSel = document.getElementById('lan-stage-sel') as HTMLSelectElement;
  private themeSel = document.getElementById('lan-theme-sel') as HTMLSelectElement;
  private geoThemeSel = document.getElementById('lan-geotheme-sel') as HTMLSelectElement;

  private hostNameEl = document.getElementById('lan-host-name')!;
  private hostPickEl = document.getElementById('lan-host-pick')!;
  private guestNameEl = document.getElementById('lan-guest-name')!;
  private guestPickEl = document.getElementById('lan-guest-pick')!;
  private guestReadyBadge = document.getElementById('lan-guest-ready-badge')!;

  private pickerLabel = document.getElementById('lan-picker-label')!;
  private pickerGrid = document.getElementById('lan-picker-grid')!;
  private ctrlHintEl = document.getElementById('lan-ctrl-hint')!;
  private btnReady = document.getElementById('btn-lan-ready') as HTMLButtonElement;
  private btnStart = document.getElementById('btn-lan-start') as HTMLButtonElement;

  constructor(deps: LanLobbyDeps) {
    this.deps = deps;

    const savedNick = localStorage.getItem(NICK_STORAGE_KEY);
    if (savedNick) {
      this.nickInput.value = savedNick;
    }

    this.client = new LanClient({
      onLocalIps: (ips) => this.renderLocalIps(ips),
      onHostStarted: (port, ips) => this.handleHostStarted(port, ips),
      onRoomsUpdated: (rooms) => this.renderDiscoveredRooms(rooms),
      onPeerConnected: (remoteLabel) => this.handlePeerConnected(remoteLabel),
      onConnectedToHost: (host, port) => this.handleConnectedToHost(host, port),
      onDisconnected: (reason) => this.handleDisconnected(reason),
      onError: (msg) => this.showStatus(msg, true),
      onMessage: (msg) => this.handlePeerMessage(msg),
      onPingUpdated: (pingMs) => this.updatePingDisplays(pingMs),
    });

    // Attach transport hooks to BOTH engines!
    this.deps.game.setLanTransport(
      (msg, droppable) => this.client.send(msg, !!droppable),
      (winnerIdx, p1Wins, p2Wins, bestOf) => this.showLanResultModal(winnerIdx, p1Wins, p2Wins, bestOf)
    );
    this.deps.mathGame.setLanTransport(
      (msg, droppable) => this.client.send(msg, !!droppable),
      (winnerIdx, p1Wins, p2Wins, bestOf) => this.showLanResultModal(winnerIdx, p1Wins, p2Wins, bestOf)
    );

    this.populateSelects();
    this.bindEvents();
    this.refreshEnvPill();
  }

  public isActive(): boolean {
    return this.inMatch || !this.overlay.classList.contains('hidden');
  }

  public open(initialMode: LanGameKind = 'scratchpad'): void {
    this.deps.game.sound.unlock();
    this.deps.game.sound.playUiSelect();
    if (this.deps.game.bgm.isEnabled()) this.deps.game.bgm.start();

    this.deps.mathGame.stop();
    this.deps.game.stopLanMatch();
    this.deps.game.setSuspended(false);
    this.deps.onHideAllMainViews();
    this.inMatch = false;
    this.liveBar.classList.add('hidden');
    this.resultOverlay.classList.add('hidden');
    this.overlay.classList.remove('hidden');

    this.initMode = initialMode;
    this.lobby.gameKind = initialMode;
    this.syncInitModeButtons();
    this.refreshEnvPill();
    this.clearStatus();

    if (this.client.role === 'none') {
      this.showConnectView();
      this.client.requestLocalIps();
      this.client.startScan();
    } else {
      this.showRoomView();
      this.renderRoomUi();
    }
  }

  public disconnectAndClose(goTitle = false): void {
    this.inMatch = false;
    this.client.stopAll();
    this.deps.game.stopLanMatch();
    this.deps.mathGame.stopLanMatch();
    this.deps.mathGame.stop();
    this.liveBar.classList.add('hidden');
    this.resultOverlay.classList.add('hidden');
    this.overlay.classList.add('hidden');
    this.clearStatus();
    if (goTitle) {
      this.deps.onReturnToTitle();
    }
  }

  private refreshEnvPill(): void {
    if (this.client.isNativeDesktop()) {
      this.envPill.textContent = '● 桌面直连引擎就绪';
      this.envPill.classList.remove('browser');
    } else {
      this.envPill.textContent = '网页预览模式（正式联机请运行 EXE）';
      this.envPill.classList.add('browser');
    }
  }

  private populateSelects(): void {
    this.stageSel.innerHTML = STAGE_LIST.map((s) => `<option value="${s.id}">${s.name}</option>`).join('');
    this.themeSel.innerHTML = THEME_LIST.map((t) => `<option value="${t.id}">${t.name}</option>`).join('');
    this.stageSel.value = this.lobby.stageId;
    this.themeSel.value = this.lobby.themeId;
    this.geoThemeSel.value = this.lobby.geoThemeId;
  }

  private getLocalNick(): string {
    const raw = (this.nickInput.value || '').trim();
    const nick = raw || '涂鸦侠';
    localStorage.setItem(NICK_STORAGE_KEY, nick);
    return nick;
  }

  private showStatus(text: string, isError = false): void {
    this.statusBar.textContent = text;
    this.statusBar.classList.toggle('error', isError);
    this.statusBar.classList.remove('hidden');
  }

  private clearStatus(): void {
    this.statusBar.classList.add('hidden');
  }

  private showConnectView(): void {
    this.connectView.classList.remove('hidden');
    this.roomView.classList.add('hidden');
  }

  private showRoomView(): void {
    this.connectView.classList.add('hidden');
    this.roomView.classList.remove('hidden');
  }

  private syncInitModeButtons(): void {
    document.querySelectorAll<HTMLButtonElement>('[data-lan-init-mode]').forEach((b) => {
      b.classList.toggle('active', b.dataset.lanInitMode === this.initMode);
    });
  }

  private renderLocalIps(ips: string[]): void {
    this.localIpsPreview.textContent = ips.length > 0 ? ips.join('  /  ') : '127.0.0.1（未检测到局域网网卡）';
  }

  private renderDiscoveredRooms(rooms: LanDiscoveredRoom[]): void {
    if (rooms.length === 0) {
      this.roomListEl.innerHTML =
        '<div class="lan-room-empty">正在扫描同一 Wi-Fi / 路由器下的房间…<br/>若未自动出现，可在下方输入房主 IP 一键直连。</div>';
      return;
    }

    this.roomListEl.innerHTML = '';
    for (const r of rooms) {
      const item = document.createElement('div');
      item.className = 'lan-room-item';
      const modeLabel = r.mode === 'geometry' ? 'φ 几何乱斗' : '✏️ 草稿纸大乱斗';
      item.innerHTML = `
        <div class="lri-info">
          <div class="lri-title">${escapeHtml(r.roomName)} · <span style="color:#1d64c2">${modeLabel}</span></div>
          <div class="lri-sub">房主：${escapeHtml(r.hostName)} · ${escapeHtml(r.hostIp)}:${r.port}</div>
        </div>
      `;
      const joinBtn = document.createElement('button');
      joinBtn.className = 'secondary-btn compact-btn';
      joinBtn.type = 'button';
      joinBtn.textContent = '加入房间';
      joinBtn.addEventListener('click', () => {
        this.deps.game.sound.playUiSelect();
        this.connectAsGuest(r.hostIp, r.port);
      });
      item.appendChild(joinBtn);
      this.roomListEl.appendChild(item);
    }
  }

  private connectAsGuest(host: string, port: number): void {
    const cleanHost = host.trim();
    if (!cleanHost) {
      this.showStatus('请先输入房主的局域网 IP 地址（例如 192.168.1.8）', true);
      return;
    }
    this.lobby.guestName = this.getLocalNick();
    this.showStatus(`正在连接 ${cleanHost}:${port}…`);
    this.client.connectToHost(cleanHost, port || 27890);
  }

  private handleHostStarted(port: number, ips: string[]): void {
    const primaryIp = ips[0] || '127.0.0.1';
    this.localRoomAddr = `${primaryIp}:${port}`;
    this.lobby.hostName = this.getLocalNick();
    this.lobby.guestName = '等待对手连接…';
    this.lobby.guestReady = false;
    this.lobby.gameKind = this.initMode;

    this.roomRoleBadge.textContent = '房主 HOST';
    this.roomAddrEl.textContent = ips.length > 1 ? `${primaryIp}:${port} (另: ${ips[1]})` : this.localRoomAddr;
    this.roomPingEl.textContent = '等待客机加入…';
    this.roomPingEl.className = 'lan-ping-chip ok';

    this.showRoomView();
    this.renderRoomUi();
    this.showStatus(`房间已创建！另一台设备可在列表一键发现，或手动输入 ${this.localRoomAddr} 加入。`);
  }

  private handlePeerConnected(remoteLabel: string): void {
    this.deps.game.sound.playUiSelect();
    this.lobby.guestName = remoteLabel || '局域网客机';
    this.lobby.guestReady = false;
    this.showStatus(`对手 (${remoteLabel}) 已连接！选好武器/学派后即可开始对决。`);
    this.roomPingEl.textContent = '已连接 · 测速中';
    this.roomPingEl.className = 'lan-ping-chip good';
    this.broadcastLobby();
    this.renderRoomUi();
  }

  private handleConnectedToHost(host: string, port: number): void {
    this.deps.game.sound.playUiSelect();
    this.localRoomAddr = `${host}:${port}`;
    this.roomRoleBadge.textContent = '客机 GUEST';
    this.roomAddrEl.textContent = this.localRoomAddr;
    this.roomPingEl.textContent = '已连接 · 测速中';
    this.roomPingEl.className = 'lan-ping-chip good';

    const nick = this.getLocalNick();
    this.lobby.guestName = nick;
    this.lobby.guestReady = false;

    this.showRoomView();
    this.renderRoomUi();
    this.showStatus(`已成功连接至房主 ${this.localRoomAddr}！选择你的武器/学派后点击「准备就绪」。`);

    this.client.send({ t: 'hello', name: nick, version: '0.4.0' }, false);
    this.client.send(
      {
        t: 'guest_pick',
        name: nick,
        weapon: this.lobby.guestWeapon,
        school: this.lobby.guestSchool,
        ready: false,
      },
      false
    );
  }

  private handleDisconnected(reason: string): void {
    const wasInMatch = this.inMatch;
    this.inMatch = false;
    this.deps.game.stopLanMatch();
    this.deps.mathGame.stopLanMatch();
    this.deps.mathGame.stop();
    this.deps.game.setSuspended(false);
    this.deps.hudEl.classList.add('hidden');
    this.deps.geoHudEl.classList.add('hidden');
    this.liveBar.classList.add('hidden');
    this.resultOverlay.classList.add('hidden');
    this.overlay.classList.remove('hidden');

    if (this.client.role === 'host') {
      this.lobby.guestName = '等待对手连接…';
      this.lobby.guestReady = false;
      this.roomPingEl.textContent = '等待客机加入…';
      this.roomPingEl.className = 'lan-ping-chip ok';
      this.showRoomView();
      this.renderRoomUi();
      this.showStatus(wasInMatch ? '对手已离开对局，房间已重置，可等待新对手加入。' : '客机已断开连接，等待重新加入。', true);
    } else {
      this.client.stopAll();
      this.showConnectView();
      this.client.startScan();
      this.showStatus(`与房主断开连接（${reason}），已返回局域网大厅。`, true);
    }
  }

  private updatePingDisplays(pingMs: number): void {
    const badge = formatPingBadge(pingMs);
    this.roomPingEl.textContent = badge.text;
    this.roomPingEl.className = `lan-ping-chip ${badge.cls}`;
    this.livePingEl.textContent = badge.text;
    this.livePingEl.className = `lan-ping-chip ${badge.cls}`;
  }

  private broadcastLobby(): void {
    if (this.client.role !== 'host') return;
    this.client.updateHostBeacon(this.hostRoomName, this.lobby.gameKind);
    if (this.client.connected) {
      this.client.send({ t: 'lobby', state: this.lobby }, false);
    }
  }

  private handlePeerMessage(msg: LanPeerMessage): void {
    switch (msg.t) {
      case 'hello':
        if (this.client.role === 'host') {
          this.lobby.guestName = msg.name || '局域网客机';
          this.broadcastLobby();
          this.renderRoomUi();
        }
        break;
      case 'lobby':
        if (this.client.role === 'guest') {
          this.lobby = { ...msg.state };
          this.renderRoomUi();
        }
        break;
      case 'guest_pick':
        if (this.client.role === 'host') {
          if (msg.name) this.lobby.guestName = msg.name;
          if (msg.weapon) this.lobby.guestWeapon = msg.weapon;
          if (msg.school) this.lobby.guestSchool = msg.school;
          if (typeof msg.ready === 'boolean') this.lobby.guestReady = msg.ready;
          this.broadcastLobby();
          this.renderRoomUi();
        }
        break;
      case 'start_match':
        if (this.client.role === 'guest') {
          this.lobby = { ...msg.lobby };
          this.launchLanMatch('guest');
        }
        break;
      case 'back_lobby':
        this.returnToLanRoom(false);
        break;
      case 'inp':
        if (this.client.role === 'host' && this.inMatch) {
          if (this.lobby.gameKind === 'scratchpad') {
            this.deps.game.receiveLanInput(msg);
          } else {
            this.deps.mathGame.receiveLanInput(msg);
          }
        }
        break;
      case 'sp_snap':
        if (this.client.role === 'guest' && this.inMatch && this.lobby.gameKind === 'scratchpad') {
          this.deps.game.receiveLanSnapshot(msg);
        }
        break;
      case 'geo_snap':
        if (this.client.role === 'guest' && this.inMatch && this.lobby.gameKind === 'geometry') {
          this.deps.mathGame.receiveLanSnapshot(msg);
        }
        break;
      case 'fx':
        if (this.client.role === 'guest' && this.inMatch) {
          if (msg.mode === 'scratchpad') this.deps.game.receiveLanFx(msg.ev);
          else this.deps.mathGame.receiveLanFx(msg.ev);
        }
        break;
    }
  }

  private renderRoomUi(): void {
    const isHost = this.client.role === 'host';
    this.settingsStrip.classList.toggle('readonly', !isHost);

    document.querySelectorAll<HTMLButtonElement>('[data-lan-game]').forEach((b) => {
      b.classList.toggle('active', b.dataset.lanGame === this.lobby.gameKind);
    });
    document.querySelectorAll<HTMLButtonElement>('[data-lan-bo]').forEach((b) => {
      b.classList.toggle('active', Number(b.dataset.lanBo) === this.lobby.bestOf);
    });

    const isGeo = this.lobby.gameKind === 'geometry';
    this.spStageGroup.classList.toggle('hidden', isGeo);
    this.geoThemeGroup.classList.toggle('hidden', !isGeo);
    this.stageSel.value = this.lobby.stageId;
    this.themeSel.value = this.lobby.themeId;
    this.geoThemeSel.value = this.lobby.geoThemeId;

    this.hostNameEl.textContent = this.lobby.hostName;
    this.guestNameEl.textContent = this.client.connected || !isHost ? this.lobby.guestName : '等待对手连接…';

    if (isGeo) {
      const hs = MATH_SCHOOLS[this.lobby.hostSchool];
      const gs = MATH_SCHOOLS[this.lobby.guestSchool];
      this.hostPickEl.textContent = `${hs.symbol} ${hs.name} (${hs.formula})`;
      this.guestPickEl.textContent = this.client.connected || !isHost ? `${gs.symbol} ${gs.name} (${gs.formula})` : '—';
    } else {
      const hw = WEAPONS[this.lobby.hostWeapon];
      const gw = WEAPONS[this.lobby.guestWeapon];
      this.hostPickEl.textContent = `${hw.icon} ${hw.name}`;
      this.guestPickEl.textContent = this.client.connected || !isHost ? `${gw.icon} ${gw.name}` : '—';
    }

    if (!this.client.connected && isHost) {
      this.guestReadyBadge.textContent = '等待加入…';
      this.guestReadyBadge.classList.remove('ready');
    } else if (this.lobby.guestReady) {
      this.guestReadyBadge.textContent = '已准备 ✓';
      this.guestReadyBadge.classList.add('ready');
    } else {
      this.guestReadyBadge.textContent = '选装中…';
      this.guestReadyBadge.classList.remove('ready');
    }

    // Picker Grid (12 Stationery Weapons OR 6 Math Schools — mirror matches allowed!)
    this.pickerGrid.classList.toggle('geo-6', isGeo);
    this.pickerLabel.textContent = isGeo
      ? '选择你的数学学派（双方可自由镜像选同一学派！）'
      : '选择你的出战文具（12 件纯正文具 · 支持镜像同武器对决！）';

    const localPickId = isGeo
      ? isHost
        ? this.lobby.hostSchool
        : this.lobby.guestSchool
      : isHost
        ? this.lobby.hostWeapon
        : this.lobby.guestWeapon;

    this.pickerGrid.innerHTML = '';
    if (isGeo) {
      for (const s of MATH_SCHOOL_LIST) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = `lan-pick-card ${s.id === localPickId ? 'selected' : ''}`;
        card.innerHTML = `
          <span class="lpk-title">${s.symbol} ${s.name}</span>
          <span class="lpk-sub">${s.formula}</span>
        `;
        card.addEventListener('click', () => {
          this.deps.game.sound.playUiClick();
          if (isHost) {
            this.lobby.hostSchool = s.id;
            this.broadcastLobby();
          } else {
            this.lobby.guestSchool = s.id;
            this.client.send({ t: 'guest_pick', school: s.id }, false);
          }
          this.renderRoomUi();
        });
        this.pickerGrid.appendChild(card);
      }
    } else {
      for (const w of WEAPON_LIST) {
        const card = document.createElement('button');
        card.type = 'button';
        card.className = `lan-pick-card ${w.id === localPickId ? 'selected' : ''}`;
        card.innerHTML = `
          <span class="lpk-title">${w.icon} ${w.name}</span>
          <span class="lpk-sub">${w.tag}</span>
        `;
        card.addEventListener('click', () => {
          this.deps.game.sound.playUiClick();
          if (isHost) {
            this.lobby.hostWeapon = w.id;
            this.broadcastLobby();
          } else {
            this.lobby.guestWeapon = w.id;
            this.client.send({ t: 'guest_pick', weapon: w.id }, false);
          }
          this.renderRoomUi();
        });
        this.pickerGrid.appendChild(card);
      }
    }

    // Footer Buttons
    this.ctrlHintEl.innerHTML = this.deps.onApplySingleP1Device();
    this.btnStart.classList.toggle('hidden', !isHost);
    this.btnReady.classList.toggle('hidden', isHost);

    if (isHost) {
      this.btnStart.disabled = !this.client.connected;
      if (!this.client.connected) {
        this.btnStart.textContent = '等待客机加入…';
      } else if (this.lobby.guestReady) {
        this.btnStart.textContent = '双方就绪 · 开始联机对决！';
      } else {
        this.btnStart.textContent = '直接开始联机对决！';
      }
    } else {
      this.btnReady.textContent = this.lobby.guestReady ? '✓ 已准备（点击取消）' : '点击准备就绪';
    }
  }

  private launchLanMatch(role: 'host' | 'guest'): void {
    this.deps.game.sound.unlock();
    this.deps.game.sound.playUiSelect();
    this.deps.game.input.cancelAllCaptures();
    this.deps.game.input.clearAll();
    (document.activeElement as HTMLElement | null)?.blur?.();

    const hintHtml = this.deps.onApplySingleP1Device();
    this.inMatch = true;
    this.overlay.classList.add('hidden');
    this.resultOverlay.classList.add('hidden');
    this.liveBar.classList.remove('hidden');
    this.liveRoleEl.textContent = role === 'host' ? '房主 P1 · 局域网直连' : '客机 P2 · 局域网直连';

    if (this.lobby.gameKind === 'scratchpad') {
      this.deps.mathGame.stop();
      this.deps.game.setSuspended(false);
      this.deps.geoHudEl.classList.add('hidden');
      this.deps.hudEl.classList.remove('hidden');
      this.deps.trainingBarEl.classList.add('hidden');
      this.deps.p1KeyHintEl.innerHTML = hintHtml;
      this.deps.p2KeyHintEl.classList.add('hidden');
      this.deps.game.startLanMatch(role, this.lobby);
    } else {
      this.deps.game.stopLanMatch();
      this.deps.game.setSuspended(true);
      this.deps.hudEl.classList.add('hidden');
      this.deps.geoHudEl.classList.remove('hidden');
      this.deps.geoHudEl.classList.toggle('light-stage', this.lobby.geoThemeId === 'blueprint');
      this.deps.geoSandboxBarEl.classList.add('hidden');
      this.deps.geoKeyHintEl.innerHTML = hintHtml;
      this.deps.mathGame.startLanMatch(role, this.lobby);
    }
  }

  private showLanResultModal(winnerIdx: 0 | 1, p1Wins: number, p2Wins: number, bestOf: LanBestOf): void {
    const localIdx = this.client.role === 'guest' ? 1 : 0;
    const localWon = winnerIdx === localIdx;
    const winnerName = winnerIdx === 0 ? this.lobby.hostName : this.lobby.guestName;

    document.getElementById('lan-res-badge')!.textContent = localWon ? '胜利!!' : '惜败';
    document.getElementById('lan-res-title')!.textContent = localWon
      ? `恭喜！你 (${winnerName}) 赢得本场联机对决！`
      : `${winnerName} 赢得了本场联机对决！`;
    document.getElementById('lan-res-sub')!.textContent =
      `最终比分 ${p1Wins} : ${p2Wins}（BO${bestOf}）· 点击下方直接回到房间换武器再战！`;

    this.resultOverlay.classList.remove('hidden');
  }

  private returnToLanRoom(notifyPeer: boolean): void {
    if (notifyPeer && this.client.connected) {
      this.client.send({ t: 'back_lobby' }, false);
    }
    this.inMatch = false;
    this.deps.game.stopLanMatch();
    this.deps.mathGame.stopLanMatch();
    this.deps.mathGame.stop();
    this.deps.game.setSuspended(false);
    this.deps.hudEl.classList.add('hidden');
    this.deps.geoHudEl.classList.add('hidden');
    this.liveBar.classList.add('hidden');
    this.resultOverlay.classList.add('hidden');
    this.lobby.guestReady = false;
    this.overlay.classList.remove('hidden');
    this.showRoomView();
    this.renderRoomUi();
    if (this.client.role === 'host') {
      this.broadcastLobby();
    }
  }

  private bindEvents(): void {
    document.getElementById('btn-lan-back')!.addEventListener('click', () => {
      this.deps.game.sound.playUiClick();
      this.disconnectAndClose(true);
    });

    document.querySelectorAll<HTMLButtonElement>('[data-lan-init-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        this.deps.game.sound.playUiClick();
        this.initMode = btn.dataset.lanInitMode as LanGameKind;
        this.syncInitModeButtons();
      });
    });

    document.getElementById('btn-lan-create')!.addEventListener('click', () => {
      this.deps.game.sound.playUiSelect();
      const nick = this.getLocalNick();
      this.hostRoomName = (this.roomNameInput.value || '').trim() || `${nick}的联机房`;
      this.clearStatus();
      this.client.startHost(this.hostRoomName, nick, this.initMode, 27890);
    });

    document.getElementById('btn-lan-rescan')!.addEventListener('click', () => {
      this.deps.game.sound.playUiClick();
      this.client.startScan();
      this.showStatus('已刷新局域网房间扫描…');
    });

    document.getElementById('btn-lan-join-ip')!.addEventListener('click', () => {
      this.deps.game.sound.playUiSelect();
      this.connectAsGuest(this.ipInput.value, Number(this.portInput.value) || 27890);
    });

    document.getElementById('btn-lan-copy-ip')!.addEventListener('click', () => {
      this.deps.game.sound.playUiClick();
      if (this.localRoomAddr && navigator.clipboard) {
        navigator.clipboard.writeText(this.localRoomAddr).catch(() => {});
        this.showStatus(`已复制联机地址：${this.localRoomAddr}`);
      }
    });

    document.getElementById('btn-lan-leave-room')!.addEventListener('click', () => {
      this.deps.game.sound.playUiClick();
      this.client.stopAll();
      this.showConnectView();
      this.clearStatus();
      this.client.requestLocalIps();
      this.client.startScan();
    });

    // Host room settings
    document.querySelectorAll<HTMLButtonElement>('[data-lan-game]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.client.role !== 'host') return;
        this.deps.game.sound.playUiClick();
        this.lobby.gameKind = btn.dataset.lanGame as LanGameKind;
        this.lobby.guestReady = false;
        this.broadcastLobby();
        this.renderRoomUi();
      });
    });

    document.querySelectorAll<HTMLButtonElement>('[data-lan-bo]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (this.client.role !== 'host') return;
        this.deps.game.sound.playUiClick();
        this.lobby.bestOf = Number(btn.dataset.lanBo) as LanBestOf;
        this.broadcastLobby();
        this.renderRoomUi();
      });
    });

    this.stageSel.addEventListener('change', () => {
      if (this.client.role !== 'host') return;
      this.lobby.stageId = this.stageSel.value as StageId;
      this.broadcastLobby();
      this.stageSel.blur();
    });

    this.themeSel.addEventListener('change', () => {
      if (this.client.role !== 'host') return;
      this.lobby.themeId = this.themeSel.value as ThemeId;
      this.broadcastLobby();
      this.themeSel.blur();
    });

    this.geoThemeSel.addEventListener('change', () => {
      if (this.client.role !== 'host') return;
      this.lobby.geoThemeId = this.geoThemeSel.value as MathThemeId;
      this.broadcastLobby();
      this.geoThemeSel.blur();
    });

    document.getElementById('btn-lan-controls')!.addEventListener('click', () => {
      this.deps.onOpenControls();
    });

    this.btnReady.addEventListener('click', () => {
      if (this.client.role !== 'guest') return;
      this.deps.game.sound.playUiSelect();
      this.lobby.guestReady = !this.lobby.guestReady;
      this.client.send({ t: 'guest_pick', ready: this.lobby.guestReady }, false);
      this.renderRoomUi();
    });

    this.btnStart.addEventListener('click', () => {
      if (this.client.role !== 'host' || !this.client.connected) return;
      this.client.send({ t: 'start_match', lobby: this.lobby }, false);
      this.launchLanMatch('host');
    });

    document.getElementById('btn-lan-exit-match')!.addEventListener('click', (e) => {
      (e.currentTarget as HTMLElement).blur();
      this.returnToLanRoom(true);
    });

    document.getElementById('btn-lan-res-back-room')!.addEventListener('click', () => {
      this.deps.game.sound.playUiSelect();
      this.returnToLanRoom(true);
    });

    document.getElementById('btn-lan-res-exit')!.addEventListener('click', () => {
      this.deps.game.sound.playUiClick();
      this.disconnectAndClose(true);
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] || c));
}
