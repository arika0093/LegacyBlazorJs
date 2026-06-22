#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  getCompatibilityResultsPath,
  getRootDir,
} from './lib/compat.mjs';

const rootDir = getRootDir();
const readmePath = path.join(rootDir, 'README.md');
const sectionStart = '<!-- compatibility-results:start -->';
const sectionEnd = '<!-- compatibility-results:end -->';

function renderStatus(result) {
  return result?.passed ? 'PASS' : 'FAIL';
}

function groupByPackage(results) {
  const grouped = new Map();
  for (const result of results) {
    if (!grouped.has(result.packageVersion)) {
      grouped.set(result.packageVersion, []);
    }

    grouped.get(result.packageVersion).push(result);
  }

  return grouped;
}

function findResult(results, profile, hostingModel) {
  return results.find(result => result.profile === profile && result.hostingModel === hostingModel);
}

function renderSection(data) {
  const total = data.results.length;
  const passed = data.results.filter(result => result.passed).length;
  const packageGroups = groupByPackage(data.results);
  const lines = [
    sectionStart,
    `Generated from \`artifacts/compatibility/results.json\`. ${passed}/${total} checks passed.`,
    '',
    `Last generated: \`${data.generatedAt}\``,
    '',
  ];

  for (const [packageVersion, packageResults] of packageGroups) {
    const upstreamTag = packageResults[0]?.upstreamTag ?? `v${packageVersion}`;
    lines.push(`### Package \`${packageVersion}\` (${upstreamTag})`);
    lines.push('');
    lines.push('| Profile | Target Chromium | Server | WASM |');
    lines.push('|---|---|---|---|');

    for (const profile of data.profiles) {
      const server = findResult(packageResults, profile.name, 'Server');
      const wasm = findResult(packageResults, profile.name, 'WebAssembly');
      const browserVersion = server?.browser?.version ?? wasm?.browser?.version ?? `Chrome ${profile.chromeMajor}`;
      lines.push(
        `| \`${profile.name}\` | Chrome ${profile.chromeMajor} (${browserVersion}) | ${renderStatus(server)} | ${renderStatus(wasm)} |`);
    }

    lines.push('');
  }

  lines.push('Failures, if any, are recorded in `artifacts/compatibility/results.json`.');
  lines.push(sectionEnd);
  return lines.join('\n');
}

async function main() {
  const readme = await readFile(readmePath, 'utf8');
  const resultsPath = getCompatibilityResultsPath();
  let data;
  try {
    data = JSON.parse(await readFile(resultsPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Missing ${resultsPath}. Run 'npm run test:compat' before updating README.`);
    }

    throw error;
  }
  const section = renderSection(data);

  const pattern = new RegExp(`${sectionStart}[\\s\\S]*?${sectionEnd}`);
  if (!pattern.test(readme)) {
    throw new Error(`README.md does not contain '${sectionStart}' and '${sectionEnd}' markers.`);
  }

  const updated = readme.replace(pattern, section);
  await writeFile(readmePath, updated);
}

await main();
