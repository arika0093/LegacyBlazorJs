#!/usr/bin/env node
import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceRoot = path.resolve(process.argv[2] ?? '.work/ci/builds');
const distRoot = path.join(rootDir, 'dist');
const packagesDir = path.join(rootDir, 'artifacts', 'packages');

function sanitizePathSegment(value) {
  return value.replace(/[^0-9A-Za-z._-]+/g, '-');
}

async function listArtifactDirectories(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(directory, entry.name))
    .sort((left, right) => left.localeCompare(right));
}

function assertSameJson(label, left, right) {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new Error(`Mismatched ${label}: ${JSON.stringify(left)} !== ${JSON.stringify(right)}`);
  }
}

const artifactDirectories = await listArtifactDirectories(sourceRoot);
if (artifactDirectories.length === 0) {
  throw new Error(`No downloaded profile artifacts were found in '${sourceRoot}'.`);
}

await rm(distRoot, { recursive: true, force: true });
await rm(packagesDir, { recursive: true, force: true });
await mkdir(distRoot, { recursive: true });
await mkdir(packagesDir, { recursive: true });

let mergedSummary = null;
let mergedBuild = null;
let mergedManifest = null;
let mergedFiles = {};

for (const artifactDirectory of artifactDirectories) {
  const summaryPath = path.join(artifactDirectory, 'artifacts', 'packages', 'build-summary.json');
  const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
  if (!Array.isArray(summary.builds) || summary.builds.length !== 1) {
    throw new Error(`Expected exactly one build entry in '${summaryPath}'.`);
  }

  const [build] = summary.builds;
  const sourceDir = path.join(artifactDirectory, 'dist', sanitizePathSegment(build.upstreamRef));
  const manifestPath = path.join(sourceDir, 'build-manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const targetDir = path.join(distRoot, sanitizePathSegment(build.upstreamRef));
  await mkdir(targetDir, { recursive: true });

  if (!mergedSummary) {
    mergedSummary = {
      repository: summary.repository,
      includePrerelease: summary.includePrerelease,
      builds: [build],
    };
    mergedBuild = build;
    mergedManifest = {
      upstreamRef: manifest.upstreamRef,
      upstreamTag: manifest.upstreamTag ?? null,
      packageVersion: manifest.packageVersion,
      files: {},
    };
  } else {
    assertSameJson('build metadata', mergedBuild, build);
    assertSameJson('repository', mergedSummary.repository, summary.repository);
    assertSameJson('includePrerelease', mergedSummary.includePrerelease, summary.includePrerelease);
    assertSameJson('manifest upstreamRef', mergedManifest.upstreamRef, manifest.upstreamRef);
    assertSameJson('manifest upstreamTag', mergedManifest.upstreamTag, manifest.upstreamTag ?? null);
    assertSameJson('manifest packageVersion', mergedManifest.packageVersion, manifest.packageVersion);
  }

  const sourceEntries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of sourceEntries) {
    if (entry.name === 'build-manifest.json') {
      continue;
    }

    await cp(path.join(sourceDir, entry.name), path.join(targetDir, entry.name), { recursive: true });
  }

  for (const [profile, fileEntry] of Object.entries(manifest.files ?? {})) {
    if (Object.hasOwn(mergedFiles, profile)) {
      assertSameJson(`manifest file entry for profile '${profile}'`, mergedFiles[profile], fileEntry);
      continue;
    }

    mergedFiles[profile] = fileEntry;
  }
}

mergedManifest.files = mergedFiles;
await writeFile(
  path.join(distRoot, sanitizePathSegment(mergedBuild.upstreamRef), 'build-manifest.json'),
  `${JSON.stringify(mergedManifest, null, 2)}\n`);
await writeFile(path.join(packagesDir, 'build-summary.json'), `${JSON.stringify(mergedSummary, null, 2)}\n`);
