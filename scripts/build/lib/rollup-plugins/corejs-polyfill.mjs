import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { LEGACY_COMMONJS_INCLUDE_PATTERNS } from './commonjs.mjs';

const VIRTUAL_ID = 'legacy-blazor-corejs-polyfill';
const RESOLVED_VIRTUAL_ID = '\0legacy-blazor-corejs-polyfill';
const POLYFILL_ENTRY_MODULE = 'core-js/stable';

function createPolyfillEntrySource(babel, targets) {
  const result = babel.transformSync(
    `import ${JSON.stringify(POLYFILL_ENTRY_MODULE)};\n`,
    {
      filename: 'legacy-corejs-polyfill-entry.js',
      sourceType: 'module',
      compact: false,
      presets: [[
        '@babel/preset-env',
        {
          targets,
          bugfixes: true,
          modules: false,
          useBuiltIns: 'entry',
          corejs: {
            version: 3,
            proposals: false,
          },
        },
      ]],
    });

  if (!result?.code) {
    throw new Error('Could not generate the target-specific core-js entry source.');
  }

  return result.code;
}

/**
 * Build only the target-specific core-js modules selected by preset-env,
 * then prepend that final output to every entry chunk.
 */
export function legacyCoreJsPolyfillPlugin(targets = {})
{
  let polyfillSource = null;
  let polyfillEntrySource = null;

  return {
    name: 'legacy-corejs-polyfill',
    async buildStart()
    {
      const workspaceRequire = createRequire(path.join(process.cwd(), 'package.json'));
      const babel = workspaceRequire('@babel/core');
      const { rollup } = workspaceRequire('rollup');
      const nodeResolveModule = workspaceRequire('@rollup/plugin-node-resolve');
      const commonjsModule = workspaceRequire('@rollup/plugin-commonjs');
      const nodeResolve = nodeResolveModule.default ?? nodeResolveModule.nodeResolve ?? nodeResolveModule;
      const commonjs = commonjsModule.default ?? commonjsModule;
      polyfillEntrySource = createPolyfillEntrySource(babel, targets);

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

              return polyfillEntrySource;
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
            include: LEGACY_COMMONJS_INCLUDE_PATTERNS,
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

      return polyfillEntrySource;
    },
    renderChunk(code, chunk)
    {
      if (!chunk.isEntry)
      {
        return null;
      }

      if (polyfillSource === null)
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
