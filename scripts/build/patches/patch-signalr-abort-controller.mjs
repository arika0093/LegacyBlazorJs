#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

export async function patchSignalRAbortController(filePath) {
  let content = await readFile(filePath, 'utf8');

  const importLine = 'import { Platform, getGlobalThis, isArrayBuffer } from "./Utils";';
  const patchedImportLine = `${importLine}\nimport { AbortController as SignalRAbortController } from "./AbortController";`;
  const abortControllerFieldsPattern = /    private readonly _abortControllerType:[^\n]+\n(?:    private readonly _supportsFetchAbort: boolean;\n)?/;
  const patchedAbortControllerFields = '    private readonly _abortControllerType: any;\n    private readonly _supportsFetchAbort: boolean;\n';

  if (content.includes('this._supportsFetchAbort = false;')) {
    console.log('SignalR AbortController fallback already patched.');
    return;
  }

  if (!content.includes('requireFunc("abort-controller")')) {
    console.log('SignalR AbortController fallback already patched or no longer requires patching.');
    return;
  }

  if (!content.includes(importLine)) {
    console.warn('Could not locate FetchHttpClient Utils import; patch not applied.');
    return;
  }

  content = content.replace(/import \{ AbortController as SignalRAbortController(?:, AbortSignal as SignalRAbortSignal)? \} from "\.\/AbortController";\n/g, '');
  content = content.replace(importLine, patchedImportLine);
  if (abortControllerFieldsPattern.test(content)) {
    content = content.replace(abortControllerFieldsPattern, patchedAbortControllerFields);
  }

  content = content.replace(
    `        if (typeof AbortController === "undefined") {
            // In order to ignore the dynamic require in webpack builds we need to do this magic
            // @ts-ignore: TS doesn't know about these names
            const requireFunc = typeof __webpack_require__ === "function" ? __non_webpack_require__ : require;

            // Node needs EventListener methods on AbortController which our custom polyfill doesn't provide
            this._abortControllerType = requireFunc("abort-controller");
        } else {
            this._abortControllerType = AbortController;
        }`,
    `        if (typeof AbortController === "undefined") {
            if (Platform.isNode) {
                // In order to ignore the dynamic require in webpack builds we need to do this magic
                // @ts-ignore: TS doesn't know about these names
                const requireFunc = typeof __webpack_require__ === "function" ? __non_webpack_require__ : require;

                // Node needs EventListener methods on AbortController which our custom polyfill doesn't provide
                this._abortControllerType = requireFunc("abort-controller");
                this._supportsFetchAbort = true;
            } else {
                this._abortControllerType = SignalRAbortController;
                this._supportsFetchAbort = false;
            }
        } else {
            this._abortControllerType = AbortController;
            this._supportsFetchAbort = true;
        }`);
  content = content.replace(
    '                signal: abortController.signal,\n',
    '                signal: this._supportsFetchAbort ? abortController.signal : undefined,\n');

  await writeFile(filePath, content);
  console.log('Patched SignalR FetchHttpClient to avoid browser-side dynamic require("abort-controller").');
}

if (process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href) {
  const filePath = process.argv[2];
  if (!filePath) {
    throw new Error('Usage: patch-signalr-abort-controller.mjs <FetchHttpClient.ts path>');
  }

  await patchSignalRAbortController(filePath);
}
