#!/usr/bin/env node
import { access, mkdir, readFile, rm } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { run } from './lib/process.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const distRoot = path.join(rootDir, 'dist');
const releaseDir = path.join(rootDir, 'artifacts', 'releases');
const summaryPath = path.join(rootDir, 'artifacts', 'packages', 'build-summary.json');

function sanitizePathSegment(value) {
  return value.replace(/[^0-9A-Za-z._-]+/g, '-');
}

const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
if (!Array.isArray(summary.builds) || summary.builds.length === 0) {
  throw new Error(`No builds were found in '${summaryPath}'.`);
}

await rm(releaseDir, { recursive: true, force: true });
await mkdir(releaseDir, { recursive: true });

for (const build of summary.builds) {
  if (!build?.version || !build?.upstreamRef) {
    throw new Error(`Each build entry must include version and upstreamRef. Received: ${JSON.stringify(build)}`);
  }

  const sourceDir = path.join(distRoot, sanitizePathSegment(build.upstreamRef));
  await access(sourceDir, fsConstants.R_OK);

  const archiveName = `LegacyBlazorJs.${build.version}.zip`;
  const archivePath = path.join(releaseDir, archiveName);
  await run('zip', ['-qr', archivePath, '.'], { cwd: sourceDir });
  console.log(`Created ${archiveName}`);
}
