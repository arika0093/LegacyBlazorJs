import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readTargetsConfig } from './config-lib.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromeForTestingMilestonesUrl =
  'https://googlechromelabs.github.io/chrome-for-testing/latest-versions-per-milestone-with-downloads.json';
const chromeForTestingKnownGoodUrl =
  'https://googlechromelabs.github.io/chrome-for-testing/known-good-versions-with-downloads.json';

export function getRootDir() {
  return rootDir;
}

export function getCompatibilityResultsPath() {
  return path.join(rootDir, 'artifacts', 'compatibility', 'results.json');
}

export async function getCompatibilityProfiles() {
  const targets = await readTargetsConfig();
  return Object.entries(targets)
    .filter(([, profile]) => Number(profile.ecma) >= 2020)
    .map(([name, profile]) => ({
      name,
      ecma: Number(profile.ecma),
      description: profile.description,
      chromeMajor: parseChromeMajor(profile),
    }))
    .sort((left, right) => left.ecma - right.ecma);
}

export function getHostingModels() {
  return ['Server', 'WebAssembly'];
}

export function getChromeForTestingPlatform() {
  switch (process.platform) {
    case 'linux':
      if (process.arch !== 'x64') {
        throw new Error(`Unsupported Linux architecture '${process.arch}'.`);
      }
      return 'linux64';
    case 'win32':
      return process.arch === 'x64' ? 'win64' : 'win32';
    case 'darwin':
      return process.arch === 'arm64' ? 'mac-arm64' : 'mac-x64';
    default:
      throw new Error(`Unsupported platform '${process.platform}'.`);
  }
}

export async function fetchMilestoneDownloads() {
  return fetchJson(chromeForTestingMilestonesUrl);
}

export async function fetchKnownGoodDownloads() {
  return fetchJson(chromeForTestingKnownGoodUrl);
}

export async function resolveCompatibilityBrowsers() {
  const platform = getChromeForTestingPlatform();
  const profiles = await getCompatibilityProfiles();
  const [milestoneData, knownGoodData] = await Promise.all([
    fetchMilestoneDownloads(),
    fetchKnownGoodDownloads(),
  ]);
  const byProfile = new Map();

  for (const profile of profiles) {
    const release = milestoneData.milestones?.[String(profile.chromeMajor)]
      ?? resolveKnownGoodRelease(knownGoodData, profile.chromeMajor);
    if (!release) {
      throw new Error(`Chrome for Testing does not list milestone ${profile.chromeMajor} for ${profile.name}.`);
    }

    const download = release.downloads?.chrome?.find(entry => entry.platform === platform);
    if (!download?.url) {
      throw new Error(`Chrome for Testing does not provide a '${platform}' Chrome download for ${profile.name}.`);
    }

    byProfile.set(profile.name, {
      milestone: profile.chromeMajor,
      version: release.version,
      downloadUrl: download.url,
      platform,
    });
  }

  return byProfile;
}

function resolveKnownGoodRelease(knownGoodData, chromeMajor) {
  const prefix = `${chromeMajor}.`;
  const versions = knownGoodData.versions?.filter(entry => entry.version?.startsWith(prefix)) ?? [];
  return versions.at(-1) ?? null;
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'legacy-blazor-js-build',
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Chrome for Testing request failed for ${url}: ${response.status} ${response.statusText}`);
  }

  return response.json();
}

export async function readBuildSummary() {
  const summaryPath = path.join(rootDir, 'artifacts', 'packages', 'build-summary.json');
  try {
    return JSON.parse(await readFile(summaryPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Missing ${summaryPath}. Build packages with 'npm run build' before running compatibility tests.`);
    }

    throw error;
  }
}

function parseChromeMajor(profile) {
  const text = Array.isArray(profile.intendedBrowsers)
    ? profile.intendedBrowsers.find(entry => /^Chrome\s*>=\s*\d+/.test(entry))
    : profile.description;
  const match = /Chrome\s*(?:>=|\+)\s*(\d+)/i.exec(text);
  if (!match) {
    throw new Error(`Could not determine the minimum Chrome major for profile '${profile.description}'.`);
  }

  return Number(match[1]);
}
