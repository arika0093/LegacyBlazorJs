#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const summaryPaths = process.argv.slice(2);
if (summaryPaths.length === 0) {
  throw new Error('Pass at least one build-summary.json path to merge.');
}

function buildKey(build) {
  return `${build.upstreamRef ?? ''}::${build.version ?? ''}`;
}

function assertSameValue(label, left, right) {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new Error(`Mismatched ${label}: ${JSON.stringify(left)} !== ${JSON.stringify(right)}`);
  }
}

const merged = {
  repository: null,
  includePrerelease: null,
  builds: [],
};
const seenBuilds = new Set();

for (const summaryPath of summaryPaths) {
  const summary = JSON.parse(await readFile(path.resolve(summaryPath), 'utf8'));
  if (!Array.isArray(summary.builds)) {
    throw new Error(`Expected 'builds' array in '${summaryPath}'.`);
  }

  if (merged.repository === null) {
    merged.repository = summary.repository;
    merged.includePrerelease = summary.includePrerelease;
  } else {
    assertSameValue('repository', merged.repository, summary.repository);
    assertSameValue('includePrerelease', merged.includePrerelease, summary.includePrerelease);
  }

  for (const build of summary.builds) {
    const key = buildKey(build);
    if (seenBuilds.has(key)) {
      continue;
    }

    seenBuilds.add(key);
    merged.builds.push(build);
  }
}

merged.builds.sort((left, right) => left.version.localeCompare(right.version, undefined, { numeric: true }));
const outputDir = path.join(rootDir, 'artifacts', 'packages');
await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, 'build-summary.json'), `${JSON.stringify(merged, null, 2)}\n`);
