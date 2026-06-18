import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { buildBrowserArguments, resolveBrowserLaunchConfiguration } from './browser-launch.mjs';
import { CapturedProcess } from './captured-process.mjs';
import { attachToDevToolsTarget, createDevToolsEndpointInfo, isMethodNotFoundError, waitForDevToolsEndpoint } from './devtools-target.mjs';
import { closeWebSocket, openWebSocket, WebSocket } from './devtools-websocket.mjs';
import { repositoryRoot, workDirectory } from './repository.mjs';
import { describeErrorSummary } from './smoke-logger.mjs';
import { createDeferred, createId, getAvailablePort, parseCounterValue, removeDirectory, toFiniteInteger } from './shared.mjs';

const INTERACTION_TIMEOUT_MS = 30_000;
const UNSUPPORTED_METHOD_RESULT = Symbol('unsupported-devtools-method');

export class BrowserHarness {
  static async create(logger) {
    const launchConfiguration = await resolveBrowserLaunchConfiguration();
    logger.info(`Launching Chromium from '${launchConfiguration.executablePath}'.`);
    return BrowserHarness.#createLegacyHarness(
      launchConfiguration.executablePath,
      launchConfiguration.versionMajor,
      launchConfiguration.platform,
      logger);
  }

  static async #createLegacyHarness(executablePath, versionMajor, platform, logger) {
    const profileDirectory = path.join(workDirectory, 'browser-profiles', createId());
    logger.info(`Creating browser profile at '${profileDirectory}'.`);
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

      logger.info(`Waiting for DevTools endpoint on port ${remoteDebuggingPort}.`);
      const devToolsEndpoint = await waitForDevToolsEndpoint(processHandle, remoteDebuggingPort, startupLog);
      logger.info(`Connecting to DevTools endpoint '${devToolsEndpoint.url}'.`);
      socket = await openWebSocket(devToolsEndpoint.url);
      const harness = new BrowserHarness(processHandle, profileDirectory, socket, startupLog, logger, devToolsEndpoint);
      await harness.#attach();
      return harness;
    } catch (error) {
      logger.error(`Browser harness setup failed: ${describeErrorSummary(error)}`);
      if (socket && socket.readyState !== WebSocket.CLOSED) {
        await closeWebSocket(socket);
      }

      if (processHandle) {
        if (!processHandle.hasExited) {
          processHandle.kill();
        }

        await processHandle.dispose();
      }

      await removeDirectory(profileDirectory);
      throw error;
    }
  }

  #process;
  #profileDirectory;
  #socket;
  #startupLog;
  #devToolsEndpoint;
  #targetId = '';
  #sessionId = '';
  #pending = new Map();
  #messageId = 0;
  #errors = [];
  #warnings = [];
  #failedResponses = [];
  #closed = false;
  #usesDirectPageCommands = false;
  #unsupportedMethods = new Set();
  #observedBrowserNotices = new Set();
  #logger;

  constructor(processHandle, profileDirectory, socket, startupLog, logger, devToolsEndpoint = createDevToolsEndpointInfo('ws://127.0.0.1/devtools/browser/default')) {
    this.#process = processHandle;
    this.#profileDirectory = profileDirectory;
    this.#socket = socket;
    this.#startupLog = startupLog;
    this.#logger = logger;
    this.#devToolsEndpoint = devToolsEndpoint;

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
    if (this.#devToolsEndpoint.usesDirectPageCommands) {
      this.#usesDirectPageCommands = true;
      this.#logger.info('Using direct page-level DevTools commands.');
      return;
    }

    this.#logger.info('Attaching to Chromium DevTools target.');
    const attachment = await attachToDevToolsTarget((method, params) => this.#sendCommand(method, params));
    this.#targetId = attachment.targetId;
    this.#sessionId = attachment.sessionId;
    this.#usesDirectPageCommands = attachment.usesDirectPageCommands;
    this.#logger.info(
      this.#usesDirectPageCommands
        ? 'Using direct page-level DevTools commands.'
        : 'Attached to Chromium DevTools target.');
  }

  async assertCounterInteractive(baseUri, profile, hostingModel) {
    this.#logger.info(`Opening counter page at ${new URL('/counter', baseUri).toString()}.`);
    const sessionId = this.#commandSessionId;
    if (this.#targetId) {
      await this.#sendOptionalCommand('Target.activateTarget', { targetId: this.#targetId });
    }

    await this.#sendOptionalCommand('Page.enable', undefined, sessionId);
    await this.#sendOptionalCommand('Runtime.enable', undefined, sessionId);
    await this.#sendOptionalCommand('Console.enable', undefined, sessionId);
    await this.#sendOptionalCommand('Log.enable', undefined, sessionId);
    await this.#sendOptionalCommand('Network.enable', undefined, sessionId);
    await this.#sendOptionalCommand('Page.bringToFront', undefined, sessionId);
    await this.#sendOptionalCommand('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId);

    await this.#navigate(new URL('/counter', baseUri).toString());
    this.#logger.info('Waiting for counter UI to render.');
    await this.#waitForCondition(
      'document.readyState === "complete" && document.querySelector("button") !== null && document.querySelector(\'[role="status"]\') !== null',
      INTERACTION_TIMEOUT_MS,
      'counter UI to render');

    this.#logger.info('Counter UI rendered. Attempting interaction.');
    const deadline = Date.now() + INTERACTION_TIMEOUT_MS;
    let attempts = 0;
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
        this.#logger.info(`Counter became interactive after ${attempts} click attempt(s).`);
        return;
      }

      attempts += 1;
      this.#logger.info(`Dispatching counter click attempt ${attempts}.`);
      await this.#ensurePageReadyForInput();
      await this.#clickButton();
      await delay(500);
    }

    if (this.#errors.length > 0) {
      this.#logger.error('Browser reported errors while waiting for interactivity.');
      throw new Error(`${hostingModel} ${profile} emitted browser errors:\n${this.#errors.join('\n')}`);
    }

    if (this.#failedResponses.length > 0) {
      this.#logger.error('HTTP failures were observed while waiting for interactivity.');
      throw new Error(`${hostingModel} ${profile} returned failing HTTP responses:\n${this.#failedResponses.join('\n')}`);
    }

    this.#logger.error('Counter did not become interactive before timeout.');
    throw new Error(
      `${hostingModel} ${profile} did not become interactive within the allotted time.\n${await this.#captureDiagnostics()}`);
  }

  async dispose() {
    this.#logger.info(`Disposing browser profile '${this.#profileDirectory}'.`);
    if (this.#socket.readyState === WebSocket.OPEN || this.#socket.readyState === WebSocket.CLOSING) {
      await closeWebSocket(this.#socket);
    }

    if (!this.#process.hasExited) {
      this.#process.kill();
    }

    await this.#process.dispose();
    await removeDirectory(this.#profileDirectory);
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

        const eventOptions = { bubbles: true, cancelable: true, view: window };
        button.dispatchEvent(new MouseEvent('mousedown', eventOptions));
        button.dispatchEvent(new MouseEvent('mouseup', eventOptions));
        if (typeof button.click === 'function') {
          button.click();
        } else {
          button.dispatchEvent(new MouseEvent('click', eventOptions));
        }
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

    if (this.#warnings.length > 0) {
      lines.push('Collected browser warnings:', ...this.#warnings);
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
        this.#recordBrowserError(
          `runtime-exception:${JSON.stringify(message.params?.exceptionDetails ?? message.params ?? message)}`,
          `Runtime exception: ${JSON.stringify(message.params?.exceptionDetails ?? message.params ?? message)}`);
        break;
      case 'Runtime.consoleAPICalled': {
        const type = String(message.params?.type ?? '').toLowerCase();
        const text = formatConsoleMessage(message.params?.args, message.params?.stackTrace);
        if (type === 'warning') {
          this.#recordBrowserWarning(`runtime-warning:${text}`, text);
        } else if (type === 'error' || type === 'assert') {
          this.#recordBrowserError(`runtime-error:${text}`, text);
        }
        break;
      }
      case 'Console.messageAdded': {
        const text = formatConsoleEntryText(message.params?.message);
        const level = normalizeConsoleLevel(message.params?.message?.level);
        if (level === 'warning') {
          this.#recordBrowserWarning(`console-warning:${text}`, text);
        } else if (level === 'error') {
          this.#recordBrowserError(`console-error:${text}`, text);
        }
        break;
      }
      case 'Log.entryAdded': {
        const entry = message.params?.entry;
        const text = formatConsoleEntryText(entry ?? message.params ?? message);
        const level = normalizeConsoleLevel(entry?.level);
        if (level === 'error' &&
          text !== 'Failed to load resource: the server responded with a status of 404 (Not Found)') {
          this.#recordBrowserError(`log-error:${text}`, text);
        } else if (level === 'warning') {
          this.#recordBrowserWarning(`log-warning:${text}`, text);
        }
        break;
      }
      case 'Network.responseReceived': {
        const response = message.params?.response;
        const status = Number(response?.status);
        const url = String(response?.url ?? '');
        if (status >= 400 && !url.endsWith('/favicon.ico')) {
          this.#recordFailedResponse(`response:${status}:${url}`, `${status} ${url}`);
        }
        break;
      }
      case 'Network.loadingFailed': {
        if (message.params?.canceled) {
          break;
        }

        const errorText = String(message.params?.errorText ?? '').trim();
        const requestId = String(message.params?.requestId ?? '').trim();
        const description = errorText.length > 0 ? errorText : 'Unknown network failure';
        const failure = requestId.length > 0 ? `${description} (${requestId})` : description;
        this.#recordFailedResponse(`loading-failed:${failure}`, failure);
        break;
      }
    }
  }

  #recordBrowserError(key, text) {
    if (this.#observedBrowserNotices.has(key)) {
      return;
    }

    this.#observedBrowserNotices.add(key);
    this.#errors.push(text);
    this.#logger.error(`Captured browser console error: ${text}`);
  }

  #recordBrowserWarning(key, text) {
    if (this.#observedBrowserNotices.has(key)) {
      return;
    }

    this.#observedBrowserNotices.add(key);
    this.#warnings.push(text);
    this.#logger.warn(`Captured browser console warning: ${text}`);
  }

  #recordFailedResponse(key, text) {
    if (this.#observedBrowserNotices.has(key)) {
      return;
    }

    this.#observedBrowserNotices.add(key);
    this.#failedResponses.push(text);
    this.#logger.error(`Captured failing network response: ${text}`);
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

function captureStartupLine(line, startupLog) {
  if (line) {
    startupLog.push(line);
  }
}

function isInvalidMouseEventParameterError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /missing or invalid ['"](?:x|y)['"] parameter/i.test(message);
}

function normalizeConsoleLevel(level) {
  const normalized = String(level ?? '').toLowerCase();
  return normalized === 'warn' ? 'warning' : normalized;
}

function formatConsoleEntryText(entry) {
  const text = entry?.text;
  if (typeof text === 'string' && text.length > 0) {
    return text;
  }

  return JSON.stringify(entry);
}

function formatConsoleMessage(args, stackTrace) {
  const parts = Array.isArray(args)
    ? args.map(formatRemoteObjectValue).filter(part => part.length > 0)
    : [];
  if (parts.length > 0) {
    return parts.join(' ');
  }

  const topFrame = stackTrace?.callFrames?.[0];
  if (topFrame?.functionName) {
    return topFrame.functionName;
  }

  return 'Console API call with no printable arguments.';
}

function formatRemoteObjectValue(value) {
  if (!value || typeof value !== 'object') {
    return '';
  }

  if (Object.hasOwn(value, 'value')) {
    const serialized = value.value;
    return typeof serialized === 'string'
      ? serialized
      : JSON.stringify(serialized);
  }

  if (typeof value.unserializableValue === 'string' && value.unserializableValue.length > 0) {
    return value.unserializableValue;
  }

  if (typeof value.description === 'string' && value.description.length > 0) {
    return value.description;
  }

  return JSON.stringify(value);
}
