import { access, chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { constants as fsConstants } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { tmpdir } from 'node:os';
import { withNodeProxyEnv } from './network.mjs';

function resolveInvocation(command, args) {
  if (process.platform === 'win32' && (command === 'npm' || command === 'yarn')) {
    return {
      command: 'cmd.exe',
      args: ['/d', '/s', '/c', command, ...args],
    };
  }

  return { command, args };
}

export function sleep(delayMs) {
  return new Promise(resolve => setTimeout(resolve, delayMs));
}

export async function retry(maxAttempts, delayMs, operation) {
  let attempt = 1;
  while (true) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= maxAttempts) {
        throw error;
      }

      console.warn(`Attempt ${attempt}/${maxAttempts} failed; retrying in ${Math.ceil(delayMs / 1000)}s...`);
      await sleep(delayMs);
      attempt += 1;
    }
  }
}

export function run(command, args, options = {}) {
  const { cwd, env, stdio = ['ignore', 'inherit', 'inherit'], timeoutMs } = options;
  const childEnv = withNodeProxyEnv(env ?? process.env);

  return new Promise((resolve, reject) => {
    const invocation = resolveInvocation(command, args);
    process.stdout.write(`[DEBUG] Running: ${invocation.command} ${invocation.args.join(' ')}\n`);
    const child = spawn(invocation.command, invocation.args, {
      cwd,
      env: childEnv,
      stdio,
      shell: false,
    });

    if (!child.pid) {
      process.stdout.write(`[DEBUG] WARNING: Process failed to spawn (no PID)\n`);
    } else {
      process.stdout.write(`[DEBUG] Process spawned with PID: ${child.pid}\n`);
    }

    let timer;
    let aliveTimer;

    // Periodic "still alive" check for long-running processes
    if (!timeoutMs || timeoutMs > 30000) {
      aliveTimer = setInterval(() => {
        if (child.pid && !child.killed) {
          process.stdout.write(`[DEBUG] Process ${child.pid} still running...\n`);
        }
      }, 10000); // Check every 10 seconds
    }

    if (timeoutMs) {
      timer = setTimeout(() => {
        clearInterval(aliveTimer);
        process.stdout.write(`[DEBUG] Process timeout (${timeoutMs}ms), killing PID: ${child.pid}\n`);
        child.kill('SIGTERM');
        reject(new Error(`Process '${command}' timed out after ${timeoutMs}ms.`));
      }, timeoutMs);
    }

    child.once('error', error => {
      clearInterval(aliveTimer);
      clearTimeout(timer);
      process.stdout.write(`[DEBUG] Process error: ${error.message}\n`);
      reject(error);
    });

    child.once('exit', code => {
      clearInterval(aliveTimer);
      clearTimeout(timer);
      process.stdout.write(`[DEBUG] Process exited with code: ${code}\n`);
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} exited with code ${code ?? 1}`));
    });
  });
}

export async function findExecutableOnPath(name) {
  const entries = (process.env.PATH ?? '').split(path.delimiter).filter(Boolean);
  const candidates = process.platform === 'win32'
    ? [name, `${name}.cmd`, `${name}.exe`, `${name}.bat`]
    : [name];

  for (const entry of entries) {
    for (const candidate of candidates) {
      const filePath = path.join(entry, candidate);
      try {
        await access(filePath, fsConstants.X_OK);
        return filePath;
      } catch {
        // Try the next PATH entry.
      }
    }
  }

  return null;
}

export async function prepareNodeShim(nodeBin) {
  const resolvedNode = await findExecutableOnPath('node');
  if (!resolvedNode || path.resolve(resolvedNode) === path.resolve(nodeBin)) {
    return {
      env: withNodeProxyEnv(process.env),
      async cleanup() {},
    };
  }

  const shimDirectory = await mkdtemp(path.join(tmpdir(), 'legacy-blazor-node-'));
  const shimPath = path.join(shimDirectory, 'node');

  // Use the resolved node path directly in the shebang to avoid infinite loop
  const shimSource = `#!${resolvedNode}
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const result = spawnSync(${JSON.stringify(nodeBin)}, process.argv.slice(2), { stdio: ['ignore', 'inherit', 'inherit'] });
if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
`;

  await writeFile(shimPath, shimSource);
  await chmod(shimPath, 0o755);

  return {
    env: withNodeProxyEnv({
      ...process.env,
      PATH: `${shimDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
    }),
    async cleanup() {
      await rm(shimDirectory, { recursive: true, force: true });
    },
  };
}
