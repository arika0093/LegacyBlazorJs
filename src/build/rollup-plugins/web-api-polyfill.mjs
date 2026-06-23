import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { sourceUsesFetch } from '../lib/legacy-output.mjs';

const require = createRequire(import.meta.url);
const VIRTUAL_ID = 'legacy-blazor-web-api-polyfill';
const RESOLVED_VIRTUAL_ID = '\0legacy-blazor-web-api-polyfill.js';
const WHATWG_FETCH_VIRTUAL_ID = 'legacy-blazor-whatwg-fetch';
const WHATWG_FETCH_RESOLVED_VIRTUAL_ID = '\0legacy-blazor-whatwg-fetch';
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

// https://caniuse.com/wf-mutationobserver
// IE10 and below. (Chrome 23 is supported with WebKit prefix)
function needsMutationObserverPolyfill(targets) {
  const ieMajor = getTargetMajor(targets, 'ie');
  return ieMajor !== null && ieMajor <= 10;
}

function needsPlatformDomPolyfill(targets) {
  const ieMajor = getTargetMajor(targets, 'ie');
  return ieMajor !== null && ieMajor <= 11;
}

// https://caniuse.com/template
// All IE, Chrome before 26
function needsTemplatePolyfill(targets) {
  const ieMajor = getTargetMajor(targets, 'ie');
  if (ieMajor !== null) {
    return true;
  }
  const chromeMajor = getTargetMajor(targets, 'chrome');
  return chromeMajor !== null && chromeMajor < 26;
}

// https://caniuse.com/mdn-api_customelementregistry
// All IE, Chrome before 54
function needsCustomElementsPolyfill(targets) {
  const ieMajor = getTargetMajor(targets, 'ie');
  if (ieMajor !== null) {
    return true;
  }
  const chromeMajor = getTargetMajor(targets, 'chrome');
  return chromeMajor !== null && chromeMajor < 54;
}

// https://caniuse.com/abortcontroller
// IE11, Chrome before 66
function needsAbortControllerPolyfill(targets) {
  const ieMajor = getTargetMajor(targets, 'ie');
  if (ieMajor !== null && ieMajor <= 11) {
    return true;
  }
  const chromeMajor = getTargetMajor(targets, 'chrome');
  return chromeMajor !== null && chromeMajor < 66;
}

// https://caniuse.com/mdn-api_node_getrootnode
// All IE, Chrome before 54
function needsDomApiShims(targets, profile) {
  const ieMajor = getTargetMajor(targets, 'ie');
  if (ieMajor !== null && ieMajor <= 11) {
    return true;
  }
  const chromeMajor = getTargetMajor(targets, 'chrome');
  return chromeMajor !== null && chromeMajor < 54;
}

// https://caniuse.com/fetch
// IE, Chrome before 42
function needsFetchPolyfill(targets) {
  const ieMajor = getTargetMajor(targets, 'ie');
  if (ieMajor !== null && ieMajor <= 11) {
    return true;
  }
  const chromeMajor = getTargetMajor(targets, 'chrome');
  return chromeMajor !== null && chromeMajor < 42;
}

function patchMutationObserverPackageSource(source) {
  return [
    '(function (window) {',
    source.replace(/module\.exports\s*=\s*MutationObserver\s*;/, 'window.MutationObserver = MutationObserver;'),
    '})(typeof window !== \'undefined\' ? window : this);',
  ].join('\n');
}

function resolvePolyfillEntries(targets, profile) {
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

  if (needsAbortControllerPolyfill(targets)) {
    entries.push({
      path: require.resolve('abortcontroller-polyfill/dist/abortcontroller-polyfill-only.js'),
    });
  }

  if (needsDomApiShims(targets, profile)) {
    entries.push({
      source: legacyDomApiShimsSource,
    });
  }

  return entries;
}

function injectModuleImport(source, moduleId) {
  const importLine = `import ${JSON.stringify(moduleId)};`;
  if (source.includes(importLine)) {
    return source;
  }

  return `${importLine}\n${source}`;
}

export function legacyWebApiPolyfillPlugin(targets, profile)
{
  const polyfillEntries = resolvePolyfillEntries(targets, profile);
  const needsFetch = needsFetchPolyfill(targets);
  let polyfillSource = null;
  let fetchPolyfillSource = null;

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

      if (needsFetch) {
        fetchPolyfillSource = await readFile(require.resolve('whatwg-fetch/fetch.js'), 'utf8');
      }
    },
    resolveId(source)
    {
      if (source === VIRTUAL_ID)
      {
        return RESOLVED_VIRTUAL_ID;
      }

      if (source === WHATWG_FETCH_VIRTUAL_ID)
      {
        return WHATWG_FETCH_RESOLVED_VIRTUAL_ID;
      }

      return null;
    },
    load(id)
    {
      if (id === RESOLVED_VIRTUAL_ID)
      {
        if (polyfillSource === null)
        {
          throw new Error('web API polyfill source was not generated before load.');
        }

        return polyfillSource;
      }

      if (id === WHATWG_FETCH_RESOLVED_VIRTUAL_ID)
      {
        if (fetchPolyfillSource === null)
        {
          throw new Error('whatwg-fetch polyfill source was not generated before load.');
        }

        return fetchPolyfillSource;
      }

      return null;
    },
    transform(code, id)
    {
      if (id === RESOLVED_VIRTUAL_ID || id === WHATWG_FETCH_RESOLVED_VIRTUAL_ID || !ENTRY_MODULE_PATTERN.test(id))
      {
        return null;
      }

      let transformed = code;

      if (polyfillEntries.length) {
        transformed = injectModuleImport(transformed, VIRTUAL_ID);
      }

      if (needsFetch && sourceUsesFetch(transformed, id)) {
        transformed = injectModuleImport(transformed, WHATWG_FETCH_VIRTUAL_ID);
      }

      return transformed === code ? null : { code: transformed, map: null };
    },
  };
}
