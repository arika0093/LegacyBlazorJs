import { readFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  readChromiumSnapshotConfig,
  readTargetsConfig,
} from '../../build/lib/config.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const chromiumSnapshotsBaseUrl = 'https://commondatastorage.googleapis.com/chromium-browser-snapshots';

export function getRootDir() {
  return rootDir;
}

export function getCompatibilityResultsPath() {
  return path.join(rootDir, 'artifacts', 'compatibility', 'results.json');
}

export async function getCompatibilityProfiles() {
  const targets = await readTargetsConfig();
  return Object.entries(targets)
    .filter(([, profile]) => hasChromeTarget(profile))
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

export function getChromiumHistoryPlatform() {
  switch (process.platform) {
    case 'linux':
      if (process.arch !== 'x64') {
        throw new Error(`Unsupported Linux architecture '${process.arch}'.`);
      }
      return {
        cacheKey: 'linux-x64',
        historyOs: 'Linux_x64',
        archiveVariants: [{
          archiveFileName: 'chrome-linux.zip',
          executableRelativePath: path.join('chrome-linux', 'chrome'),
        }],
      };
    case 'win32':
      // Always use x86 (older Chromium snapshots are not distributed for x64)
      return {
        cacheKey: 'win-x86',
        historyOs: 'Win',
        archiveVariants: [
          {
            archiveFileName: 'chrome-win.zip',
            executableRelativePath: path.join('chrome-win', 'chrome.exe'),
          },
          {
            archiveFileName: 'chrome-win32.zip',
            executableRelativePath: path.join('chrome-win32', 'chrome.exe'),
          },
        ],
      };
    case 'darwin':
      return process.arch === 'arm64'
        ? {
          cacheKey: 'mac-arm64',
          historyOs: 'Mac_Arm',
          archiveVariants: [{
            archiveFileName: 'chrome-mac.zip',
            executableRelativePath: path.join('chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
          }],
        }
        : {
          cacheKey: 'mac-x64',
          historyOs: 'Mac',
          archiveVariants: [{
            archiveFileName: 'chrome-mac.zip',
            executableRelativePath: path.join('chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
          }],
        };
    default:
      throw new Error(`Unsupported platform '${process.platform}'.`);
  }
}

export async function resolveCompatibilityBrowsers() {
  const platform = getChromiumHistoryPlatform();
  const profiles = await getCompatibilityProfiles();
  const overrides = await readChromiumSnapshotConfig();
  const byProfile = new Map();

  for (const profile of profiles) {
    const release = resolveSnapshotRelease(profile.chromeMajor, platform, overrides);
    if (!release) {
      throw new Error(`No Chromium snapshot was found for major ${profile.chromeMajor} (${profile.name}).`);
    }

    byProfile.set(profile.name, {
      milestone: profile.chromeMajor,
      version: release.version,
      downloadUrl: `${chromiumSnapshotsBaseUrl}/${release.snapshotPrefix}${platform.archiveVariants[0].archiveFileName}`,
      downloadUrls: platform.archiveVariants
        .map(variant => `${chromiumSnapshotsBaseUrl}/${release.snapshotPrefix}${variant.archiveFileName}`),
      executableRelativePath: platform.archiveVariants[0].executableRelativePath,
      executableRelativePaths: platform.archiveVariants.map(variant => variant.executableRelativePath),
      downloadVariants: platform.archiveVariants.map(variant => ({
        downloadUrl: `${chromiumSnapshotsBaseUrl}/${release.snapshotPrefix}${variant.archiveFileName}`,
        executableRelativePath: variant.executableRelativePath,
      })),
      cacheKey: platform.cacheKey,
      source: release.source,
    });
  }

  return byProfile;
}

function resolveSnapshotRelease(chromeMajor, platform, overrides) {
  return resolveLocalSnapshotRelease(chromeMajor, platform, overrides);
}

function resolveLocalSnapshotRelease(chromeMajor, platform, overrides) {
  const override = overrides?.majors?.[String(chromeMajor)];
  if (!override) {
    return null;
  }

  return {
    version: override.version,
    snapshotPrefix: `${platform.historyOs}/${override.position}/`,
    source: 'config/chromium-snapshot-overrides.json',
  };
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

function hasChromeTarget(profile) {
  if (profile.intendedBrowsers?.chrome) {
    return true;
  }

  const text = Array.isArray(profile.intendedBrowsers)
    ? profile.intendedBrowsers.join('\n')
    : profile.description;
  return /Chrome\s*(?:>=|\+)\s*\d+/i.test(text);
}

/** Extract the minimum Chrome major version declared for a target profile. */
function parseChromeMajor(profile) {
  if (profile.intendedBrowsers?.chrome) {
    return Number(profile.intendedBrowsers.chrome);
  }

  const text = Array.isArray(profile.intendedBrowsers)
    ? profile.intendedBrowsers.find(entry => /^Chrome\s*(?:>=|\+)\s*\d+/i.test(entry))
    : profile.description;
  const match = /Chrome\s*(?:>=|\+)\s*(\d+)/i.exec(text);
  if (!match) {
    throw new Error(`Could not determine the minimum Chrome major for profile '${profile.description}'.`);
  }

  return Number(match[1]);
}
