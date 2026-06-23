#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

// Upstream wraps the regex in new RegExp(...), which prevents Babel's
// transform-named-capturing-groups-regex plugin from statically detecting
// the named capture group. Convert it to a RegExp literal so Babel can
// transpile .groups access for legacy browsers.
const ORIGINAL_LINE = 'const blazorCommentRegularExpression = new RegExp(/^\\s*Blazor:[^{]*(?<descriptor>.*)$/);';
const REPLACEMENT_LINE = 'const blazorCommentRegularExpression = /^\\s*Blazor:[^{]*(?<descriptor>.*)$/;';

export async function patchBlazorRegex(filePath) {
  const content = await readFile(filePath, 'utf8');

  if (content.includes(REPLACEMENT_LINE)) {
    console.log('blazorCommentRegularExpression already uses a RegExp literal; skipping.');
    return;
  }

  if (!content.includes(ORIGINAL_LINE)) {
    console.warn('Could not locate blazorCommentRegularExpression; patch not applied.');
    return;
  }

  const patched = content.replace(ORIGINAL_LINE, REPLACEMENT_LINE);
  await writeFile(filePath, patched);
  console.log('Patched blazorCommentRegularExpression to use a RegExp literal.');
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error('Usage: patch-blazor-regex.mjs <ComponentDescriptorDiscovery.ts path>');
  }

  await patchBlazorRegex(filePath);
}
