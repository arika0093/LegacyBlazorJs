#!/usr/bin/env node
import { mkdir, readdir, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { getConfiguredBuildChannels } from './lib/config.mjs';
import { buildUpstream } from './lib/upstream-build.mjs';
import {
  fetchLatestTagForMajor,
  parseAspNetTag,
} from './lib/version.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const artifactsDir = path.join(rootDir, 'artifacts', 'packages');
const repository = process.env.UPSTREAM_REPOSITORY ?? 'dotnet/aspnetcore';
const includePrerelease = process.env.INCLUDE_PRERELEASE === 'true';
const explicitTag = process.env.ASPNETCORE_TAG;
const explicitRef = process.env.UPSTREAM_REF;
const explicitProfiles = process.env.BUILD_TARGET_PROFILES;

async function buildFromTag(tag) {
  await buildUpstream({
    tag,
    nodeBin: process.execPath,
    buildProfiles: explicitProfiles,
    repository,
    includePrerelease,
    githubToken: process.env.GITHUB_TOKEN,
  });

  const parsed = parseAspNetTag(tag);
  if (!parsed) {
    throw new Error(`Invalid ASP.NET Core tag: ${tag}`);
  }

  return {
    ...parsed,
    upstreamRef: tag,
  };
}

async function buildFromRef(ref) {
  const packageVersion = process.env.PACKAGE_VERSION?.trim();
  if (!packageVersion) {
    throw new Error('Set PACKAGE_VERSION when building from UPSTREAM_REF.');
  }

  const targetFramework = process.env.LEGACY_BLAZOR_TARGET_FRAMEWORK?.trim()
    ?? `net${process.env.DOTNET_MAJOR ?? parseAspNetTag(`v${packageVersion}`)?.major ?? ''}.0`;
  if (!/^net\d+\.\d+$/.test(targetFramework)) {
    throw new Error(`Could not determine LEGACY_BLAZOR_TARGET_FRAMEWORK for package version '${packageVersion}'.`);
  }

  await buildUpstream({
    ref,
    nodeBin: process.execPath,
    buildProfiles: explicitProfiles,
    repository,
    packageVersion,
    targetFramework,
  });

  const majorMatch = /^(\d+)\./.exec(packageVersion);
  if (!majorMatch) {
    throw new Error(`Could not determine the .NET major from package version '${packageVersion}'.`);
  }

  return {
    channel: process.env.BUILD_CHANNEL ?? null,
    major: Number(majorMatch[1]),
    patch: null,
    prerelease: packageVersion.includes('-') ? packageVersion.split('-').slice(1).join('-') : null,
    tag: null,
    upstreamRef: ref,
    version: packageVersion,
  };
}

async function buildFromChannel(channel) {
  const selected = await fetchLatestTagForMajor({
    repository,
    major: channel.major,
    prereleaseMode: channel.prereleaseMode,
    githubToken: process.env.GITHUB_TOKEN,
  });

  if (!selected) {
    throw new Error(`No matching tag found for build channel '${channel.name}' (.NET ${channel.major}, mode: ${channel.prereleaseMode}).`);
  }

  await buildUpstream({
    tag: selected.tag,
    nodeBin: process.execPath,
    buildProfiles: explicitProfiles,
    repository,
    githubToken: process.env.GITHUB_TOKEN,
  });

  return {
    ...selected,
    channel: channel.name,
    upstreamRef: selected.tag,
  };
}

async function main() {
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
  } else if (explicitRef) {
    builds.push(await buildFromRef(explicitRef));
  } else {
    const channels = await getConfiguredBuildChannels();
    for (const channel of channels) {
      builds.push(await buildFromChannel(channel));
    }
  }

  await writeFile(
    path.join(artifactsDir, 'build-summary.json'),
    `${JSON.stringify({ repository, includePrerelease, builds }, null, 2)}\n`);

  console.log(`Built ${builds.length} package(s): ${builds.map(build => build.upstreamRef ?? build.tag ?? build.version).join(', ')}`);
}

await main();
