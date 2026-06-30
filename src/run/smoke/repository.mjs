import path from 'node:path';
import { getRootDir } from '../lib/compat.mjs';

export const repositoryRoot = getRootDir();
export const packageSourceDirectory = path.join(repositoryRoot, 'artifacts', 'packages');
export const workDirectory = path.join(repositoryRoot, '.work');
export const blazorServerAppTemplateDirectory = path.join(repositoryRoot, 'dotnet', 'tests', 'LegacyBlazorJs.Test.Server');
export const blazorWasmAppTemplateDirectory = path.join(repositoryRoot, 'dotnet', 'tests', 'LegacyBlazorJs.Test.Wasm');
