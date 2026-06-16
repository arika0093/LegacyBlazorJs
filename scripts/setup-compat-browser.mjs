#!/usr/bin/env node
import { appendFile } from 'node:fs/promises';
import process from 'node:process';
import { setupCompatibilityBrowser } from './browser-setup-lib.mjs';
import { resolveCompatibilityBrowsers } from './compat-lib.mjs';

const profile = process.argv[2];
if (!profile) {
  throw new Error('Usage: node scripts/setup-compat-browser.mjs <profile>');
}

const browser = (await resolveCompatibilityBrowsers()).get(profile);
if (!browser) {
  throw new Error(`No compatibility browser is configured for profile '${profile}'.`);
}

const executablePath = await setupCompatibilityBrowser(browser);
const values = {
  SMOKE_TEST_CHROMIUM_EXECUTABLE_PATH: executablePath,
  SMOKE_TEST_CHROMIUM_VERSION: browser.version,
};

const output = Object.entries(values).map(([name, value]) => `${name}=${value}`).join('\n');
if (process.env.GITHUB_ENV) {
  await appendFile(process.env.GITHUB_ENV, `${output}\n`);
} else {
  console.log(output);
}
