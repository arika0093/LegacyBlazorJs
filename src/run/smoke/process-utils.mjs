import { spawn } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';

import { TimeoutError } from './shared.mjs';

const HTTP_TIMEOUT_MS = 2_000;

export async function runChecked(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', chunk => {
    stdout += chunk.toString();
  });
  child.stderr?.on('data', chunk => {
    stderr += chunk.toString();
  });

  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => resolve(code ?? 0));
  });

  if (exitCode !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(' ')}\n${stdout}${stderr}`);
  }

  return { stdout, stderr };
}

export async function requestText(url) {
  const targetUrl = new URL(url);
  const client = targetUrl.protocol === 'https:' ? https : http;

  return new Promise((resolve, reject) => {
    const request = client.request(targetUrl, {
      method: 'GET',
      agent: false,
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        body += chunk;
      });
      response.on('end', () => {
        resolve({
          statusCode: response.statusCode ?? 0,
          body,
        });
      });
    });

    request.setTimeout(HTTP_TIMEOUT_MS, () => {
      request.destroy(new TimeoutError(`Timed out fetching '${url}'.`));
    });
    request.once('error', reject);
    request.end();
  });
}
