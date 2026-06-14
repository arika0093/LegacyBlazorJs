import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { readTargetsConfig } from './config-lib.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const chromiumSnapshotsBaseUrl = 'https://commondatastorage.googleapis.com/chromium-browser-snapshots';
const chromiumHistoryJsonBaseUrl =
  'https://raw.githubusercontent.com/vikyd/chromium-history-version-position/master/json/ver-pos-os-link';

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

/** Determine the Chromium snapshot platform identifiers for the current OS/architecture. */
export function getChromiumHistoryPlatform() {
  switch (process.platform) {
    case 'linux':
      if (process.arch !== 'x64') {
        throw new Error(`Unsupported Linux architecture '${process.arch}'.`);
      }
      return {
        cacheKey: 'linux-x64',
        executableRelativePath: path.join('chrome-linux', 'chrome'),
        historyOs: 'Linux_x64',
        archiveFileName: 'chrome-linux.zip',
      };
    case 'win32':
      return process.arch === 'x64'
        ? {
          cacheKey: 'win-x64',
          executableRelativePath: path.join('chrome-win', 'chrome.exe'),
          historyOs: 'Win_x64',
          archiveFileName: 'chrome-win.zip',
        }
        : {
          cacheKey: 'win-x86',
          executableRelativePath: path.join('chrome-win', 'chrome.exe'),
          historyOs: 'Win',
          archiveFileName: 'chrome-win.zip',
        };
    case 'darwin':
      return process.arch === 'arm64'
        ? {
          cacheKey: 'mac-arm64',
          executableRelativePath: path.join('chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
          historyOs: 'Mac_Arm',
          archiveFileName: 'chrome-mac.zip',
        }
        : {
          cacheKey: 'mac-x64',
          executableRelativePath: path.join('chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
          historyOs: 'Mac',
          archiveFileName: 'chrome-mac.zip',
        };
    default:
      throw new Error(`Unsupported platform '${process.platform}'.`);
  }
}

export async function fetchChromiumVersionLinks() {
  const platform = getChromiumHistoryPlatform();
  return fetchJson(`${chromiumHistoryJsonBaseUrl}/version-position-link-${platform.historyOs}.json`);
}

export async function resolveCompatibilityBrowsers() {
  const platform = getChromiumHistoryPlatform();
  const profiles = await getCompatibilityProfiles();
  const versionLinks = await fetchChromiumVersionLinks();
  const byProfile = new Map();

  for (const profile of profiles) {
    const release = resolveSnapshotRelease(versionLinks, profile.chromeMajor);
    if (!release) {
      throw new Error(`No Chromium snapshot was found for major ${profile.chromeMajor} (${profile.name}).`);
    }

    byProfile.set(profile.name, {
      milestone: profile.chromeMajor,
      version: release.version,
      downloadUrl: `${chromiumSnapshotsBaseUrl}/${release.snapshotPrefix}${platform.archiveFileName}`,
      executableRelativePath: platform.executableRelativePath,
      cacheKey: platform.cacheKey,
      source: 'vikyd/chromium-history-version-position',
    });
  }

  return byProfile;
}

/** Find the newest Chromium snapshot that matches the requested major version. */
function resolveSnapshotRelease(versionLinks, chromeMajor) {
  const prefix = `${chromeMajor}.`;
  const version = Object.keys(versionLinks)
    .filter(candidate => candidate.startsWith(prefix))
    .sort(compareVersions)
    .at(-1);

  if (!version) {
    return null;
  }

  const indexUrl = versionLinks[version];
  const match = /prefix=([^&]+\/)/.exec(indexUrl);
  if (!match) {
    throw new Error(`Could not parse the Chromium snapshot prefix from '${indexUrl}'.`);
  }

  return {
    version,
    snapshotPrefix: match[1],
  };
}

/** Compare dotted version strings numerically, treating missing segments as zero. */
function compareVersions(left, right) {
  const leftParts = left.split('.').map(Number);
  const rightParts = right.split('.').map(Number);
  const length = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }

  return 0;
}

const FETCH_TIMEOUT_MS = 30_000;

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'legacy-blazor-js-build',
        Accept: 'application/json',
      },
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Chromium version metadata request timed out after ${FETCH_TIMEOUT_MS}ms for ${url}.`);
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`Chromium version metadata request failed for ${url}: ${response.status} ${response.statusText}`);
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

/** Extract the minimum Chrome major version declared for a target profile. */
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
