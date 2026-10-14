import {spawn} from 'node:child_process';
export function nativePort(command, origin, env = process.env) {
  const child = spawn(command, [origin], {env, stdio: ['pipe', 'pipe', 'ignore'], shell: false});
  let buffer = Buffer.alloc(0), closed = false, reap;
  const listeners = () => { const list = new Set(); return {addListener: fn => list.add(fn), emit: value => { for (const fn of list) fn(value); }}; };
  const port = {onMessage: listeners(), onDisconnect: listeners(),
    postMessage(frame) {
      if (closed) throw new Error('DISCONNECTED');
      const bytes = Buffer.from(JSON.stringify(frame));
      if (!bytes.length || bytes.length > 1048576) throw new Error('FRAME_TOO_LARGE');
      const header = Buffer.alloc(4); header.writeUInt32LE(bytes.length);
      child.stdin.write(Buffer.concat([header, bytes]));
    },
    disconnect() {
      if (closed) return; closed = true; child.stdin.destroy(); child.kill();
      reap = setTimeout(() => child.kill('SIGKILL'), 2000); reap.unref(); port.onDisconnect.emit();
    }
  };
  child.stdout.on('data', bytes => {
    if (closed) return;
    try {
      buffer = Buffer.concat([buffer, bytes]);
      while (buffer.length >= 4) {
        const length = buffer.readUInt32LE();
        if (!length || length > 1048576) throw new Error('INVALID_FRAME_SIZE');
        if (buffer.length < length + 4) break;
        const text = new TextDecoder('utf-8', {fatal: true}).decode(buffer.subarray(4, length + 4));
        buffer = buffer.subarray(length + 4); port.onMessage.emit(JSON.parse(text));
      }
      if (buffer.length > 1048580) throw new Error('FRAME_TOO_LARGE');
    } catch { port.disconnect(); }
  });
  child.once('error', () => port.disconnect()); child.once('exit', () => { port.disconnect(); clearTimeout(reap); });
  child.stdin.on('error', () => port.disconnect());
  return port;
}
