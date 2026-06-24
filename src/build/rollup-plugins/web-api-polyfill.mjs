import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { injectModuleImport } from '../lib/legacy-output.mjs';

const require = createRequire(import.meta.url);
const VIRTUAL_ID = 'legacy-blazor-web-api-polyfill';
const RESOLVED_VIRTUAL_ID = '\0legacy-blazor-web-api-polyfill.js';
const ENTRY_MODULE_PATTERN = /\/Boot\.(?:Server|Web|WebAssembly|WebView)\.ts$/;

export const legacySendBeaconPolyfillSource = `
(function () {
  var navigatorObject = typeof navigator !== 'undefined' ? navigator : null;
  if (navigatorObject && typeof navigatorObject.sendBeacon !== 'function') {
    navigatorObject.sendBeacon = function sendBeacon(url, data) {
      if (typeof fetch === 'function') {
        fetch(url, {
          method: 'POST',
          body: data,
          keepalive: true
        });
        return true;
      }
      if (typeof XMLHttpRequest === 'function') {
        var request = new XMLHttpRequest();
        request.open('POST', url, true);
        request.send(data);
        return true;
      }
      return false;
    };
  }
})();
`.trim();

export const legacyAttachShadowPolyfillSource = `
(function () {
  var elementPrototype = typeof Element !== 'undefined' && Element.prototype;
  if (elementPrototype && !elementPrototype.attachShadow) {
    elementPrototype.attachShadow = function attachShadow() {
      if (!this.__legacyShadowRoot) {
        this.__legacyShadowRoot = this;
      }
      return this.__legacyShadowRoot;
    };
  }

  if (elementPrototype && !('shadowRoot' in elementPrototype) && typeof Object.defineProperty === 'function') {
    Object.defineProperty(elementPrototype, 'shadowRoot', {
      configurable: true,
      enumerable: true,
      get: function get() {
        return this.__legacyShadowRoot || null;
      }
    });
  }
})();
`.trim();

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

export const legacyCurrentScriptPolyfillSource = `
(function () {
  var documentObject = typeof document !== 'undefined' ? document : null;
  if (!documentObject || 'currentScript' in documentObject) {
    return;
  }

  Object.defineProperty(documentObject, 'currentScript', {
    configurable: true,
    enumerable: true,
    get: function getCurrentScript() {
      var scripts = documentObject.getElementsByTagName('script');
      for (var index = scripts.length - 1; index >= 0; index -= 1) {
        var script = scripts[index];
        if (script.readyState === 'interactive') {
          return script;
        }
      }

      return scripts[scripts.length - 1] || null;
    },
  });
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

// https://caniuse.com/document-currentscript
// All IE, Chrome before 29
function needsCurrentScriptPolyfill(targets) {
  const ieMajor = getTargetMajor(targets, 'ie');
  if (ieMajor !== null) {
    return true;
  }

  const chromeMajor = getTargetMajor(targets, 'chrome');
  return chromeMajor !== null && chromeMajor < 29;
// https://caniuse.com/beacon
// All IE, Chrome before 39
function needsSendBeaconPolyfill(targets) {
  const ieMajor = getTargetMajor(targets, 'ie');
  if (ieMajor !== null && ieMajor <= 11) {
    return true;
  }
  const chromeMajor = getTargetMajor(targets, 'chrome');
  return chromeMajor !== null && chromeMajor < 39;
}

// https://caniuse.com/mdn-api_element_attachshadow
// All IE, Chrome before 53
function needsAttachShadowPolyfill(targets) {
  const ieMajor = getTargetMajor(targets, 'ie');
  if (ieMajor !== null) {
    return true;
  }
  const chromeMajor = getTargetMajor(targets, 'chrome');
  return chromeMajor !== null && chromeMajor < 53;
}

// https://caniuse.com/mdn-api_node_getrootnode
// All IE, Chrome before 54
function needsDomApiShims(targets) {
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

function createInlinePolyfillEntry(source) {
  return { source };
}

function resolvePolyfillEntries(targets) {
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

  if (needsCurrentScriptPolyfill(targets)) {
    entries.push(createInlinePolyfillEntry(legacyCurrentScriptPolyfillSource));
  }

  if (needsSendBeaconPolyfill(targets)) {
    entries.push(createInlinePolyfillEntry(legacySendBeaconPolyfillSource));
  }

  if (needsAttachShadowPolyfill(targets)) {
    entries.push(createInlinePolyfillEntry(legacyAttachShadowPolyfillSource));
  }

  if (needsDomApiShims(targets)) {
    entries.push(createInlinePolyfillEntry(legacyDomApiShimsSource));
  }

  return entries;
}

export function legacyWebApiPolyfillPlugin(targets, _profile)
{
  const polyfillEntries = resolvePolyfillEntries(targets);
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
