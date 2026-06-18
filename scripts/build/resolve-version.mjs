#!/usr/bin/env node
import { appendFile } from 'node:fs/promises';
import process from 'node:process';
import { getConfiguredBuildChannels } from './lib/config.mjs';
import {
  fetchLatestTagForMajor,
  parseAspNetTag,
  resolvePrereleaseMode,
} from './lib/version.mjs';

const repository = process.env.UPSTREAM_REPOSITORY ?? 'dotnet/aspnetcore';
const requestedMajor = process.env.DOTNET_MAJOR;
const explicitTag = process.env.ASPNETCORE_TAG;
const includePrerelease = process.env.INCLUDE_PRERELEASE === 'true';
const requestedChannel = process.env.BUILD_CHANNEL?.trim();

if (!requestedChannel && !requestedMajor && !explicitTag) {
  throw new Error('Set BUILD_CHANNEL, DOTNET_MAJOR, or ASPNETCORE_TAG.');
}

let selected;
if (explicitTag) {
  selected = parseAspNetTag(explicitTag);
  if (!selected) {
    throw new Error(`Invalid ASP.NET Core tag: ${explicitTag}`);
  }
  if (requestedChannel) {
    selected.channel = requestedChannel;
  }
} else if (requestedChannel) {
  const [channel] = await getConfiguredBuildChannels();
  if (!channel) {
    throw new Error(`Unknown build channel '${requestedChannel}'.`);
  }
  selected = await fetchLatestTagForMajor({
    repository,
    major: channel.major,
    prereleaseMode: channel.prereleaseMode,
    githubToken: process.env.GITHUB_TOKEN,
  });
  if (!selected) {
    throw new Error(`No matching tag found for build channel '${channel.name}'.`);
  }
  selected.channel = channel.name;
} else {
  selected = await fetchLatestTagForMajor({
    repository,
    major: requestedMajor,
    prereleaseMode: resolvePrereleaseMode(includePrerelease),
    githubToken: process.env.GITHUB_TOKEN,
  });
  if (!selected) {
    throw new Error(`No matching tag found for .NET ${requestedMajor}.`);
  }
}

console.log(JSON.stringify(selected, null, 2));

if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `tag=${selected.tag}\nversion=${selected.version}\nmajor=${selected.major}\n`);
}
