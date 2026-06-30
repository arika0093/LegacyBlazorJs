import { access, cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';

import {
  blazorServerAppTemplateDirectory,
  blazorWasmAppTemplateDirectory,
} from './repository.mjs';
import { CapturedProcess } from './captured-process.mjs';
import { resolveScriptProfile } from './package-version.mjs';
import { requestText, runChecked } from './process-utils.mjs';
import { createId, getAvailablePort, removeDirectory } from './shared.mjs';

const SERVER_READY_TIMEOUT_MS = 120_000;
const DEFAULT_TARGET_FRAMEWORK = 'net10.0';
const DEFAULT_GLOBAL_PACKAGES_FOLDER = '.nuget/packages';
const DEFAULT_WORKSPACE_PACKAGE_SOURCE = '../../artifacts/packages';

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
      '--no-launch-profile',
      '--no-restore',
      ...this.#getDotnetPropertyArgs(),
      '--',
      '--urls', this.#baseUri,
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
    await this.#copyNuGetConfig();

    this.#logger.info(`Restoring .NET dependencies for '${this.#projectPath}'.`);
    await runChecked('dotnet', [
      'restore',
      this.#projectPath,
      ...this.#getDotnetPropertyArgs(),
    ], { cwd: this.#rootDirectory });

    const scriptHostPath = getScriptHostPath(this.#rootDirectory, this.#hostingModel);
    const scriptName = this.#hostingModel === 'Server'
      ? `blazor.server.${this.#scriptProfile}.js`
      : `blazor.webassembly.${this.#scriptProfile}.js`;
    this.#logger.info(`Injecting generated script '${scriptName}' into '${scriptHostPath}'.`);
    await replaceSingleToken(scriptHostPath, '__BLAZOR_SCRIPT_NAME__', scriptName);
  }

  async #copyNuGetConfig() {
    const sourcePath = path.join(this.#rootDirectory, 'NuGet.config');
    if (await hasPath(sourcePath)) {
      return;
    }

    await writeNuGetConfig(this.#rootDirectory);
  }

  #getDotnetPropertyArgs() {
    return [
      `-p:LegacyBlazorTestTargetFramework=${this.#targetFramework}`,
      `-p:LegacyBlazorPackageVersion=${this.#packageVersion}`,
      `-p:AspNetCorePackageVersion=${this.#packageVersion}`,
    ];
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
  const contents = `<?xml version="1.0" encoding="utf-8"?>\n<configuration>\n  <config>\n    <add key="globalPackagesFolder" value="${DEFAULT_GLOBAL_PACKAGES_FOLDER}" />\n  </config>\n  <packageSources>\n    <clear />\n    <add key="local" value="${DEFAULT_WORKSPACE_PACKAGE_SOURCE}" />\n    <add key="nuget.org" value="https://api.nuget.org/v3/index.json" protocolVersion="3" />\n  </packageSources>\n</configuration>\n`;
  await writeFile(nugetConfigPath, contents);
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
      return path.join(appDirectory, 'LegacyBlazorJs.Test.Server.csproj');
    case 'WebAssembly':
      return path.join(appDirectory, 'LegacyBlazorJs.Test.Wasm.csproj');
    default:
      throw new Error(`Unsupported hosting model '${hostingModel}'.`);
  }
}

function resolveTargetFrameworkMoniker(packageVersion, explicitMajor) {
  if (!packageVersion?.trim()) {
    return DEFAULT_TARGET_FRAMEWORK;
  }

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
