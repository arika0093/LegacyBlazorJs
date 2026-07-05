import { cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minify } from 'terser';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const staticPackageAssetsDir = path.join(rootDir, 'src', 'build', 'static-package-assets');

async function* enumerateFiles(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      yield* enumerateFiles(entryPath);
      continue;
    }

    if (entry.isFile()) {
      yield entryPath;
    }
  }
}

async function writeJavaScriptAsset(sourcePath, destinationPath) {
  const source = await readFile(sourcePath, 'utf8');
  if (process.env.LEGACY_BLAZOR_DISABLE_TERSER === 'true') {
    await writeFile(destinationPath, `${source.trimEnd()}\n`);
    return;
  }

  const result = await minify(source, {
    compress: true,
    mangle: true,
    format: {
      comments: false,
    },
  });

  if (!result.code) {
    throw new Error(`Failed to minify '${sourcePath}'.`);
  }

  await writeFile(destinationPath, `${result.code}\n`);
}

export async function writeStaticPackageAssets(destinationDirectory) {
  await mkdir(destinationDirectory, { recursive: true });

  for await (const sourcePath of enumerateFiles(staticPackageAssetsDir)) {
    const relativePath = path.relative(staticPackageAssetsDir, sourcePath);
    const destinationPath = path.join(destinationDirectory, relativePath);

    await mkdir(path.dirname(destinationPath), { recursive: true });
    if (path.extname(sourcePath) === '.js') {
      await writeJavaScriptAsset(sourcePath, destinationPath);
      continue;
    }

    await cp(sourcePath, destinationPath);
  }
}
