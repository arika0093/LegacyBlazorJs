#!/usr/bin/env node
import { access } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readSelectedTargets } from './lib/config.mjs';
import { run } from './lib/process.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const defaultOutputDir = path.join(rootDir, 'dotnet', 'src', 'LegacyBlazorJs', 'wwwroot');
const require = createRequire(import.meta.url);
const esCheckCliPath = path.join(path.dirname(require.resolve('es-check')), 'cli', 'index.js');

function resolveEsCheckTarget(profile) {
  return profile.ecma <= 5 ? 'es5' : `es${profile.ecma}`;
}

async function resolveProfileFiles(outputDir, profileName) {
  const files = [
    path.join(outputDir, `blazor.web.${profileName}.js`),
    path.join(outputDir, `blazor.server.${profileName}.js`),
  ];

  await Promise.all(files.map(filePath => access(filePath)));
  return files;
}

export async function runEsCheck({ outputDir = defaultOutputDir, targets } = {}) {
  const selectedTargets = targets ?? await readSelectedTargets();

  for (const [profileName, profile] of Object.entries(selectedTargets)) {
    const target = resolveEsCheckTarget(profile);
    const files = await resolveProfileFiles(outputDir, profileName);
    console.log(`****** ES Check "${profileName}" (target: ${target}) ******`);
    await run(process.execPath, [esCheckCliPath, target, ...files], {
      cwd: rootDir,
    });
  }
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  await runEsCheck({
    outputDir: process.argv[2] ? path.resolve(process.argv[2]) : defaultOutputDir,
  });
}
