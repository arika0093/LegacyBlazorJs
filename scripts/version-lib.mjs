export function parseAspNetTag(tag) {
  const match = /^v(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(tag);
  if (!match) return null;
  return {
    tag,
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ?? null,
    version: tag.slice(1),
  };
}

export function compareVersions(a, b) {
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true });
}

export function latestTagForMajor(tags, major, includePrerelease = false) {
  const versions = tags
    .map(parseAspNetTag)
    .filter(Boolean)
    .filter(version => version.major === Number(major))
    .filter(version => includePrerelease || version.prerelease === null)
    .sort(compareVersions);
  return versions.at(-1) ?? null;
}
