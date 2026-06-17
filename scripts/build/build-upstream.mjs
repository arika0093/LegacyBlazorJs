#!/usr/bin/env node
import process from 'node:process';
import { buildUpstream } from './lib/upstream-build.mjs';

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

await buildUpstream({
  major: arg('major', process.env.DOTNET_MAJOR),
  tag: arg('tag', process.env.ASPNETCORE_TAG),
  nodeBin: arg('node-bin', process.execPath),
  buildProfiles: arg('profiles', process.env.BUILD_TARGET_PROFILES),
  skipPrebuild: arg('skip-prebuild', process.env.SKIP_PREBUILD) === '1',
});
