#!/usr/bin/env node
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { getSupportedMajors, getTargetProfiles } from './lib/config.mjs';

const mode = process.argv[2] ?? 'profiles';
const json = process.argv.includes('--json');
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function listPackageVersions() {
  const packageDirectory = path.join(rootDir, 'artifacts', 'packages');
  const files = await readdir(packageDirectory);
  return files
    .map(file => /^LegacyBlazorJs\.(.+)\.nupkg$/.exec(file)?.[1] ?? null)
    .filter(Boolean)
    .sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));
}

async function resolveValues() {
  switch (mode) {
    case 'majors':
      return getSupportedMajors();
    case 'profiles':
      return getTargetProfiles();
    case 'packages':
      return listPackageVersions();
    case 'build-summary':
      return JSON.parse(await readFile(path.join(rootDir, 'artifacts', 'packages', 'build-summary.json'), 'utf8'));
    default:
      throw new Error(`Unsupported mode '${mode}'. Use majors, profiles, packages, or build-summary.`);
  }
}

const values = await resolveValues();
if (json) {
  console.log(JSON.stringify(values));
} else if (Array.isArray(values)) {
  for (const value of values) {
    console.log(value);
  }
} else {
  console.log(JSON.stringify(values, null, 2));
}
