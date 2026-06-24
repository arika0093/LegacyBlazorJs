import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const polyfillsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../polyfills');

export function resolveBuildPolyfillPath(fileName) {
  return path.join(polyfillsDir, fileName);
}

export function readBuildPolyfillFile(fileName) {
  return readFile(resolveBuildPolyfillPath(fileName), 'utf8');
}

export function resolvePackageSourcePath(moduleId) {
  return require.resolve(moduleId);
}

export function readPackageSourceFile(moduleId) {
  return readFile(resolvePackageSourcePath(moduleId), 'utf8');
}
