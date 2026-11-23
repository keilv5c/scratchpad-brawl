/**
 * Lightweight zero-dependency WebSocket LAN Dev Relay (RFC6455, port 27892).
 * Used ONLY for browser-mode development/testing (InkbladeDuel.exe uses native C# TCP_NODELAY directly!).
 */
import http from 'node:http';
import crypto from 'node:crypto';

const PORT = Number(process.env.LAN_RELAY_PORT || 27892);
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

/** @type {Map<string, { host?: any; guest?: any }>} */
const rooms = new Map();

function encodeWsText(str) {
  const payload = Buffer.from(str, 'utf8');
  const len = payload.length;
  let header;
  if (len < 126) {
    header = Buffer.alloc(2);
    header[0] = 0x81;
    header[1] = len;
  } else if (len < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(len, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x81;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(len), 2);
  }
  return Buffer.concat([header, payload]);
}

function attachWsReader(socket, onText, onClose) {
  let buf = Buffer.alloc(0);
  socket.on('data', (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const opcode = buf[0] & 0x0f;
      const masked = (buf[1] & 0x80) !== 0;
      let len = buf[1] & 0x7f;
      let offset = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        offset = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        offset = 10;
      }
      const need = offset + (masked ? 4 : 0) + len;
      if (buf.length < need) return;

      let payload;
      if (masked) {
        const mask = buf.subarray(offset, offset + 4);
        payload = Buffer.alloc(len);
        const start = offset + 4;
        for (let i = 0; i < len; i++) {
          payload[i] = buf[start + i] ^ mask[i & 3];
        }
      } else {
        payload = buf.subarray(offset, offset + len);
      }
      buf = buf.subarray(need);

      if (opcode === 0x8) {
        socket.end();
        return;
      }
      if (opcode === 0x9) {
        // Pong
        const pong = Buffer.from([0x8a, payload.length, ...payload]);
        socket.write(pong);
        continue;
      }
      if (opcode === 0x1) {
        onText(payload.toString('utf8'));
      }
    }
  });
  socket.on('close', onClose);
  socket.on('error', () => onClose());
}

const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Scratchpad Brawl LAN Dev Relay OK\n');
});

server.on('upgrade', (req, socket) => {
  const key = req.headers['sec-websocket-key'];
  if (!key) {
    socket.destroy();
    return;
  }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.setNoDelay(true);
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
      'Upgrade: websocket\r\n' +
      'Connection: Upgrade\r\n' +
      `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );

  const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
  const role = url.searchParams.get('role') === 'guest' ? 'guest' : 'host';
  const roomKey = url.searchParams.get('room') || 'default';
  // If guest connects with default 'dev' room, auto-match first waiting host!
  let targetKey = roomKey;
  if (role === 'guest' && !rooms.has(targetKey)) {
    for (const [k, r] of rooms.entries()) {
      if (r.host && !r.guest) {
        targetKey = k;
        break;
      }
    }
  }
  if (!rooms.has(targetKey)) rooms.set(targetKey, {});
  const room = rooms.get(targetKey);
  room[role] = socket;

  const sendSafe = (sock, text) => {
    if (sock && !sock.destroyed) {
      try {
        sock.write(encodeWsText(text));
      } catch {
        // ignore closed socket
      }
    }
  };

  if (room.host && room.guest) {
    sendSafe(room.host, JSON.stringify({ type: 'relay:paired', remote: 'Browser Guest' }));
    sendSafe(room.guest, JSON.stringify({ type: 'relay:paired', remote: 'Browser Host' }));
  }

  let closed = false;
  const handleClose = () => {
    if (closed) return;
    closed = true;
    if (room[role] === socket) delete room[role];
    const other = role === 'host' ? room.guest : room.host;
    if (other) sendSafe(other, JSON.stringify({ type: 'relay:peer_left' }));
    if (!room.host && !room.guest) rooms.delete(targetKey);
  };

  attachWsReader(
    socket,
    (text) => {
      const other = role === 'host' ? room.guest : room.host;
      if (other) sendSafe(other, text);
    },
    handleClose
  );
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[LAN Dev Relay] listening on ws://127.0.0.1:${PORT}`);
});
