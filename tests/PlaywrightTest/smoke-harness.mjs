import { existsSync } from 'node:fs';
import { access, chmod, cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { spawn, spawnSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'undici';

const SERVER_READY_TIMEOUT_MS = 120_000;
const DEVTOOLS_CONNECT_TIMEOUT_MS = 15_000;
const INTERACTION_TIMEOUT_MS = 30_000;
const HTTP_TIMEOUT_MS = 2_000;
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = findRepositoryRoot(moduleDirectory);
const packageSourceDirectory = path.join(repositoryRoot, 'artifacts', 'packages');
const workDirectory = path.join(repositoryRoot, '.work');
const blazorServerAppTemplateDirectory = path.join(repositoryRoot, 'tests', 'BlazorServerApp');
const blazorWasmAppTemplateDirectory = path.join(repositoryRoot, 'tests', 'BlazorWasmApp');

export async function getProfiles() {
  const configuredProfile = process.env.SMOKE_TEST_PROFILE?.trim();
  if (configuredProfile) {
    return [configuredProfile];
  }

  const targetsPath = path.join(repositoryRoot, 'config', 'targets.json');
  const targets = JSON.parse(await readFile(targetsPath, 'utf8'));
  return Object.keys(targets);
}

export function getHostingModel() {
  const configured = process.env.SMOKE_TEST_HOSTING_MODEL?.trim();
  if (!configured) {
    return 'Server';
  }

  switch (configured) {
    case 'Server':
    case 'WebAssembly':
      return configured;
    default:
      throw new Error(
        `Unsupported SMOKE_TEST_HOSTING_MODEL value '${configured}'. Expected 'Server' or 'WebAssembly'.`);
  }
}

export async function runSmokeTest(profile, hostingModel = getHostingModel()) {
  const packageVersion = await resolvePackageVersion();
  const appHarness = await SmokeAppHarness.create(repositoryRoot, profile, packageVersion, hostingModel);

  try {
    await appHarness.start();

    const browserHarness = await BrowserHarness.create();
    try {
      await browserHarness.assertCounterInteractive(appHarness.baseUri, profile, hostingModel);
    } finally {
      await browserHarness.dispose();
    }
  } finally {
    await appHarness.dispose();
  }
}

class SmokeAppHarness {
  static async create(root, profile, packageVersion, hostingModel) {
    const rootDirectory = path.join(
      root,
      '.work',
      `smoke-${hostingModel.toLowerCase()}-${profile}-${createId()}`);
    await mkdir(rootDirectory, { recursive: true });

    const templateDirectory = getTemplateDirectory(hostingModel);
    await cp(templateDirectory, rootDirectory, { recursive: true });

    const projectPath = getProjectPath(rootDirectory, hostingModel);
    const baseUri = `http://127.0.0.1:${await getAvailablePort()}`;
    const targetFramework = resolveTargetFrameworkMoniker(packageVersion);
    const scriptProfile = await resolveScriptProfile(profile);

    const harness = new SmokeAppHarness(
      rootDirectory,
      projectPath,
      profile,
      scriptProfile,
      packageVersion,
      targetFramework,
      hostingModel,
      baseUri);
    await harness.#initialize();
    return harness;
  }

  #rootDirectory;
  #projectPath;
  #profile;
  #scriptProfile;
  #packageVersion;
  #targetFramework;
  #hostingModel;
  #baseUri;
  #serverProcess = null;

  constructor(rootDirectory, projectPath, profile, scriptProfile, packageVersion, targetFramework, hostingModel, baseUri) {
    this.#rootDirectory = rootDirectory;
    this.#projectPath = projectPath;
    this.#profile = profile;
    this.#scriptProfile = scriptProfile;
    this.#packageVersion = packageVersion;
    this.#targetFramework = targetFramework;
    this.#hostingModel = hostingModel;
    this.#baseUri = baseUri;
  }

  get baseUri() {
    return this.#baseUri;
  }

  async start() {
    this.#serverProcess = CapturedProcess.start('dotnet', [
      'run',
      '--project', this.#projectPath,
      '--urls', this.#baseUri,
      '--no-launch-profile',
      '--no-restore',
    ], {
      cwd: this.#rootDirectory,
      env: {
        ...process.env,
        ASPNETCORE_ENVIRONMENT: 'Development',
      },
    });

    const readyUntil = Date.now() + SERVER_READY_TIMEOUT_MS;
    while (Date.now() < readyUntil) {
      if (this.#serverProcess.hasExited) {
        throw new Error(
          `Blazor ${this.#hostingModel} app exited before it became ready.\n${await this.#serverProcess.getCombinedOutput()}`);
      }

      try {
        const response = await requestText(new URL('/counter', this.#baseUri).toString());
        if (response.statusCode >= 200 && response.statusCode < 300) {
          return;
        }
      } catch (error) {
        if (error?.name !== 'TimeoutError' && error?.code !== 'ECONNREFUSED') {
          throw error;
        }
      }

      await delay(1_000);
    }

    await this.#disposeServer();
    throw new Error(
      `Blazor ${this.#hostingModel} app did not become ready at ${this.#baseUri} within ${SERVER_READY_TIMEOUT_MS / 1000} seconds.`);
  }

  async dispose() {
    await this.#disposeServer();
    await rm(this.#rootDirectory, { recursive: true, force: true });
  }

  async #initialize() {
    await this.#replaceProjectPlaceholders();
    await this.#normalizeLegacyBlazorReference();
    await writeNuGetConfig(this.#rootDirectory);

    await runChecked('dotnet', ['restore', this.#projectPath], { cwd: this.#rootDirectory });

    const scriptHostPath = getScriptHostPath(this.#rootDirectory, this.#hostingModel);
    const scriptName = this.#hostingModel === 'Server'
      ? `blazor.web.${this.#scriptProfile}.js`
      : `blazor.webassembly.${this.#scriptProfile}.js`;
    const replacement = `<script src="_content/LegacyBlazorJs/${scriptName}"></script>`;
    await replaceSingleToken(scriptHostPath, '__LEGACY_BLAZOR_SCRIPT__', replacement);
  }

  async #normalizeLegacyBlazorReference() {
    const projectReference = '<ProjectReference Include="..\\..\\src\\LegacyBlazorJs\\LegacyBlazorJs.csproj" />';
    const packageReference = `<PackageReference Include="LegacyBlazorJs" Version="${this.#packageVersion}" />`;
    const contents = await readFile(this.#projectPath, 'utf8');
    const updated = contents.replace(projectReference, packageReference);

    if (updated === contents && !contents.includes('<PackageReference Include="LegacyBlazorJs"')) {
      throw new Error(`Could not normalize the LegacyBlazorJs reference in '${this.#projectPath}'.`);
    }

    if (updated !== contents) {
      await writeFile(this.#projectPath, updated);
    }
  }

  async #replaceProjectPlaceholders() {
    const projectFiles = await findFiles(this.#rootDirectory, filePath => filePath.endsWith('.csproj'));
    await Promise.all(projectFiles.map(async projectPath => {
      let contents = await readFile(projectPath, 'utf8');
      const updated = contents
        .replaceAll('__TARGET_FRAMEWORK__', this.#targetFramework)
        .replaceAll('__ASPNETCORE_VERSION__', this.#packageVersion);

      if (updated !== contents) {
        contents = updated;
        await writeFile(projectPath, contents);
      }
    }));
  }

  async #disposeServer() {
    if (!this.#serverProcess) {
      return;
    }

    if (!this.#serverProcess.hasExited) {
      this.#serverProcess.kill();
    }

    await this.#serverProcess.dispose();
    this.#serverProcess = null;
  }
}

class BrowserHarness {
  static async create() {
    const launchConfiguration = await resolveBrowserLaunchConfiguration();
    return BrowserHarness.#createLegacyHarness(
      launchConfiguration.executablePath,
      launchConfiguration.versionMajor,
      launchConfiguration.platform);
  }

  static async #createLegacyHarness(executablePath, versionMajor, platform) {
    const profileDirectory = path.join(workDirectory, 'browser-profiles', createId());
    await mkdir(profileDirectory, { recursive: true });

    let processHandle;
    let socket;
    try {
      const remoteDebuggingPort = await getAvailablePort();
      const startupLog = [];
      processHandle = CapturedProcess.start(
        executablePath,
        buildBrowserArguments(profileDirectory, remoteDebuggingPort, versionMajor, { platform }), {
          cwd: repositoryRoot,
          onStdoutLine: line => captureStartupLine(line, startupLog),
          onStderrLine: line => captureStartupLine(line, startupLog),
        });

      const endpoint = await waitForDevToolsEndpoint(processHandle, remoteDebuggingPort, startupLog);
      socket = await openWebSocket(endpoint);
      const harness = new BrowserHarness(processHandle, profileDirectory, socket, startupLog);
      await harness.#attach();
      return harness;
    } catch (error) {
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        await closeWebSocket(socket);
      }

      if (processHandle) {
        if (!processHandle.hasExited) {
          processHandle.kill();
        }

        await processHandle.dispose();
      }

      await rm(profileDirectory, { recursive: true, force: true });
      throw error;
    }
  }

  #process;
  #profileDirectory;
  #socket;
  #startupLog;
  #targetId = '';
  #sessionId = '';
  #pending = new Map();
  #messageId = 0;
  #errors = [];
  #failedResponses = [];
  #closed = false;
  #usesDirectPageCommands = false;
  #unsupportedMethods = new Set();

  constructor(processHandle, profileDirectory, socket, startupLog) {
    this.#process = processHandle;
    this.#profileDirectory = profileDirectory;
    this.#socket = socket;
    this.#startupLog = startupLog;

    socket.addEventListener('message', event => {
      void this.#handleSocketMessage(event.data);
    });
    socket.addEventListener('close', () => {
      this.#closed = true;
      this.#failPending(new Error('Legacy Chromium DevTools connection closed.'));
    });
    socket.addEventListener('error', () => {
      this.#failPending(new Error('Legacy Chromium DevTools connection failed.'));
    });
  }

  async #attach() {
    const attachment = await attachToDevToolsTarget((method, params) => this.#sendCommand(method, params));
    this.#targetId = attachment.targetId;
    this.#sessionId = attachment.sessionId;
    this.#usesDirectPageCommands = attachment.usesDirectPageCommands;
  }

  async assertCounterInteractive(baseUri, profile, hostingModel) {
    const sessionId = this.#commandSessionId;
    if (this.#targetId) {
      await this.#sendOptionalCommand('Target.activateTarget', { targetId: this.#targetId });
    }

    await this.#sendOptionalCommand('Page.enable', undefined, sessionId);
    await this.#sendOptionalCommand('Runtime.enable', undefined, sessionId);
    await this.#sendOptionalCommand('Log.enable', undefined, sessionId);
    await this.#sendOptionalCommand('Network.enable', undefined, sessionId);
    await this.#sendOptionalCommand('Page.bringToFront', undefined, sessionId);
    await this.#sendOptionalCommand('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId);

    await this.#navigate(new URL('/counter', baseUri).toString());
    await this.#waitForCondition(
      'document.readyState === "complete" && document.querySelector("button") !== null && document.querySelector(\'[role="status"]\') !== null',
      INTERACTION_TIMEOUT_MS,
      'counter UI to render');

    const deadline = Date.now() + INTERACTION_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (this.#errors.length > 0 || this.#failedResponses.length > 0) {
        break;
      }

      const countText = await this.#evaluateString(`
        (function () {
          var status = document.querySelector('[role="status"]');
          return status ? status.textContent : '';
        })()
      `);
      if (parseCounterValue(countText) > 0) {
        return;
      }

      await this.#ensurePageReadyForInput();
      await this.#clickButton();
      await delay(500);
    }

    if (this.#errors.length > 0) {
      throw new Error(`${hostingModel} ${profile} emitted browser errors:\n${this.#errors.join('\n')}`);
    }

    if (this.#failedResponses.length > 0) {
      throw new Error(`${hostingModel} ${profile} returned failing HTTP responses:\n${this.#failedResponses.join('\n')}`);
    }

    throw new Error(
      `${hostingModel} ${profile} did not become interactive within the allotted time.\n${await this.#captureDiagnostics()}`);
  }

  async dispose() {
    if (this.#socket.readyState === WebSocket.OPEN || this.#socket.readyState === WebSocket.CLOSING) {
      await closeWebSocket(this.#socket);
    }

    if (!this.#process.hasExited) {
      this.#process.kill();
    }

    await this.#process.dispose();
    await rm(this.#profileDirectory, { recursive: true, force: true });
  }

  async #waitForCondition(expression, timeoutMs, description) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (this.#errors.length > 0 || this.#failedResponses.length > 0) {
        return;
      }

      if (await this.#evaluateBoolean(expression)) {
        return;
      }

      await delay(500);
    }

    throw new Error(
      `Legacy Chromium timed out waiting for ${description}: ${expression}\n${await this.#captureDiagnostics()}`);
  }

  async #ensurePageReadyForInput() {
    await this.#sendOptionalCommand('Page.bringToFront', undefined, this.#commandSessionId);
    await this.#evaluate(`
      (() => {
        const button = document.querySelector('button');
        if (!button) {
          return false;
        }

        button.scrollIntoView({ block: 'center', inline: 'center' });
        button.focus();
        return true;
      })()
    `);
  }

  async #clickButton() {
    const buttonCenter = await this.#evaluate(`
      (() => {
        const button = document.querySelector('button');
        if (!button) {
          return null;
        }

        button.scrollIntoView({ block: 'center', inline: 'center' });
        button.focus();
        const rect = button.getBoundingClientRect();
        const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
        return {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
          visible: rect.width > 0 && rect.height > 0,
          hitTag: hit ? hit.tagName : null
        };
      })()
    `);

    if (!buttonCenter) {
      return;
    }

    const x = toFiniteInteger(buttonCenter.x);
    const y = toFiniteInteger(buttonCenter.y);
    if (x !== null && y !== null) {
      try {
        await this.#sendOptionalCommand(
          'Input.dispatchMouseEvent',
          { type: 'mouseMoved', x, y, button: 'none', buttons: 0, clickCount: 0 },
          this.#commandSessionId);
        await this.#sendOptionalCommand(
          'Input.dispatchMouseEvent',
          { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 },
          this.#commandSessionId);
        await this.#sendOptionalCommand(
          'Input.dispatchMouseEvent',
          { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 },
          this.#commandSessionId);
      } catch (error) {
        if (!isInvalidMouseEventParameterError(error)) {
          throw error;
        }
      }
    }

    await this.#evaluate(`
      (() => {
        const button = document.querySelector('button');
        if (!button) {
          return false;
        }

        button.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
        return true;
      })()
    `);
  }

  async #evaluateBoolean(expression) {
    return Boolean(await this.#evaluate(expression));
  }

  async #evaluateString(expression) {
    const value = await this.#evaluate(expression);
    return typeof value === 'string' ? value : value == null ? null : String(value);
  }

  async #evaluate(expression) {
    const response = await this.#sendCommand('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    }, this.#commandSessionId);

    if (response?.exceptionDetails) {
      throw new Error(`Legacy Chromium evaluation failed: ${JSON.stringify(response.exceptionDetails)}`);
    }

    return response?.result && Object.hasOwn(response.result, 'value')
      ? response.result.value
      : null;
  }

  async #navigate(url) {
    const navigation = await this.#sendOptionalCommand('Page.navigate', { url }, this.#commandSessionId);
    if (navigation !== UNSUPPORTED_METHOD_RESULT) {
      return navigation;
    }

    return await this.#evaluate(`
      (() => {
        location.href = ${JSON.stringify(url)};
        return true;
      })()
    `);
  }

  async #sendCommand(method, params = {}, sessionId) {
    if (this.#closed) {
      throw new Error(`Cannot send '${method}' because the DevTools connection is closed.`);
    }

    const id = ++this.#messageId;
    const payload = sessionId
      ? { id, method, params, sessionId }
      : { id, method, params };

    const completion = createDeferred();
    this.#pending.set(id, completion);

    try {
      this.#socket.send(JSON.stringify(payload));
    } catch (error) {
      this.#pending.delete(id);
      throw error;
    }

    return completion.promise.catch(error => {
      if (isMethodNotFoundError(error, method)) {
        this.#unsupportedMethods.add(method);
      }

      throw error;
    });
  }

  async #sendOptionalCommand(method, params = {}, sessionId) {
    if (this.#unsupportedMethods.has(method)) {
      return UNSUPPORTED_METHOD_RESULT;
    }

    try {
      return await this.#sendCommand(method, params, sessionId);
    } catch (error) {
      if (isMethodNotFoundError(error, method)) {
        this.#unsupportedMethods.add(method);
        return UNSUPPORTED_METHOD_RESULT;
      }

      throw error;
    }
  }

  async #captureDiagnostics() {
    const diagnostics = await this.#evaluate(`
      (() => {
        const button = document.querySelector('button');
        const status = document.querySelector('[role="status"]');
        const scripts = Array.from(document.scripts).map(script => script.src).filter(Boolean);
        const rect = button ? button.getBoundingClientRect() : null;
        const hit = rect ? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2) : null;

        return {
          readyState: document.readyState,
          href: location.href,
          userAgent: navigator.userAgent,
          statusText: status ? status.textContent : null,
          buttonText: button ? button.textContent : null,
          buttonDisabled: button ? button.disabled : null,
          activeElement: document.activeElement ? document.activeElement.tagName : null,
          buttonRect: rect ? {
            left: rect.left,
            top: rect.top,
            width: rect.width,
            height: rect.height
          } : null,
          centerHitTag: hit ? hit.tagName : null,
          scripts,
          htmlSnippet: document.body ? document.body.innerHTML.slice(0, 1500) : null
        };
      })()
    `);

    const lines = [
      'Legacy Chromium diagnostics:',
      JSON.stringify(diagnostics),
    ];

    if (this.#errors.length > 0) {
      lines.push('Collected browser errors:', ...this.#errors);
    }

    if (this.#failedResponses.length > 0) {
      lines.push('Collected failed responses:', ...this.#failedResponses);
    }

    if (this.#startupLog.length > 0) {
      lines.push('Browser startup output:', ...this.#startupLog);
    }

    return lines.join('\n');
  }

  async #handleSocketMessage(data) {
    const text = typeof data === 'string'
      ? data
      : Buffer.from(data instanceof ArrayBuffer ? data : await data.arrayBuffer()).toString('utf8');
    this.#handleMessage(JSON.parse(text));
  }

  #handleMessage(message) {
    if (typeof message.id === 'number') {
      const completion = this.#pending.get(message.id);
      this.#pending.delete(message.id);
      if (!completion) {
        return;
      }

      if (message.error) {
        completion.reject(new Error(message.error.message ?? JSON.stringify(message.error)));
        return;
      }

      completion.resolve(message.result ?? null);
      return;
    }

    switch (message.method) {
      case 'Runtime.exceptionThrown':
        this.#errors.push(JSON.stringify(message.params?.exceptionDetails ?? message.params ?? message));
        break;
      case 'Log.entryAdded': {
        const entry = message.params?.entry;
        const text = entry?.text ?? JSON.stringify(entry ?? message.params ?? message);
        if (String(entry?.level ?? '').toLowerCase() === 'error' &&
          text !== 'Failed to load resource: the server responded with a status of 404 (Not Found)') {
          this.#errors.push(text);
        }
        break;
      }
      case 'Network.responseReceived': {
        const response = message.params?.response;
        const status = Number(response?.status);
        const url = String(response?.url ?? '');
        if (status >= 400 && !url.endsWith('/favicon.ico')) {
          this.#failedResponses.push(`${status} ${url}`);
        }
        break;
      }
    }
  }

  #failPending(error) {
    for (const completion of this.#pending.values()) {
      completion.reject(error);
    }

    this.#pending.clear();
  }

  get #commandSessionId() {
    return this.#usesDirectPageCommands ? undefined : this.#sessionId;
  }
}

class CapturedProcess {
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

async function resolvePackageVersion() {
  const explicitVersion = process.env.PACKAGE_VERSION?.trim();
  if (explicitVersion) {
    return explicitVersion;
  }

  const packagePath = await resolveLatestPackagePath();
  const match = /^LegacyBlazorJs\.(.+)\.nupkg$/.exec(path.basename(packagePath));
  if (!match) {
    throw new Error(`Could not determine the package version from '${path.basename(packagePath)}'.`);
  }

  return match[1];
}

async function resolveScriptProfile(requestedProfile) {
  const availableProfiles = await getAvailableScriptProfiles();
  if (availableProfiles.includes(requestedProfile)) {
    return requestedProfile;
  }

  if (requestedProfile === 'es5') {
    const ieFallback = [...availableProfiles]
      .filter(profile => profile.toLowerCase().startsWith('ie'))
      .sort((left, right) => right.localeCompare(left, undefined, { sensitivity: 'base' }))[0];
    if (ieFallback) {
      return ieFallback;
    }
  }

  throw new Error(
    `No generated script matching profile '${requestedProfile}' was found in '${packageSourceDirectory}'. Available profiles: ${availableProfiles.join(', ')}`);
}

async function getAvailableScriptProfiles() {
  const packagePath = await resolveLatestPackagePath();
  const entries = await listArchiveEntries(packagePath);
  return [...new Set(entries
    .map(entry => /^staticwebassets\/blazor\.web\.(.+)\.js$/.exec(entry)?.[1] ?? null)
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' }));
}

async function resolveLatestPackagePath() {
  let files;
  try {
    files = await readdir(packageSourceDirectory);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw new Error(`Package directory '${packageSourceDirectory}' does not exist. Build the package before running smoke tests.`);
    }

    throw error;
  }

  const candidates = await Promise.all(files
    .filter(file => /^LegacyBlazorJs\..+\.nupkg$/.test(file))
    .map(async file => {
      const filePath = path.join(packageSourceDirectory, file);
      const stats = await stat(filePath);
      return { filePath, lastModified: stats.mtimeMs };
    }));

  candidates.sort((left, right) => right.lastModified - left.lastModified);
  const latest = candidates[0]?.filePath;
  if (!latest) {
    throw new Error(`No LegacyBlazorJs package was found in '${packageSourceDirectory}'. Build the package before running smoke tests.`);
  }

  return latest;
}

async function listArchiveEntries(archivePath) {
  if (process.platform === 'win32') {
    const command = [
      'Add-Type -AssemblyName System.IO.Compression.FileSystem',
      `$archive = [System.IO.Compression.ZipFile]::OpenRead(${quotePowerShellString(archivePath)})`,
      'try {',
      '  $archive.Entries | ForEach-Object FullName',
      '} finally {',
      '  $archive.Dispose()',
      '}',
    ].join('; ');
    const { stdout } = await runChecked('powershell', ['-NoProfile', '-Command', command]);
    return stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  }

  const { stdout } = await runChecked('unzip', ['-Z1', archivePath]);
  return stdout.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

async function writeNuGetConfig(directory) {
  const nugetConfigPath = path.join(directory, 'NuGet.config');
  const contents = `<?xml version="1.0" encoding="utf-8"?>\n<configuration>\n  <packageSources>\n    <clear />\n    <add key="local" value="${packageSourceDirectory.replaceAll('\\', '/')}" />\n    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" protocolVersion="3" />\n  </packageSources>\n</configuration>\n`;
  await writeFile(nugetConfigPath, contents);
}

async function replaceSingleToken(filePath, token, replacement) {
  const contents = await readFile(filePath, 'utf8');
  const updated = contents.replace(token, replacement);
  if (updated === contents) {
    throw new Error(`Could not replace the script placeholder in '${filePath}'.`);
  }

  await writeFile(filePath, updated);
}

async function findFiles(rootDirectory, predicate) {
  const result = [];
  const entries = await readdir(rootDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(rootDirectory, entry.name);
    if (entry.isDirectory()) {
      result.push(...await findFiles(entryPath, predicate));
      continue;
    }

    if (predicate(entryPath)) {
      result.push(entryPath);
    }
  }

  return result;
}

function getTemplateDirectory(hostingModel) {
  switch (hostingModel) {
    case 'Server':
      return blazorServerAppTemplateDirectory;
    case 'WebAssembly':
      return blazorWasmAppTemplateDirectory;
    default:
      throw new Error(`Unsupported hosting model '${hostingModel}'.`);
  }
}

function getScriptHostPath(appDirectory, hostingModel) {
  switch (hostingModel) {
    case 'Server':
      return path.join(appDirectory, 'Components', 'App.razor');
    case 'WebAssembly':
      return path.join(appDirectory, 'wwwroot', 'index.html');
    default:
      throw new Error(`Unsupported hosting model '${hostingModel}'.`);
  }
}

function getProjectPath(appDirectory, hostingModel) {
  switch (hostingModel) {
    case 'Server':
      return path.join(appDirectory, 'BlazorServerApp.csproj');
    case 'WebAssembly':
      return path.join(appDirectory, 'BlazorWasmApp.csproj');
    default:
      throw new Error(`Unsupported hosting model '${hostingModel}'.`);
  }
}

function resolveTargetFrameworkMoniker(packageVersion) {
  const match = /^(?<major>\d+)\./.exec(packageVersion);
  if (!match?.groups?.major) {
    throw new Error(`Could not determine the target framework from package version '${packageVersion}'.`);
  }

  return `net${match.groups.major}.0`;
}

async function resolveBrowserLaunchConfiguration() {
  const configuredPath = process.env.SMOKE_TEST_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (configuredPath) {
    if (!await fileExists(configuredPath)) {
      throw new Error(
        `Configured Chromium executable was not found at '${configuredPath}'. Run 'node scripts/test/export-browser-env.mjs es5' before executing smoke tests that require a compatibility browser.`);
    }

    await ensureExecutablePermissions(configuredPath);
    return {
      executablePath: configuredPath,
      platform: inferBrowserPlatform(configuredPath),
      versionMajor: parseBrowserMajor(process.env.SMOKE_TEST_CHROMIUM_VERSION),
    };
  }

  for (const candidate of await findInstalledBrowsers()) {
    if (await fileExists(candidate)) {
      await ensureExecutablePermissions(candidate);
      return {
        executablePath: candidate,
        platform: inferBrowserPlatform(candidate),
        versionMajor: null,
      };
    }
  }

  throw new Error(
    `No Chromium executable is configured. Set SMOKE_TEST_CHROMIUM_EXECUTABLE_PATH, install a local browser, or run 'node scripts/test/export-browser-env.mjs es5'.`);
}

async function findInstalledBrowsers() {
  const commands = process.platform === 'win32'
    ? ['msedge.exe', 'chrome.exe']
    : ['chromium-browser', 'chromium', 'google-chrome-stable', 'google-chrome', 'microsoft-edge'];
  const resolved = [];

  for (const command of commands) {
    const located = await locateCommand(command);
    if (located) {
      resolved.push(located);
    }
  }

  const commonPaths = process.platform === 'win32'
    ? [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    ]
    : [
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium',
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/microsoft-edge',
    ];

  return [...new Set([...resolved, ...commonPaths])];
}

async function locateCommand(command) {
  const locator = process.platform === 'win32' ? 'where' : 'which';
  const args = process.platform === 'win32' ? [command] : ['-a', command];

  try {
    const { stdout } = await runChecked(locator, args);
    return stdout.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? null;
  } catch {
    return null;
  }
}

function inferBrowserPlatform(executablePath) {
  if (executablePath.toLowerCase().endsWith('.exe')) {
    return 'win32';
  }

  return process.platform;
}

export function buildBrowserArguments(
  profileDirectory,
  remoteDebuggingPort,
  versionMajor,
  options = {}) {
  const platform = options.platform ?? process.platform;
  const display = options.display ?? process.env.DISPLAY;
  const supportsHeadless = versionMajor === null || versionMajor >= 59;
  const argumentsList = [
    '--disable-gpu',
    '--disable-dev-shm-usage',
    `--remote-debugging-port=${remoteDebuggingPort}`,
    `--user-data-dir=${profileDirectory}`,
    'about:blank',
  ];

  if (!display) {
    if (platform === 'linux' && !supportsHeadless) {
      throw new Error('Legacy Chromium requires a display server. Run the smoke test under xvfb-run or set DISPLAY.');
    }

    if (supportsHeadless) {
      argumentsList.unshift('--headless');
    }
  }

  if (platform === 'linux') {
    argumentsList.push('--no-sandbox');
  }

  return argumentsList;
}

function captureStartupLine(line, startupLog) {
  if (line) {
    startupLog.push(line);
  }
}

async function waitForDevToolsEndpoint(processHandle, remoteDebuggingPort, startupLog) {
  const deadline = Date.now() + DEVTOOLS_CONNECT_TIMEOUT_MS;
  const listeningPattern = /DevTools listening on (?<url>ws:\/\/\S+)/;

  while (Date.now() < deadline) {
    const directMatch = startupLog
      .map(line => listeningPattern.exec(line)?.groups?.url ?? null)
      .find(Boolean);
    if (directMatch) {
      return directMatch;
    }

    if (processHandle.hasExited) {
      const suffix = `Legacy Chromium exited before opening the DevTools endpoint.\n${buildStartupLog(startupLog)}`;
      throw new Error(suffix);
    }

    const endpoint = await tryResolveDevToolsEndpointFromHttp(remoteDebuggingPort);
    if (endpoint) {
      return endpoint;
    }

    await delay(250);
  }

  throw new Error(
    `Timed out waiting for the legacy Chromium DevTools endpoint on port ${remoteDebuggingPort}.\n${buildStartupLog(startupLog)}`);
}

async function tryResolveDevToolsEndpointFromHttp(remoteDebuggingPort) {
  const baseUrl = `http://127.0.0.1:${remoteDebuggingPort}`;
  const versionEndpoint = await tryReadJson(`${baseUrl}/json/version`);
  if (versionEndpoint && typeof versionEndpoint === 'object') {
    const endpoint = versionEndpoint.webSocketDebuggerUrl;
    if (typeof endpoint === 'string' && endpoint.length > 0) {
      return endpoint;
    }
  }

  const targets = await tryReadJson(`${baseUrl}/json/list`) ?? await tryReadJson(`${baseUrl}/json`);
  if (Array.isArray(targets)) {
    for (const target of targets) {
      const endpoint = target?.webSocketDebuggerUrl;
      if (typeof endpoint === 'string' && endpoint.length > 0) {
        return endpoint;
      }
    }
  }

  return null;
}

async function tryReadJson(url) {
  try {
    const response = await requestText(url);
    if (response.statusCode < 200 || response.statusCode >= 300) {
      return null;
    }

    return JSON.parse(response.body);
  } catch (error) {
    if (
      error?.name === 'TimeoutError' ||
      error?.code === 'ECONNREFUSED' ||
      error?.code === 'ECONNRESET' ||
      error instanceof SyntaxError
    ) {
      return null;
    }

    throw error;
  }
}

function buildStartupLog(startupLog) {
  return startupLog.length === 0
    ? 'No browser startup output was captured.'
    : `Browser startup output:\n${startupLog.join('\n')}`;
}

async function openWebSocket(endpoint) {
  const socket = new WebSocket(endpoint);
  await waitForWebSocketOpen(socket);
  return socket;
}

async function waitForWebSocketOpen(socket) {
  if (socket.readyState === WebSocket.OPEN) {
    return;
  }

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error('Timed out waiting for the DevTools WebSocket connection.'));
    }, DEVTOOLS_CONNECT_TIMEOUT_MS);

    const handleOpen = () => {
      cleanup();
      resolve();
    };
    const handleClose = () => {
      cleanup();
      reject(new Error('DevTools WebSocket closed before it opened.'));
    };
    const handleError = () => {
      cleanup();
      reject(new Error('DevTools WebSocket failed to open.'));
    };
    const cleanup = () => {
      clearTimeout(timeout);
      socket.removeEventListener('open', handleOpen);
      socket.removeEventListener('close', handleClose);
      socket.removeEventListener('error', handleError);
    };

    socket.addEventListener('open', handleOpen, { once: true });
    socket.addEventListener('close', handleClose, { once: true });
    socket.addEventListener('error', handleError, { once: true });
  });
}

async function closeWebSocket(socket) {
  if (socket.readyState === WebSocket.CLOSED) {
    return;
  }

  await new Promise(resolve => {
    const timeout = setTimeout(resolve, 1_000);
    socket.addEventListener('close', () => {
      clearTimeout(timeout);
      resolve();
    }, { once: true });
    socket.close(1000, 'disposing');
  });
}

async function runChecked(command, args, options = {}) {
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

async function requestText(url) {
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

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, resolve, reject };
}

async function getAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : null;
      server.close(error => {
        if (error) {
          reject(error);
          return;
        }

        if (port === null) {
          reject(new Error('Could not determine an available TCP port.'));
          return;
        }

        resolve(port);
      });
    });
  });
}

async function ensureExecutablePermissions(executablePath) {
  if (process.platform !== 'win32' && await fileExists(executablePath)) {
    try {
      await chmod(executablePath, 0o755);
    } catch (error) {
      if (error?.code !== 'EPERM' && error?.code !== 'EACCES') {
        throw error;
      }
    }
  }
}

async function fileExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function parseBrowserMajor(versionText) {
  const match = /^(\d+)\./.exec(versionText ?? '');
  return match ? Number(match[1]) : null;
}

const UNSUPPORTED_METHOD_RESULT = Symbol('unsupported-devtools-method');

export async function attachToDevToolsTarget(sendCommand) {
  try {
    const target = await sendCommand('Target.createTarget', { url: 'about:blank' });
    const targetId = target?.targetId;
    if (!targetId) {
      throw new Error('CDP did not return a target id.');
    }

    const attached = await sendCommand('Target.attachToTarget', { targetId, flatten: true });
    const sessionId = attached?.sessionId;
    if (!sessionId) {
      throw new Error('CDP did not return a session id.');
    }

    return {
      targetId,
      sessionId,
      usesDirectPageCommands: false,
    };
  } catch (error) {
    if (isMethodNotFoundError(error, 'Target.createTarget')) {
      return {
        targetId: '',
        sessionId: '',
        usesDirectPageCommands: true,
      };
    }

    throw error;
  }
}

export function isMethodNotFoundError(error, method) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message.includes(`'${method}' wasn't found`) ||
    message.includes(`"${method}" wasn't found`) ||
    message.includes(`No such method ${method}`) ||
    (/method not found/i.test(message) && message.includes(method));
}

function isInvalidMouseEventParameterError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /missing or invalid ['"](?:x|y)['"] parameter/i.test(message);
}

function toFiniteInteger(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.round(value)
    : null;
}

function parseCounterValue(text) {
  const match = /Current count:\s*(\d+)/.exec(text ?? '');
  return match ? Number(match[1]) : 0;
}

class TimeoutError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TimeoutError';
  }
}

function createId() {
  return typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID().replaceAll('-', '')
    : `${Date.now()}${Math.random().toString(16).slice(2)}`;
}

function quotePowerShellString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function findRepositoryRoot(startDirectory) {
  let currentDirectory = startDirectory;
  while (currentDirectory && currentDirectory !== path.dirname(currentDirectory)) {
    if (existsSync(path.join(currentDirectory, 'package.json'))) {
      return currentDirectory;
    }

    currentDirectory = path.dirname(currentDirectory);
  }

  throw new Error('Could not locate the repository root from the smoke test directory.');
}
