#!/usr/bin/env node
import { readFile, writeFile, mkdir, rm, copyFile, access, unlink } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import process from 'node:process';
import { parseAspNetTag } from './version-lib.mjs';
import { readSelectedTargets } from './config-lib.mjs';

/** Parse a command-line flag and return the following value, or the fallback. */
function arg(name, fallback) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; }

/** Run a command in the given directory and fail on non-zero exit codes. */
function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    // On Windows, npm/yarn may not be directly executable, so invoke them through cmd.exe.
    const invocation = process.platform === 'win32' && (command === 'yarn' || command === 'npm')
      ? { command: 'cmd.exe', args: ['/d', '/s', '/c', command, ...args] }
      : { command, args };
    const child = spawn(invocation.command, invocation.args, { cwd, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

/** Return the first accessible path, allowing for layout differences across upstream versions. */
async function firstExisting(paths) {
  for (const candidate of paths) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next layout used by another ASP.NET Core major version.
    }
  }
  throw new Error(`None of the expected upstream files exist:\n${paths.join('\n')}`);
}

/** Determine whether the upstream source uses npm workspaces instead of Yarn. */
async function usesNpmWorkspaces(sourceDir) {
  // Walk up from the Web.JS folder to find the upstream repository root (where package.json defines workspaces).
  let current = path.resolve(sourceDir);
  for (let depth = 0; depth < 5; depth++) {
    const parent = path.dirname(current);
    if (parent === current) break;
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

/** Resolve the browser target list used when Babel down-levels a generated bundle. */
function resolveBabelTargets(profile) {
  return profile.intendedBrowsers;
}


/** Write the Rollup Babel bridge module next to the upstream Rollup config. */
async function writeRollupBabelBridge(bundlerConfigPath) {
  const legacyRequire = createRequire(path.join(process.cwd(), 'package.json'));
  const babelPluginPath = legacyRequire.resolve('@rollup/plugin-babel');
  const presetEnvPath = legacyRequire.resolve('@babel/preset-env');
  const bridgePath = path.join(path.dirname(bundlerConfigPath), 'legacy-blazor-babel-plugin.mjs');
  const bridgeSource = `import { babel } from ${JSON.stringify(pathToFileURL(babelPluginPath).href)};
import presetEnv from ${JSON.stringify(pathToFileURL(presetEnvPath).href)};

export function legacyBlazorBabelPlugin() {
  const targets = JSON.parse(process.env.LEGACY_BLAZOR_BABEL_TARGETS ?? '{}');
  return babel({
    babelHelpers: 'bundled',
    extensions: ['.js', '.mjs', '.ts'],
    exclude: /node_modules/,
    presets: [[
      presetEnv, {
        targets,
        modules: false,
        bugfixes: true,
        useBuiltIns: 'usage',
        corejs: '3'
      }
    ]]
  });
}
`;
  await writeFile(bridgePath, bridgeSource);
  return bridgePath;
}

/** Inject Babel into the upstream Rollup plugin chain before Terser so polyfills are bundled and minified. */
function withRollupBabelPlugin(configSource) {
  const importLine = "import { legacyBlazorBabelPlugin } from './legacy-blazor-babel-plugin.mjs';";
  const withImport = configSource.includes(importLine)
    ? configSource
    : `${importLine}\n${configSource}`;

  if (withImport.includes('legacyBlazorBabelPlugin(),')) {
    return withImport;
  }

  const patched = withImport.replace(/(\n\s*)terser\(\{/m, '$1legacyBlazorBabelPlugin(),$1terser({');
  if (patched === withImport) {
    throw new Error('Could not locate the upstream Rollup Terser plugin to insert Babel before it.');
  }
  return patched;
}

/** Down-level the already-bundled JS files when the upstream bundler cannot target older ECMA versions. */
async function postProcessForProfile(distDir, profile) {
  const files = ['blazor.web.js', 'blazor.webassembly.js', 'blazor.server.js', 'blazor.webview.js'];

  if (profile.ecma >= 2018) {
    return;
  }

  const legacyRequire = createRequire(path.join(process.cwd(), 'package.json'));
  const babel = legacyRequire('@babel/core');
  const targets = resolveBabelTargets(profile);

  console.log(`*** transform execute (profile=${profile.description}) `)
  for (const file of files) {
    const filePath = path.join(distDir, file);
    const source = await readFile(filePath, 'utf8');
    console.log(`* transform: ${file}`)
    const result = babel.transformSync(source, {
      presets: [[
        '@babel/preset-env', {
          targets,
        }]],
      filename: file,
      compact: true,
    });
    await writeFile(filePath, result.code);
  }
}

const sourceDir = path.resolve(arg('source-dir', 'src/Components/Web.JS'));
const output = path.resolve(arg('output', 'src/LegacyBlazorJs/wwwroot'));
const parsed = parseAspNetTag(arg('tag', process.env.ASPNETCORE_TAG) ?? '');
if (!parsed) throw new Error('A valid --tag vX.Y.Z is required.');
const selectedProfiles = arg('profiles', process.env.BUILD_TARGET_PROFILES);
if (selectedProfiles) {
  process.env.BUILD_TARGET_PROFILES = selectedProfiles;
}
// Target profiles define the JS syntax level we rebuild for each output file.
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
const rollupBabelBridgePath = isRollupBuild ? await writeRollupBabelBridge(bundlerConfigPath) : null;
const originalTsconfig = await readFile(tsconfigPath, 'utf8');
const originalBundlerConfig = await readFile(bundlerConfigPath, 'utf8');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const files = {};

try {
  for (const [name, profile] of Object.entries(targets)) {
    console.log(`****** Build "${name}" (target: ${profile.typescriptTarget}) ******`);

    // Rewrite the upstream TypeScript target before each rebuild so the emitted syntax matches the profile.
    const tsconfig = JSON.parse(originalTsconfig);
    tsconfig.compilerOptions.target = profile.typescriptTarget;
    if (profile.typescriptTarget === 'es5') tsconfig.compilerOptions.downlevelIteration = true;
    if (npmWorkspace) {
      // ASP.NET Core 9+ workspaces ship an older tslib that does not include helpers like __spreadArray.
      // Emit helpers inline so the build succeeds across all down-level targets.
      tsconfig.compilerOptions.importHelpers = false;
      if (profile.ecma < 2018) {
        // The upstream source uses ES2018 syntax (e.g. named capturing groups) that TypeScript refuses
        // to emit when targeting older ECMA versions. Compile to ES2018 first, then let Babel down-level it.
        tsconfig.compilerOptions.target = 'es2018';
      }
    }
    await writeFile(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);

    // The bundler also needs the matching ECMA level so minification does not re-introduce newer syntax.
    const ecmaPatchedBundlerConfig = originalBundlerConfig.replace(/ecma:\s*\d+/g, `ecma: ${profile.ecma}`);
    if (ecmaPatchedBundlerConfig === originalBundlerConfig && !originalBundlerConfig.includes(`ecma: ${profile.ecma}`)) {
      throw new Error('Could not locate the upstream bundler/Terser ECMA target.');
    }
    const bundlerConfig = isRollupBuild && profile.ecma < 2018
      ? withRollupBabelPlugin(ecmaPatchedBundlerConfig)
      : ecmaPatchedBundlerConfig;
    process.env.LEGACY_BLAZOR_BABEL_TARGETS = JSON.stringify(resolveBabelTargets(profile));
    await writeFile(bundlerConfigPath, bundlerConfig);

    if (npmWorkspace) {
      // ASP.NET Core 9+ uses npm workspaces; run the Web.JS build from the repository root.
      await run('npm', ['run', 'build:production', `--workspace=${npmWorkspace.workspacePath}`], npmWorkspace.root);
    } else {
      // Older ASP.NET Core versions use Yarn v1 with package links.
      await run('yarn', ['install', '--mutex', 'network', '--frozen-lockfile', '--ignore-engines'], sourceDir);
      await run('yarn', ['run', 'build:production'], sourceDir);
    }

    if (!isRollupBuild && profile.ecma < 2018) {
      const distDir = path.join(sourceDir, 'dist', 'Release');
      await postProcessForProfile(distDir, profile);
    }

    // copy build results
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
      name: name,
      description: profile.description,
      ecma: profile.ecma
    };
  }
} finally {
  // Always restore upstream files so repeated builds start from a clean checkout.
  await writeFile(tsconfigPath, originalTsconfig);
  await writeFile(bundlerConfigPath, originalBundlerConfig);
  if (rollupBabelBridgePath) await unlink(rollupBabelBridgePath).catch(() => {});
  delete process.env.LEGACY_BLAZOR_BABEL_TARGETS;
}
await writeFile(path.join(output, 'build-manifest.json'), `${JSON.stringify({ upstreamTag: parsed.tag, packageVersion: parsed.version, files }, null, 2)}\n`);
console.log(`Built ${Object.keys(files).length} upstream variants for ${parsed.tag} in ${output}`);
