#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

const validLogLevels = new Map([
  ['trace', 'Trace'],
  ['debug', 'Debug'],
  ['information', 'Information'],
  ['warning', 'Warning'],
  ['error', 'Error'],
  ['critical', 'Critical'],
]);

export function resolveSignalRLogLevel(logLevel) {
  const normalized = logLevel?.trim();
  if (!normalized) {
    return null;
  }

  const resolved = validLogLevels.get(normalized.toLowerCase());
  if (!resolved) {
    throw new Error(`Invalid SIGNALR_LOGGING value '${logLevel}'. Expected one of: ${[...validLogLevels.values()].join(', ')}.`);
  }

  return resolved;
}

export async function patchSignalRLogging(filePath, logLevel = process.env.SIGNALR_LOGGING) {
  const resolvedLogLevel = resolveSignalRLogLevel(logLevel);
  if (!resolvedLogLevel) {
    return false;
  }

  const content = await readFile(filePath, 'utf8');
  const patchedContent = content.replace(
    /^(\s*logLevel:\s*)LogLevel\.[A-Za-z]+(,\s*)$/m,
    `$1LogLevel.${resolvedLogLevel}$2`);

  if (patchedContent === content) {
    console.warn(`Could not locate the CircuitStartOptions logLevel assignment in '${filePath}'; patch not applied.`);
    return false;
  }

  await writeFile(filePath, patchedContent);
  console.log(`Patched SignalR circuit logLevel to LogLevel.${resolvedLogLevel}.`);
  return true;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error('Usage: patch-signalr-logging.mjs <CircuitStartOptions.ts path> [log-level]');
  }

  await patchSignalRLogging(filePath, process.argv[3] ?? process.env.SIGNALR_LOGGING);
}
