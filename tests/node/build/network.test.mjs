import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getProxyUrl,
  withNodeProxyEnv,
  withProxyFetchOptions,
} from '../../../scripts/build/lib/network.mjs';

test('getProxyUrl prefers HTTPS_PROXY for https requests and HTTP_PROXY for http requests', () => {
  const env = {
    HTTP_PROXY: 'http://http-proxy.local:8080',
    HTTPS_PROXY: 'http://https-proxy.local:8443',
  };

  assert.equal(getProxyUrl('https://example.com/data.json', env), env.HTTPS_PROXY);
  assert.equal(getProxyUrl('http://example.com/data.json', env), env.HTTP_PROXY);
});

test('withProxyFetchOptions adds a dispatcher when a proxy is configured', () => {
  const options = withProxyFetchOptions('https://example.com/data.json', {}, {
    HTTP_PROXY: 'http://proxy.local:8080',
  });

  assert.ok(options.dispatcher);
});

test('withNodeProxyEnv enables NODE_USE_ENV_PROXY when HTTP_PROXY is set', () => {
  const env = withNodeProxyEnv({ HTTP_PROXY: 'http://proxy.local:8080' });

  assert.equal(env.NODE_USE_ENV_PROXY, '1');
});
