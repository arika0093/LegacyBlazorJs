import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const VIRTUAL_ID = 'legacy-blazor-corejs-polyfill';
const RESOLVED_VIRTUAL_ID = '\0legacy-blazor-corejs-polyfill';

export const polyfillModules = [
  // Keep this list aligned with the union of @babel/preset-env IE11 usage analysis
  // across the generated blazor.server/web/webview bundles. Syntax transpilation is
  // not enough for legacy browsers because the runtime still depends on Web APIs
  // like URL/URLSearchParams and DOM collection helpers like NodeList#forEach.
  'core-js/modules/esnext.global-this.js',
  'core-js/modules/es.symbol.js',
  'core-js/modules/es.symbol.description.js',
  'core-js/modules/es.symbol.async-iterator.js',
  'core-js/modules/es.array.iterator.js',
  'core-js/modules/es.array.concat.js',
  'core-js/modules/es.array.filter.js',
  'core-js/modules/es.array.find.js',
  'core-js/modules/es.array.from.js',
  'core-js/modules/es.array.includes.js',
  'core-js/modules/es.array.join.js',
  'core-js/modules/es.array.map.js',
  'core-js/modules/es.array.slice.js',
  'core-js/modules/es.array.sort.js',
  'core-js/modules/es.array.splice.js',
  'core-js/modules/es.array-buffer.constructor.js',
  'core-js/modules/es.date.to-primitive.js',
  'core-js/modules/es.function.name.js',
  'core-js/modules/es.map.js',
  'core-js/modules/es.math.trunc.js',
  'core-js/modules/es.number.constructor.js',
  'core-js/modules/es.number.epsilon.js',
  'core-js/modules/es.object.assign.js',
  'core-js/modules/es.object.define-property.js',
  'core-js/modules/es.object.get-own-property-descriptor.js',
  'core-js/modules/es.object.get-own-property-descriptors.js',
  'core-js/modules/es.object.get-own-property-names.js',
  'core-js/modules/es.object.get-prototype-of.js',
  'core-js/modules/es.object.is-extensible.js',
  'core-js/modules/es.object.is-frozen.js',
  'core-js/modules/es.object.keys.js',
  'core-js/modules/es.object.entries.js',
  'core-js/modules/es.object.freeze.js',
  'core-js/modules/es.object.prevent-extensions.js',
  'core-js/modules/es.object.seal.js',
  'core-js/modules/es.object.to-string.js',
  'core-js/modules/es.object.is-sealed.js',
  'core-js/modules/es.number.is-integer.js',
  'core-js/modules/es.number.is-nan.js',
  'core-js/modules/es.number.is-safe-integer.js',
  'core-js/modules/es.number.parse-int.js',
  'core-js/modules/es.promise.constructor.js',
  'core-js/modules/es.promise.all.js',
  'core-js/modules/es.promise.catch.js',
  'core-js/modules/es.promise.race.js',
  'core-js/modules/es.promise.reject.js',
  'core-js/modules/es.promise.resolve.js',
  'core-js/modules/es.promise.finally.js',
  'core-js/modules/es.promise.with-resolvers.js',
  'core-js/modules/es.reflect.apply.js',
  'core-js/modules/es.reflect.construct.js',
  'core-js/modules/es.regexp.constructor.js',
  'core-js/modules/es.regexp.exec.js',
  'core-js/modules/es.regexp.to-string.js',
  'core-js/modules/es.set.js',
  'core-js/modules/es.string.ends-with.js',
  'core-js/modules/es.string.includes.js',
  'core-js/modules/es.string.iterator.js',
  'core-js/modules/es.string.match.js',
  'core-js/modules/es.string.pad-start.js',
  'core-js/modules/es.string.repeat.js',
  'core-js/modules/es.string.replace.js',
  'core-js/modules/es.string.split.js',
  'core-js/modules/es.string.starts-with.js',
  'core-js/modules/es.string.trim.js',
  'core-js/modules/es.typed-array.copy-within.js',
  'core-js/modules/es.typed-array.every.js',
  'core-js/modules/es.typed-array.fill.js',
  'core-js/modules/es.typed-array.filter.js',
  'core-js/modules/es.typed-array.find.js',
  'core-js/modules/es.typed-array.find-index.js',
  'core-js/modules/es.typed-array.for-each.js',
  'core-js/modules/es.typed-array.from.js',
  'core-js/modules/es.typed-array.includes.js',
  'core-js/modules/es.typed-array.index-of.js',
  'core-js/modules/es.typed-array.iterator.js',
  'core-js/modules/es.typed-array.join.js',
  'core-js/modules/es.typed-array.last-index-of.js',
  'core-js/modules/es.typed-array.map.js',
  'core-js/modules/es.typed-array.reduce-right.js',
  'core-js/modules/es.typed-array.reduce.js',
  'core-js/modules/es.typed-array.reverse.js',
  'core-js/modules/es.typed-array.set.js',
  'core-js/modules/es.typed-array.slice.js',
  'core-js/modules/es.typed-array.some.js',
  'core-js/modules/es.typed-array.sort.js',
  'core-js/modules/es.typed-array.subarray.js',
  'core-js/modules/es.typed-array.to-locale-string.js',
  'core-js/modules/es.typed-array.to-string.js',
  'core-js/modules/es.typed-array.uint8-array.js',
  'core-js/modules/es.weak-map.js',
  'core-js/modules/es.weak-set.js',
  'core-js/modules/web.dom-collections.for-each.js',
  'core-js/modules/web.dom-collections.iterator.js',
  'core-js/modules/web.queue-microtask.js',
  'core-js/modules/web.url.js',
  'core-js/modules/web.url-search-params.js',
  'core-js/modules/web.url.to-json.js',
];

/**
 * Build core-js separately, then prepend that final ES5-safe output to every entry chunk.
 */
export function legacyCoreJsPolyfillPlugin()
{
  let polyfillSource = null;

  return {
    name: 'legacy-corejs-polyfill',
    async buildStart()
    {
      const workspaceRequire = createRequire(path.join(process.cwd(), 'package.json'));
      const { rollup } = workspaceRequire('rollup');
      const nodeResolveModule = workspaceRequire('@rollup/plugin-node-resolve');
      const commonjsModule = workspaceRequire('@rollup/plugin-commonjs');
      const nodeResolve = nodeResolveModule.default ?? nodeResolveModule.nodeResolve ?? nodeResolveModule;
      const commonjs = commonjsModule.default ?? commonjsModule;

      const bundle = await rollup({
        input: VIRTUAL_ID,
        plugins: [
          {
            name: 'legacy-corejs-polyfill-virtual-entry',
            resolveId(source)
            {
              return source === VIRTUAL_ID ? RESOLVED_VIRTUAL_ID : null;
            },
            load(id)
            {
              if (id !== RESOLVED_VIRTUAL_ID)
              {
                return null;
              }

              return `${polyfillModules.map(moduleId => `import ${JSON.stringify(moduleId)};`).join('\n')}\n`;
            },
          },
          {
            name: 'legacy-corejs-browser-env',
            transform(code, id)
            {
              if (!id.includes('/core-js/'))
              {
                return null;
              }

              const transformed = code
                .replace(/var\s+([A-Za-z0-9_$]+)\s*=\s*require\('\.\.\/internals\/environment-is-node'\);/g, 'var $1 = false;')
                .replace(/var\s+([A-Za-z0-9_$]+)\s*=\s*require\('\.\/environment-is-node'\);/g, 'var $1 = false;');

              return transformed === code ? null : { code: transformed, map: null };
            },
          },
          nodeResolve(),
          commonjs({
            include: /node_modules/,
          }),
        ],
        treeshake: false,
      });

      try
      {
        const generated = await bundle.generate({
          format: 'iife',
          name: 'LegacyBlazorCoreJsPolyfill',
        });
        const chunk = generated.output.find(output => output.type === 'chunk');
        if (!chunk)
        {
          throw new Error('Could not generate core-js polyfill output.');
        }

        polyfillSource = chunk.code;
      }
      finally
      {
        await bundle.close();
      }
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

      return `${polyfillModules.map(moduleId => `import ${JSON.stringify(moduleId)};`).join('\n')}\n`;
    },
    renderChunk(code, chunk)
    {
      if (!chunk.isEntry)
      {
        return null;
      }

      if (!polyfillSource)
      {
        throw new Error('core-js polyfill source was not generated before renderChunk.');
      }

      return {
        code: `${polyfillSource}\n${code}`,
        map: null,
      };
    },
  };
}
