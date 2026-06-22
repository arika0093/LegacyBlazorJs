#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { withProxyFetchOptions } from './lib/network.mjs';

const REPO = 'arika0093/LegacyBlazorJs';
const UPSTREAM_REPO = 'dotnet/aspnetcore';
const README_PATH = new URL('../../README.md', import.meta.url);
const MAX_RUNS = 5;
const FETCH_TIMEOUT_MS = 30_000;

const STATUS_EMOJI = {
  success: '✅',
  failure: '❌',
  cancelled: '🚫',
  skipped: '⏭️',
  timed_out: '⏰',
  action_required: '⚠️',
  neutral: '⚪',
  in_progress: '🔄',
  queued: '💤',
  requested: '💤',
  waiting: '💤',
  pending: '💤',
};

async function fetchWorkflowRuns(workflowId, githubToken) {
  const url = `https://api.github.com/repos/${REPO}/actions/workflows/${workflowId}/runs?event=schedule&per_page=${MAX_RUNS}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, withProxyFetchOptions(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'legacy-blazor-js-build',
        ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
      },
    }));
    if (!response.ok) {
      throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return data.workflow_runs ?? [];
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRunJobOutputs(runId, githubToken) {
  const url = `https://api.github.com/repos/${REPO}/actions/runs/${runId}/jobs`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, withProxyFetchOptions(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'legacy-blazor-js-build',
        ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
      },
    }));
    if (!response.ok) {
      return null;
    }
    const data = await response.json();
    const outputs = {};
    for (const job of data.jobs ?? []) {
      for (const [key, value] of Object.entries(job.outputs ?? {})) {
        outputs[key] = value;
      }
    }
    return outputs;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchCommitShortHash(ref, githubToken) {
  const url = `https://api.github.com/repos/${UPSTREAM_REPO}/commits/${ref}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, withProxyFetchOptions(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'legacy-blazor-js-build',
        ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
      },
    }));
    if (!response.ok) {
      throw new Error(`Upstream commit request failed: ${response.status} ${response.statusText}`);
    }
    const data = await response.json();
    return data.sha?.slice(0, 8) ?? 'unknown';
  } finally {
    clearTimeout(timer);
  }
}

function formatDate(isoString) {
  if (!isoString) return 'N/A';
  const date = new Date(isoString);
  return date.toISOString().slice(0, 10);
}

async function resolveWeeklyMessage(run, githubToken) {
  if (run.conclusion === 'success') {
    const releaseTag = await resolveReleaseTag(run, githubToken);
    if (releaseTag) {
      return `[v${releaseTag} released](https://github.com/${REPO}/releases/tag/v${releaseTag})`;
    }
    return 'No updates';
  }

  const jobs = await fetchRunJobs(run.id, githubToken);
  const failedJob = jobs.find(job => job.conclusion === 'failure' || job.conclusion === 'timed_out');
  return failedJob?.name ? `Error in ${failedJob.name}` : 'Error';
}

async function resolveReleaseTag(run, githubToken) {
  const url = `https://api.github.com/repos/${REPO}/releases?per_page=10`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, withProxyFetchOptions(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'legacy-blazor-js-build',
        ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
      },
    }));
    if (!response.ok) {
      return null;
    }
    const releases = await response.json();
    const runTime = new Date(run.created_at).getTime();
    const release = releases
      .filter(r => {
        const createdTime = new Date(r.created_at).getTime();
        return createdTime >= runTime - 60_000 && createdTime <= runTime + 10 * 60_000;
      })
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];
    if (release?.tag_name?.startsWith('v')) {
      return release.tag_name.slice(1);
    }
    return null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchRunJobs(runId, githubToken) {
  const url = `https://api.github.com/repos/${REPO}/actions/runs/${runId}/jobs`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, withProxyFetchOptions(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'legacy-blazor-js-build',
        ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
      },
    }));
    if (!response.ok) {
      return [];
    }
    const data = await response.json();
    return data.jobs ?? [];
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

async function buildWeeklyRows(runs, githubToken) {
  const rows = [];
  for (const run of runs) {
    const status = run.conclusion || run.status;
    const runLink = `[#${run.run_number}](${run.html_url})`;
    const date = formatDate(run.run_started_at || run.created_at);
    const message = await resolveWeeklyMessage(run, githubToken);
    rows.push(`| ${STATUS_EMOJI[status] ?? '❓'} | ${runLink} | ${date} | ${message} |`);
  }
  return rows.join('\n');
}

async function resolveUpstreamMainHash(run, githubToken) {
  const outputs = await fetchRunJobOutputs(run.id, githubToken);
  const outputSha = outputs?.['upstream-main-sha'];
  if (outputSha) {
    return outputSha.slice(0, 8);
  }

  // Fallback: resolve the main commit at the time the run started.
  return fetchCommitShortHash('main', githubToken);
}

async function buildDailyRows(runs, githubToken) {
  const rows = [];
  for (const run of runs) {
    const status = run.conclusion || run.status;
    const runLink = `[#${run.run_number}](${run.html_url})`;
    const date = formatDate(run.run_started_at || run.created_at);
    let message = '';
    if (status !== 'success') {
      const jobs = await fetchRunJobs(run.id, githubToken);
      const failedJob = jobs.find(job => job.conclusion === 'failure' || job.conclusion === 'timed_out');
      message = failedJob?.name ? `Error in ${failedJob.name}` : 'Error';
    }
    const upstreamHash = await resolveUpstreamMainHash(run, githubToken);
    const upstreamLink = `[${upstreamHash}](https://github.com/${UPSTREAM_REPO}/commit/${upstreamHash})`;
    rows.push(`| ${STATUS_EMOJI[status] ?? '❓'} | ${runLink} | ${date} | ${message} | ${upstreamLink} |`);
  }
  return rows.join('\n');
}

function replaceSection(content, marker, table) {
  const start = `<!-- start:${marker} -->`;
  const end = `<!-- end:${marker} -->`;
  const pattern = new RegExp(`${start}[\\s\\S]*?${end}`, 'g');
  return content.replace(pattern, `${start}\n${table}\n${end}`);
}

async function main() {
  const githubToken = process.env.GITHUB_TOKEN;
  const [weeklyRuns, dailyRuns] = await Promise.all([
    fetchWorkflowRuns('ci.yml', githubToken),
    fetchWorkflowRuns('upstream-build.yml', githubToken),
  ]);

  const weeklyTableHeader = '| Result | Run ID | Date | Message |\n|--------|--------|------|---------|';
  const dailyTableHeader = '| Result | Run ID | Date | Message | Upstream main hash |\n|--------|--------|------|---------|--------------------|';

  const weeklyTable = weeklyRuns.length > 0
    ? `${weeklyTableHeader}\n${await buildWeeklyRows(weeklyRuns, githubToken)}`
    : `${weeklyTableHeader}\n| - | - | - | No recent scheduled runs |`;

  const dailyTable = dailyRuns.length > 0
    ? `${dailyTableHeader}\n${await buildDailyRows(dailyRuns, githubToken)}`
    : `${dailyTableHeader}\n| - | - | - | No recent scheduled runs | - |`;

  let readme = await readFile(README_PATH, 'utf8');
  readme = replaceSection(readme, 'weekly-release-builds', weeklyTable);
  readme = replaceSection(readme, 'daily-main-build', dailyTable);
  await writeFile(README_PATH, readme, 'utf8');

  console.log('README build status sections updated.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
