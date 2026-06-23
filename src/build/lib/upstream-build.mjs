import { access, cp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildVariants } from '../build-variants.mjs';
import { prepareNodeShim, retry, run } from './process.mjs';
import {
  fetchLatestTagForMajor,
  parseAspNetTag,
  resolvePrereleaseMode,
} from './version.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const packageProjectPath = path.join(rootDir, 'dotnet/src/LegacyBlazorJs/LegacyBlazorJs.csproj');

async function hasPath(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readPackageJson(packageJsonPath) {
  return JSON.parse(await readFile(packageJsonPath, 'utf8'));
}

async function resolveNpmWorkspace(upstreamDir) {
  if (await hasPath(path.join(upstreamDir, 'package-lock.json'))) {
    return true;
  }

  const packageJsonPath = path.join(upstreamDir, 'package.json');
  if (!await hasPath(packageJsonPath)) {
    return false;
  }

  const packageJson = await readPackageJson(packageJsonPath);
  return Array.isArray(packageJson.workspaces) && packageJson.workspaces.length > 0;
}

function resolveTargetFramework(packageVersion, explicitTargetFramework) {
  if (explicitTargetFramework?.trim()) {
    return explicitTargetFramework.trim();
  }

  const majorMatch = /^(\d+)\./.exec(packageVersion ?? '');
  if (!majorMatch) {
    throw new Error(`Could not determine the target framework from package version '${packageVersion}'.`);
  }

  return `net${majorMatch[1]}.0`;
}

async function resolveBuildIdentity({
  major,
  tag,
  ref,
  repository,
  includePrerelease,
  prereleaseMode,
  githubToken,
  packageVersion,
  targetFramework,
}) {
  if (tag) {
    const parsed = parseAspNetTag(tag);
    if (!parsed) {
      throw new Error(`Invalid ASP.NET Core tag: ${tag}`);
    }

    return {
      ...parsed,
      checkoutRef: tag,
      targetFramework: resolveTargetFramework(parsed.version, targetFramework),
      upstreamRef: tag,
    };
  }

  if (ref) {
    const resolvedPackageVersion = packageVersion?.trim();
    if (!resolvedPackageVersion) {
      throw new Error('Set PACKAGE_VERSION when building from UPSTREAM_REF.');
    }

    const parsed = parseAspNetTag(`v${resolvedPackageVersion}`);
    const resolvedMajor = parsed?.major ?? Number(major);
    if (!resolvedMajor || Number.isNaN(resolvedMajor)) {
      throw new Error(`Could not determine the .NET major for upstream ref '${ref}'.`);
    }

    return {
      checkoutRef: ref,
      major: resolvedMajor,
      patch: parsed?.patch ?? null,
      prerelease: parsed?.prerelease ?? (resolvedPackageVersion.includes('-')
        ? resolvedPackageVersion.split('-').slice(1).join('-')
        : null),
      tag: null,
      targetFramework: resolveTargetFramework(resolvedPackageVersion, targetFramework),
      upstreamRef: ref,
      version: resolvedPackageVersion,
    };
  }

  if (!major) {
    throw new Error('Set DOTNET_MAJOR, ASPNETCORE_TAG, or UPSTREAM_REF.');
  }

  const selected = await fetchLatestTagForMajor({
    repository,
    major,
    prereleaseMode: prereleaseMode ?? resolvePrereleaseMode(includePrerelease),
    githubToken,
  });
  if (!selected) {
    throw new Error(`No matching tag found for .NET ${major}.`);
  }

  return {
    ...selected,
    checkoutRef: selected.tag,
    targetFramework: resolveTargetFramework(selected.version, targetFramework),
    upstreamRef: selected.tag,
  };
}

async function checkoutUpstreamSource(upstreamDir, ref, repository) {
  console.log('---------------------------------------');
  console.log(` Clone upstream source: ${repository}@${ref}`);

  if (await hasPath(path.join(upstreamDir, '.git'))) {
    await run('git', ['fetch', '--depth', '1', 'origin', ref], { cwd: upstreamDir });
    await run('git', ['checkout', '--detach', 'FETCH_HEAD'], { cwd: upstreamDir });
    return;
  }

  await rm(upstreamDir, { recursive: true, force: true });
  await run('git', ['clone', '--depth', '1', '--branch', ref, '--', `https://github.com/${repository}.git`, upstreamDir], {
    cwd: rootDir,
  });
}

async function prebuildWorkspacePackages(upstreamDir, env) {
  console.log('---------------------------------------');
  console.log(' Build required packages (JSInterop, SignalR, and related packages)');
  await retry(3, 15_000, () => run('npm', ['install', '--ignore-scripts'], { cwd: upstreamDir, env }));
  await run('npm', ['run', 'build', '--workspace=src/JSInterop/Microsoft.JSInterop.JS/src'], { cwd: upstreamDir, env });
  await run('npm', ['run', 'build', '--workspace=src/SignalR/clients/ts/signalr'], { cwd: upstreamDir, env });
  await run('npm', ['run', 'build', '--workspace=src/SignalR/clients/ts/signalr-protocol-msgpack'], { cwd: upstreamDir, env });
}

function sanitizePathSegment(value) {
  return value.replace(/[^0-9A-Za-z._-]+/g, '-');
}

export async function buildUpstream({
  major = process.env.DOTNET_MAJOR,
  tag = process.env.ASPNETCORE_TAG,
  ref = process.env.UPSTREAM_REF,
  nodeBin = process.execPath,
  buildProfiles = process.env.BUILD_TARGET_PROFILES,
  skipPrebuild = process.env.SKIP_PREBUILD === 'true',
  repository = process.env.UPSTREAM_REPOSITORY ?? 'dotnet/aspnetcore',
  includePrerelease = process.env.INCLUDE_PRERELEASE === 'true',
  prereleaseMode,
  githubToken = process.env.GITHUB_TOKEN,
  packageVersion = process.env.PACKAGE_VERSION,
  targetFramework = process.env.LEGACY_BLAZOR_TARGET_FRAMEWORK,
} = {}) {
  const build = await resolveBuildIdentity({
    major,
    tag,
    ref,
    repository,
    includePrerelease,
    prereleaseMode,
    githubToken,
    packageVersion,
    targetFramework,
  });

  const distDir = path.join(rootDir, 'dist', sanitizePathSegment(build.upstreamRef));
  const packageWwwroot = path.join(rootDir, 'dotnet/src/LegacyBlazorJs/wwwroot');
  const upstreamDir = path.join(rootDir, '.work', `aspnetcore-${sanitizePathSegment(build.upstreamRef)}`);
  const webJsDir = path.join(upstreamDir, 'src/Components/Web.JS');
  const { env, cleanup } = await prepareNodeShim(nodeBin);

  try {
    await checkoutUpstreamSource(upstreamDir, build.checkoutRef, repository);

    if (!await resolveNpmWorkspace(upstreamDir)) {
      throw new Error(`The upstream source '${repository}@${build.checkoutRef}' is not an npm workspace build. Legacy yarn-based builds are no longer supported.`);
    }

    if (skipPrebuild) {
      console.log('---------------------------------------');
      console.log(' Build required packages (JSInterop, SignalR, and related packages)');
      console.log(' ... Skipped (SKIP_PREBUILD = true)');
    } else {
      await prebuildWorkspacePackages(upstreamDir, env);
    }

    console.log('---------------------------------------');
    console.log(' Build Web.JS per profile target');
    await buildVariants({
      sourceDir: webJsDir,
      output: distDir,
      upstreamRef: build.upstreamRef,
      upstreamTag: build.tag,
      packageVersion: build.version,
      profiles: buildProfiles,
    });

    await rm(packageWwwroot, { recursive: true, force: true });
    await cp(distDir, packageWwwroot, { recursive: true });

    console.log('---------------------------------------');
    console.log(' Pack the Razor class library with the selected upstream version');
    await run('dotnet', [
      'pack',
      packageProjectPath,
      '-c',
      'Release',
      `-p:PackageVersion=${build.version}`,
      `-p:LegacyBlazorTargetFramework=${build.targetFramework}`,
      '-o',
      path.join(rootDir, 'artifacts/packages'),
    ], {
      cwd: rootDir,
      env,
    });
  } finally {
    await cleanup();
  }

  return build;
}
