#!/usr/bin/env node
import { appendFile, readFile } from 'node:fs/promises';
import process from 'node:process';
import { getConfiguredBuildChannels } from './lib/config.mjs';
import { fetchLatestTagForMajor } from './lib/version.mjs';

const repository = process.env.UPSTREAM_REPOSITORY ?? 'dotnet/aspnetcore';

async function resolveBuild(channel) {
  const selected = await fetchLatestTagForMajor({
    repository,
    major: channel.major,
    prereleaseMode: channel.prereleaseMode,
    githubToken: process.env.GITHUB_TOKEN,
  });

  if (!selected) {
    throw new Error(`No matching tag found for build channel '${channel.name}' (.NET ${channel.major}, mode: ${channel.prereleaseMode}).`);
  }

  return {
    channel: channel.name,
    major: selected.major,
    prereleaseMode: channel.prereleaseMode,
    tag: selected.tag,
    version: selected.version,
  };
}

const channels = await getConfiguredBuildChannels();
const builds = await Promise.all(channels.map(resolveBuild));
const targetProfiles = Object.keys(JSON.parse(await readFile(new URL('../../config/targets.json', import.meta.url), 'utf8')));

console.log(JSON.stringify({ builds, targetProfiles }, null, 2));

if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `builds=${JSON.stringify(builds)}\n`);
  await appendFile(process.env.GITHUB_OUTPUT, `target-profiles=${JSON.stringify(targetProfiles)}\n`);
}
