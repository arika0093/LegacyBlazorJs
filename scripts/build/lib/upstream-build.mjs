import { access, cp, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildVariants } from '../build-variants.mjs';
import { patchSignalRAbortController } from '../patches/patch-signalr-abort-controller.mjs';
import { patchTslibOverride } from '../patches/patch-tslib-override.mjs';
import { prepareNodeShim, retry, run } from './process.mjs';
import { fetchLatestTagForMajor, parseAspNetTag } from './version.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');

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

async function usesNpmWorkspaces(upstreamDir) {
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

async function runYarnBuild(projectDir, env, buildScript = 'build') {
  await retry(3, 15_000, () => run('yarn', ['install', '--mutex', 'network', '--frozen-lockfile', '--ignore-engines'], {
    cwd: projectDir,
    env,
  }));
  await run('yarn', ['run', buildScript], { cwd: projectDir, env });
}

async function resolveTag({ major, tag, repository, includePrerelease, githubToken }) {
  if (tag) {
    return tag;
  }
  if (!major) {
    throw new Error('Pass --major <version> or --tag vX.Y.Z.');
  }

  const selected = await fetchLatestTagForMajor({
    repository,
    major,
    includePrerelease,
    githubToken,
  });
  if (!selected) {
    throw new Error(`No matching tag found for .NET ${major}.`);
  }

  return selected.tag;
}

async function checkoutUpstreamSource(upstreamDir, tag) {
  console.log('---------------------------------------');
  console.log(` Clone Upstream source: ${tag.slice(1)}`);

  if (await hasPath(path.join(upstreamDir, '.git'))) {
    await run('git', ['fetch', '--depth', '1', 'origin', tag], { cwd: upstreamDir });
    await run('git', ['checkout', '--detach', 'FETCH_HEAD'], { cwd: upstreamDir });
    return;
  }

  await rm(upstreamDir, { recursive: true, force: true });
  await run('git', ['clone', '--depth', '1', '--branch', tag, '--', 'https://github.com/dotnet/aspnetcore.git', upstreamDir], {
    cwd: rootDir,
  });
}

async function prebuildWorkspacePackages(upstreamDir, env) {
  console.log('---------------------------------------');
  console.log(' Build required packages(JSInteop, SignalR, and relation packages)');
  await patchTslibOverride(path.join(upstreamDir, 'package.json'));
  await patchSignalRAbortController(path.join(upstreamDir, 'src/SignalR/clients/ts/signalr/src/FetchHttpClient.ts'));
  await retry(3, 15_000, () => run('npm', ['install', '--ignore-scripts'], { cwd: upstreamDir, env }));
  await run('npm', ['run', 'build', '--workspace=src/JSInterop/Microsoft.JSInterop.JS/src'], { cwd: upstreamDir, env });
  await run('npm', ['run', 'build', '--workspace=src/SignalR/clients/ts/signalr'], { cwd: upstreamDir, env });
  await run('npm', ['run', 'build', '--workspace=src/SignalR/clients/ts/signalr-protocol-msgpack'], { cwd: upstreamDir, env });
}

async function prebuildYarnPackages(upstreamDir, env) {
  console.log('---------------------------------------');
  console.log(' Build required packages(JSInteop, SignalR, and relation packages)');
  await run('corepack', ['prepare', 'yarn@1.22.22', '--activate'], { cwd: rootDir, env });
  await patchSignalRAbortController(path.join(upstreamDir, 'src/SignalR/clients/ts/signalr/src/FetchHttpClient.ts'));
  await runYarnBuild(path.join(upstreamDir, 'src/JSInterop/Microsoft.JSInterop.JS/src'), env);
  await retry(3, 15_000, () => run('yarn', ['install', '--mutex', 'network', '--frozen-lockfile', '--ignore-engines'], {
    cwd: path.join(upstreamDir, 'src/SignalR/clients/ts/common'),
    env,
  }));
  await runYarnBuild(path.join(upstreamDir, 'src/SignalR/clients/ts/signalr'), env);
  await runYarnBuild(path.join(upstreamDir, 'src/SignalR/clients/ts/signalr-protocol-msgpack'), env);
}

export async function buildUpstream({
  major,
  tag,
  nodeBin = process.execPath,
  buildProfiles = process.env.BUILD_TARGET_PROFILES,
  skipPrebuild = process.env.SKIP_PREBUILD === 'true',
  repository = process.env.UPSTREAM_REPOSITORY ?? 'dotnet/aspnetcore',
  includePrerelease = process.env.INCLUDE_PRERELEASE === 'true',
  githubToken = process.env.GITHUB_TOKEN,
} = {}) {
  const resolvedTag = await resolveTag({ major, tag, repository, includePrerelease, githubToken });
  const parsed = parseAspNetTag(resolvedTag);
  if (!parsed) {
    throw new Error(`Invalid ASP.NET Core tag: ${resolvedTag}`);
  }

  const targetFramework = `net${parsed.major}.0`;
  const distDir = path.join(rootDir, 'dist', resolvedTag);
  const packageWwwroot = path.join(rootDir, 'src/LegacyBlazorJs/wwwroot');
  const upstreamDir = path.join(rootDir, '.work', `aspnetcore-${resolvedTag}`);
  const webJsDir = path.join(upstreamDir, 'src/Components/Web.JS');
  const { env, cleanup } = await prepareNodeShim(nodeBin);

  try {
    await checkoutUpstreamSource(upstreamDir, resolvedTag);

    if (skipPrebuild) {
      console.log('---------------------------------------');
      console.log(' Build required packages(JSInteop, SignalR, and relation packages)');
      console.log(' ... Skipped (SKIP_PREBUILD = true)');
    } else if (await usesNpmWorkspaces(upstreamDir)) {
      await prebuildWorkspacePackages(upstreamDir, env);
    } else {
      await prebuildYarnPackages(upstreamDir, env);
    }

    console.log('---------------------------------------');
    console.log(' Build Web.JS per profile target');
    await buildVariants({
      sourceDir: webJsDir,
      output: distDir,
      tag: resolvedTag,
      profiles: buildProfiles,
    });

    await rm(packageWwwroot, { recursive: true, force: true });
    await cp(distDir, packageWwwroot, { recursive: true });

    console.log('---------------------------------------');
    console.log(' Pack the Razor class library with the upstream version');
    await run('dotnet', [
      'pack',
      path.join(rootDir, 'src/LegacyBlazorJs/LegacyBlazorJs.csproj'),
      '-c',
      'Release',
      `-p:PackageVersion=${parsed.version}`,
      `-p:LegacyBlazorTargetFramework=${targetFramework}`,
      '-o',
      path.join(rootDir, 'artifacts/packages'),
    ], {
      cwd: rootDir,
      env,
    });
  } finally {
    await cleanup();
  }

  return parsed;
}
