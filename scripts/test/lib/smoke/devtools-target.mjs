import { setTimeout as delay } from 'node:timers/promises';

import { requestText } from './process-utils.mjs';

const DEVTOOLS_CONNECT_TIMEOUT_MS = 15_000;

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

export async function waitForDevToolsEndpoint(processHandle, remoteDebuggingPort, startupLog) {
  const deadline = Date.now() + DEVTOOLS_CONNECT_TIMEOUT_MS;
  const listeningPattern = /DevTools listening on (?<url>ws:\/\/\S+)/;

  while (Date.now() < deadline) {
    const directMatch = startupLog
      .map(line => listeningPattern.exec(line)?.groups?.url ?? null)
      .find(Boolean);
    if (directMatch) {
      return createDevToolsEndpointInfo(directMatch);
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

export function createDevToolsEndpointInfo(url) {
  const endpoint = new URL(url);
  return {
    url,
    usesDirectPageCommands: /\/devtools\/page\//.test(endpoint.pathname),
  };
}

async function tryResolveDevToolsEndpointFromHttp(remoteDebuggingPort) {
  const baseUrl = `http://127.0.0.1:${remoteDebuggingPort}`;
  const versionEndpoint = await tryReadJson(`${baseUrl}/json/version`);
  if (versionEndpoint && typeof versionEndpoint === 'object') {
    const endpoint = versionEndpoint.webSocketDebuggerUrl;
    if (typeof endpoint === 'string' && endpoint.length > 0) {
      return createDevToolsEndpointInfo(endpoint);
    }
  }

  const targets = await tryReadJson(`${baseUrl}/json/list`) ?? await tryReadJson(`${baseUrl}/json`);
  if (Array.isArray(targets)) {
    for (const target of targets) {
      const endpoint = target?.webSocketDebuggerUrl;
      if (typeof endpoint === 'string' && endpoint.length > 0) {
        return createDevToolsEndpointInfo(endpoint);
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
