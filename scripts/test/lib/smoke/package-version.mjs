import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

import { packageSourceDirectory } from './repository.mjs';
import { runChecked } from './process-utils.mjs';
import { quotePowerShellString } from './shared.mjs';

export async function resolvePackageVersion() {
  const explicitVersion = process.env.PACKAGE_VERSION?.trim();
  if (explicitVersion) {
    return explicitVersion;
  }

  const packagePath = await resolveLatestPackagePath();
  const match = /^LegacyBlazorJs\.(.+)\.nupkg$/.exec(path.basename(packagePath));
  if (!match) {
    throw new Error(`Could not determine the package version from '${path.basename(packagePath)}'.`);
  }

  return match[1];
}

export async function resolveScriptProfile(requestedProfile) {
  const availableProfiles = await getAvailableScriptProfiles();
  if (availableProfiles.includes(requestedProfile)) {
    return requestedProfile;
  }

  if (requestedProfile === 'es5') {
    const ieFallback = [...availableProfiles]
      .filter(profile => profile.toLowerCase().startsWith('ie'))
      .sort((left, right) => right.localeCompare(left, undefined, { sensitivity: 'base' }))[0];
    if (ieFallback) {
      return ieFallback;
    }
  }

  throw new Error(
    `No generated script matching profile '${requestedProfile}' was found in '${packageSourceDirectory}'. Available profiles: ${availableProfiles.join(', ')}`);
}

async function getAvailableScriptProfiles() {
  const packagePath = await resolveLatestPackagePath();
  const entries = await listArchiveEntries(packagePath);
  return [...new Set(entries
    .map(entry => /^staticwebassets\/blazor\.web\.(.+)\.js$/.exec(entry)?.[1] ?? null)
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}

async function resolveLatestPackagePath() {
  let files;
  try {
    files = await readdir(packageSourceDirectory);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Package directory '${packageSourceDirectory}' does not exist. Build the package before running smoke tests.`);
    }

    throw error;
  }

  const candidates = await Promise.all(files
    .filter(file => /^LegacyBlazorJs\..+\.nupkg$/.test(file))
    .map(async file => {
      const filePath = path.join(packageSourceDirectory, file);
      const stats = await stat(filePath);
      return { filePath, lastModified: stats.mtimeMs };
    }));

  candidates.sort((left, right) => right.lastModified - left.lastModified);
  const latest = candidates[0]?.filePath;
  if (!latest) {
    throw new Error(`No LegacyBlazorJs package was found in '${packageSourceDirectory}'. Build the package before running smoke tests.`);
  }

  return latest;
}

async function listArchiveEntries(archivePath) {
  if (process.platform === 'win32') {
    const command = [
      'Add-Type -AssemblyName System.IO.Compression.FileSystem',
      `$archive = [System.IO.Compression.ZipFile]::OpenRead(${quotePowerShellString(archivePath)})`,
      'try {',
      '  $archive.Entries | ForEach-Object FullName',
      '} finally {',
      '  $archive.Dispose()',
      '}',
    ].join('; ');
    const { stdout } = await runChecked('powershell', ['-NoProfile', '-Command', command]);
    return stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  }

  const { stdout } = await runChecked('unzip', ['-Z1', archivePath]);
  return stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}
