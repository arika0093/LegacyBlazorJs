#!/usr/bin/env node
import { readFile, writeFile, mkdir, rm, copyFile, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { parseAspNetTag } from './version-lib.mjs';
import { readTargetsConfig } from './config-lib.mjs';

function arg(name, fallback) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; }
function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const invocation = process.platform === 'win32' && command === 'yarn'
      ? { command: 'cmd.exe', args: ['/d', '/s', '/c', 'yarn', ...args] }
      : { command, args };
    const child = spawn(invocation.command, invocation.args, { cwd, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}
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

const sourceDir = path.resolve(arg('source-dir', 'src/Components/Web.JS'));
const output = path.resolve(arg('output', 'src/LegacyBlazorJs/wwwroot'));
const parsed = parseAspNetTag(arg('tag', process.env.ASPNETCORE_TAG) ?? '');
if (!parsed) throw new Error('A valid --tag vX.Y.Z is required.');
// Target profiles define the JS syntax level we rebuild for each output file.
const targets = await readTargetsConfig();
const bundlerConfigPath = await firstExisting([
  path.join(sourceDir, 'src/webpack.config.js'),
  path.join(sourceDir, '../Shared.JS/rollup.config.mjs'),
]);
const tsconfigPath = bundlerConfigPath.endsWith('webpack.config.js')
  ? path.join(sourceDir, 'tsconfig.json')
  : path.join(sourceDir, '../Shared.JS/tsconfig.json');
const originalTsconfig = await readFile(tsconfigPath, 'utf8');
const originalBundlerConfig = await readFile(bundlerConfigPath, 'utf8');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const files = {};

try {
  for (const [name, profile] of Object.entries(targets)) {
    // Rewrite the upstream TypeScript target before each rebuild so the emitted syntax matches the profile.
    const tsconfig = JSON.parse(originalTsconfig);
    tsconfig.compilerOptions.target = profile.typescriptTarget;
    if (profile.typescriptTarget === 'es5') tsconfig.compilerOptions.downlevelIteration = true;
    await writeFile(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);

    // The bundler also needs the matching ECMA level so minification does not re-introduce newer syntax.
    const bundlerConfig = originalBundlerConfig.replace(/ecma:\s*\d+/g, `ecma: ${profile.ecma}`);
    if (bundlerConfig === originalBundlerConfig && !originalBundlerConfig.includes(`ecma: ${profile.ecma}`)) {
      throw new Error('Could not locate the upstream bundler/Terser ECMA target.');
    }
    await writeFile(bundlerConfigPath, bundlerConfig);
    await run('yarn', ['run', 'build:production'], sourceDir);
    const filename = `blazor.web.${name}.js`;
    await copyFile(path.join(sourceDir, 'dist/Release/blazor.web.js'), path.join(output, filename));
    files[name] = { file: filename, description: profile.description, ecma: profile.ecma };
  }
} finally {
  // Always restore upstream files so repeated builds start from a clean checkout.
  await writeFile(tsconfigPath, originalTsconfig);
  await writeFile(bundlerConfigPath, originalBundlerConfig);
}
await writeFile(path.join(output, 'build-manifest.json'), `${JSON.stringify({ upstreamTag: parsed.tag, packageVersion: parsed.version, files }, null, 2)}\n`);
console.log(`Built ${Object.keys(files).length} upstream variants for ${parsed.tag} in ${output}`);
