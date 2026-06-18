import { createHash, randomBytes } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';

const DEVTOOLS_CONNECT_TIMEOUT_MS = 15_000;
const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';

export class WebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;

  #url;
  #socket = null;
  #listeners = new Map();
  #handshakeBuffer = Buffer.alloc(0);
  #frameBuffer = Buffer.alloc(0);
  #messageFragments = [];
  #fragmentOpcode = null;
  #closeCode = 1006;
  #closeReason = '';
  #closeEmitted = false;

  readyState = WebSocket.CONNECTING;

  constructor(endpoint) {
    this.#url = new URL(endpoint);
    this.#connect();
  }

  addEventListener(type, callback, options = {}) {
    if (typeof callback !== 'function' && typeof callback?.handleEvent !== 'function') {
      return;
    }

    const listeners = this.#listeners.get(type) ?? [];
    listeners.push({ callback, once: Boolean(options.once) });
    this.#listeners.set(type, listeners);
  }

  removeEventListener(type, callback) {
    const listeners = this.#listeners.get(type);
    if (!listeners) {
      return;
    }

    this.#listeners.set(type, listeners.filter(listener => listener.callback !== callback));
  }

  send(data) {
    if (this.readyState !== WebSocket.OPEN || !this.#socket) {
      throw new Error('WebSocket is not open.');
    }

    const payload = Buffer.isBuffer(data) ? data : Buffer.from(String(data), 'utf8');
    const frame = createWebSocketFrame(0x1, payload, true);
    this.#socket.write(frame);
  }

  close(code = 1000, reason = '') {
    if (this.readyState === WebSocket.CLOSED) {
      return;
    }

    this.#closeCode = code;
    this.#closeReason = reason;
    if (this.readyState === WebSocket.CONNECTING) {
      this.readyState = WebSocket.CLOSING;
      this.#socket?.destroy();
      return;
    }

    if (this.readyState === WebSocket.OPEN && this.#socket) {
      this.readyState = WebSocket.CLOSING;
      const codeBuffer = Buffer.alloc(2);
      codeBuffer.writeUInt16BE(code, 0);
      const reasonBuffer = Buffer.from(reason, 'utf8');
      this.#socket.write(createWebSocketFrame(0x8, Buffer.concat([codeBuffer, reasonBuffer]), true));
      this.#socket.end();
    }
  }

  #connect() {
    const port = Number(this.#url.port || (this.#url.protocol === 'wss:' ? 443 : 80));
    const requestPath = `${this.#url.pathname || '/'}${this.#url.search}`;
    const key = randomBytes(16).toString('base64');
    const expectedAccept = createHash('sha1')
      .update(`${key}${WEBSOCKET_GUID}`)
      .digest('base64');
    const hostHeader = this.#buildHostHeader(port);
    const originScheme = this.#url.protocol === 'wss:' ? 'https' : 'http';
    const handshakeRequest = [
      `GET ${requestPath} HTTP/1.1`,
      `Host: ${hostHeader}`,
      'Connection: Upgrade',
      'Upgrade: websocket',
      'Sec-WebSocket-Version: 13',
      `Sec-WebSocket-Key: ${key}`,
      `Origin: ${originScheme}://${hostHeader}`,
      '',
      '',
    ].join('\r\n');

    const socket = this.#url.protocol === 'wss:'
      ? tls.connect({ host: this.#url.hostname, port, rejectUnauthorized: false })
      : net.connect({ host: this.#url.hostname, port });
    this.#socket = socket;
    socket.setNoDelay(true);

    socket.on(this.#url.protocol === 'wss:' ? 'secureConnect' : 'connect', () => {
      socket.write(handshakeRequest);
    });
    socket.on('data', chunk => {
      try {
        if (this.readyState === WebSocket.CONNECTING) {
          this.#consumeHandshakeChunk(chunk, expectedAccept);
          return;
        }

        this.#consumeFrameChunk(chunk);
      } catch (error) {
        this.#closeCode = 1002;
        this.#closeReason = error instanceof Error ? error.message : String(error);
        this.readyState = WebSocket.CLOSING;
        this.#emit('error', { error });
        socket.destroy();
      }
    });
    socket.on('error', error => {
      if (this.readyState !== WebSocket.CLOSED) {
        this.#emit('error', { error });
      }
    });
    socket.on('close', () => {
      this.#finalizeClose();
    });
    socket.on('end', () => {
      this.#finalizeClose();
    });
  }

  #buildHostHeader(port) {
    const isDefaultPort = (this.#url.protocol === 'ws:' && port === 80) ||
      (this.#url.protocol === 'wss:' && port === 443);
    return isDefaultPort ? this.#url.hostname : `${this.#url.hostname}:${port}`;
  }

  #consumeHandshakeChunk(chunk, expectedAccept) {
    this.#handshakeBuffer = Buffer.concat([this.#handshakeBuffer, chunk]);
    const headerEnd = this.#handshakeBuffer.indexOf('\r\n\r\n');
    if (headerEnd === -1) {
      return;
    }

    const headerText = this.#handshakeBuffer.subarray(0, headerEnd).toString('utf8');
    const remaining = this.#handshakeBuffer.subarray(headerEnd + 4);
    this.#handshakeBuffer = Buffer.alloc(0);
    this.#verifyHandshakeResponse(headerText, expectedAccept);
    this.readyState = WebSocket.OPEN;
    this.#emit('open', {});
    if (remaining.length > 0) {
      this.#consumeFrameChunk(remaining);
    }
  }

  #verifyHandshakeResponse(headerText, expectedAccept) {
    const [statusLine, ...headerLines] = headerText.split('\r\n');
    if (!/^HTTP\/1\.[01] 101\b/.test(statusLine ?? '')) {
      throw new Error(`Unexpected WebSocket handshake response: ${statusLine ?? 'missing status line'}`);
    }

    const headers = new Map();
    for (const line of headerLines) {
      const separatorIndex = line.indexOf(':');
      if (separatorIndex === -1) {
        continue;
      }

      headers.set(
        line.slice(0, separatorIndex).trim().toLowerCase(),
        line.slice(separatorIndex + 1).trim());
    }

    if ((headers.get('upgrade') ?? '').toLowerCase() !== 'websocket') {
      throw new Error('WebSocket handshake did not upgrade the connection.');
    }

    const accept = headers.get('sec-websocket-accept');
    if (accept !== expectedAccept) {
      throw new Error('WebSocket handshake returned an unexpected accept token.');
    }
  }

  #consumeFrameChunk(chunk) {
    this.#frameBuffer = Buffer.concat([this.#frameBuffer, chunk]);
    while (true) {
      const frame = readWebSocketFrame(this.#frameBuffer);
      if (!frame) {
        return;
      }

      this.#frameBuffer = this.#frameBuffer.subarray(frame.bytesConsumed);
      this.#handleFrame(frame);
    }
  }

  #handleFrame(frame) {
    switch (frame.opcode) {
      case 0x0:
        this.#messageFragments.push(frame.payload);
        if (frame.fin && this.#fragmentOpcode === 0x1) {
          const data = Buffer.concat(this.#messageFragments).toString('utf8');
          this.#messageFragments = [];
          this.#fragmentOpcode = null;
          this.#emit('message', { data });
        }
        return;
      case 0x1:
        if (frame.fin) {
          this.#emit('message', { data: frame.payload.toString('utf8') });
          return;
        }

        this.#fragmentOpcode = 0x1;
        this.#messageFragments = [frame.payload];
        return;
      case 0x8:
        if (frame.payload.length >= 2) {
          this.#closeCode = frame.payload.readUInt16BE(0);
          this.#closeReason = frame.payload.subarray(2).toString('utf8');
        }
        if (this.readyState === WebSocket.OPEN && this.#socket) {
          this.readyState = WebSocket.CLOSING;
          this.#socket.end(createWebSocketFrame(0x8, frame.payload, true));
        }
        return;
      case 0x9:
        this.#socket?.write(createWebSocketFrame(0xA, frame.payload, true));
        return;
      case 0xA:
        return;
      default:
        throw new Error(`Unsupported WebSocket opcode '${frame.opcode}'.`);
    }
  }

  #emit(type, event) {
    const listeners = [...(this.#listeners.get(type) ?? [])];
    if (listeners.length === 0) {
      return;
    }

    for (const listener of listeners) {
      if (listener.once) {
        this.removeEventListener(type, listener.callback);
      }

      if (typeof listener.callback === 'function') {
        listener.callback(event);
      } else {
        listener.callback.handleEvent(event);
      }
    }
  }

  #finalizeClose() {
    if (this.#closeEmitted) {
      return;
    }

    this.readyState = WebSocket.CLOSED;
    this.#closeEmitted = true;
    this.#emit('close', {
      code: this.#closeCode,
      reason: this.#closeReason,
      wasClean: this.#closeCode === 1000,
    });
  }
}

export async function openWebSocket(endpoint) {
  const socket = new WebSocket(endpoint);
  await waitForWebSocketOpen(socket);
  return socket;
}

export async function closeWebSocket(socket) {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }

  await new Promise(resolve => {
    const timeout = setTimeout(resolve, 1_000);
    socket.addEventListener('close', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    socket.close(1000, 'disposing');
  });
}

async function waitForWebSocketOpen(socket) {
  if (socket.readyState === WebSocket.OPEN) {
    return;
  }

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for the DevTools WebSocket connection.'));
    }, DEVTOOLS_CONNECT_TIMEOUT_MS);

    const handleOpen = () => {
      cleanup();
      resolve();
    };
    const handleClose = () => {
      cleanup();
      reject(new Error('DevTools WebSocket closed before it opened.'));
    };
    const handleError = () => {
      cleanup();
      reject(new Error('DevTools WebSocket failed to open.'));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener('open', handleOpen);
      socket.removeEventListener('close', handleClose);
      socket.removeEventListener('error', handleError);
    };

    socket.addEventListener('open', handleOpen, { once: true });
    socket.addEventListener('close', handleClose, { once: true });
    socket.addEventListener('error', handleError, { once: true });
  });
}

function createWebSocketFrame(opcode, payload, maskClientPayload) {
  const payloadLength = payload.length;
  let headerLength = 2;
  if (payloadLength >= 126 && payloadLength <= 0xffff) {
    headerLength += 2;
  } else if (payloadLength > 0xffff) {
    headerLength += 8;
  }

  const maskLength = maskClientPayload ? 4 : 0;
  const frame = Buffer.alloc(headerLength + maskLength + payloadLength);
  frame[0] = 0x80 | opcode;

  let offset = 2;
  if (payloadLength < 126) {
    frame[1] = payloadLength;
  } else if (payloadLength <= 0xffff) {
    frame[1] = 126;
    frame.writeUInt16BE(payloadLength, offset);
    offset += 2;
  } else {
    frame[1] = 127;
    frame.writeBigUInt64BE(BigInt(payloadLength), offset);
    offset += 8;
  }

  if (maskClientPayload) {
    frame[1] |= 0x80;
    const mask = randomBytes(4);
    mask.copy(frame, offset);
    offset += 4;
    for (let index = 0; index < payloadLength; index += 1) {
      frame[offset + index] = payload[index] ^ mask[index % mask.length];
    }
    return frame;
  }

  payload.copy(frame, offset);
  return frame;
}

function readWebSocketFrame(buffer) {
  if (buffer.length < 2) {
    return null;
  }

  const firstByte = buffer[0];
  const secondByte = buffer[1];
  const fin = (firstByte & 0x80) !== 0;
  const opcode = firstByte & 0x0f;
  const masked = (secondByte & 0x80) !== 0;
  let payloadLength = secondByte & 0x7f;
  let offset = 2;

  if (payloadLength === 126) {
    if (buffer.length < offset + 2) {
      return null;
    }

    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (buffer.length < offset + 8) {
      return null;
    }

    payloadLength = Number(buffer.readBigUInt64BE(offset));
    offset += 8;
  }

  const maskLength = masked ? 4 : 0;
  if (buffer.length < offset + maskLength + payloadLength) {
    return null;
  }

  const mask = masked ? buffer.subarray(offset, offset + 4) : null;
  offset += maskLength;

  const payload = Buffer.from(buffer.subarray(offset, offset + payloadLength));
  if (mask) {
    for (let index = 0; index < payload.length; index += 1) {
      payload[index] ^= mask[index % mask.length];
    }
  }

  return {
    fin,
    opcode,
    payload,
    bytesConsumed: offset + payloadLength,
  };
}
