#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const REPO = 'arika0093/LegacyBlazorJs';
const UPSTREAM_REPO = 'dotnet/aspnetcore';
const README_PATH = fileURLToPath(new URL('../README.md', import.meta.url));
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

function getProxyUrl(url) {
  const protocol = typeof url === 'string' ? new URL(url).protocol : url.protocol;
  if (protocol === 'https:') {
    return process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy ?? null;
  }

  if (protocol === 'http:') {
    return process.env.HTTP_PROXY ?? process.env.http_proxy ?? null;
  }

  return null;
}

async function fetchJson(url, githubToken) {
  const proxyUrl = getProxyUrl(url);
  const fetchOptions = {
    signal: new AbortController().signal,
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'legacy-blazor-js-build',
      ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
    },
  };

  if (proxyUrl) {
    const { ProxyAgent } = await import('undici');
    fetchOptions.dispatcher = new ProxyAgent(proxyUrl);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...fetchOptions, signal: controller.signal });
    if (!response.ok) {
      throw new Error(`GitHub API request failed: ${response.status} ${response.statusText}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchWorkflowRuns(workflowId, githubToken) {
  const url = `https://api.github.com/repos/${REPO}/actions/workflows/${workflowId}/runs?event=schedule&per_page=${MAX_RUNS}`;
  const data = await fetchJson(url, githubToken);
  return data.workflow_runs ?? [];
}

async function fetchCommitShortHash(ref, githubToken) {
  const url = `https://api.github.com/repos/${UPSTREAM_REPO}/commits/${ref}`;
  const data = await fetchJson(url, githubToken);
  return data.sha?.slice(0, 8) ?? 'unknown';
}

async function fetchCommitShortHashAtTime(ref, isoString, githubToken) {
  const url = `https://api.github.com/repos/${UPSTREAM_REPO}/commits?sha=${encodeURIComponent(ref)}&until=${encodeURIComponent(isoString)}&per_page=1`;
  const data = await fetchJson(url, githubToken);
  return data?.[0]?.sha?.slice(0, 8) ?? null;
}

function formatDate(isoString) {
  if (!isoString) return 'N/A';
  const date = new Date(isoString);
  return date.toISOString().slice(0, 10);
}

async function fetchRunJobs(runId, githubToken) {
  const url = `https://api.github.com/repos/${REPO}/actions/runs/${runId}/jobs`;
  try {
    const data = await fetchJson(url, githubToken);
    return data.jobs ?? [];
  } catch {
    return [];
  }
}

async function resolveReleaseTag(run, githubToken) {
  const url = `https://api.github.com/repos/${REPO}/releases?per_page=10`;
  try {
    const releases = await fetchJson(url, githubToken);
    const runTime = new Date(run.created_at).getTime();
    const release = releases
      .filter(r => {
        const createdTime = new Date(r.created_at).getTime();
        return createdTime >= runTime - 60_000 && createdTime <= runTime + 10 * 60 * 60_000;
      })
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())[0];
    return release?.tag_name ?? null;
  } catch {
    return null;
  }
}

async function resolveMonthlyMessage(run, runConclusion, githubToken) {
  if (runConclusion === 'success') {
    const releaseTag = await resolveReleaseTag(run, githubToken);
    if (releaseTag) {
      return `[${releaseTag} released](https://github.com/${REPO}/releases/tag/${releaseTag})`;
    }
    return 'No updates';
  }

  const jobs = await fetchRunJobs(run.id, githubToken);
  const failedJob = jobs.find(job => job.conclusion === 'failure' || job.conclusion === 'timed_out');
  return failedJob?.name ? `Error in ${failedJob.name}` : 'Error';
}

const CURRENT_RUN_ID = process.env.GITHUB_RUN_ID;

function isCurrentRun(run) {
  return CURRENT_RUN_ID && String(run.id) === CURRENT_RUN_ID;
}

async function resolveEffectiveConclusion(run, githubToken) {
  if (run.conclusion) {
    return run.conclusion;
  }
  if (!isCurrentRun(run)) {
    return run.status;
  }

  const jobs = await fetchRunJobs(run.id, githubToken);
  // Exclude the current update-readme job, which is still running while this code executes.
  const relevantJobs = jobs.filter(job => !/update.?readme/i.test(job.name));
  const hasFailure = relevantJobs.some(
    job => job.conclusion === 'failure' || job.conclusion === 'timed_out'
  );
  if (hasFailure) {
    return 'failure';
  }
  const allCompleted = relevantJobs.every(job => job.status === 'completed');
  if (allCompleted) {
    return 'success';
  }
  return run.status;
}

async function resolveUpstreamMainHash(run, githubToken) {
  const runTimestamp = run.run_started_at || run.created_at;
  if (runTimestamp) {
    const historicalHash = await fetchCommitShortHashAtTime('main', runTimestamp, githubToken);
    if (historicalHash) {
      return historicalHash;
    }
  }

  return fetchCommitShortHash('main', githubToken);
}

async function buildMonthlyRows(runs, githubToken) {
  const rows = [];
  for (const run of runs) {
    const conclusion = await resolveEffectiveConclusion(run, githubToken);
    const runLink = `[#${run.run_number}](${run.html_url})`;
    const date = formatDate(run.run_started_at || run.created_at);
    const message = await resolveMonthlyMessage(run, conclusion, githubToken);
    rows.push(`| ${STATUS_EMOJI[conclusion] ?? '❓'} | ${runLink} | ${date} | ${message} |`);
  }
  return rows.join('\n');
}

async function buildDailyRows(runs, githubToken) {
  const rows = [];
  for (const run of runs) {
    const conclusion = await resolveEffectiveConclusion(run, githubToken);
    const runLink = `[#${run.run_number}](${run.html_url})`;
    const date = formatDate(run.run_started_at || run.created_at);
    let message = '';
    if (conclusion !== 'success') {
      const jobs = await fetchRunJobs(run.id, githubToken);
      const failedJob = jobs.find(job => job.conclusion === 'failure' || job.conclusion === 'timed_out');
      message = failedJob?.name ? `Error in ${failedJob.name}` : 'Error';
    }
    const upstreamHash = await resolveUpstreamMainHash(run, githubToken);
    const upstreamLink = `[${upstreamHash}](https://github.com/${UPSTREAM_REPO}/tree/${upstreamHash})`;
    rows.push(`| ${STATUS_EMOJI[conclusion] ?? '❓'} | ${runLink} | ${date} | ${message} | ${upstreamLink} |`);
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
  const [monthlyRuns, dailyRuns] = await Promise.all([
    fetchWorkflowRuns('ci.yml', githubToken),
    fetchWorkflowRuns('upstream-build.yml', githubToken),
  ]);

  const monthlyTableHeader = '| Result | Run ID | Date | Message |\n|--------|--------|------|---------|';
  const dailyTableHeader = '| Result | Run ID | Date | Message | Upstream main hash |\n|--------|--------|------|---------|--------------------|';

  const monthlyTable = monthlyRuns.length > 0
    ? `${monthlyTableHeader}\n${await buildMonthlyRows(monthlyRuns, githubToken)}`
    : `${monthlyTableHeader}\n| - | - | - | No recent scheduled runs |`;

  const dailyTable = dailyRuns.length > 0
    ? `${dailyTableHeader}\n${await buildDailyRows(dailyRuns, githubToken)}`
    : `${dailyTableHeader}\n| - | - | - | No recent scheduled runs | - |`;

  let readme = await readFile(README_PATH, 'utf8');
  readme = replaceSection(readme, 'monthly-release-builds', monthlyTable);
  readme = replaceSection(readme, 'daily-main-build', dailyTable);
  await writeFile(README_PATH, readme, 'utf8');

  console.log('README build status sections updated.');
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
