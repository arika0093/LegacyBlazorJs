#!/usr/bin/env node
import { mkdir, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { getSupportedMajors } from './config-lib.mjs';
import { fetchLatestTagForMajor, parseAspNetTag } from './version-lib.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifactsDir = path.join(rootDir, 'artifacts', 'packages');
const repository = process.env.UPSTREAM_REPOSITORY ?? 'dotnet/aspnetcore';
const includePrerelease = process.env.INCLUDE_PRERELEASE === 'true';
const explicitTag = process.env.ASPNETCORE_TAG;
const positionalMajors = process.argv.slice(2).filter(argument => !argument.startsWith('--'));
const nodeBinForBash = toBashPath(process.execPath);

function toBashPath(filePath) {
  const normalized = filePath.replace(/\\/g, '/');
  const match = /^([A-Za-z]):\/(.*)$/.exec(normalized);
  if (!match) {
    return normalized;
  }

  return `/mnt/${match[1].toLowerCase()}/${match[2]}`;
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', ...options });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

async function buildFromTag(tag) {
  await run('bash', ['scripts/fetch-and-build-upstream.sh', '', tag, nodeBinForBash], { cwd: rootDir });

  const parsed = parseAspNetTag(tag);
  if (!parsed) {
    throw new Error(`Invalid ASP.NET Core tag: ${tag}`);
  }

  return parsed;
}

async function buildFromMajor(major) {
  const selected = await fetchLatestTagForMajor({
    repository,
    major,
    includePrerelease,
    githubToken: process.env.GITHUB_TOKEN,
  });

  if (!selected) {
    throw new Error(`No matching tag found for .NET ${major}.`);
  }

  await run('bash', ['scripts/fetch-and-build-upstream.sh', String(major), selected.tag, nodeBinForBash], { cwd: rootDir });

  return selected;
}

async function main() {
  const majors = positionalMajors.length > 0
    ? positionalMajors.map(Number)
    : await getSupportedMajors();

  if (majors.some(Number.isNaN)) {
    throw new Error(`Invalid major list: ${positionalMajors.join(', ')}`);
  }

  await mkdir(artifactsDir, { recursive: true });
  await rm(path.join(artifactsDir, 'build-summary.json'), { force: true });
  for (const file of await readdir(artifactsDir)) {
    if (file.endsWith('.nupkg') || file.endsWith('.snupkg')) {
      await unlink(path.join(artifactsDir, file));
    }
  }

  const builds = [];
  if (explicitTag) {
    builds.push(await buildFromTag(explicitTag));
  } else {
    for (const major of majors) {
      builds.push(await buildFromMajor(major));
    }
  }

  await writeFile(
    path.join(artifactsDir, 'build-summary.json'),
    `${JSON.stringify({ repository, includePrerelease, builds }, null, 2)}\n`);

  console.log(`Built ${builds.length} package(s): ${builds.map(build => build.tag).join(', ')}`);
}

await main();
