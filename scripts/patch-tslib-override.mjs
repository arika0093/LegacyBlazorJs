#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

const packageJsonPath = process.argv[2];
if (!packageJsonPath) {
  throw new Error('Usage: patch-tslib-override.mjs <package.json path>');
}

const content = await readFile(packageJsonPath, 'utf8');
const packageJson = JSON.parse(content);

if (!packageJson.overrides) {
  packageJson.overrides = {};
}

// Force a tslib version that includes helpers required for ES5 down-leveling (e.g. __spreadArray).
packageJson.overrides.tslib = '^2.4.0';

await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`);
console.log('Patched workspace package.json to use tslib ^2.4.0.');
