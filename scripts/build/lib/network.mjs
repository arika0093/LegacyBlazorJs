import process from 'node:process';
import { ProxyAgent } from 'undici';

function firstDefined(...values) {
  return values.find(value => typeof value === 'string' && value.length > 0) ?? null;
}

export function getProxyUrl(url, env = process.env) {
  const protocol = typeof url === 'string' ? new URL(url).protocol : url.protocol;
  if (protocol === 'https:') {
    return firstDefined(env.HTTPS_PROXY, env.https_proxy, env.HTTP_PROXY, env.http_proxy);
  }

  if (protocol === 'http:') {
    return firstDefined(env.HTTP_PROXY, env.http_proxy);
  }

  return null;
}

export function withProxyFetchOptions(url, options = {}, env = process.env) {
  const proxyUrl = getProxyUrl(url, env);
  if (!proxyUrl) {
    return options;
  }

  return {
    ...options,
    dispatcher: options.dispatcher ?? new ProxyAgent(proxyUrl),
  };
}

export function withNodeProxyEnv(env = process.env) {
  const proxyConfigured = firstDefined(env.HTTP_PROXY, env.http_proxy, env.HTTPS_PROXY, env.https_proxy);
  if (!proxyConfigured) {
    return { ...env };
  }

  return {
    ...env,
    NODE_USE_ENV_PROXY: env.NODE_USE_ENV_PROXY ?? '1',
  };
}
