#!/usr/bin/env node
import { spawn } from 'node:child_process';
import process from 'node:process';

const args = process.argv.slice(2);
let timeoutMinutes = 10;
let maxAttempts = 2;
let retryDelaySeconds = 5;
let retryOn = 'timeout';
const separatorIndex = args.indexOf('--');

if (separatorIndex < 0 || separatorIndex === args.length - 1) {
  throw new Error('Usage: node scripts/test/run-with-retry.mjs [options] -- <command> [args...]');
}

const optionArgs = args.slice(0, separatorIndex);
const commandArgs = args.slice(separatorIndex + 1);

for (let index = 0; index < optionArgs.length; index += 1) {
  const option = optionArgs[index];
  const value = optionArgs[index + 1];
  switch (option) {
    case '--timeout-minutes':
      timeoutMinutes = Number(value);
      index += 1;
      break;
    case '--max-attempts':
      maxAttempts = Number(value);
      index += 1;
      break;
    case '--retry-delay-seconds':
      retryDelaySeconds = Number(value);
      index += 1;
      break;
    case '--retry-on':
      retryOn = value;
      index += 1;
      break;
    default:
      throw new Error(`Unknown option '${option}'.`);
  }
}

if (!Number.isFinite(timeoutMinutes) || timeoutMinutes <= 0) {
  throw new Error(`Invalid --timeout-minutes value '${timeoutMinutes}'.`);
}
if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
  throw new Error(`Invalid --max-attempts value '${maxAttempts}'.`);
}
if (!Number.isFinite(retryDelaySeconds) || retryDelaySeconds < 0) {
  throw new Error(`Invalid --retry-delay-seconds value '${retryDelaySeconds}'.`);
}
if (!['timeout', 'any'].includes(retryOn)) {
  throw new Error(`Unsupported --retry-on value '${retryOn}'.`);
}

const [command, ...commandTail] = commandArgs;
const timeoutMs = timeoutMinutes * 60 * 1000;

function sleep(delayMs) {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

function spawnAndWait(commandName, commandLine) {
  return new Promise(resolve => {
    const child = spawn(commandName, commandLine, {
      stdio: 'inherit',
      shell: false,
      detached: process.platform !== 'win32',
    });

    let settled = false;
    let timedOut = false;
    const finish = result => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      resolve(result);
    };

    const timer = setTimeout(async () => {
      timedOut = true;
      await terminateProcessTree(child);
      finish({ exitCode: 124, timedOut: true });
    }, timeoutMs);

    child.once('error', error => {
      finish({ exitCode: 1, timedOut: false, error });
    });
    child.once('exit', (code, signal) => {
      if (timedOut) {
        return;
      }

      if (signal) {
        finish({ exitCode: 1, timedOut: false, signal });
        return;
      }

      finish({ exitCode: code ?? 1, timedOut: false });
    });
  });
}

async function terminateProcessTree(child) {
  if (!child.pid) {
    return;
  }

  if (process.platform === 'win32') {
    await new Promise(resolve => {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
        stdio: 'inherit',
        shell: false,
      });
      killer.once('exit', () => resolve());
      killer.once('error', () => resolve());
    });
    return;
  }

  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      return;
    }
  }

  await sleep(5_000);
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // Ignore failures during forced termination.
    }
  }
}

for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
  console.log(`Starting attempt ${attempt}/${maxAttempts}: ${command} ${commandTail.join(' ')}`);
  const result = await spawnAndWait(command, commandTail);
  if (result.error) {
    console.error(String(result.error));
  }
  if (result.signal) {
    console.error(`Process exited due to signal '${result.signal}'.`);
  }

  if (result.exitCode === 0) {
    process.exit(0);
  }

  const shouldRetry = attempt < maxAttempts && (retryOn === 'any' || result.timedOut);
  if (!shouldRetry) {
    process.exit(result.exitCode ?? 1);
  }

  const reason = result.timedOut ? 'timeout' : `exit code ${result.exitCode ?? 1}`;
  console.warn(`Attempt ${attempt}/${maxAttempts} ended with ${reason}. Retrying in ${retryDelaySeconds}s...`);
  await sleep(retryDelaySeconds * 1000);
}
