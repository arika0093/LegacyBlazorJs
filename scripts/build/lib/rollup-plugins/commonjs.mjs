import commonjs from '@rollup/plugin-commonjs';

export const LEGACY_COMMONJS_INCLUDE_PATTERNS = [
  /[/\\]node_modules[/\\]/,
  /[/\\]src[/\\](?!Components[/\\]Web\.JS[/\\]dist[/\\]).+[/\\]dist[/\\]/,
];

export function shouldTransformLegacyCommonjsModule(id) {
  return LEGACY_COMMONJS_INCLUDE_PATTERNS.some(pattern => pattern.test(id));
}

/**
 * Convert CommonJS modules to ES modules, including workspace-linked upstream package builds.
 * npm workspaces resolve these packages outside node_modules, so a node_modules-only
 * filter misses them and leaves raw require() calls in legacy bundles.
 */
export function legacyCommonjsPlugin() {
  return commonjs({
    include: LEGACY_COMMONJS_INCLUDE_PATTERNS,
    transformMixedEsModules: true,
  });
}
