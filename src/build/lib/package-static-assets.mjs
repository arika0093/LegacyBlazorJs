import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

export function isGeneratedPackageAsset(relativePath) {
  const normalizedPath = relativePath.split(path.sep).join('/');
  if (normalizedPath.includes('/')) {
    return false;
  }

  return normalizedPath === 'build-manifest.json'
    || /^blazor\.(?:server|web)\..+\.js$/u.test(normalizedPath);
}

export async function cleanGeneratedPackageAssets(directory) {
  await mkdir(directory, { recursive: true });

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !isGeneratedPackageAsset(entry.name)) {
      continue;
    }

    await rm(path.join(directory, entry.name), { force: true });
  }
}
