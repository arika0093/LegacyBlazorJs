import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { access, chmod, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pipeline } from 'node:stream/promises';
import { getRootDir } from './compat-lib.mjs';

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
  const executablePath = path.join(browserDirectory, browser.executableRelativePath);

  if (await exists(executablePath)) {
    await ensureExecutablePermissions(executablePath);
    return executablePath;
  }

  await mkdir(browserDirectory, { recursive: true });
  const archivePath = path.join(browserDirectory, path.basename(new URL(browser.downloadUrl).pathname));
  if (!await exists(archivePath)) {
    await downloadBrowserArchiveWithRetry(browser.downloadUrl, archivePath);
  }

  await extractArchive(archivePath, browserDirectory);
  if (!await exists(executablePath)) {
    throw new Error(`Downloaded Chromium archive did not contain the expected executable '${browser.executableRelativePath}'.`);
  }

  await ensureExecutablePermissions(executablePath);
  return executablePath;
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

async function downloadBrowserArchiveWithRetry(downloadUrl, archivePath) {
  for (let attempt = 1; attempt <= MAX_DOWNLOAD_ATTEMPTS; attempt += 1) {
    try {
      await downloadBrowserArchive(downloadUrl, archivePath);
      return;
    } catch (error) {
      await rm(archivePath, { force: true });
      if (attempt === MAX_DOWNLOAD_ATTEMPTS) {
        throw error;
      }

      await new Promise(resolve => setTimeout(resolve, 2000 * attempt));
    }
  }
}

async function downloadBrowserArchive(downloadUrl, archivePath) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  try {
    const response = await fetch(downloadUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Chromium download failed for ${downloadUrl}: ${response.status} ${response.statusText}`);
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
