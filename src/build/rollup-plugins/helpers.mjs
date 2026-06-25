import { injectModuleImport } from '../lib/legacy-output.mjs';

export const LEGACY_ENTRY_MODULE_PATTERN = /\/Boot\.(?:Server|Web|WebAssembly|WebView)\.ts$/;

export function createTransformResult(code, transformed) {
  return transformed === code ? null : { code: transformed, map: null };
}

export function createRenderChunkTransformPlugin({
  name,
  buildStart,
  isEnabled = () => true,
  transformChunk,
}) {
  const plugin = {
    name,
    renderChunk(code, chunk) {
      if (!isEnabled()) {
        return null;
      }

      return createTransformResult(code, transformChunk(code, chunk));
    },
  };

  if (buildStart) {
    plugin.buildStart = buildStart;
  }

  return plugin;
}

export function createEntryChunkPrependPlugin({
  name,
  loadSource,
  isEnabled = () => true,
  shouldPrependChunk = chunk => chunk.isEntry,
}) {
  let enabled = false;
  let source = null;

  return {
    name,
    async buildStart() {
      enabled = isEnabled();
      if (!enabled) {
        return;
      }

      source = await loadSource();
    },
    renderChunk(code, chunk) {
      if (!enabled || !shouldPrependChunk(chunk)) {
        return null;
      }

      if (source === null) {
        throw new Error(`${name} source was not generated before renderChunk.`);
      }

      return {
        code: `${source}\n${code}`,
        map: null,
      };
    },
  };
}

export function createSourceBackedImportInjectorPlugin({
  name,
  moduleId,
  loadSource,
  isEnabled = () => true,
  shouldTransform = () => true,
  injectImport = code => injectModuleImport(code, moduleId),
}) {
  const resolvedModuleId = `\0${moduleId}`;
  let enabled = false;
  let source = null;

  return {
    name,
    async buildStart() {
      enabled = isEnabled();
      if (!enabled) {
        return;
      }

      source = await loadSource();
    },
    resolveId(sourceId) {
      if (!enabled || sourceId !== moduleId) {
        return null;
      }

      return resolvedModuleId;
    },
    load(id) {
      if (!enabled || id !== resolvedModuleId) {
        return null;
      }

      if (source === null) {
        throw new Error(`${name} source was not generated before load.`);
      }

      return source;
    },
    transform(code, id) {
      if (!enabled || id === resolvedModuleId || !shouldTransform(code, id)) {
        return null;
      }

      return createTransformResult(code, injectImport(code, id));
    },
  };
}

export function createLegacyEntryPolyfillPlugin({
  name,
  moduleId,
  loadSource,
  isEnabled = () => true,
}) {
  return createSourceBackedImportInjectorPlugin({
    name,
    moduleId,
    loadSource,
    isEnabled,
    shouldTransform: (_code, id) => LEGACY_ENTRY_MODULE_PATTERN.test(id),
  });
}
