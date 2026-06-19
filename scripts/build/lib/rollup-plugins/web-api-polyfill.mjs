import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { injectModuleImport } from '../legacy-output.mjs';

const require = createRequire(import.meta.url);
const VIRTUAL_ID = 'legacy-blazor-web-api-polyfill';
const RESOLVED_VIRTUAL_ID = '\0legacy-blazor-web-api-polyfill.js';
const ENTRY_MODULE_PATTERN = /\/Boot\.(?:Server|Web|WebAssembly|WebView)\.ts$/;

export const legacyDomApiShimsSource = `
(function () {
  var nodePrototype = typeof Node !== 'undefined' && Node.prototype;
  if (nodePrototype && !nodePrototype.getRootNode) {
    nodePrototype.getRootNode = function getRootNode() {
      var current = this;
      while (current && current.parentNode) {
        current = current.parentNode;
      }
      if (current && current.nodeType === 11 && current.host) {
        return current.host;
      }
      return current || this;
    };
  }

  var eventPrototype = typeof Event !== 'undefined' && Event.prototype;
  if (eventPrototype && !eventPrototype.composedPath) {
    eventPrototype.composedPath = function composedPath() {
      var path = [];
      var current = this.target;
      while (current) {
        path.push(current);
        current = current.parentNode || current.host || null;
      }
      if (typeof window !== 'undefined') {
        path.push(window);
      }
      return path;
    };
  }
})();
`.trim();

function getTargetMajor(targets, browserName) {
  const rawVersion = targets?.[browserName];
  if (rawVersion === undefined || rawVersion === null) {
    return null;
  }

  const major = Number.parseInt(String(rawVersion), 10);
  return Number.isNaN(major) ? null : major;
}

function isLegacyEs5Profile(profile) {
  return profile === 'es5';
}

function needsMutationObserverPolyfill(targets) {
  const ieMajor = getTargetMajor(targets, 'ie');
  return ieMajor !== null && ieMajor <= 10;
}

function needsPlatformDomPolyfill(targets) {
  const ieMajor = getTargetMajor(targets, 'ie');
  return ieMajor !== null && ieMajor <= 11;
}

function needsTemplatePolyfill(targets) {
  const ieMajor = getTargetMajor(targets, 'ie');
  if (ieMajor !== null && ieMajor <= 11) {
    return true;
  }

  const chromeMajor = getTargetMajor(targets, 'chrome');
  return chromeMajor !== null && chromeMajor < 26;
}

function needsCustomElementsPolyfill(targets) {
  const ieMajor = getTargetMajor(targets, 'ie');
  if (ieMajor !== null) {
    return true;
  }

  const chromeMajor = getTargetMajor(targets, 'chrome');
  return chromeMajor !== null && chromeMajor < 54;
}

function needsDomApiShims(targets, profile) {
  if (!isLegacyEs5Profile(profile)) {
    return false;
  }

  const ieMajor = getTargetMajor(targets, 'ie');
  if (ieMajor !== null && ieMajor <= 11) {
    return true;
  }

  const chromeMajor = getTargetMajor(targets, 'chrome');
  return chromeMajor !== null && chromeMajor < 54;
}

function patchMutationObserverPackageSource(source) {
  return [
    '(function (window) {',
    source.replace(/module\.exports\s*=\s*MutationObserver\s*;/, 'window.MutationObserver = MutationObserver;'),
    '})(typeof window !== \'undefined\' ? window : this);',
  ].join('\n');
}

function resolvePolyfillEntries(targets, profile) {
  if (!isLegacyEs5Profile(profile)) {
    return [];
  }

  const entries = [];

  if (needsMutationObserverPolyfill(targets)) {
    entries.push({
      path: require.resolve('mutation-observer/index.js'),
      transform: patchMutationObserverPackageSource,
    });
  }

  if (needsPlatformDomPolyfill(targets)) {
    entries.push({
      path: require.resolve('@webcomponents/webcomponentsjs/bundles/webcomponents-pf_dom.js'),
    });
  }

  if (needsTemplatePolyfill(targets)) {
    entries.push({
      path: require.resolve('@webcomponents/template/template.min.js'),
    });
  }

  if (needsCustomElementsPolyfill(targets)) {
    entries.push({
      path: require.resolve('@webcomponents/custom-elements/custom-elements.min.js'),
    });
  }

  if (needsDomApiShims(targets, profile)) {
    entries.push({
      source: legacyDomApiShimsSource,
    });
  }

  return entries;
}

export function legacyWebApiPolyfillPlugin(targets, profile)
{
  const polyfillEntries = resolvePolyfillEntries(targets, profile);
  let polyfillSource = null;

  return {
    name: 'legacy-web-api-polyfill',
    async buildStart()
    {
      const parts = await Promise.all(polyfillEntries.map(async entry => {
        if (entry.source) {
          return entry.source;
        }

        const source = await readFile(entry.path, 'utf8');
        return entry.transform ? entry.transform(source) : source;
      }));

      polyfillSource = parts.filter(Boolean).join('\n');
    },
    resolveId(source)
    {
      if (source === VIRTUAL_ID)
      {
        return RESOLVED_VIRTUAL_ID;
      }

      return null;
    },
    load(id)
    {
      if (id !== RESOLVED_VIRTUAL_ID)
      {
        return null;
      }

      if (polyfillSource === null)
      {
        throw new Error('web API polyfill source was not generated before load.');
      }

      return polyfillSource;
    },
    transform(code, id)
    {
      if (id === RESOLVED_VIRTUAL_ID || !ENTRY_MODULE_PATTERN.test(id) || !polyfillEntries.length)
      {
        return null;
      }

      const transformed = injectModuleImport(code, VIRTUAL_ID);
      return transformed === code ? null : { code: transformed, map: null };
    },
  };
}
