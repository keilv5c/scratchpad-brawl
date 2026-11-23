import { InputState } from '../types';
import {
  LanDiscoveredRoom,
  LanGameKind,
  LanInputPacket,
  LanPeerMessage,
  LanRole,
} from './lanTypes';

interface WebView2Bridge {
  postMessage: (msg: unknown) => void;
  addEventListener: (type: 'message', listener: (ev: { data: unknown }) => void) => void;
}

declare global {
  interface Window {
    chrome?: {
      webview?: WebView2Bridge;
    };
  }
}

export interface LanSessionCallbacks {
  onLocalIps?: (ips: string[]) => void;
  onHostStarted?: (port: number, ips: string[], roomId: string) => void;
  onRoomsUpdated?: (rooms: LanDiscoveredRoom[]) => void;
  onPeerConnected?: (remoteLabel: string) => void;
  onConnectedToHost?: (host: string, port: number) => void;
  onDisconnected?: (reason: string) => void;
  onError?: (message: string) => void;
  onMessage?: (msg: LanPeerMessage) => void;
  onPingUpdated?: (pingMs: number, jitterMs: number) => void;
}

/**
 * Smooth low-latency snapshot buffer for Guest rendering.
 * Keeps a tiny adaptive 16ms..42ms interpolation window so fighters & projectiles glide
 * at full 60/120fps with ZERO stutter or freeze even under mild Wi-Fi jitter.
 */
export class SnapshotInterpolator<T extends { seq: number; ts: number }> {
  private entries: Array<{ snap: T; recvMs: number }> = [];
  private lastArrivalMs = 0;
  private emaIntervalMs = 16.67;
  private emaJitterMs = 2;

  public reset(): void {
    this.entries = [];
    this.lastArrivalMs = 0;
    this.emaIntervalMs = 16.67;
    this.emaJitterMs = 2;
  }

  public push(snap: T, nowMs: number = performance.now()): void {
    if (this.entries.length > 0 && snap.seq <= this.entries[this.entries.length - 1].snap.seq) {
      return;
    }
    if (this.lastArrivalMs > 0) {
      const dt = Math.min(80, Math.max(4, nowMs - this.lastArrivalMs));
      const dev = Math.abs(dt - this.emaIntervalMs);
      this.emaIntervalMs = this.emaIntervalMs * 0.85 + dt * 0.15;
      this.emaJitterMs = this.emaJitterMs * 0.82 + dev * 0.18;
    }
    this.lastArrivalMs = nowMs;
    this.entries.push({ snap, recvMs: nowMs });
    if (this.entries.length > 6) {
      this.entries.splice(0, this.entries.length - 6);
    }
  }

  public getLatest(): T | null {
    return this.entries.length > 0 ? this.entries[this.entries.length - 1].snap : null;
  }

  public sample(nowMs: number = performance.now()): { prev: T; next: T; alpha: number } | null {
    const n = this.entries.length;
    if (n === 0) return null;
    if (n === 1) return { prev: this.entries[0].snap, next: this.entries[0].snap, alpha: 1 };

    // Adaptive tiny delay: ~18ms on clean LAN, expanding smoothly up to 44ms only if Wi-Fi jitters
    const interpDelayMs = Math.min(44, Math.max(16, 15 + this.emaJitterMs * 1.4));
    const renderTime = nowMs - interpDelayMs;

    for (let i = n - 1; i >= 1; i--) {
      const a = this.entries[i - 1];
      const b = this.entries[i];
      if (renderTime >= a.recvMs) {
        const span = Math.max(1, b.recvMs - a.recvMs);
        // Gentle cap at 1.15 prevents both teleporting and infinite overshoot on brief packet pauses
        const alpha = Math.min(1.15, Math.max(0, (renderTime - a.recvMs) / span));
        return { prev: a.snap, next: b.snap, alpha };
      }
    }

    return { prev: this.entries[0].snap, next: this.entries[1].snap, alpha: 0 };
  }
}

/**
 * Helper on Guest side: converts local InputState into monotonic-edge-counter LanInputPackets
 * so NO tap (jump, light, heavy, parry, dash, super, double-tap drop) can ever be dropped!
 */
export class GuestInputEncoder {
  private seq = 0;
  private jSeq = 0;
  private ltSeq = 0;
  private hvSeq = 0;
  private hvRelSeq = 0;
  private blSeq = 0;
  private daSeq = 0;
  private suSeq = 0;
  private drSeq = 0;
  private lastSentSig = '';
  private lastSendMs = 0;

  public reset(): void {
    this.seq = 0;
    this.jSeq = this.ltSeq = this.hvSeq = this.hvRelSeq = this.blSeq = this.daSeq = this.suSeq = this.drSeq = 0;
    this.lastSentSig = '';
    this.lastSendMs = 0;
  }

  public consumeAndEncode(inp: InputState, nowMs: number = performance.now()): LanInputPacket | null {
    let edgeTriggered = false;
    if (inp.jumpPressed > 0) { this.jSeq++; inp.jumpPressed = 0; edgeTriggered = true; }
    if (inp.lightPressed > 0) { this.ltSeq++; inp.lightPressed = 0; edgeTriggered = true; }
    if (inp.heavyPressed > 0) { this.hvSeq++; inp.heavyPressed = 0; edgeTriggered = true; }
    if (inp.heavyReleased > 0) { this.hvRelSeq++; inp.heavyReleased = 0; edgeTriggered = true; }
    if (inp.blockPressed > 0) { this.blSeq++; inp.blockPressed = 0; edgeTriggered = true; }
    if (inp.dashPressed > 0) { this.daSeq++; inp.dashPressed = 0; edgeTriggered = true; }
    if (inp.superPressed > 0) { this.suSeq++; inp.superPressed = 0; edgeTriggered = true; }
    if (inp.dropThroughPressed > 0) { this.drSeq++; inp.dropThroughPressed = 0; edgeTriggered = true; }

    const aa = inp.aimAngle !== undefined && inp.aimAngle !== null ? Math.round(inp.aimAngle * 100) / 100 : null;
    const ad: -1 | 0 | 1 = inp.aimDir ?? 0;

    const sig = `${inp.left ? 1 : 0}${inp.right ? 1 : 0}${inp.up ? 1 : 0}${inp.down ? 1 : 0}${inp.light ? 1 : 0}${inp.heavy ? 1 : 0}${inp.block ? 1 : 0}${inp.dash ? 1 : 0}${inp.superBtn ? 1 : 0}|${ad}|${aa ?? ''}`;
    if (!edgeTriggered && sig === this.lastSentSig && nowMs - this.lastSendMs < 32) {
      return null;
    }

    this.lastSentSig = sig;
    this.lastSendMs = nowMs;
    this.seq++;

    return {
      t: 'inp',
      seq: this.seq,
      l: inp.left ? 1 : 0,
      r: inp.right ? 1 : 0,
      u: inp.up ? 1 : 0,
      d: inp.down ? 1 : 0,
      lt: inp.light ? 1 : 0,
      hv: inp.heavy ? 1 : 0,
      bl: inp.block ? 1 : 0,
      da: inp.dash ? 1 : 0,
      su: inp.superBtn ? 1 : 0,
      jSeq: this.jSeq,
      ltSeq: this.ltSeq,
      hvSeq: this.hvSeq,
      hvRelSeq: this.hvRelSeq,
      blSeq: this.blSeq,
      daSeq: this.daSeq,
      suSeq: this.suSeq,
      drSeq: this.drSeq,
      ad,
      aa,
    };
  }
}

/**
 * Helper on Host side: reconstructs Guest's LanInputPackets into a live InputState for P2!
 */
export class HostRemoteInputDecoder {
  private lastSeq = 0;
  private jSeq = 0;
  private ltSeq = 0;
  private hvSeq = 0;
  private hvRelSeq = 0;
  private blSeq = 0;
  private daSeq = 0;
  private suSeq = 0;
  private drSeq = 0;

  public reset(): void {
    this.lastSeq = 0;
    this.jSeq = this.ltSeq = this.hvSeq = this.hvRelSeq = this.blSeq = this.daSeq = this.suSeq = this.drSeq = 0;
  }

  public applyPacket(pkt: LanInputPacket, target: InputState): void {
    if (pkt.seq < this.lastSeq) return;
    this.lastSeq = pkt.seq;

    target.left = pkt.l === 1;
    target.right = pkt.r === 1;
    target.up = pkt.u === 1;
    target.down = pkt.d === 1;
    target.light = pkt.lt === 1;
    target.heavy = pkt.hv === 1;
    target.block = pkt.bl === 1;
    target.dash = pkt.da === 1;
    target.superBtn = pkt.su === 1;
    target.aimDir = pkt.ad;
    target.aimAngle = pkt.aa;

    const BUF = 9;
    if (pkt.jSeq > this.jSeq) { this.jSeq = pkt.jSeq; target.jumpPressed = BUF; }
    if (pkt.ltSeq > this.ltSeq) { this.ltSeq = pkt.ltSeq; target.lightPressed = BUF; }
    if (pkt.hvSeq > this.hvSeq) { this.hvSeq = pkt.hvSeq; target.heavyPressed = BUF; }
    if (pkt.hvRelSeq > this.hvRelSeq) { this.hvRelSeq = pkt.hvRelSeq; target.heavyReleased = BUF; }
    if (pkt.blSeq > this.blSeq) { this.blSeq = pkt.blSeq; target.blockPressed = BUF; }
    if (pkt.daSeq > this.daSeq) { this.daSeq = pkt.daSeq; target.dashPressed = BUF; }
    if (pkt.suSeq > this.suSeq) { this.suSeq = pkt.suSeq; target.superPressed = BUF; }
    if (pkt.drSeq > this.drSeq) { this.drSeq = pkt.drSeq; target.dropThroughPressed = BUF; }
  }
}

/**
 * Unified LAN transport client:
 * - Uses native WebView2 PostWebMessage <-> C# LanManager (TCP_NODELAY + UDP discovery) inside InkbladeDuel.exe
 * - Also supports an optional WebSocket relay URL (ws://host:27892) when developing/testing in a regular browser!
 */
export class LanClient {
  public role: LanRole = 'none';
  public connected = false;
  public pingMs = 0;
  public jitterMs = 0;
  public localIps: string[] = [];
  public hostPort = 27890;

  private callbacks: LanSessionCallbacks;
  private nativeBridge: WebView2Bridge | null;
  private ws: WebSocket | null = null;
  private pingTimer = 0;
  private pingSeq = 0;

  constructor(callbacks: LanSessionCallbacks) {
    this.callbacks = callbacks;
    this.nativeBridge = typeof window !== 'undefined' && window.chrome?.webview ? window.chrome.webview : null;

    if (this.nativeBridge) {
      this.nativeBridge.addEventListener('message', (ev) => {
        try {
          const data = typeof ev.data === 'string' ? JSON.parse(ev.data) : ev.data;
          this.handleBridgeEvent(data);
        } catch {
          // ignore malformed bridge packet
        }
      });
    }
  }

  public isNativeDesktop(): boolean {
    return this.nativeBridge !== null;
  }

  public requestLocalIps(): void {
    if (this.nativeBridge) {
      this.nativeBridge.postMessage({ cmd: 'lan:getLocalIps' });
    } else {
      this.callbacks.onLocalIps?.(['127.0.0.1']);
    }
  }

  public startHost(roomName: string, hostName: string, mode: LanGameKind, port = 27890): void {
    this.stopAll();
    this.role = 'host';
    this.hostPort = port;

    if (this.nativeBridge) {
      this.nativeBridge.postMessage({ cmd: 'lan:hostStart', roomName, hostName, mode, port });
    } else {
      // Browser dev fallback via optional scripts/lan-relay.mjs on ws://127.0.0.1:27892
      this.connectBrowserRelay('host', '127.0.0.1', 27892, roomName);
    }
  }

  public updateHostBeacon(roomName: string, mode: LanGameKind): void {
    if (this.nativeBridge && this.role === 'host') {
      this.nativeBridge.postMessage({ cmd: 'lan:hostUpdateBeacon', roomName, mode });
    }
  }

  public startScan(): void {
    if (this.nativeBridge) {
      this.nativeBridge.postMessage({ cmd: 'lan:scanStart' });
    }
  }

  public stopScan(): void {
    if (this.nativeBridge) {
      this.nativeBridge.postMessage({ cmd: 'lan:scanStop' });
    }
  }

  public connectToHost(host: string, port = 27890): void {
    this.stopAll();
    this.role = 'guest';
    if (this.nativeBridge) {
      this.nativeBridge.postMessage({ cmd: 'lan:connect', host, port });
    } else {
      const wsPort = port === 27890 ? 27892 : port;
      this.connectBrowserRelay('guest', host || '127.0.0.1', wsPort, 'dev');
    }
  }

  public send(msg: LanPeerMessage, droppable = false): void {
    if (!this.connected) return;
    if (this.nativeBridge) {
      this.nativeBridge.postMessage({ cmd: 'lan:send', payload: msg, droppable });
    } else if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  public stopAll(): void {
    this.stopPingLoop();
    this.connected = false;
    this.pingMs = 0;
    this.jitterMs = 0;
    const prevRole = this.role;
    this.role = 'none';
    if (this.nativeBridge) {
      this.nativeBridge.postMessage({ cmd: 'lan:scanStop' });
      if (prevRole === 'host') this.nativeBridge.postMessage({ cmd: 'lan:hostStop' });
      else this.nativeBridge.postMessage({ cmd: 'lan:disconnect' });
    }
    if (this.ws) {
      try { this.ws.close(); } catch { }
      this.ws = null;
    }
  }

  private handleBridgeEvent(ev: any): void {
    if (!ev || typeof ev !== 'object') return;
    switch (ev.type) {
      case 'lan:localIps':
        this.localIps = Array.isArray(ev.ips) ? ev.ips : [];
        this.callbacks.onLocalIps?.(this.localIps);
        break;
      case 'lan:hostStarted':
        this.localIps = Array.isArray(ev.ips) ? ev.ips : [];
        this.hostPort = ev.port || 27890;
        this.callbacks.onHostStarted?.(this.hostPort, this.localIps, ev.roomId || '');
        break;
      case 'lan:rooms':
        this.callbacks.onRoomsUpdated?.(Array.isArray(ev.rooms) ? ev.rooms : []);
        break;
      case 'lan:peerConnected':
        this.connected = true;
        this.startPingLoop();
        this.callbacks.onPeerConnected?.(ev.remoteIp || '局域网玩家');
        break;
      case 'lan:connected':
        this.connected = true;
        this.startPingLoop();
        this.callbacks.onConnectedToHost?.(ev.host || '', ev.port || 27890);
        break;
      case 'lan:peerDisconnected':
        this.connected = false;
        this.stopPingLoop();
        this.callbacks.onDisconnected?.(ev.reason || 'remote_closed');
        break;
      case 'lan:error':
        this.callbacks.onError?.(ev.message || '局域网连接错误');
        break;
      case 'lan:msg':
        if (ev.payload) this.handlePeerMessage(ev.payload as LanPeerMessage);
        break;
    }
  }

  private handlePeerMessage(msg: LanPeerMessage): void {
    if (msg.t === 'ping') {
      this.send({ t: 'pong', id: msg.id, sentAt: msg.sentAt }, false);
      return;
    }
    if (msg.t === 'pong') {
      const rtt = Math.max(0, Math.round(performance.now() - msg.sentAt));
      const dev = Math.abs(rtt - this.pingMs);
      this.pingMs = this.pingMs === 0 ? rtt : Math.round(this.pingMs * 0.72 + rtt * 0.28);
      this.jitterMs = Math.round(this.jitterMs * 0.8 + dev * 0.2);
      this.callbacks.onPingUpdated?.(this.pingMs, this.jitterMs);
      return;
    }
    this.callbacks.onMessage?.(msg);
  }

  private startPingLoop(): void {
    this.stopPingLoop();
    this.pingTimer = window.setInterval(() => {
      if (!this.connected) return;
      this.pingSeq++;
      this.send({ t: 'ping', id: this.pingSeq, sentAt: performance.now() }, false);
    }, 1000);
  }

  private stopPingLoop(): void {
    if (this.pingTimer) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = 0;
    }
  }

  private connectBrowserRelay(role: 'host' | 'guest', host: string, port: number, room: string): void {
    try {
      const ws = new WebSocket(`ws://${host}:${port}/?role=${role}&room=${encodeURIComponent(room)}`);
      this.ws = ws;
      ws.onopen = () => {
        if (role === 'host') {
          this.callbacks.onHostStarted?.(port, [host], room);
        }
      };
      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(String(e.data));
          if (msg.type === 'relay:paired') {
            this.connected = true;
            this.startPingLoop();
            if (role === 'host') this.callbacks.onPeerConnected?.(msg.remote || 'Browser Peer');
            else this.callbacks.onConnectedToHost?.(host, port);
          } else if (msg.type === 'relay:peer_left') {
            this.connected = false;
            this.stopPingLoop();
            this.callbacks.onDisconnected?.('peer_left');
          } else if (msg.t) {
            this.handlePeerMessage(msg as LanPeerMessage);
          }
        } catch { }
      };
      ws.onerror = () => {
        this.callbacks.onError?.('浏览器网页版需运行 Windows 桌面端 InkbladeDuel.exe（或本地 dev 中继）才可进行局域网直连');
      };
      ws.onclose = () => {
        if (this.connected) {
          this.connected = false;
          this.stopPingLoop();
          this.callbacks.onDisconnected?.('closed');
        }
      };
    } catch {
      this.callbacks.onError?.('请使用 Windows 桌面程序 InkbladeDuel.exe 体验免配置局域网双设备联机');
    }
  }
}

export function formatPingBadge(pingMs: number): { text: string; cls: 'good' | 'ok' | 'warn' } {
  if (pingMs <= 12) return { text: `${pingMs}ms · 极速`, cls: 'good' };
  if (pingMs <= 38) return { text: `${pingMs}ms · 流畅`, cls: 'good' };
  if (pingMs <= 80) return { text: `${pingMs}ms · 一般`, cls: 'ok' };
  return { text: `${pingMs}ms · 波动`, cls: 'warn' };
}
