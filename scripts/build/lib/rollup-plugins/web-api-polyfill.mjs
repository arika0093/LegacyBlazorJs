import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

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
      polyfillSource = await readFile(customElementsPolyfillPath, 'utf8');
    },
    renderChunk(code, chunk)
    {
      if (!chunk.isEntry)
      {
        return null;
      }

      if (!polyfillSource)
      {
        throw new Error('web API polyfill source was not generated before renderChunk.');
      }

      return {
        code: `${polyfillSource}\n${legacyDomApiShimsSource}\n${code}`,
        map: null,
      };
    },
  };
}
