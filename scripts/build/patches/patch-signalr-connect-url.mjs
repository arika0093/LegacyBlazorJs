#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

export async function patchSignalRConnectUrl(filePath) {
  let content = await readFile(filePath, 'utf8');

  if (content.includes('id=${encodeURIComponent(connectionToken)}')) {
    console.log('SignalR connect URL encoding already patched.');
    return;
  }

  const original = '        return url + (url.indexOf("?") === -1 ? "?" : "&") + `id=${connectionToken}`;';
  const patched = '        return url + (url.indexOf("?") === -1 ? "?" : "&") + `id=${encodeURIComponent(connectionToken)}`;';

  if (!content.includes(original)) {
    console.warn('Could not locate SignalR _createConnectUrl implementation; patch not applied.');
    return;
  }

  content = content.replace(original, patched);
  await writeFile(filePath, content);
  console.log('Patched SignalR _createConnectUrl to encode the connection token.');
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error('Usage: patch-signalr-connect-url.mjs <HttpConnection.ts path>');
  }

  await patchSignalRConnectUrl(filePath);
}
