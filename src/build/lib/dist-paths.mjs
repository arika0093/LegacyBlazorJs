import path from 'node:path';

export function sanitizePathSegment(value) {
  return value.replace(/[^0-9A-Za-z._-]+/g, '-');
}

export function resolveDistVersionDirectoryName(version) {
  if (!version?.trim()) {
    throw new Error('A package version is required to resolve the dist directory name.');
  }

  const normalizedVersion = version.trim().startsWith('v')
    ? version.trim()
    : `v${version.trim()}`;
  return sanitizePathSegment(normalizedVersion);
}

export function resolveDistDirectory(rootDirectory, version) {
  return path.join(rootDirectory, resolveDistVersionDirectoryName(version));
}
