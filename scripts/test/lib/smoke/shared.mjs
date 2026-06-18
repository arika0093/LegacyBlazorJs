import { access, chmod, rm } from 'node:fs/promises';
import net from 'node:net';
import process from 'node:process';

export class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TimeoutError';
  }
}

export function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

export async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(error => {
        if (error) {
          reject(error);
          return;
        }

        if (port === null) {
          reject(new Error('Could not determine an available TCP port.'));
          return;
        }

        resolve(port);
      });
    });
  });
}

export async function ensureExecutablePermissions(executablePath) {
  if (process.platform !== 'win32' && await fileExists(executablePath)) {
    try {
      await chmod(executablePath, 0o755);
    } catch (error) {
      if (error?.code !== 'EPERM' && error?.code !== 'EACCES') {
        throw error;
      }
    }
  }
}

export async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function removeDirectory(directoryPath) {
  await rm(directoryPath, {
    recursive: true,
    force: true,
    maxRetries: 20,
    retryDelay: 250,
  });
}

export function parseBrowserMajor(versionText) {
  const match = /^(\d+)\./.exec(versionText ?? '');
  return match ? Number(match[1]) : null;
}

export function toFiniteInteger(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : null;
}

export function parseCounterValue(text) {
  const match = /Current count:\s*(\d+)/.exec(text ?? '');
  return match ? Number(match[1]) : 0;
}

export function createId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().replaceAll('-', '')
    : `${Date.now()}${Math.random().toString(16).slice(2)}`;
}

export function quotePowerShellString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}
