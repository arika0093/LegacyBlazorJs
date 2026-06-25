#!/usr/bin/env node
import { accessSync, constants, cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npmDir = path.join(rootDir, 'npm');
const npmDistDir = path.join(npmDir, 'dist');
const originalPackageJson = path.join(npmDir, 'package.json');
const summaryPath = path.join(rootDir, 'artifacts', 'packages', 'build-summary.json');

const sanitizePathSegment = value => value.replace(/[^0-9A-Za-z._-]+/g, '-');
const resolveDistTag = build => (build.channel === 'preview' || build.version.includes('-') ? 'preview' : 'latest');

function copyDirectoryContents(sourceDir, targetDir) {
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    cpSync(path.join(sourceDir, entry.name), path.join(targetDir, entry.name), { recursive: true });
  }
}

function configurePackageJson(version) {
  const args = ['pkg', 'set', `version=${version}`];
  if (process.env.NPM_PACKAGE_NAME?.trim()) {
    args.push(`name=${process.env.NPM_PACKAGE_NAME.trim()}`);
  }
  if (process.env.NPM_REGISTRY_URL?.trim()) {
    args.push(`publishConfig.registry=${process.env.NPM_REGISTRY_URL.trim()}`);
  }
  if (process.env.NPM_ACCESS?.trim()) {
    args.push(`publishConfig.access=${process.env.NPM_ACCESS.trim()}`);
  }

  execFileSync(npmCommand, args, { cwd: npmDir, stdio: 'inherit' });
  return JSON.parse(readFileSync(originalPackageJson, 'utf8'));
}

function packageVersionExists(name, version, registry) {
  try {
    const publishedVersion = execFileSync(
      npmCommand,
      ['view', `${name}@${version}`, 'version', '--registry', registry],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    ).trim();
    return publishedVersion === version;
  } catch (error) {
    const stderr = error.stderr?.toString?.() ?? '';
    if (/E404|404\b/.test(stderr)) {
      return false;
    }

    throw new Error(`Failed to query ${name}@${version} from ${registry}: ${stderr || error.message}`);
  }
}

const registry = process.env.NPM_REGISTRY_URL?.trim() || 'https://registry.npmjs.org';
const access = process.env.NPM_ACCESS?.trim() || 'public';
const dryRun = process.env.NPM_DRY_RUN === 'true';
const provenance = process.env.NPM_PROVENANCE === 'true';
const explicitTag = process.env.NPM_DIST_TAG?.trim();
const originalPackageJsonSource = readFileSync(originalPackageJson, 'utf8');
const summary = JSON.parse(readFileSync(summaryPath, 'utf8'));

if (!Array.isArray(summary.builds) || summary.builds.length === 0) {
  throw new Error(`No builds were found in '${summaryPath}'.`);
}

mkdirSync(npmDistDir, { recursive: true });

try {
  for (const build of summary.builds) {
    if (!build?.version || !build?.upstreamRef) {
      throw new Error(`Each build entry must include version and upstreamRef. Received: ${JSON.stringify(build)}`);
    }

    const sourceDir = path.join(rootDir, 'dist', sanitizePathSegment(build.upstreamRef));
    accessSync(sourceDir, constants.R_OK);

    rmSync(npmDistDir, { recursive: true, force: true });
    mkdirSync(npmDistDir, { recursive: true });
    copyDirectoryContents(sourceDir, npmDistDir);

    const packageJson = configurePackageJson(build.version);
    if (!packageJson.name) {
      throw new Error('npm/package.json must define a package name or NPM_PACKAGE_NAME must be set.');
    }
    if (packageVersionExists(packageJson.name, build.version, registry)) {
      console.log(`Skipping ${packageJson.name}@${build.version}; it is already published.`);
      continue;
    }

    const distTag = explicitTag || resolveDistTag(build);
    const publishArgs = ['publish', '--access', access, '--registry', registry, '--tag', distTag];
    if (provenance) {
      publishArgs.push('--provenance');
    }
    if (dryRun) {
      publishArgs.push('--dry-run');
    }

    console.log(`Publishing ${packageJson.name}@${build.version} with dist-tag '${distTag}'.`);
    execFileSync(npmCommand, publishArgs, { cwd: npmDir, stdio: 'inherit' });
  }
} finally {
  writeFileSync(originalPackageJson, originalPackageJsonSource);
  rmSync(npmDistDir, { recursive: true, force: true });
}
