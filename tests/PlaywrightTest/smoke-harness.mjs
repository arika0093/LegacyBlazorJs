import { readFile } from 'node:fs/promises';
import path from 'node:path';

import {
  BrowserHarness,
  SmokeAppHarness,
  createSmokeLogger,
  describeErrorSummary,
  repositoryRoot,
  resolvePackageVersion,
} from '../../scripts/test/lib/smoke/index.mjs';

// The smoke app/browser harness implementations and low-level DevTools helpers
// now live under scripts/test/lib/smoke/ as smaller per-class modules, so this
// file stays focused on test flow. See smoke-app-harness.mjs, browser-harness.mjs,
// captured-process.mjs, devtools-target.mjs, and devtools-websocket.mjs.

export async function getProfiles() {
  const configuredProfile = process.env.SMOKE_TEST_PROFILE?.trim();
  if (configuredProfile) {
    return [configuredProfile];
  }

  const targetsPath = path.join(repositoryRoot, 'config', 'targets.json');
  const targets = JSON.parse(await readFile(targetsPath, 'utf8'));
  return Object.keys(targets);
}

export function getHostingModel() {
  const configured = process.env.SMOKE_TEST_HOSTING_MODEL?.trim();
  if (!configured) {
    return 'Server';
  }

  switch (configured) {
    case 'Server':
    case 'WebAssembly':
      return configured;
    default:
      throw new Error(
        `Unsupported SMOKE_TEST_HOSTING_MODEL value '${configured}'. Expected 'Server' or 'WebAssembly'.`);
  }
}

export async function runSmokeTest(profile, hostingModel = getHostingModel()) {
  const logger = createSmokeLogger(profile, hostingModel);
  logger.info('Resolving package version.');

  try {
    const packageVersion = await resolvePackageVersion();
    logger.info(`Using package version ${packageVersion}.`);
    const appHarness = await SmokeAppHarness.create(repositoryRoot, profile, packageVersion, hostingModel, logger);

    try {
      await appHarness.start();
      logger.info('Application server is ready.');

      const browserHarness = await BrowserHarness.create(logger);
      try {
        await browserHarness.assertCounterInteractive(appHarness.baseUri, profile, hostingModel);
        logger.info('Counter interaction completed successfully.');
      } finally {
        logger.info('Disposing browser harness.');
        await browserHarness.dispose();
      }
    } finally {
      logger.info('Disposing application harness.');
      await appHarness.dispose();
    }
  } catch (error) {
    logger.error(`Smoke test failed: ${describeErrorSummary(error)}`);
    throw error instanceof Error
      ? error
      : new Error(describeErrorSummary(error));
  }
}
