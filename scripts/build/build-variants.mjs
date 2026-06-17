#!/usr/bin/env node
import { copyFile, mkdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { run } from './lib/process.mjs';
import { readSelectedTargets } from './lib/config.mjs';
import { transformLegacyDynamicImport } from './lib/legacy-output.mjs';
import { parseAspNetTag } from './lib/version.mjs';

function arg(name, fallback, argv = process.argv.slice(2)) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : fallback;
}

function resolveBabelTargets(profile) {
  return profile.intendedBrowsers;
}

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

async function readFirstExisting(paths) {
  for (const candidate of paths) {
    try {
      return await readFile(candidate, 'utf8');
    } catch (error) {
      if (error?.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  throw new Error(`None of the expected upstream files exist:\n${paths.join('\n')}`);
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

async function usesNpmWorkspaces(sourceDir) {
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

  return null;
}

async function writeRollupLegacyPluginsModule(bundlerConfigPath) {
  const pluginsIndexPath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lib', 'rollup-plugins', 'index.mjs');
  const bridgePath = path.join(path.dirname(bundlerConfigPath), 'for-legacy-plugins.mjs');
  
  // Simple bridge that just re-exports from the rollup-plugins directory
  const bridgeSource = `import { legacyBlazorPlugins as legacyBlazorPluginsImpl } from ${JSON.stringify(pathToFileURL(pluginsIndexPath).href)};

export function legacyBlazorPlugins() {
  const targets = JSON.parse(process.env.LEGACY_BLAZOR_BABEL_TARGETS ?? '{}');
  return legacyBlazorPluginsImpl(targets);
}
`;
  
  await writeFile(bridgePath, bridgeSource);
  return bridgePath;
}

function withRollupLegacyPlugins(configSource) {
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

async function postProcessLegacyOutputs(distDir, profile, shouldDownlevel) {
  // this method is legacy support ( < 8 ), will be removed in future.
  const files = ['blazor.web.js', 'blazor.webassembly.js', 'blazor.server.js', 'blazor.webview.js'];
  const legacyRequire = createRequire(path.join(rootDir, 'package.json'));
  const babel = shouldDownlevel ? legacyRequire('@babel/core') : null;
  const targets = shouldDownlevel ? resolveBabelTargets(profile) : null;

  for (const file of files) {
    const filePath = path.join(distDir, file);
    let source = await readFile(filePath, 'utf8');

    if (shouldDownlevel) {
      const result = babel.transformSync(source, {
        presets: [[
          '@babel/preset-env', {
            targets,
          },
        ]],
        filename: file,
        compact: true,
      });
      source = result.code;
    }

    source = transformLegacyDynamicImport(source, file);
    await writeFile(filePath, source);
  }
}

export async function buildVariants({
  sourceDir = path.resolve('src/Components/Web.JS'),
  output = path.resolve('src/LegacyBlazorJs/wwwroot'),
  tag = process.env.ASPNETCORE_TAG,
  profiles = process.env.BUILD_TARGET_PROFILES,
} = {}) {
  const parsed = parseAspNetTag(tag ?? '');
  if (!parsed) {
    throw new Error('A valid --tag vX.Y.Z is required.');
  }

  const previousProfiles = process.env.BUILD_TARGET_PROFILES;
  if (profiles) {
    process.env.BUILD_TARGET_PROFILES = profiles;
  } else {
    delete process.env.BUILD_TARGET_PROFILES;
  }

  const targets = await readSelectedTargets();
  const npmWorkspace = await usesNpmWorkspaces(sourceDir);
  const bundlerConfigPath = await firstExisting([
    path.join(sourceDir, 'src/webpack.config.js'),
    path.join(sourceDir, '../Shared.JS/rollup.config.mjs'),
  ]);
  const tsconfigPath = bundlerConfigPath.endsWith('webpack.config.js')
    ? path.join(sourceDir, 'tsconfig.json')
    : path.join(sourceDir, '../Shared.JS/tsconfig.json');
  const isRollupBuild = bundlerConfigPath.endsWith('rollup.config.mjs');
  const needsRollupLegacyPlugins = isRollupBuild && Object.values(targets).some(profile => profile.ecma < 2018);
  const rollupLegacyPluginsPath = needsRollupLegacyPlugins
    ? await writeRollupLegacyPluginsModule(bundlerConfigPath)
    : null;
  const originalTsconfig = await readFile(tsconfigPath, 'utf8');
  const originalBundlerConfig = await readFile(bundlerConfigPath, 'utf8');

  await rm(output, { recursive: true, force: true });
  await mkdir(output, { recursive: true });
  const files = {};

  try {
    for (const [name, profile] of Object.entries(targets)) {
      console.log(`****** Build "${name}" (target: ${profile.typescriptTarget}) ******`);

      const tsconfig = JSON.parse(originalTsconfig);
      tsconfig.compilerOptions.target = profile.typescriptTarget;
      if (profile.typescriptTarget === 'es5') {
        tsconfig.compilerOptions.downlevelIteration = true;
      }
      if (npmWorkspace) {
        tsconfig.compilerOptions.importHelpers = false;
        if (profile.ecma < 2018) {
          tsconfig.compilerOptions.target = 'es2018';
        }
      }
      await writeFile(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);

      const ecmaPatchedBundlerConfig = originalBundlerConfig.replace(/ecma:\s*\d+/g, `ecma: ${profile.ecma}`);
      if (ecmaPatchedBundlerConfig === originalBundlerConfig && !originalBundlerConfig.includes(`ecma: ${profile.ecma}`)) {
        throw new Error('Could not locate the upstream bundler/Terser ECMA target.');
      }

      const useRollupLegacyPlugins = isRollupBuild && profile.ecma < 2018;
      const bundlerConfig = useRollupLegacyPlugins
        ? withRollupLegacyPlugins(ecmaPatchedBundlerConfig)
        : ecmaPatchedBundlerConfig;
      if (useRollupLegacyPlugins) {
        process.env.LEGACY_BLAZOR_BABEL_TARGETS = JSON.stringify(resolveBabelTargets(profile));
      } else {
        delete process.env.LEGACY_BLAZOR_BABEL_TARGETS;
      }
      await writeFile(bundlerConfigPath, bundlerConfig);

      if (npmWorkspace) {
        await run('npm', ['run', 'build:production', `--workspace=${npmWorkspace.workspacePath}`], { cwd: npmWorkspace.root });
      } else {
        await run('yarn', ['install', '--mutex', 'network', '--frozen-lockfile', '--ignore-engines'], { cwd: sourceDir });
        await run('yarn', ['run', 'build:production'], { cwd: sourceDir });
      }

      await postProcessLegacyOutputs(path.join(sourceDir, 'dist', 'Release'), profile, !isRollupBuild && profile.ecma < 2018);

      const webFilename = `blazor.web.${name}.js`;
      const webAssemblyFilename = `blazor.webassembly.${name}.js`;
      const serverFilename = `blazor.server.${name}.js`;
      const webviewFilename = `blazor.webview.${name}.js`;
      await copyFile(path.join(sourceDir, 'dist/Release/blazor.web.js'), path.join(output, webFilename));
      await copyFile(path.join(sourceDir, 'dist/Release/blazor.webassembly.js'), path.join(output, webAssemblyFilename));
      await copyFile(path.join(sourceDir, 'dist/Release/blazor.server.js'), path.join(output, serverFilename));
      await copyFile(path.join(sourceDir, 'dist/Release/blazor.webview.js'), path.join(output, webviewFilename));
      files[name] = {
        file: webFilename,
        webAssemblyFile: webAssemblyFilename,
        serverFile: serverFilename,
        webviewFile: webviewFilename,
        name,
        description: profile.description,
        ecma: profile.ecma,
      };
    }
  } finally {
    await writeFile(tsconfigPath, originalTsconfig);
    await writeFile(bundlerConfigPath, originalBundlerConfig);
    if (rollupLegacyPluginsPath) {
      await unlink(rollupLegacyPluginsPath).catch(() => {});
    }
    delete process.env.LEGACY_BLAZOR_BABEL_TARGETS;
    if (previousProfiles) {
      process.env.BUILD_TARGET_PROFILES = previousProfiles;
    } else {
      delete process.env.BUILD_TARGET_PROFILES;
    }
  }

  await writeFile(
    path.join(output, 'build-manifest.json'),
    `${JSON.stringify({ upstreamTag: parsed.tag, packageVersion: parsed.version, files }, null, 2)}\n`);
  console.log(`Built ${Object.keys(files).length} upstream variants for ${parsed.tag} in ${output}`);
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  await buildVariants({
    sourceDir: path.resolve(arg('source-dir', 'src/Components/Web.JS')),
    output: path.resolve(arg('output', 'src/LegacyBlazorJs/wwwroot')),
    tag: arg('tag', process.env.ASPNETCORE_TAG),
    profiles: arg('profiles', process.env.BUILD_TARGET_PROFILES),
  });
}
