import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { injectModuleImport } from '../legacy-output.mjs';

const require = createRequire(import.meta.url);
const VIRTUAL_ID = 'legacy-blazor-web-api-polyfill';
const RESOLVED_VIRTUAL_ID = '\0legacy-blazor-web-api-polyfill.js';
const ENTRY_MODULE_PATTERN = /\/Boot\.(?:Server|Web|WebAssembly|WebView)\.ts$/;

export const legacyMutationObserverPolyfillSource = `
(function (global) {
  if (!global || global.MutationObserver || global.WebKitMutationObserver) {
    return;
  }

  function toArray(nodes) {
    var result = [];
    for (var i = 0; i < nodes.length; i += 1) {
      result.push(nodes[i]);
    }

    return result;
  }

  function indexOfNode(nodes, node) {
    for (var i = 0; i < nodes.length; i += 1) {
      if (nodes[i] === node) {
        return i;
      }
    }

    return -1;
  }

  function hasNode(nodes, node) {
    return indexOfNode(nodes, node) >= 0;
  }

  function copyAttributes(node, attributeFilter) {
    var result = {};
    if (node.nodeType !== 1 || !node.attributes) {
      return result;
    }

    for (var i = 0; i < node.attributes.length; i += 1) {
      var attribute = node.attributes[i];
      if (attributeFilter && !attributeFilter[attribute.name]) {
        continue;
      }

      result[attribute.name] = attribute.value;
    }

    return result;
  }

  function snapshotNode(node, options) {
    var snapshot = {
      node: node,
      attributes: null,
      characterData: null,
      childNodes: null
    };

    if (options.attributes && node.nodeType === 1) {
      snapshot.attributes = copyAttributes(node, options.attributeFilter);
    }

    if (options.characterData && (node.nodeType === 3 || node.nodeType === 8)) {
      snapshot.characterData = node.nodeValue;
    }

    if (options.childList || options.subtree) {
      var currentChildren = toArray(node.childNodes || []);
      snapshot.childNodes = [];

      for (var i = 0; i < currentChildren.length; i += 1) {
        snapshot.childNodes.push(options.subtree ? snapshotNode(currentChildren[i], options) : { node: currentChildren[i] });
      }
    }

    return snapshot;
  }

  function createRecord(type, target) {
    return {
      type: type,
      target: target,
      addedNodes: [],
      removedNodes: [],
      previousSibling: null,
      nextSibling: null,
      attributeName: null,
      attributeNamespace: null,
      oldValue: null
    };
  }

  function diffAttributes(target, previous, options, records) {
    if (!options.attributes || target.nodeType !== 1) {
      return;
    }

    var oldAttributes = previous.attributes || {};
    var newAttributes = copyAttributes(target, options.attributeFilter);
    var seen = {};
    var name;

    for (name in newAttributes) {
      if (!Object.prototype.hasOwnProperty.call(newAttributes, name)) {
        continue;
      }

      seen[name] = true;
      if (oldAttributes[name] !== newAttributes[name]) {
        var changedRecord = createRecord('attributes', target);
        changedRecord.attributeName = name;
        changedRecord.oldValue = options.attributeOldValue
          ? (Object.prototype.hasOwnProperty.call(oldAttributes, name) ? oldAttributes[name] : null)
          : null;
        records.push(changedRecord);
      }
    }

    for (name in oldAttributes) {
      if (!Object.prototype.hasOwnProperty.call(oldAttributes, name) || seen[name]) {
        continue;
      }

      var removedRecord = createRecord('attributes', target);
      removedRecord.attributeName = name;
      removedRecord.oldValue = options.attributeOldValue ? oldAttributes[name] : null;
      records.push(removedRecord);
    }
  }

  function diffCharacterData(target, previous, options, records) {
    if (!options.characterData || (target.nodeType !== 3 && target.nodeType !== 8)) {
      return;
    }

    if (previous.characterData !== target.nodeValue) {
      var record = createRecord('characterData', target);
      record.oldValue = options.characterDataOldValue ? previous.characterData : null;
      records.push(record);
    }
  }

  function diffChildList(target, previous, options, records) {
    if (!options.childList) {
      return { currentChildren: null, previousChildren: null };
    }

    var previousSnapshots = previous.childNodes || [];
    var previousChildren = [];
    for (var i = 0; i < previousSnapshots.length; i += 1) {
      previousChildren.push(previousSnapshots[i].node);
    }

    var currentChildren = toArray(target.childNodes || []);
    var addedNodes = [];
    var removedNodes = [];

    for (i = 0; i < currentChildren.length; i += 1) {
      if (!hasNode(previousChildren, currentChildren[i])) {
        addedNodes.push(currentChildren[i]);
      }
    }

    for (i = 0; i < previousChildren.length; i += 1) {
      if (!hasNode(currentChildren, previousChildren[i])) {
        removedNodes.push(previousChildren[i]);
      }
    }

    if (addedNodes.length || removedNodes.length) {
      var record = createRecord('childList', target);
      record.addedNodes = addedNodes;
      record.removedNodes = removedNodes;
      var siblingSource = addedNodes.length ? addedNodes[0] : removedNodes[0];
      if (siblingSource) {
        record.previousSibling = siblingSource.previousSibling;
        record.nextSibling = siblingSource.nextSibling;
      }

      records.push(record);
    }

    return {
      currentChildren: currentChildren,
      previousChildren: previousSnapshots
    };
  }

  function diffNode(target, previous, options, records) {
    diffAttributes(target, previous, options, records);
    diffCharacterData(target, previous, options, records);

    if (!(options.childList || options.subtree)) {
      return;
    }

    var childDiff = diffChildList(target, previous, options, records);
    if (!options.subtree) {
      return;
    }

    var currentChildren = childDiff.currentChildren || toArray(target.childNodes || []);
    var previousChildren = childDiff.previousChildren || previous.childNodes || [];

    for (var i = 0; i < currentChildren.length; i += 1) {
      var currentChild = currentChildren[i];
      var previousSnapshot = null;

      for (var j = 0; j < previousChildren.length; j += 1) {
        if (previousChildren[j].node === currentChild) {
          previousSnapshot = previousChildren[j];
          break;
        }
      }

      if (previousSnapshot) {
        diffNode(currentChild, previousSnapshot, options, records);
      }
    }
  }

  function normalizeOptions(options) {
    var normalized = options || {};
    return {
      attributes: !!(normalized.attributes || normalized.attributeOldValue || normalized.attributeFilter),
      attributeOldValue: !!normalized.attributeOldValue,
      attributeFilter: normalized.attributeFilter ? (function () {
        var result = {};
        for (var i = 0; i < normalized.attributeFilter.length; i += 1) {
          result[normalized.attributeFilter[i]] = true;
        }

        return result;
      })() : null,
      childList: !!normalized.childList,
      subtree: !!normalized.subtree,
      characterData: !!(normalized.characterData || normalized.characterDataOldValue),
      characterDataOldValue: !!normalized.characterDataOldValue
    };
  }

  function MutationObserver(callback) {
    this._callback = callback;
    this._watchedTargets = [];
    this._records = [];
    this._timerId = null;
  }

  MutationObserver._period = 30;

  MutationObserver.prototype.observe = function (target, options) {
    var normalizedOptions = normalizeOptions(options);

    for (var i = 0; i < this._watchedTargets.length; i += 1) {
      if (this._watchedTargets[i].target === target) {
        this._watchedTargets.splice(i, 1);
        break;
      }
    }

    this._watchedTargets.push({
      target: target,
      options: normalizedOptions,
      snapshot: snapshotNode(target, normalizedOptions)
    });

    if (this._timerId === null) {
      this._schedule();
    }
  };

  MutationObserver.prototype.disconnect = function () {
    this._watchedTargets = [];
    if (this._timerId !== null) {
      global.clearTimeout(this._timerId);
      this._timerId = null;
    }
  };

  MutationObserver.prototype.takeRecords = function () {
    var records = this._records.slice(0);
    this._records.length = 0;
    return records;
  };

  MutationObserver.prototype._schedule = function () {
    var observer = this;
    observer._timerId = global.setTimeout(function () {
      observer._timerId = null;

      if (!observer._watchedTargets.length) {
        return;
      }

      for (var i = 0; i < observer._watchedTargets.length; i += 1) {
        var watchedTarget = observer._watchedTargets[i];
        diffNode(watchedTarget.target, watchedTarget.snapshot, watchedTarget.options, observer._records);
        watchedTarget.snapshot = snapshotNode(watchedTarget.target, watchedTarget.options);
      }

      if (observer._records.length) {
        observer._callback(observer.takeRecords(), observer);
      }

      if (observer._watchedTargets.length) {
        observer._schedule();
      }
    }, MutationObserver._period);
  };

  global.MutationObserver = MutationObserver;
})(typeof window !== 'undefined' ? window : this);
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

export function legacyWebApiPolyfillPlugin()
{
  const customElementsPolyfillPath = require.resolve('@webcomponents/custom-elements');
  let polyfillSource = null;

  return {
    name: 'legacy-web-api-polyfill',
    async buildStart()
    {
      const [customElementsPolyfillSource] = await Promise.all([
        readFile(customElementsPolyfillPath, 'utf8'),
      ]);
      const patchedCustomElementsPolyfillSource = customElementsPolyfillSource.replace(
        /new MutationObserver\(/g,
        'new (window.MutationObserver || window.WebKitMutationObserver)(');

      polyfillSource = `${legacyMutationObserverPolyfillSource}
${patchedCustomElementsPolyfillSource}
${legacyDomApiShimsSource}`;
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

      if (!polyfillSource)
      {
        throw new Error('web API polyfill source was not generated before load.');
      }

      return polyfillSource;
    },
    transform(code, id)
    {
      if (id === RESOLVED_VIRTUAL_ID || !ENTRY_MODULE_PATTERN.test(id))
      {
        return null;
      }

      const transformed = injectModuleImport(code, VIRTUAL_ID);
      return transformed === code ? null : { code: transformed, map: null };
    },
  };
}
