import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const parser = require('@babel/parser');
const traverseModule = require('@babel/traverse');
const generatorModule = require('@babel/generator');
const t = require('@babel/types');

const traverse = traverseModule.default ?? traverseModule;
const generate = generatorModule.default ?? generatorModule;

export const LEGACY_DYNAMIC_IMPORT_HELPER_NAME = '__legacyDynamicImport';
export const LEGACY_DYNAMIC_IMPORT_HELPER_SOURCE =
  'function __legacyDynamicImport(u) { return Function("u", "return import(u)")(u); }';

function parseSource(source, filename) {
  return parser.parse(source, {
    sourceType: 'unambiguous',
    sourceFilename: filename,
    plugins: ['dynamicImport'],
  });
}

function createHelperDeclaration() {
  return parseSource(LEGACY_DYNAMIC_IMPORT_HELPER_SOURCE, 'legacy-dynamic-import-helper.js').program.body[0];
}

function findInsertionIndex(statements) {
  let index = 0;
  while (index < statements.length) {
    const statement = statements[index];
    if (statement.directive || t.isImportDeclaration(statement)) {
      index += 1;
      continue;
    }

    break;
  }

  return index;
}

function hasHelperDeclaration(statements) {
  return statements.some(statement =>
    t.isFunctionDeclaration(statement)
      && t.isIdentifier(statement.id, { name: LEGACY_DYNAMIC_IMPORT_HELPER_NAME }));
}

export function transformLegacyDynamicImport(source, filename = 'chunk.js') {
  if (!/\bimport\s*\(/.test(source)) {
    return source;
  }

  const ast = parseSource(source, filename);
  let transformed = false;

  traverse(ast, {
    ImportExpression(path) {
      transformed = true;
      path.replaceWith(
        t.callExpression(
          t.identifier(LEGACY_DYNAMIC_IMPORT_HELPER_NAME),
          [path.node.source]));
    },
    CallExpression(path) {
      if (path.node.callee.type !== 'Import' || path.node.arguments.length !== 1) {
        return;
      }

      transformed = true;
      path.replaceWith(
        t.callExpression(
          t.identifier(LEGACY_DYNAMIC_IMPORT_HELPER_NAME),
          [path.node.arguments[0]]));
    },
  });

  if (!transformed) {
    return source;
  }

  if (!hasHelperDeclaration(ast.program.body)) {
    ast.program.body.splice(findInsertionIndex(ast.program.body), 0, createHelperDeclaration());
  }

  return generate(ast, { comments: true }, source).code;
}

export function sourceUsesFetch(source, filename = 'chunk.js') {
  if (!source.includes('fetch')) {
    return false;
  }

  const ast = parseSource(source, filename);
  let usesFetch = false;

  traverse(ast, {
    CallExpression(path) {
      const { callee } = path.node;
      if (t.isIdentifier(callee, { name: 'fetch' })) {
        usesFetch = true;
        path.stop();
        return;
      }

      if (t.isMemberExpression(callee) && !callee.computed && t.isIdentifier(callee.property, { name: 'fetch' })) {
        usesFetch = true;
        path.stop();
      }
    },
  });

  return usesFetch;
}

export function injectModuleImport(source, moduleId) {
  const importLine = `import ${JSON.stringify(moduleId)};`;
  if (source.includes(importLine)) {
    return source;
  }

  return `${importLine}\n${source}`;
}
