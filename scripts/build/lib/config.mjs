import { readFile } from 'node:fs/promises';
import process from 'node:process';

async function readJsonConfig(relativePath) {
  const fileUrl = new URL(`../../../${relativePath}`, import.meta.url);
  return JSON.parse(await readFile(fileUrl, 'utf8'));
}

export async function readMajorsConfig() {
  return readJsonConfig('config/majors.json');
}

export async function readTargetsConfig() {
  return readJsonConfig('config/targets.json');
}

export async function readChromiumSnapshotOverridesConfig() {
  return readJsonConfig('config/chromium-snapshot-overrides.json');
}

export async function readSelectedTargets() {
  const targets = await readTargetsConfig();
  const configuredProfiles = process.env.BUILD_TARGET_PROFILES
    ?.split(',')
    .map(profile => profile.trim())
    .filter(Boolean);

  if (!configuredProfiles || configuredProfiles.length === 0) {
    return targets;
  }

  const selectedTargets = {};
  for (const profile of configuredProfiles) {
    if (!Object.hasOwn(targets, profile)) {
      throw new Error(`Unknown target profile '${profile}'. Expected one of: ${Object.keys(targets).join(', ')}`);
    }

    selectedTargets[profile] = targets[profile];
  }

  return selectedTargets;
}

export async function getSupportedMajors() {
  const { supportedMajors } = await readMajorsConfig();
  return supportedMajors.map(Number);
}

export async function getTargetProfiles() {
  return Object.keys(await readTargetsConfig());
}
