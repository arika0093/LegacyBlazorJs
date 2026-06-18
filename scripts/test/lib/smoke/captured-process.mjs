import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';
import { createInterface } from 'node:readline';

export class CapturedProcess {
  static start(command, args, options = {}) {
    const child = spawn(command, args, {
      cwd: options.cwd,
      detached: process.platform !== 'win32',
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const handle = new CapturedProcess(child);
    handle.#wireOutput(options.onStdoutLine, options.onStderrLine);
    return handle;
  }

  #process;
  #stdout = '';
  #stderr = '';
  #closePromise;

  constructor(processHandle) {
    this.#process = processHandle;
    this.#closePromise = new Promise((resolve, reject) => {
      processHandle.once('error', reject);
      processHandle.once('close', code => resolve(code ?? 0));
    });
  }

  get hasExited() {
    return this.#process.exitCode !== null || this.#process.signalCode !== null;
  }

  #wireOutput(onStdoutLine, onStderrLine) {
    this.#process.stdout?.on('data', chunk => {
      this.#stdout += chunk.toString();
    });
    this.#process.stderr?.on('data', chunk => {
      this.#stderr += chunk.toString();
    });

    if (onStdoutLine) {
      const outputReader = createInterface({ input: this.#process.stdout });
      outputReader.on('line', onStdoutLine);
    }

    if (onStderrLine) {
      const errorReader = createInterface({ input: this.#process.stderr });
      errorReader.on('line', onStderrLine);
    }
  }

  kill() {
    if (!this.hasExited) {
      if (process.platform === 'win32') {
        const result = spawnSync('taskkill', ['/PID', `${this.#process.pid}`, '/T', '/F'], { stdio: 'ignore' });
        if (result.status === 0) {
          return;
        }
      } else {
        try {
          process.kill(-this.#process.pid, 'SIGKILL');
          return;
        } catch {
        }
      }

      this.#process.kill('SIGKILL');
    }
  }

  async waitForExit() {
    return this.#closePromise;
  }

  async getCombinedOutput() {
    await this.#closePromise;
    return this.#stdout + this.#stderr;
  }

  async dispose() {
    await this.#closePromise.catch(() => {});
  }
}
