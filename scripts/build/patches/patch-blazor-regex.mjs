#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

export async function patchBlazorRegex(filePath) {
  let content = await readFile(filePath, 'utf8');

  const originalLine = 'const blazorCommentRegularExpression = new RegExp(/^\\s*Blazor:[^{]*(?<descriptor>.*)$/);';
  const replacement = `// LegacyBlazorJs patch: keep this as a RegExp literal instead of new RegExp(...).
// See scripts/build/patches/patch-blazor-regex.mjs for the full explanation.
const blazorCommentRegularExpression = /^\\s*Blazor:[^{]*(.*)$/;`;

  if (content.includes(originalLine)) {
    content = content.replace(originalLine, replacement);
    content = content.replace(
      "const json = definition && definition.groups && definition.groups['descriptor'];",
      'const json = definition && definition[1];');
    await writeFile(filePath, content);
    console.log('Patched blazorCommentRegularExpression to use a RegExp literal.');
    return;
  }

  if (content.includes('const blazorCommentRegularExpression = /^\\s*Blazor:')) {
    content = content.replace(
      'const blazorCommentRegularExpression = /^\\s*Blazor:[^{]*(?<descriptor>.*)$/;',
      'const blazorCommentRegularExpression = /^\\s*Blazor:[^{]*(.*)$/;');
    content = content.replace(
      "const json = definition && definition.groups && definition.groups['descriptor'];",
      'const json = definition && definition[1];');
    await writeFile(filePath, content);
    console.log('blazorCommentRegularExpression already uses a RegExp literal; skipping.');
    return;
  }

  console.warn('Could not locate blazorCommentRegularExpression; patch not applied.');
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error('Usage: patch-blazor-regex.mjs <ComponentDescriptorDiscovery.ts path>');
  }

  await patchBlazorRegex(filePath);
}
