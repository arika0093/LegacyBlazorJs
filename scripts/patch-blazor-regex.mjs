#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

const filePath = process.argv[2];
if (!filePath) {
  throw new Error('Usage: patch-blazor-regex.mjs <ComponentDescriptorDiscovery.ts path>');
}

let content = await readFile(filePath, 'utf8');

// The upstream source wraps a RegExp literal in new RegExp(...).  That is legal TypeScript,
// but it interacts badly with Babel's named-capturing-groups transform when the output is
// down-leveled for ES2017 and earlier.
//
// Babel's plugin transforms a RegExpLiteral such as /...(?<descriptor>...)/ into a call to
// _wrapRegExp(regex, { descriptor: 1 }).  _wrapRegExp returns a BabelRegExp instance whose
// .groups property is populated by an overridden exec() method, so code that reads
// result.groups.descriptor continues to work on browsers that do not support named groups.
//
// However, when the original source is `new RegExp(/.../)`, Babel only transforms the inner
// RegExpLiteral and leaves the outer `new RegExp(...)` intact.  The generated code becomes
// `new RegExp(/*#__PURE__*/_wrapRegExp(...))`.  Executing `new RegExp(babelRegExp)` creates a
// plain RegExp copy, which drops the BabelRegExp prototype and therefore loses the .groups
// property on browsers without native named-capture support (the ES2017 target set:
// Chrome 58, Edge 16, Firefox 54, Safari 11).
//
// Blazor Server relies on matching <!--Blazor:{...}--> markers with this regex during startup.
// When .groups is undefined, no components are discovered and auto-start silently fails.
//
// Using a RegExp literal directly lets Babel emit `/*#__PURE__*/_wrapRegExp(...)` without the
// outer `new RegExp(...)` wrapper, preserving the BabelRegExp behavior on older browsers.
const originalLine = 'const blazorCommentRegularExpression = new RegExp(/^\\s*Blazor:[^{]*(?<descriptor>.*)$/);';
const replacement = `// LegacyBlazorJs patch: keep this as a RegExp literal instead of new RegExp(...).
// See scripts/patch-blazor-regex.mjs for the full explanation.
const blazorCommentRegularExpression = /^\\s*Blazor:[^{]*(?<descriptor>.*)$/;`;

if (content.includes(originalLine)) {
  content = content.replace(originalLine, replacement);
  await writeFile(filePath, content);
  console.log('Patched blazorCommentRegularExpression to use a RegExp literal.');
} else if (content.includes('const blazorCommentRegularExpression = /^\\s*Blazor:')) {
  console.log('blazorCommentRegularExpression already uses a RegExp literal; skipping.');
} else {
  console.warn('Could not locate blazorCommentRegularExpression; patch not applied.');
}
