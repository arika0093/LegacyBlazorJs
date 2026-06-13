#!/usr/bin/env node
import { appendFile } from 'node:fs/promises';
import process from 'node:process';
import { latestTagForMajor, parseAspNetTag } from './version-lib.mjs';

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
  if (!selected) throw new Error(`Invalid ASP.NET Core tag: ${explicitTag}`);
} else {
  const tags = [];
  for (let page = 1; page <= 10; page++) {
    const response = await fetch(`https://api.github.com/repos/${repository}/tags?per_page=100&page=${page}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'legacy-blazor-js-build',
        ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
      },
    });
    if (!response.ok) throw new Error(`GitHub tags request failed: ${response.status} ${response.statusText}`);
    const pageTags = await response.json();
    tags.push(...pageTags.map(item => item.name));
    if (pageTags.length < 100) break;
  }
  selected = latestTagForMajor(tags, requestedMajor, includePrerelease);
  if (!selected) throw new Error(`No matching tag found for .NET ${requestedMajor}.`);
}

console.log(JSON.stringify(selected, null, 2));
if (process.env.GITHUB_OUTPUT) {
  await appendFile(process.env.GITHUB_OUTPUT, `tag=${selected.tag}\nversion=${selected.version}\nmajor=${selected.major}\n`);
}
