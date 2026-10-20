#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

// Upstream loads every JS initializer (including the dev-only
// dotnet-watch Hot Reload module) via `await import(...)` with no error
// handling. The legacy build rewrites dynamic imports to
// `__legacyDynamicImport`, which always throws in old browsers, so the
// Hot Reload initializer rejects `Promise.all` and prevents Blazor from
// attaching event handlers. Hot Reload is dev-only and must be skipped in
// legacy browsers instead of breaking startup.
const PATCH_MARKER = 'LegacyBlazorJs: skip legacy-unsupported Hot Reload initializer.';

const INITIALIZER_IMPORT_PATTERN =
  /if\s*\(\s*!asset\.moduleExports\s*\)\s*\{\s*adjustedPath\s*=\s*adjustPath\(asset\.name!\);\s*asset\.moduleExports\s*=\s*await\s+import\((?:\s*\/\*\s*webpackIgnore:\s*true\s*\*\/\s*)?adjustedPath\);\s*\}/u;

// .NET 9 shape: the initializer entry is a plain path string, e.g.
//   async function importAndInvokeInitializer(jsInitializer: JSInitializer, path: string): Promise<void> {
//     const adjustedPath = adjustPath(path);
//     const initializer = await import(/* webpackIgnore: true */ adjustedPath) as ...;
const LEGACY_V9_IMPORT_PATTERN =
  /const\s+adjustedPath\s*=\s*adjustPath\(path\);\s*const\s+initializer\s*=\s*await\s+import\((?:\s*\/\*\s*webpackIgnore:\s*true\s*\*\/\s*)?adjustedPath\)([^;]*);/u;

export function applyJsInitializersPatch(source) {
  if (source.includes(PATCH_MARKER)) {
    return { code: source, applied: false };
  }

  if (INITIALIZER_IMPORT_PATTERN.test(source)) {
    const replacement = `if (!asset.moduleExports) {
        adjustedPath = adjustPath(asset.name!);
        try {
          // ${PATCH_MARKER}
          asset.moduleExports = await import(/* webpackIgnore: true */ adjustedPath);
        } catch (e) {
          if (/DotNetWatch|hot[-_]?reload/i.test(adjustedPath || (asset && asset.name) || '')) {
            return;
          }
          throw e;
        }
      }`;

    return { code: source.replace(INITIALIZER_IMPORT_PATTERN, replacement), applied: true };
  }

  if (LEGACY_V9_IMPORT_PATTERN.test(source)) {
    const replacement = `const adjustedPath = adjustPath(path);
      let initializer;
      try {
        // ${PATCH_MARKER}
        initializer = await import(/* webpackIgnore: true */ adjustedPath)$1;
      } catch (e) {
        if (/DotNetWatch|hot[-_]?reload/i.test(adjustedPath || path || '')) {
          return;
        }
        throw e;
      }`;

    return { code: source.replace(LEGACY_V9_IMPORT_PATTERN, replacement), applied: true };
  }

  return { code: source, applied: false };
}

export async function patchJsInitializers(filePath) {
  const content = await readFile(filePath, 'utf8');
  const { code, applied } = applyJsInitializersPatch(content);

  if (!applied) {
    if (content.includes(PATCH_MARKER)) {
      console.log('JS initializers already tolerate Hot Reload import failures; skipping.');
      return true;
    }

    console.warn(`Could not locate the JS initializer dynamic import in '${filePath}'; patch not applied.`);
    return false;
  }

  await writeFile(filePath, code);
  console.log('Patched JS initializers to skip Hot Reload imports on legacy browsers.');
  return true;
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error('Usage: patch-js-initializers.mjs <JSInitializers.ts path>');
  }

  const applied = await patchJsInitializers(filePath);
  if (!applied) {
    process.exitCode = 1;
  }
}
