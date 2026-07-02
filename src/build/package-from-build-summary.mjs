#!/usr/bin/env node
import { cp, mkdir, readdir, readFile, rm, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveDistDirectory } from './lib/dist-paths.mjs';
import { cleanGeneratedPackageAssets } from './lib/package-static-assets.mjs';
import { run } from './lib/process.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const packagesDir = path.join(rootDir, 'artifacts', 'packages');
const summaryPath = path.join(packagesDir, 'build-summary.json');
const distRoot = path.join(rootDir, 'dist');
const packageWwwroot = path.join(rootDir, 'dotnet', 'src', 'LegacyBlazorJs', 'wwwroot');
const packageProjectPath = path.join(rootDir, 'dotnet', 'src', 'LegacyBlazorJs', 'LegacyBlazorJs.csproj');

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
  const sourceDir = resolveDistDirectory(distRoot, build.version);
  await cleanGeneratedPackageAssets(packageWwwroot);
  await cp(sourceDir, packageWwwroot, { recursive: true });

  await run('dotnet', [
    'pack',
    packageProjectPath,
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
