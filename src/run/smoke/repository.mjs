import path from 'node:path';
import { getRootDir } from '../compat.mjs';

export const repositoryRoot = getRootDir();
export const packageSourceDirectory = path.join(repositoryRoot, 'artifacts', 'packages');
export const workDirectory = path.join(repositoryRoot, '.work');
export const blazorServerAppTemplateDirectory = path.join(repositoryRoot, 'dotnet', 'tests', 'BlazorServerApp');
export const blazorWasmAppTemplateDirectory = path.join(repositoryRoot, 'dotnet', 'tests', 'BlazorWasmApp');
