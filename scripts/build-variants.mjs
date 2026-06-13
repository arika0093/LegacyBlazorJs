#!/usr/bin/env node
import { readFile, writeFile, mkdir, rm, copyFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { parseAspNetTag } from './version-lib.mjs';

function arg(name, fallback) { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback; }
function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited with code ${code}`)));
  });
}

const sourceDir = path.resolve(arg('source-dir', 'src/Components/Web.JS'));
const output = path.resolve(arg('output', 'src/LegacyBlazorJs/wwwroot'));
const parsed = parseAspNetTag(arg('tag', process.env.ASPNETCORE_TAG) ?? '');
if (!parsed) throw new Error('A valid --tag vX.Y.Z is required.');
const targets = JSON.parse(await readFile(new URL('../config/targets.json', import.meta.url), 'utf8'));
const tsconfigPath = path.join(sourceDir, 'tsconfig.json');
const webpackPath = path.join(sourceDir, 'src/webpack.config.js');
const originalTsconfig = await readFile(tsconfigPath, 'utf8');
const originalWebpack = await readFile(webpackPath, 'utf8');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const files = {};

try {
  for (const [name, profile] of Object.entries(targets)) {
    const tsconfig = JSON.parse(originalTsconfig);
    tsconfig.compilerOptions.target = profile.typescriptTarget;
    if (profile.typescriptTarget === 'es5') tsconfig.compilerOptions.downlevelIteration = true;
    await writeFile(tsconfigPath, `${JSON.stringify(tsconfig, null, 2)}\n`);
    const webpack = originalWebpack.replaceAll('ecma: 2019', `ecma: ${profile.ecma}`);
    if (webpack === originalWebpack && profile.ecma !== 2019) {
      throw new Error('Could not locate the upstream webpack/Terser ECMA target.');
    }
    await writeFile(webpackPath, webpack);
    await run('yarn', ['run', 'build:production'], sourceDir);
    const filename = `blazor.web.${name}.js`;
    await copyFile(path.join(sourceDir, 'dist/Release/blazor.web.js'), path.join(output, filename));
    files[name] = { file: filename, description: profile.description, ecma: profile.ecma };
  }
} finally {
  await writeFile(tsconfigPath, originalTsconfig);
  await writeFile(webpackPath, originalWebpack);
}
await writeFile(path.join(output, 'build-manifest.json'), `${JSON.stringify({ upstreamTag: parsed.tag, packageVersion: parsed.version, files }, null, 2)}\n`);
console.log(`Built ${Object.keys(files).length} upstream variants for ${parsed.tag} in ${output}`);
