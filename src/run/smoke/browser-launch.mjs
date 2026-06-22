import process from 'node:process';

import { runChecked } from './process-utils.mjs';
import { ensureExecutablePermissions, fileExists, parseBrowserMajor } from './shared.mjs';

export async function resolveBrowserLaunchConfiguration() {
  const configuredPath = process.env.SMOKE_TEST_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (configuredPath) {
    if (!await fileExists(configuredPath)) {
      throw new Error(
        `Configured Chromium executable was not found at '${configuredPath}'. Run 'node src/run/export-browser-env.mjs es5' before executing smoke tests that require a compatibility browser.`);
    }

    await ensureExecutablePermissions(configuredPath);
    return {
      executablePath: configuredPath,
      platform: inferBrowserPlatform(configuredPath),
      versionMajor: parseBrowserMajor(process.env.SMOKE_TEST_CHROMIUM_VERSION),
    };
  }

  for (const candidate of await findInstalledBrowsers()) {
    if (await fileExists(candidate)) {
      await ensureExecutablePermissions(candidate);
      return {
        executablePath: candidate,
        platform: inferBrowserPlatform(candidate),
        versionMajor: null,
      };
    }
  }

  throw new Error(
    `No Chromium executable is configured. Set SMOKE_TEST_CHROMIUM_EXECUTABLE_PATH, install a local browser, or run 'node src/run/export-browser-env.mjs es5'.`);
}

export function buildBrowserArguments(profileDirectory, remoteDebuggingPort, versionMajor, options = {}) {
  const platform = options.platform ?? process.platform;
  const display = options.display ?? process.env.DISPLAY;
  const supportsHeadless = versionMajor === null || versionMajor >= 59;
  const argumentsList = [
    '--disable-gpu',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${remoteDebuggingPort}`,
    `--user-data-dir=${profileDirectory}`,
    'about:blank',
  ];

  if (!display) {
    if (platform === 'linux' && !supportsHeadless) {
      throw new Error('Legacy Chromium requires a display server. Run the smoke test under xvfb-run or set DISPLAY.');
    }

    if (supportsHeadless) {
      argumentsList.unshift('--headless');
    }
  }

  if (platform === 'linux') {
    argumentsList.push('--no-sandbox');
  }

  return argumentsList;
}

async function findInstalledBrowsers() {
  const commands = process.platform === 'win32'
    ? ['msedge.exe', 'chrome.exe']
    : ['chromium-browser', 'chromium', 'google-chrome-stable', 'google-chrome', 'microsoft-edge'];
  const resolved = [];

  for (const command of commands) {
    const located = await locateCommand(command);
    if (located) {
      resolved.push(located);
    }
  }

  const commonPaths = process.platform === 'win32'
    ? [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ]
    : [
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/microsoft-edge',
    ];

  return [...new Set([...resolved, ...commonPaths])];
}

async function locateCommand(command) {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  const args = process.platform === 'win32' ? [command] : ['-a', command];

  try {
    const { stdout } = await runChecked(locator, args);
    return stdout.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? null;
  } catch {
    return null;
  }
}

function inferBrowserPlatform(executablePath) {
  if (executablePath.toLowerCase().endsWith('.exe')) {
    return 'win32';
  }

  return process.platform;
}
