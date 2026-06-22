import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';

const VIRTUAL_ID = 'legacy-blazor-corejs-polyfill';
const RESOLVED_VIRTUAL_ID = '\0legacy-blazor-corejs-polyfill';

export const polyfillModules = [
  'core-js/actual',
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
