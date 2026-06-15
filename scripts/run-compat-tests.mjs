#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import {
  getCompatibilityProfiles,
  getCompatibilityResultsPath,
  getHostingModels,
  readBuildSummary,
  resolveCompatibilityBrowsers,
} from './compat-lib.mjs';

const PROCESS_TIMEOUT_MS = 600_000;

/** Spawn a child process, tee its output, and enforce a wall-clock timeout. */
function run(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let output = '';
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
      reject(new Error(`Process '${command}' timed out after ${PROCESS_TIMEOUT_MS}ms.`));
    }, PROCESS_TIMEOUT_MS);

    child.stdout.on('data', chunk => {
      const text = chunk.toString();
      output += text;
      process.stdout.write(text);
    });
    child.stderr.on('data', chunk => {
      const text = chunk.toString();
      output += text;
      process.stderr.write(text);
    });

    child.once('error', error => {
      clearTimeout(timer);
      resolve({ exitCode: 1, output: `${output}\n${String(error)}` });
    });
    child.once('exit', exitCode => {
      clearTimeout(timer);
      resolve({ exitCode: exitCode ?? 1, output });
    });
  });
}

/** Keep failure logs readable by trimming them to the last 8000 characters. */
function trimLog(text) {
  const normalized = text.trim();
  if (normalized.length <= 8000) {
    return normalized;
  }

  return normalized.slice(-8000);
}

async function main() {
  const [profiles, hostingModels, buildSummary, browsersByProfile] = await Promise.all([
    getCompatibilityProfiles(),
    Promise.resolve(getHostingModels()),
    readBuildSummary(),
    resolveCompatibilityBrowsers(),
  ]);

  const results = [];
  let hasFailures = false;

  for (const build of buildSummary.builds) {
    for (const profile of profiles) {
      const browser = browsersByProfile.get(profile.name);
      for (const hostingModel of hostingModels) {
        const startedAt = new Date().toISOString();
        const started = Date.now();
        const env = {
          ...process.env,
          PACKAGE_VERSION: build.version,
          SMOKE_TEST_PROFILE: profile.name,
          SMOKE_TEST_HOSTING_MODEL: hostingModel,
          SMOKE_TEST_CHROMIUM_VERSION: browser.version,
          SMOKE_TEST_CHROMIUM_DOWNLOAD_URL: browser.downloadUrl,
          SMOKE_TEST_CHROMIUM_EXECUTABLE_RELATIVE_PATH: browser.executableRelativePath,
          SMOKE_TEST_CHROMIUM_CACHE_KEY: browser.cacheKey,
        };

        console.log(
          `Running ${build.version} ${profile.name} ${hostingModel} on Chromium ${browser.version} (${browser.source})`);
        const outcome = await run(
          'dotnet',
          ['test', 'tests/PlaywrightTest/PlaywrightTest.csproj', '--logger', 'console;verbosity=minimal'],
          env);
        const durationSeconds = Number(((Date.now() - started) / 1000).toFixed(1));
        const passed = outcome.exitCode === 0;
        hasFailures ||= !passed;

        results.push({
          packageVersion: build.version,
          upstreamTag: build.tag,
          profile: profile.name,
          ecma: profile.ecma,
          hostingModel,
          browser,
          passed,
          durationSeconds,
          startedAt,
          failureLog: passed ? null : trimLog(outcome.output),
        });
      }
    }
  }

  const outputPath = getCompatibilityResultsPath();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    `${JSON.stringify({
      generatedAt: new Date().toISOString(),
      profiles,
      hostingModels,
      packages: buildSummary.builds,
      results,
    }, null, 2)}\n`);

  if (hasFailures) {
    process.exitCode = 1;
  }
}

await main();
