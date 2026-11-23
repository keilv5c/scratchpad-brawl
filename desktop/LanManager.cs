using System.Buffers.Binary;
using System.Collections.Concurrent;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;

namespace InkbladeDesktop;

/// <summary>
/// Ultra-low-latency native LAN networking engine embedded inside InkbladeDuel.exe.
/// - TCP_NODELAY (port 27890) direct peer-to-peer link between Host PC and Guest PC (< 1ms on LAN)
/// - Anti-bufferbloat dual-lane sender: reliable control/input lane + latest-only droppable 60Hz snapshot slot
/// - Multi-NIC subnet-aware UDP discovery beacon (port 27891) for 1-click zero-config LAN room joining
/// </summary>
internal sealed class LanManager : IDisposable
{
    public const int DefaultTcpPort = 27890;
    public const int DiscoveryUdpPort = 27891;
    private const int MaxPacketBytes = 256 * 1024;

    private readonly Action<string> _emitToWebView;

    // Host state
    private TcpListener? _listener;
    private CancellationTokenSource? _hostCts;
    private string _roomId = "";
    private string _roomName = "草稿纸对战房";
    private string _hostName = "房主";
    private string _hostMode = "scratchpad";
    private int _hostPort = DefaultTcpPort;

    // Active peer connection (used by both Host's accepted Guest and Guest's connection to Host)
    private readonly object _connLock = new();
    private TcpClient? _peerClient;
    private NetworkStream? _peerStream;
    private CancellationTokenSource? _peerCts;
    private Channel<byte[]>? _reliableOut;
    private volatile byte[]? _latestSnapshotFrame;
    private SemaphoreSlim? _sendSignal;
    private bool _isHostRole;

    // UDP Scanner state (Guest room list)
    private CancellationTokenSource? _scanCts;
    private readonly ConcurrentDictionary<string, DiscoveredRoom> _rooms = new();

    private sealed class DiscoveredRoom
    {
        public string roomId { get; set; } = "";
        public string roomName { get; set; } = "";
        public string hostName { get; set; } = "";
        public string hostIp { get; set; } = "";
        public int port { get; set; } = DefaultTcpPort;
        public string mode { get; set; } = "scratchpad";
        public string version { get; set; } = "0.4.0";
        public long lastSeenMs { get; set; }
    }

    public LanManager(Action<string> emitToWebView)
    {
        _emitToWebView = emitToWebView;
    }

    public void HandleWebMessage(JsonElement root)
    {
        if (!root.TryGetProperty("cmd", out var cmdEl)) return;
        var cmd = cmdEl.GetString() ?? "";

        switch (cmd)
        {
            case "lan:getLocalIps":
                EmitJson(new { type = "lan:localIps", ips = GetLocalLanIpv4s() });
                break;

            case "lan:hostStart":
            {
                var roomName = root.TryGetProperty("roomName", out var rn) ? (rn.GetString() ?? "草稿纸对战房") : "草稿纸对战房";
                var hostName = root.TryGetProperty("hostName", out var hn) ? (hn.GetString() ?? "房主") : "房主";
                var mode = root.TryGetProperty("mode", out var md) ? (md.GetString() ?? "scratchpad") : "scratchpad";
                var port = root.TryGetProperty("port", out var pt) && pt.TryGetInt32(out var pVal) ? pVal : DefaultTcpPort;
                StartHosting(roomName, hostName, mode, port);
                break;
            }

            case "lan:hostUpdateBeacon":
            {
                if (root.TryGetProperty("roomName", out var rn)) _roomName = rn.GetString() ?? _roomName;
                if (root.TryGetProperty("mode", out var md)) _hostMode = md.GetString() ?? _hostMode;
                break;
            }

            case "lan:hostStop":
                StopHosting();
                break;

            case "lan:scanStart":
                StartScanning();
                break;

            case "lan:scanStop":
                StopScanning();
                break;

            case "lan:connect":
            {
                var host = root.TryGetProperty("host", out var hEl) ? (hEl.GetString() ?? "").Trim() : "";
                var port = root.TryGetProperty("port", out var pEl) && pEl.TryGetInt32(out var pv) ? pv : DefaultTcpPort;
                if (string.IsNullOrWhiteSpace(host))
                {
                    EmitJson(new { type = "lan:error", message = "请输入有效的局域网 IP 地址" });
                    return;
                }
                _ = ConnectToHostAsync(host, port);
                break;
            }

            case "lan:disconnect":
                ClosePeer("local_disconnect", notifyWeb: false);
                break;

            case "lan:send":
            {
                if (!root.TryGetProperty("payload", out var payloadEl)) return;
                var raw = payloadEl.GetRawText();
                var droppable = root.TryGetProperty("droppable", out var dEl) && dEl.ValueKind == JsonValueKind.True;
                SendToPeer(raw, droppable);
                break;
            }
        }
    }

    private void StartHosting(string roomName, string hostName, string mode, int port)
    {
        StopHosting();
        StopScanning();
        ClosePeer("restart_host", notifyWeb: false);

        _roomId = Guid.NewGuid().ToString("N")[..8];
        _roomName = string.IsNullOrWhiteSpace(roomName) ? "草稿纸对战房" : roomName.Trim();
        _hostName = string.IsNullOrWhiteSpace(hostName) ? "房主" : hostName.Trim();
        _hostMode = mode;
        _hostPort = port > 1024 && port < 65535 ? port : DefaultTcpPort;
        _isHostRole = true;

        try
        {
            _listener = new TcpListener(IPAddress.Any, _hostPort);
            _listener.Server.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
            _listener.Start(4);
        }
        catch (Exception ex)
        {
            EmitJson(new { type = "lan:error", message = $"创建房间失败（端口 {_hostPort} 被占用或防火墙拦截）：{ex.Message}" });
            return;
        }

        _hostCts = new CancellationTokenSource();
        var ct = _hostCts.Token;

        var ips = GetLocalLanIpv4s();
        EmitJson(new
        {
            type = "lan:hostStarted",
            roomId = _roomId,
            port = _hostPort,
            ips
        });

        _ = Task.Run(() => AcceptLoopAsync(_listener, ct), ct);
        _ = Task.Run(() => BeaconLoopAsync(ct), ct);
    }

    private void StopHosting()
    {
        _isHostRole = false;
        try { _hostCts?.Cancel(); } catch { }
        try { _listener?.Stop(); } catch { }
        _listener = null;
        _hostCts?.Dispose();
        _hostCts = null;
        ClosePeer("host_stopped", notifyWeb: false);
    }

    private async Task AcceptLoopAsync(TcpListener listener, CancellationToken ct)
    {
        while (!ct.IsCancellationRequested)
        {
            try
            {
                var client = await listener.AcceptTcpClientAsync(ct);
                ConfigureLowLatencySocket(client);

                // Single 1v1 duel slot: replace stale connection cleanly if any
                ClosePeer("replaced", notifyWeb: false);
                AttachPeer(client, isHost: true);

                var remoteIp = (client.Client.RemoteEndPoint as IPEndPoint)?.Address.ToString() ?? "LAN Peer";
                EmitJson(new { type = "lan:peerConnected", remoteIp });
            }
            catch (OperationCanceledException)
            {
                break;
            }
            catch (ObjectDisposedException)
            {
                break;
            }
            catch
            {
                if (!ct.IsCancellationRequested) await Task.Delay(120, ct);
            }
        }
    }

    private async Task BeaconLoopAsync(CancellationToken ct)
    {
        using var udp = new UdpClient();
        udp.EnableBroadcast = true;

        while (!ct.IsCancellationRequested)
        {
            try
            {
                // Pause beacon spam once a Guest is actively connected (still visible if they leave)
                bool hasPeer;
                lock (_connLock) { hasPeer = _peerClient != null && _peerClient.Connected; }

                if (!hasPeer)
                {
                    var ips = GetLocalLanIpv4s();
                    var primaryIp = ips.Count > 0 ? ips[0] : "127.0.0.1";
                    var beaconJson = JsonSerializer.Serialize(new
                    {
                        magic = "SCRATCHPAD_LAN_V1",
                        roomId = _roomId,
                        roomName = _roomName,
                        hostName = _hostName,
                        hostIp = primaryIp,
                        port = _hostPort,
                        mode = _hostMode,
                        version = "0.4.1"
                    });
                    var bytes = Encoding.UTF8.GetBytes(beaconJson);

                    var targets = GetBroadcastEndpoints(DiscoveryUdpPort);
                    foreach (var ep in targets)
                    {
                        try { await udp.SendAsync(bytes, bytes.Length, ep); } catch { }
                    }
                }
            }
            catch { }

            try { await Task.Delay(900, ct); } catch { break; }
        }
    }

    private void StartScanning()
    {
        StopScanning();
        _rooms.Clear();
        _scanCts = new CancellationTokenSource();
        var ct = _scanCts.Token;

        _ = Task.Run(async () =>
        {
            UdpClient? udp = null;
            try
            {
                udp = new UdpClient();
                udp.ExclusiveAddressUse = false;
                udp.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.ReuseAddress, true);
                udp.Client.Bind(new IPEndPoint(IPAddress.Any, DiscoveryUdpPort));
            }
            catch
            {
                udp?.Dispose();
                return;
            }

            using (udp)
            {
                var pruneTask = Task.Run(async () =>
                {
                    while (!ct.IsCancellationRequested)
                    {
                        var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                        bool changed = false;
                        foreach (var kv in _rooms)
                        {
                            if (now - kv.Value.lastSeenMs > 3800)
                            {
                                if (_rooms.TryRemove(kv.Key, out _)) changed = true;
                            }
                        }
                        if (changed) EmitRoomList();
                        try { await Task.Delay(1000, ct); } catch { break; }
                    }
                }, ct);

                while (!ct.IsCancellationRequested)
                {
                    try
                    {
                        var res = await udp.ReceiveAsync(ct);
                        var text = Encoding.UTF8.GetString(res.Buffer);
                        using var doc = JsonDocument.Parse(text);
                        var root = doc.RootElement;
                        if (!root.TryGetProperty("magic", out var mEl) || mEl.GetString() != "SCRATCHPAD_LAN_V1") continue;

                        var rid = root.TryGetProperty("roomId", out var rEl) ? (rEl.GetString() ?? "") : "";
                        if (string.IsNullOrEmpty(rid)) continue;

                        // Ignore our own room if hosting on the same machine
                        if (_isHostRole && rid == _roomId) continue;

                        var senderIp = res.RemoteEndPoint.Address.MapToIPv4().ToString();
                        var room = new DiscoveredRoom
                        {
                            roomId = rid,
                            roomName = root.TryGetProperty("roomName", out var rn) ? (rn.GetString() ?? "对战房") : "对战房",
                            hostName = root.TryGetProperty("hostName", out var hn) ? (hn.GetString() ?? "房主") : "房主",
                            hostIp = senderIp,
                            port = root.TryGetProperty("port", out var pt) && pt.TryGetInt32(out var pv) ? pv : DefaultTcpPort,
                            mode = root.TryGetProperty("mode", out var md) ? (md.GetString() ?? "scratchpad") : "scratchpad",
                            version = root.TryGetProperty("version", out var ver) ? (ver.GetString() ?? "0.4.0") : "0.4.0",
                            lastSeenMs = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()
                        };
                        _rooms[rid] = room;
                        EmitRoomList();
                    }
                    catch (OperationCanceledException)
                    {
                        break;
                    }
                    catch { }
                }

                try { await pruneTask; } catch { }
            }
        }, ct);
    }

    private void StopScanning()
    {
        try { _scanCts?.Cancel(); } catch { }
        _scanCts?.Dispose();
        _scanCts = null;
    }

    private void EmitRoomList()
    {
        var list = _rooms.Values
            .OrderByDescending(r => r.lastSeenMs)
            .Select(r => new
            {
                r.roomId,
                r.roomName,
                r.hostName,
                r.hostIp,
                r.port,
                r.mode,
                r.version
            })
            .ToArray();
        EmitJson(new { type = "lan:rooms", rooms = list });
    }

    private async Task ConnectToHostAsync(string host, int port)
    {
        StopHosting();
        ClosePeer("reconnecting", notifyWeb: false);

        var client = new TcpClient();
        try
        {
            using var timeoutCts = new CancellationTokenSource(TimeSpan.FromSeconds(5));
            await client.ConnectAsync(host, port, timeoutCts.Token);
            ConfigureLowLatencySocket(client);
            AttachPeer(client, isHost: false);
            StopScanning();
            EmitJson(new { type = "lan:connected", host, port });
        }
        catch (Exception ex)
        {
            try { client.Dispose(); } catch { }
            EmitJson(new { type = "lan:error", message = $"无法连接到 {host}:{port}（请确认两台设备在同一局域网且房主已允许防火墙放行）：{ex.Message}" });
        }
    }

    private void AttachPeer(TcpClient client, bool isHost)
    {
        var cts = new CancellationTokenSource();
        var stream = client.GetStream();
        var reliable = Channel.CreateUnbounded<byte[]>(new UnboundedChannelOptions
        {
            SingleReader = true,
            SingleWriter = false
        });
        var signal = new SemaphoreSlim(0);

        lock (_connLock)
        {
            _peerClient = client;
            _peerStream = stream;
            _peerCts = cts;
            _reliableOut = reliable;
            _latestSnapshotFrame = null;
            _sendSignal = signal;
            _isHostRole = isHost;
        }

        _ = Task.Run(() => PeerReadLoopAsync(stream, cts.Token), cts.Token);
        _ = Task.Run(() => PeerWriteLoopAsync(stream, reliable, signal, cts.Token), cts.Token);
    }

    private void SendToPeer(string jsonPayload, bool droppable)
    {
        var payloadBytes = Encoding.UTF8.GetBytes(jsonPayload);
        if (payloadBytes.Length > MaxPacketBytes) return;

        var framed = new byte[4 + payloadBytes.Length];
        BinaryPrimitives.WriteInt32LittleEndian(framed.AsSpan(0, 4), payloadBytes.Length);
        Buffer.BlockCopy(payloadBytes, 0, framed, 4, payloadBytes.Length);

        Channel<byte[]>? reliable;
        SemaphoreSlim? signal;
        lock (_connLock)
        {
            if (_peerStream == null || _reliableOut == null || _sendSignal == null) return;
            reliable = _reliableOut;
            signal = _sendSignal;
        }

        if (droppable)
        {
            // Latest-only atomic swap: stale 60Hz snapshots NEVER pile up in a queue!
            Interlocked.Exchange(ref _latestSnapshotFrame, framed);
        }
        else
        {
            reliable.Writer.TryWrite(framed);
        }
        try { signal.Release(); } catch { }
    }

    private async Task PeerWriteLoopAsync(NetworkStream stream, Channel<byte[]> reliable, SemaphoreSlim signal, CancellationToken ct)
    {
        try
        {
            while (!ct.IsCancellationRequested)
            {
                await signal.WaitAsync(ct);

                // Drain reliable control/event/input messages first
                while (reliable.Reader.TryRead(out var msg))
                {
                    await stream.WriteAsync(msg, ct);
                }

                // Then flush the single most recent snapshot if present
                var snap = Interlocked.Exchange(ref _latestSnapshotFrame, null);
                if (snap != null)
                {
                    await stream.WriteAsync(snap, ct);
                }
            }
        }
        catch (OperationCanceledException) { }
        catch
        {
            ClosePeer("write_error", notifyWeb: true);
        }
    }

    private async Task PeerReadLoopAsync(NetworkStream stream, CancellationToken ct)
    {
        var lenBuf = new byte[4];
        try
        {
            while (!ct.IsCancellationRequested)
            {
                if (!await ReadExactAsync(stream, lenBuf, 4, ct)) break;
                int len = BinaryPrimitives.ReadInt32LittleEndian(lenBuf);
                if (len <= 0 || len > MaxPacketBytes) break;

                var body = new byte[len];
                if (!await ReadExactAsync(stream, body, len, ct)) break;

                var text = Encoding.UTF8.GetString(body);
                // Wrap without re-parsing JSON for ultra-low CPU overhead!
                _emitToWebView("{\"type\":\"lan:msg\",\"payload\":" + text + "}");
            }
        }
        catch (OperationCanceledException) { }
        catch { }
        finally
        {
            ClosePeer("remote_closed", notifyWeb: true);
        }
    }

    private static async Task<bool> ReadExactAsync(NetworkStream stream, byte[] buf, int count, CancellationToken ct)
    {
        int offset = 0;
        while (offset < count)
        {
            int n = await stream.ReadAsync(buf.AsMemory(offset, count - offset), ct);
            if (n <= 0) return false;
            offset += n;
        }
        return true;
    }

    private void ClosePeer(string reason, bool notifyWeb)
    {
        TcpClient? client;
        CancellationTokenSource? cts;
        SemaphoreSlim? signal;
        bool hadPeer;
        lock (_connLock)
        {
            hadPeer = _peerClient != null;
            client = _peerClient;
            cts = _peerCts;
            signal = _sendSignal;
            _peerClient = null;
            _peerStream = null;
            _peerCts = null;
            _reliableOut = null;
            _latestSnapshotFrame = null;
            _sendSignal = null;
        }

        try { cts?.Cancel(); } catch { }
        try { client?.Close(); } catch { }
        try { client?.Dispose(); } catch { }
        try { cts?.Dispose(); } catch { }
        try { signal?.Dispose(); } catch { }

        if (notifyWeb && hadPeer)
        {
            EmitJson(new { type = "lan:peerDisconnected", reason });
        }
    }

    private static void ConfigureLowLatencySocket(TcpClient client)
    {
        client.NoDelay = true;
        client.SendBufferSize = 64 * 1024;
        client.ReceiveBufferSize = 64 * 1024;
        try
        {
            client.Client.SetSocketOption(SocketOptionLevel.Socket, SocketOptionName.KeepAlive, true);
        }
        catch { }
    }

    private static List<string> GetLocalLanIpv4s()
    {
        var preferred = new List<string>();
        var fallback = new List<string>();
        try
        {
            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.OperationalStatus != OperationalStatus.Up) continue;
                if (nic.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                var desc = (nic.Description + " " + nic.Name).ToLowerInvariant();
                bool isVirtual = desc.Contains("virtual") || desc.Contains("vmware") || desc.Contains("vbox")
                              || desc.Contains("wsl") || desc.Contains("hyper-v") || desc.Contains("loopback")
                              || desc.Contains("tap") || desc.Contains("tun") || desc.Contains("zerotier");

                foreach (var ua in nic.GetIPProperties().UnicastAddresses)
                {
                    if (ua.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                    var ip = ua.Address.ToString();
                    if (ip.StartsWith("127.") || ip.StartsWith("169.254.")) continue;
                    if (!isVirtual) preferred.Add(ip);
                    else fallback.Add(ip);
                }
            }
        }
        catch { }

        preferred.AddRange(fallback);
        return preferred.Distinct().ToList();
    }

    private static List<IPEndPoint> GetBroadcastEndpoints(int port)
    {
        var list = new List<IPEndPoint> { new IPEndPoint(IPAddress.Broadcast, port) };
        try
        {
            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.OperationalStatus != OperationalStatus.Up) continue;
                if (nic.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                foreach (var ua in nic.GetIPProperties().UnicastAddresses)
                {
                    if (ua.Address.AddressFamily != AddressFamily.InterNetwork || ua.IPv4Mask == null) continue;
                    var ipBytes = ua.Address.GetAddressBytes();
                    var maskBytes = ua.IPv4Mask.GetAddressBytes();
                    if (ipBytes[0] == 127 || (ipBytes[0] == 169 && ipBytes[1] == 254)) continue;
                    var bcast = new byte[4];
                    for (int i = 0; i < 4; i++) bcast[i] = (byte)(ipBytes[i] | ~maskBytes[i]);
                    var bIp = new IPAddress(bcast);
                    if (!list.Any(e => e.Address.Equals(bIp)))
                    {
                        list.Add(new IPEndPoint(bIp, port));
                    }
                }
            }
        }
        catch { }
        return list;
    }

    private void EmitJson(object obj)
    {
        var json = JsonSerializer.Serialize(obj);
        _emitToWebView(json);
    }

    public void Dispose()
    {
        StopScanning();
        StopHosting();
    }
}
