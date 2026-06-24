import { access, cp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

import {
  blazorServerAppTemplateDirectory,
  blazorWasmAppTemplateDirectory,
  packageSourceDirectory,
} from './repository.mjs';
import { CapturedProcess } from './captured-process.mjs';
import { resolveScriptProfile } from './package-version.mjs';
import { requestText, runChecked } from './process-utils.mjs';
import { createId, getAvailablePort, removeDirectory } from './shared.mjs';

const SERVER_READY_TIMEOUT_MS = 120_000;

export class SmokeAppHarness {
  static async create(root, profile, packageVersion, hostingModel, logger) {
    const rootDirectory = path.join(
      root,
      '.work',
      `smoke-${hostingModel.toLowerCase()}-${profile}-${createId()}`);
    logger.info(`Creating smoke app workspace at '${rootDirectory}'.`);
    await mkdir(rootDirectory, { recursive: true });

    const templateDirectory = getTemplateDirectory(hostingModel);
    logger.info(`Copying ${hostingModel} template from '${templateDirectory}'.`);
    await cp(templateDirectory, rootDirectory, { recursive: true });

    const projectPath = getProjectPath(rootDirectory, hostingModel);
    const baseUri = `http://127.0.0.1:${await getAvailablePort()}`;
    const targetFramework = resolveTargetFrameworkMoniker(
      packageVersion,
      process.env.SMOKE_TEST_DOTNET_MAJOR?.trim());
    const scriptProfile = await resolveScriptProfile(profile);
    logger.info(`Resolved script profile '${scriptProfile}' for requested profile '${profile}'.`);

    const harness = new SmokeAppHarness(
      rootDirectory,
      projectPath,
      profile,
      scriptProfile,
      packageVersion,
      targetFramework,
      hostingModel,
      baseUri,
      logger);
    await harness.#initialize();
    return harness;
  }

  #rootDirectory;
  #projectPath;
  #profile;
  #scriptProfile;
  #packageVersion;
  #targetFramework;
  #hostingModel;
  #baseUri;
  #logger;
  #serverProcess = null;

  constructor(rootDirectory, projectPath, profile, scriptProfile, packageVersion, targetFramework, hostingModel, baseUri, logger) {
    this.#rootDirectory = rootDirectory;
    this.#projectPath = projectPath;
    this.#profile = profile;
    this.#scriptProfile = scriptProfile;
    this.#packageVersion = packageVersion;
    this.#targetFramework = targetFramework;
    this.#hostingModel = hostingModel;
    this.#baseUri = baseUri;
    this.#logger = logger;
  }

  get baseUri() {
    return this.#baseUri;
  }

  async start() {
    this.#logger.info(`Starting Blazor ${this.#hostingModel} app at ${this.#baseUri}.`);
    this.#serverProcess = CapturedProcess.start('dotnet', [
      'run',
      '--project', this.#projectPath,
      '--urls', this.#baseUri,
      '--no-launch-profile',
      '--no-restore',
    ], {
      cwd: this.#rootDirectory,
      env: {
        ...process.env,
        ASPNETCORE_ENVIRONMENT: 'Development',
      },
    });

    const readyUntil = Date.now() + SERVER_READY_TIMEOUT_MS;
    while (Date.now() < readyUntil) {
      if (this.#serverProcess.hasExited) {
        this.#logger.error('Blazor app exited before reporting ready state.');
        throw new Error(
          `Blazor ${this.#hostingModel} app exited before it became ready.\n${await this.#serverProcess.getCombinedOutput()}`);
      }

      try {
        const response = await requestText(new URL('/counter', this.#baseUri).toString());
        if (response.statusCode >= 200 && response.statusCode < 300) {
          this.#logger.info(`Blazor ${this.#hostingModel} app responded successfully on ${this.#baseUri}.`);
          return;
        }
      } catch (error) {
        if (error?.name !== 'TimeoutError' && error?.code !== 'ECONNREFUSED') {
          throw error;
        }
      }

      await delay(1_000);
    }

    await this.#disposeServer();
    this.#logger.error(`Blazor ${this.#hostingModel} app did not become ready before timeout.`);
    throw new Error(
      `Blazor ${this.#hostingModel} app did not become ready at ${this.#baseUri} within ${SERVER_READY_TIMEOUT_MS / 1000} seconds.`);
  }

  async dispose() {
    this.#logger.info(`Removing smoke app workspace '${this.#rootDirectory}'.`);
    await this.#disposeServer();
    await removeDirectory(this.#rootDirectory);
  }

  async #initialize() {
    this.#logger.info(`Preparing project '${this.#projectPath}'.`);
    await this.#replaceProjectPlaceholders();
    await this.#copyNuGetConfig();

    this.#logger.info(`Restoring .NET dependencies for '${this.#projectPath}'.`);
    await runChecked('dotnet', ['restore', this.#projectPath], { cwd: this.#rootDirectory });

    const scriptHostPath = getScriptHostPath(this.#rootDirectory, this.#hostingModel);
    const scriptName = this.#hostingModel === 'Server'
      ? `blazor.server.${this.#scriptProfile}.js`
      : `blazor.webassembly.${this.#scriptProfile}.js`;
    this.#logger.info(`Injecting generated script '${scriptName}' into '${scriptHostPath}'.`);
    await replaceSingleToken(scriptHostPath, '__BLAZOR_SCRIPT_NAME__', scriptName);
  }

  async #replaceProjectPlaceholders() {
    const projectFiles = await findFiles(this.#rootDirectory, filePath => filePath.endsWith('.csproj'));
    const nugetConfigFiles = await findFiles(this.#rootDirectory, filePath => filePath.endsWith('NuGet.config'));
    await Promise.all([...projectFiles, ...nugetConfigFiles].map(async filePath => {
      let contents = await readFile(filePath, 'utf8');
      const updated = contents
        .replaceAll('__TARGET_FRAMEWORK__', this.#targetFramework)
        .replaceAll('__ASPNETCORE_VERSION__', this.#packageVersion)
        .replaceAll('__PACKAGE_VERSION__', this.#packageVersion)
        .replaceAll('__NUGET_PACKAGES_FOLDER__', getGlobalPackagesFolder(this.#rootDirectory))
        .replaceAll('__PACKAGE_SOURCE__', packageSourceDirectory.replaceAll('\\', '/'));

      if (updated !== contents) {
        contents = updated;
        await writeFile(filePath, contents);
      }
    }));
  }

  async #copyNuGetConfig() {
    const sourcePath = path.join(this.#rootDirectory, 'NuGet.config');
    if (await hasPath(sourcePath)) {
      return;
    }

    await writeNuGetConfig(this.#rootDirectory);
  }

  async #disposeServer() {
    if (!this.#serverProcess) {
      return;
    }

    if (!this.#serverProcess.hasExited) {
      this.#logger.info('Stopping Blazor app process.');
      this.#serverProcess.kill();
    }

    await this.#serverProcess.dispose();
    this.#serverProcess = null;
  }
}

async function writeNuGetConfig(directory) {
  const nugetConfigPath = path.join(directory, 'NuGet.config');
  const contents = `<?xml version="1.0" encoding="utf-8"?>\n<configuration>\n  <config>\n    <add key="globalPackagesFolder" value="${getGlobalPackagesFolder(directory)}" />\n  </config>\n  <packageSources>\n    <clear />\n    <add key="local" value="${packageSourceDirectory.replaceAll('\\', '/')}" />\n    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" protocolVersion="3" />\n  </packageSources>\n</configuration>\n`;
  await writeFile(nugetConfigPath, contents);
}

function getGlobalPackagesFolder(directory) {
  return path.join(directory, '.nuget', 'packages').replaceAll('\\', '/');
}

async function hasPath(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function replaceSingleToken(filePath, token, replacement) {
  const contents = await readFile(filePath, 'utf8');
  const updated = contents.replace(token, replacement);
  if (updated === contents) {
    throw new Error(`Could not replace the script placeholder in '${filePath}'.`);
  }

  await writeFile(filePath, updated);
}

async function findFiles(rootDirectory, predicate) {
  const result = [];
  const entries = await readdir(rootDirectory, { withFileTypes: true });
  for (const entry of entries) {
    const entryPath = path.join(rootDirectory, entry.name);
    if (entry.isDirectory()) {
      result.push(...await findFiles(entryPath, predicate));
      continue;
    }

    if (predicate(entryPath)) {
      result.push(entryPath);
    }
  }

  return result;
}

function getTemplateDirectory(hostingModel) {
  switch (hostingModel) {
    case 'Server':
      return blazorServerAppTemplateDirectory;
    case 'WebAssembly':
      return blazorWasmAppTemplateDirectory;
    default:
      throw new Error(`Unsupported hosting model '${hostingModel}'.`);
  }
}

function getScriptHostPath(appDirectory, hostingModel) {
  switch (hostingModel) {
    case 'Server':
      return path.join(appDirectory, 'Components', 'App.razor');
    case 'WebAssembly':
      return path.join(appDirectory, 'wwwroot', 'index.html');
    default:
      throw new Error(`Unsupported hosting model '${hostingModel}'.`);
  }
}

function getProjectPath(appDirectory, hostingModel) {
  switch (hostingModel) {
    case 'Server':
      return path.join(appDirectory, 'BlazorServerApp.csproj');
    case 'WebAssembly':
      return path.join(appDirectory, 'BlazorWasmApp.csproj');
    default:
      throw new Error(`Unsupported hosting model '${hostingModel}'.`);
  }
}

function resolveTargetFrameworkMoniker(packageVersion, explicitMajor) {
  const numericExplicitMajor = Number(explicitMajor);
  if (Number.isFinite(numericExplicitMajor) && numericExplicitMajor > 0) {
    return `net${numericExplicitMajor}.0`;
  }

  const match = /^(?<major>\d+)\./.exec(packageVersion);
  if (!match?.groups?.major || Number(match.groups.major) <= 0) {
    throw new Error(`Could not determine the target framework from package version '${packageVersion}'.`);
  }

  return `net${match.groups.major}.0`;
}
