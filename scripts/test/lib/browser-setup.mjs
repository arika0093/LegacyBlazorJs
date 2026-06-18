import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { access, chmod, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pipeline } from 'node:stream/promises';
import { getRootDir } from './compat.mjs';

const DOWNLOAD_TIMEOUT_MS = 600_000;
const MAX_DOWNLOAD_ATTEMPTS = 3;

export async function setupCompatibilityBrowser(browser) {
  const browserDirectory = path.join(
    getRootDir(),
    'artifacts',
    'browsers',
    'chromium',
    browser.version,
    browser.cacheKey);
  const executablePath = await findExistingExecutablePath(browser, browserDirectory);
  if (executablePath) {
    await ensureExecutablePermissions(executablePath);
    return executablePath;
  }

  await mkdir(browserDirectory, { recursive: true });
  let archiveVariant = await findExistingArchiveVariant(browser, browserDirectory);
  if (!archiveVariant) {
    archiveVariant = await downloadBrowserArchiveWithRetry(browser, browserDirectory);
  }

  await extractArchive(archiveVariant.archivePath, browserDirectory);
  const extractedExecutablePath = await findExistingExecutablePath(
    browser,
    browserDirectory,
    [archiveVariant.executableRelativePath]);
  if (!extractedExecutablePath) {
    throw new Error(`Downloaded Chromium archive did not contain any expected executable: ${getExecutableRelativePaths(browser).join(', ')}`);
  }

  await ensureExecutablePermissions(extractedExecutablePath);
  return extractedExecutablePath;
}

async function extractArchive(archivePath, destinationDirectory) {
  if (process.platform === 'win32') {
    await run('powershell', [
      '-NoProfile',
      '-Command',
      `Expand-Archive -LiteralPath ${quotePowerShellString(archivePath)} -DestinationPath ${quotePowerShellString(destinationDirectory)} -Force`,
    ]);
    return;
  }

  await run('unzip', ['-o', archivePath, '-d', destinationDirectory]);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit' });
    child.once('error', reject);
    child.once('exit', exitCode => {
      if (exitCode === 0) {
        resolve();
      } else {
        reject(new Error(`Command '${command}' exited with code ${exitCode}.`));
      }
    });
  });
}

function quotePowerShellString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

async function findExistingExecutablePath(browser, browserDirectory, preferredRelativePaths = []) {
  for (const executableRelativePath of getExecutableRelativePaths(browser, preferredRelativePaths)) {
    const executablePath = path.join(browserDirectory, executableRelativePath);
    if (await exists(executablePath)) {
      return executablePath;
    }
  }

  return null;
}

async function findExistingArchiveVariant(browser, browserDirectory) {
  for (const variant of getDownloadVariants(browser)) {
    const archivePath = path.join(browserDirectory, path.basename(new URL(variant.downloadUrl).pathname));
    if (await exists(archivePath)) {
      return {
        ...variant,
        archivePath,
      };
    }
  }

  return null;
}

async function downloadBrowserArchiveWithRetry(browser, browserDirectory) {
  let lastError = null;
  for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt += 1) {
    for (const variant of getDownloadVariants(browser)) {
      const archivePath = path.join(browserDirectory, path.basename(new URL(variant.downloadUrl).pathname));
      try {
        await downloadBrowserArchive(variant.downloadUrl, archivePath);
        return {
          ...variant,
          archivePath,
        };
      } catch (error) {
        lastError = error;
        await rm(archivePath, { force: true });
        if (!isMissingArchiveError(error)) {
          break;
        }
      }
    }

    if (attempt === MAX_DOWNLOAD_ATTEMPTS) {
      throw lastError;
    }

    await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
  }

  throw lastError;
}

function getDownloadVariants(browser) {
  if (browser.downloadVariants?.length) {
    return browser.downloadVariants;
  }

  return [{
    downloadUrl: browser.downloadUrl,
    executableRelativePath: browser.executableRelativePath,
  }];
}

function getExecutableRelativePaths(browser, preferredRelativePaths = []) {
  const executableRelativePaths = [
    ...preferredRelativePaths,
    ...(browser.executableRelativePaths ?? getDownloadVariants(browser).map(variant => variant.executableRelativePath)),
  ];
  return [...new Set(executableRelativePaths)];
}

function isMissingArchiveError(error) {
  return error?.statusCode === 404;
}

async function downloadBrowserArchive(downloadUrl, archivePath) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(downloadUrl, { signal: controller.signal });
    if (!response.ok) {
      const error = new Error(`Chromium download failed for ${downloadUrl}: ${response.status} ${response.statusText}`);
      error.statusCode = response.status;
      throw error;
    }

    await pipeline(response.body, createWriteStream(archivePath));
  } catch (error) {
    if (error?.name === 'AbortError') {
      throw new Error(`Chromium download timed out after ${DOWNLOAD_TIMEOUT_MS}ms for ${downloadUrl}.`);
    }

    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function ensureExecutablePermissions(executablePath) {
  if (process.platform !== 'win32') {
    await chmod(executablePath, 0o755);
  }
}

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
