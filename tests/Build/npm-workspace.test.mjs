import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveNpmWorkspace } from '../../src/build/build-variants.mjs';

test('resolves an npm workspace by package name when a nested workspace shares its path prefix', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'legacy-blazor-js-workspace-'));
  t.after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  const sourceDir = path.join(root, 'src', 'Components', 'Web.JS');
  const nestedDir = path.join(sourceDir, 'JSInterop');
  await mkdir(nestedDir, { recursive: true });

  await writeFile(path.join(root, 'package.json'), JSON.stringify({
    private: true,
    workspaces: [
      'src/Components/Web.JS',
      'src/Components/Web.JS/JSInterop',
    ],
  }));
  await writeFile(path.join(sourceDir, 'package.json'), JSON.stringify({
    name: '@microsoft/microsoft.aspnetcore.components.web.js',
  }));
  await writeFile(path.join(nestedDir, 'package.json'), JSON.stringify({
    name: '@microsoft/dotnet-js-interop',
  }));

  assert.deepEqual(await resolveNpmWorkspace(sourceDir), {
    root,
    workspaceName: '@microsoft/microsoft.aspnetcore.components.web.js',
  });
});
