#!/usr/bin/env node
import { access, copyFile, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from './lib/process.mjs';
import { readSelectedTargets } from './lib/config.mjs';
import { cleanGeneratedPackageAssets, copyStaticPackageAssets } from './lib/package-static-assets.mjs';
import { runEsCheck } from './run-es-check.mjs';
import { patchBlazorRegex } from './patches/patch-blazor-regex.mjs';
import { patchSignalRLogging } from './patches/patch-signalr-logging.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const packageWwwroot = path.join(rootDir, 'dotnet', 'src', 'LegacyBlazorJs', 'wwwroot');

function resolveBabelTargets(profile) {
  return profile.intendedBrowsers;
}

async function firstExisting(paths) {
  for (const candidate of paths) {
    try {
      await readFile(candidate, 'utf8');
      return candidate;
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  throw new Error(`None of the expected upstream files exist:\n${paths.join('\n')}`);
}

async function firstExistingReleaseDirectory(paths) {
  for (const candidate of paths) {
    try {
      await Promise.all([
        access(path.join(candidate, 'blazor.web.js')),
        access(path.join(candidate, 'blazor.webassembly.js')),
        access(path.join(candidate, 'blazor.server.js')),
      ]);
      return candidate;
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  throw new Error(`None of the expected upstream release directories contain the required framework JS bundles:\n${paths.join('\n')}`);
}

async function resolveBuildOutputLayout(sourceDir) {
  const frameworkDir = await firstExistingReleaseDirectory([
    path.join(sourceDir, 'dist/Release/_framework'),
    path.join(sourceDir, 'dist/Release'),
  ]);

  const webviewPath = await firstExisting([
    path.join(sourceDir, 'dist/Release/blazor.webview.js'),
    path.join(sourceDir, 'dist/Release/_framework/blazor.webview.js'),
  ]);

  return { frameworkDir, webviewPath };
}

async function resolveNpmWorkspace(sourceDir) {
  let current = path.resolve(sourceDir);
  for (let depth = 0; depth < 5; depth += 1) {
    const parent = path.dirname(current);
    if (parent === current) {
      break;
    }

    current = parent;
    try {
      const rootPackage = JSON.parse(await readFile(path.join(current, 'package.json'), 'utf8'));
      if (Array.isArray(rootPackage.workspaces) && rootPackage.workspaces.length > 0) {
        return { root: current, workspacePath: path.relative(current, sourceDir) };
      }
    } catch {
      // Continue walking up.
    }
  }

  throw new Error(`Could not locate an npm workspace root for '${sourceDir}'. Legacy yarn-based builds are no longer supported.`);
}

async function writeRollupLegacyPluginsModule(bundlerConfigPath) {
  const pluginsIndexPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'rollup-plugins', 'index.mjs');
  const bridgePath = path.join(path.dirname(bundlerConfigPath), 'for-legacy-plugins.mjs');

  const bridgeSource = `import { legacyBlazorPlugins as legacyBlazorPluginsImpl } from ${JSON.stringify(pathToFileURL(pluginsIndexPath).href)};

export function legacyBlazorPlugins() {
  const targets = JSON.parse(process.env.LEGACY_BLAZOR_BABEL_TARGETS ?? '{}');
  return legacyBlazorPluginsImpl(targets);
}
`;

  await writeFile(bridgePath, bridgeSource);
  return bridgePath;
}

function findRollupTerserCall(configSource) {
  const match = /(^[ \t]*)terser\(\{/m.exec(configSource);
  if (!match) {
    throw new Error('Could not locate the upstream Rollup Terser plugin.');
  }

  const start = match.index + match[1].length;
  let index = start + 'terser('.length;
  let parenDepth = 1;

  while (index < configSource.length && parenDepth > 0) {
    const char = configSource[index];
    if (char === '(') {
      parenDepth += 1;
    } else if (char === ')') {
      parenDepth -= 1;
    }
    index += 1;
  }

  if (parenDepth !== 0) {
    throw new Error('Could not find the end of the upstream Rollup Terser plugin.');
  }

  while (index < configSource.length && /[ \t]/.test(configSource[index])) {
    index += 1;
  }
  if (configSource[index] === ',') {
    index += 1;
  }

  return {
    start,
    end: index,
    indentation: match[1],
    source: configSource.slice(start, index),
  };
}

export function withOptionalRollupTerser(configSource) {
  if (configSource.includes('LegacyBlazorJs: terser disabled via LEGACY_BLAZOR_DISABLE_TERSER.')) {
    return configSource;
  }

  const terserCall = findRollupTerserCall(configSource);
  const commentedSource = [
    `${terserCall.indentation}// LegacyBlazorJs: terser disabled via LEGACY_BLAZOR_DISABLE_TERSER.`,
    ...terserCall.source.split('\n').map(line => `${terserCall.indentation}// ${line}`),
  ].join('\n');

  return `${configSource.slice(0, terserCall.start)}${commentedSource}${configSource.slice(terserCall.end)}`;
}

export function withRollupLegacyPlugins(configSource) {
  const importLine = "import { legacyBlazorPlugins } from './for-legacy-plugins.mjs';";
  const withImport = configSource.includes(importLine)
    ? configSource
    : `${importLine}\n${configSource}`;

  if (withImport.includes('...legacyBlazorPlugins(),')) {
    return withImport;
  }

  const patched = withImport.replace(/(\n\s*)terser\(\{/m, '$1...legacyBlazorPlugins(),$1terser({');
  if (patched === withImport) {
    throw new Error('Could not locate the upstream Rollup Terser plugin to insert legacy plugins before it.');
  }

  return patched;
}

export function withHiddenProductionServerSourcemap(configSource) {
  const patched = configSource.replace(
    /environment === 'production' && \(output === 'blazor\.web' \|\| output === 'blazor\.webassembly'\)/u,
    "environment === 'production' && (output === 'blazor.web' || output === 'blazor.webassembly' || output === 'blazor.server')");

  if (patched === configSource) {
    throw new Error('Could not locate the upstream Web.JS production sourcemap condition.');
  }

  return patched;
}

export async function buildVariants({
  sourceDir = path.resolve('src/Components/Web.JS'),
  output = path.resolve('dotnet/src/LegacyBlazorJs/wwwroot'),
  upstreamRef = process.env.UPSTREAM_REF ?? process.env.ASPNETCORE_TAG,
  upstreamTag = process.env.ASPNETCORE_TAG,
  packageVersion = process.env.PACKAGE_VERSION,
  profiles = process.env.BUILD_TARGET_PROFILES,
} = {}) {
  if (!upstreamRef) {
    throw new Error('Set UPSTREAM_REF or ASPNETCORE_TAG before building variants.');
  }
  if (!packageVersion) {
    throw new Error('Set PACKAGE_VERSION before building variants.');
  }

  const previousProfiles = process.env.BUILD_TARGET_PROFILES;
  if (profiles) {
    process.env.BUILD_TARGET_PROFILES = profiles;
  } else {
    delete process.env.BUILD_TARGET_PROFILES;
  }

  await patchBlazorRegex(path.join(sourceDir, 'src/Services/ComponentDescriptorDiscovery.ts'));
  await patchSignalRLogging(path.join(sourceDir, 'src/Platform/Circuits/CircuitStartOptions.ts'));

  const targets = await readSelectedTargets();
  const npmWorkspace = await resolveNpmWorkspace(sourceDir);
  const bundlerConfigPath = await firstExisting([
    path.join(sourceDir, '../Shared.JS/rollup.config.mjs'),
  ]);
  const webJsConfigPath = await firstExisting([
    path.join(sourceDir, 'rollup.config.mjs'),
  ]);
  const tsconfigPath = path.join(sourceDir, '../Shared.JS/tsconfig.json');
  const rollupLegacyPluginsPath = await writeRollupLegacyPluginsModule(bundlerConfigPath);
  const originalTsconfig = await readFile(tsconfigPath, 'utf8');
  const originalBundlerConfig = await readFile(bundlerConfigPath, 'utf8');
  const originalWebJsConfig = await readFile(webJsConfigPath, 'utf8');

  if (path.resolve(output) === packageWwwroot) {
    await cleanGeneratedPackageAssets(output);
  } else {
    await rm(output, { recursive: true, force: true });
    await mkdir(output, { recursive: true });
    await copyStaticPackageAssets(packageWwwroot, output);
  }

  const files = {};

  try {
    for (const [name, profile] of Object.entries(targets)) {
      console.log(`****** Build "${name}" (target: ${profile.typescriptTarget}) ******`);

      const ecmaPatchedBundlerConfig = originalBundlerConfig.replace(/ecma:\s*\d+/g, `ecma: ${profile.ecma}`);
      if (ecmaPatchedBundlerConfig === originalBundlerConfig && !originalBundlerConfig.includes(`ecma: ${profile.ecma}`)) {
        throw new Error('Could not locate the upstream Rollup Terser ECMA target.');
      }

      let bundlerConfig = withRollupLegacyPlugins(ecmaPatchedBundlerConfig);
      if (process.env.LEGACY_BLAZOR_DISABLE_TERSER === 'true') {
        bundlerConfig = withOptionalRollupTerser(bundlerConfig);
      }
      const webJsConfig = withHiddenProductionServerSourcemap(originalWebJsConfig);

      process.env.LEGACY_BLAZOR_BABEL_TARGETS = JSON.stringify(resolveBabelTargets(profile));
      process.env.LEGACY_BLAZOR_TARGET_PROFILE = name;
      await writeFile(bundlerConfigPath, bundlerConfig);
      await writeFile(webJsConfigPath, webJsConfig);
      await run('npm', ['run', 'build:production', `--workspace=${npmWorkspace.workspacePath}`], { cwd: npmWorkspace.root });
      const { frameworkDir, webviewPath } = await resolveBuildOutputLayout(sourceDir);

      // NOTE: WebAssembly and WebView are not currently supported, so there is no need to copy the output.
      const webFilename = `blazor.web.${name}.js`;
      const serverFilename = `blazor.server.${name}.js`;
      await copyFile(path.join(frameworkDir, 'blazor.web.js'), path.join(output, webFilename));
      await copyFile(path.join(frameworkDir, 'blazor.server.js'), path.join(output, serverFilename));

      files[name] = {
        file: webFilename,
        serverFile: serverFilename,
        name,
        description: profile.description,
        ecma: profile.ecma,
      };
    }

    await runEsCheck({ outputDir: output, targets });
  } finally {
    await writeFile(tsconfigPath, originalTsconfig);
    await writeFile(bundlerConfigPath, originalBundlerConfig);
    await writeFile(webJsConfigPath, originalWebJsConfig);
    await unlink(rollupLegacyPluginsPath).catch(() => {});
    delete process.env.LEGACY_BLAZOR_BABEL_TARGETS;
    delete process.env.LEGACY_BLAZOR_TARGET_PROFILE;
    if (previousProfiles) {
      process.env.BUILD_TARGET_PROFILES = previousProfiles;
    } else {
      delete process.env.BUILD_TARGET_PROFILES;
    }
  }

  await writeFile(
    path.join(output, 'build-manifest.json'),
    `${JSON.stringify({ upstreamRef, upstreamTag: upstreamTag ?? null, packageVersion, files }, null, 2)}\n`);
  console.log(`Built ${Object.keys(files).length} upstream variants for ${upstreamRef} in ${output}`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  await buildVariants();
}
