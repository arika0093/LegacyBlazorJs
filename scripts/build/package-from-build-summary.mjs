#!/usr/bin/env node
import { cp, mkdir, readdir, readFile, rm, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from './lib/process.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const packagesDir = path.join(rootDir, 'artifacts', 'packages');
const summaryPath = path.join(packagesDir, 'build-summary.json');
const distRoot = path.join(rootDir, 'dist');
const packageWwwroot = path.join(rootDir, 'src', 'LegacyBlazorJs', 'wwwroot');

function sanitizePathSegment(value) {
  return value.replace(/[^0-9A-Za-z._-]+/g, '-');
}

function resolveTargetFramework(build) {
  if (build?.major && Number.isFinite(Number(build.major))) {
    return `net${Number(build.major)}.0`;
  }

  const majorMatch = /^(\d+)\./.exec(build?.version ?? '');
  if (!majorMatch) {
    throw new Error(`Could not determine the target framework from '${build?.version ?? ''}'.`);
  }

  return `net${majorMatch[1]}.0`;
}

const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
if (!Array.isArray(summary.builds) || summary.builds.length === 0) {
  throw new Error(`No builds were found in '${summaryPath}'.`);
}

await mkdir(packagesDir, { recursive: true });
for (const file of await readdir(packagesDir)) {
  if (file === 'build-summary.json') {
    continue;
  }

  if (file.endsWith('.nupkg') || file.endsWith('.snupkg')) {
    await unlink(path.join(packagesDir, file));
  }
}

for (const build of summary.builds) {
  const sourceDir = path.join(distRoot, sanitizePathSegment(build.upstreamRef));
  await rm(packageWwwroot, { recursive: true, force: true });
  await cp(sourceDir, packageWwwroot, { recursive: true });

  await run('dotnet', [
    'pack',
    path.join(rootDir, 'src/LegacyBlazorJs/LegacyBlazorJs.csproj'),
    '-c',
    'Release',
    `-p:PackageVersion=${build.version}`,
    `-p:LegacyBlazorTargetFramework=${resolveTargetFramework(build)}`,
    '-o',
    packagesDir,
  ], {
    cwd: rootDir,
  });
}
