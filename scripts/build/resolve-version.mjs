#!/usr/bin/env node
import { appendFile } from 'node:fs/promises';
import process from 'node:process';
import { fetchLatestTagForMajor, parseAspNetTag } from './lib/version.mjs';

const repository = process.env.UPSTREAM_REPOSITORY ?? 'dotnet/aspnetcore';
const requestedMajor = process.argv[2] ?? process.env.DOTNET_MAJOR;
const explicitTag = process.env.ASPNETCORE_TAG;
const includePrerelease = process.env.INCLUDE_PRERELEASE === 'true';

if (!requestedMajor && !explicitTag) {
  throw new Error('Pass a .NET major version or set ASPNETCORE_TAG.');
}

let selected;
if (explicitTag) {
  selected = parseAspNetTag(explicitTag);
  if (!selected) {
    throw new Error(`Invalid ASP.NET Core tag: ${explicitTag}`);
  }
} else {
  selected = await fetchLatestTagForMajor({
    repository,
    major: requestedMajor,
    includePrerelease,
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
