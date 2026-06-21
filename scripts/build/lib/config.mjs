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

export async function readChromiumSnapshotConfig() {
  return readJsonConfig('config/chromium-snapshot.json');
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
  const channels = await getConfiguredBuildChannels();
  return channels.map(channel => channel.major);
}

export async function getTargetProfiles() {
  return Object.keys(await readTargetsConfig());
}

function splitCsvEnv(value) {
  return value
    ?.split(',')
    .map(item => item.trim())
    .filter(Boolean) ?? [];
}

function normalizeChannel(name) {
  return name.trim().toLowerCase();
}

function toChannelEnvKey(name) {
  return normalizeChannel(name).replace(/[^a-z0-9]+/g, '_').toUpperCase();
}

export async function getConfiguredBuildChannels() {
  const { defaultBuildChannels = [], channels = {} } = await readMajorsConfig();
  const requested = splitCsvEnv(process.env.BUILD_CHANNELS ?? process.env.BUILD_CHANNEL);
  const selectedNames = requested.length > 0
    ? requested.map(normalizeChannel)
    : defaultBuildChannels.map(normalizeChannel);

  return selectedNames.map(name => {
    const configured = channels[name];
    if (!configured) {
      throw new Error(`Unknown build channel '${name}'. Expected one of: ${Object.keys(channels).join(', ')}`);
    }

    const majorOverride = process.env[`${toChannelEnvKey(name)}_DOTNET_MAJOR`];
    const major = Number(majorOverride ?? configured.major);
    if (Number.isNaN(major)) {
      throw new Error(`Invalid .NET major for build channel '${name}': ${majorOverride ?? configured.major}`);
    }

    return {
      name,
      major,
      prereleaseMode: configured.prereleaseMode ?? 'stable',
    };
  });
}
