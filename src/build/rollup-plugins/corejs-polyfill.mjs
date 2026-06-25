import path from 'node:path';
import process from 'node:process';
import { createRequire } from 'node:module';
import { createEntryChunkPrependPlugin } from './helpers.mjs';

const VIRTUAL_ID = 'legacy-blazor-corejs-polyfill';
const RESOLVED_VIRTUAL_ID = '\0legacy-blazor-corejs-polyfill';

export const polyfillModules = [
  'core-js/actual',
];

function createCoreJsVirtualEntryPlugin() {
  return {
    name: 'legacy-corejs-polyfill-virtual-entry',
    resolveId(source) {
      return source === VIRTUAL_ID ? RESOLVED_VIRTUAL_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_VIRTUAL_ID) {
        return null;
      }

      return `${polyfillModules.map(moduleId => `import ${JSON.stringify(moduleId)};`).join('\n')}\n`;
    },
  };
}

function createCoreJsBrowserEnvPlugin() {
  return {
    name: 'legacy-corejs-browser-env',
    transform(code, id) {
      if (!id.includes('/core-js/')) {
        return null;
      }

      const transformed = code
        .replace(/var\s+([A-Za-z0-9_$]+)\s*=\s*require\('\.\.\/internals\/environment-is-node'\);/g, 'var $1 = false;')
        .replace(/var\s+([A-Za-z0-9_$]+)\s*=\s*require\('\.\/environment-is-node'\);/g, 'var $1 = false;');

      return transformed === code ? null : { code: transformed, map: null };
    },
  };
}

async function buildCoreJsPolyfillSource() {
  const workspaceRequire = createRequire(path.join(process.cwd(), 'package.json'));
  const { rollup } = workspaceRequire('rollup');
  const nodeResolveModule = workspaceRequire('@rollup/plugin-node-resolve');
  const commonjsModule = workspaceRequire('@rollup/plugin-commonjs');
  const nodeResolve = nodeResolveModule.default ?? nodeResolveModule.nodeResolve ?? nodeResolveModule;
  const commonjs = commonjsModule.default ?? commonjsModule;

  const bundle = await rollup({
    input: VIRTUAL_ID,
    plugins: [
      createCoreJsVirtualEntryPlugin(),
      createCoreJsBrowserEnvPlugin(),
      nodeResolve(),
      commonjs({
        include: /node_modules/,
      }),
    ],
    treeshake: false,
  });

  try {
    const generated = await bundle.generate({
      format: 'iife',
      name: 'LegacyBlazorCoreJsPolyfill',
    });
    const chunk = generated.output.find(output => output.type === 'chunk');
    if (!chunk) {
      throw new Error('Could not generate core-js polyfill output.');
    }

    return chunk.code;
  } finally {
    await bundle.close();
  }
}

/**
 * Build core-js separately, then prepend that final ES5-safe output to every entry chunk.
 */
export function legacyCoreJsPolyfillPlugin() {
  return createEntryChunkPrependPlugin({
    name: 'legacy-corejs-polyfill',
    loadSource: buildCoreJsPolyfillSource,
  });
}
