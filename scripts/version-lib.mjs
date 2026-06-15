/** Parse an ASP.NET Core tag like v8.0.1 or v9.0.0-preview.1 into its numeric components. */
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

/** Compare two parsed tags, with stable releases sorting after prereleases of the same version. */
export function compareVersions(a, b) {
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] - b[key];
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true });
}

/** Select the newest tag matching the requested .NET major, optionally including prereleases. */
export function latestTagForMajor(tags, major, includePrerelease = false) {
  const versions = tags
    .map(parseAspNetTag)
    .filter(Boolean)
    .filter(version => version.major === Number(major))
    .filter(version => includePrerelease || version.prerelease === null)
    .sort(compareVersions);
  return versions.at(-1) ?? null;
}

const FETCH_TIMEOUT_MS = 30_000;

export async function fetchTagsFromGitHub(repository, githubToken) {
  const tags = [];

  // GitHub's tags API is paginated, so keep walking until a page contains fewer than 100 tags.
  for (let page = 1; page <= 10; page++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

    let response;
    try {
      response = await fetch(`https://api.github.com/repos/${repository}/tags?per_page=100&page=${page}`, {
        signal: controller.signal,
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': 'legacy-blazor-js-build',
          ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
        },
      });
    } catch (error) {
      if (error?.name === 'AbortError') {
        throw new Error(`GitHub tags request timed out after ${FETCH_TIMEOUT_MS}ms.`);
      }

      throw error;
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new Error(`GitHub tags request failed: ${response.status} ${response.statusText}`);
    }

    const pageTags = await response.json();
    tags.push(...pageTags.map(item => item.name));
    if (pageTags.length < 100) {
      break;
    }
  }

  return tags;
}

export async function fetchLatestTagForMajor({ repository, major, includePrerelease = false, githubToken }) {
  const tags = await fetchTagsFromGitHub(repository, githubToken);
  return latestTagForMajor(tags, major, includePrerelease);
}
