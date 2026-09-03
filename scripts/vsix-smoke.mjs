import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
  runTests,
} from "@vscode/test-electron";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8"));
const vsixPath = resolve(process.argv[2] ?? `${manifest.name}-${manifest.version}.vsix`);
const runRoot = join(projectRoot, ".tmp", `vsix-smoke-${process.pid}-${Date.now()}`);
const userDataDir = join(runRoot, "user-data");
const extensionsDir = join(runRoot, "extensions");
const fixtureDir = join(runRoot, "fixture");
const extensionId = `${manifest.publisher}.${manifest.name}`;
const vscodeExecutablePath =
  process.env.VSCODE_EXECUTABLE_PATH ??
  (await downloadAndUnzipVSCode({ version: process.env.VSCODE_TEST_VERSION ?? "1.110.0" }));

try {
  await Promise.all([
    mkdir(userDataDir, { recursive: true }),
    mkdir(extensionsDir, { recursive: true }),
    mkdir(fixtureDir, { recursive: true }),
  ]);
  const piFixturePath = await createPiFixture(fixtureDir);
  const profileArgs = [`--user-data-dir=${userDataDir}`, `--extensions-dir=${extensionsDir}`];

  runVSCodeCli(vscodeExecutablePath, [...profileArgs, "--install-extension", vsixPath, "--force"]);
  const installed = runVSCodeCli(vscodeExecutablePath, [
    ...profileArgs,
    "--list-extensions",
    "--show-versions",
  ]).stdout;
  assertExtensionVersion(installed, extensionId, manifest.version, "installed");

  await runTests({
    vscodeExecutablePath,
    reuseMachineInstall: true,
    extensionDevelopmentPath: join(projectRoot, "test", "vsix", "driver"),
    extensionTestsPath: join(projectRoot, "test", "vsix", "suite.cjs"),
    extensionTestsEnv: {
      PI_VSCODE_TEST_BINARY: piFixturePath,
      PI_VSCODE_TEST_EXTENSION_DIR: extensionsDir,
      PI_VSCODE_TEST_VERSION: manifest.version,
    },
    launchArgs: profileArgs,
  });

  runVSCodeCli(vscodeExecutablePath, [...profileArgs, "--uninstall-extension", extensionId]);
  const remaining = runVSCodeCli(vscodeExecutablePath, [
    ...profileArgs,
    "--list-extensions",
    "--show-versions",
  ]).stdout;
  if (new RegExp(`^${escapeRegExp(extensionId)}@`, "im").test(remaining)) {
    throw new Error(`${extensionId} is still installed after uninstall.`);
  }

  console.log(
    `VSIX smoke passed: installed, activated, launched a persistent terminal, and uninstalled ${extensionId}@${manifest.version}.`,
  );
} finally {
  await rm(runRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}

async function createPiFixture(directory) {
  const scriptPath = join(directory, "pi-fixture.cjs");
  await writeFile(scriptPath, "setTimeout(() => {}, 30000);\n", "utf8");
  if (process.platform === "win32") {
    const commandPath = join(directory, "pi.cmd");
    await writeFile(
      commandPath,
      `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`,
      "utf8",
    );
    return commandPath;
  }

  const commandPath = join(directory, "pi");
  await writeFile(
    commandPath,
    `#!/bin/sh\nexec "${process.execPath}" "${scriptPath}" "$@"\n`,
    "utf8",
  );
  await chmod(commandPath, 0o755);
  return commandPath;
}

function runVSCodeCli(executablePath, args) {
  const cli = resolveVSCodeCli(executablePath);
  const result = spawnSync(cli.command, [...cli.prefixArgs, ...args], {
    encoding: "utf8",
    env: cli.env,
    shell: false,
    timeout: 60_000,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `VS Code CLI exited with code ${result.status}.`);
  }
  return result;
}

function resolveVSCodeCli(executablePath) {
  if (process.platform !== "win32") {
    const [command, ...prefixArgs] = resolveCliArgsFromVSCodeExecutablePath(executablePath, {
      reuseMachineInstall: true,
    });
    return { command, prefixArgs, env: process.env };
  }

  const installRoot = dirname(executablePath);
  const directCli = join(installRoot, "resources", "app", "out", "cli.js");
  const cliPath = findWindowsCli(installRoot, directCli);
  return {
    command: executablePath,
    prefixArgs: [cliPath],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  };
}

function findWindowsCli(installRoot, directCli) {
  if (existsSync(directCli)) return directCli;
  const candidates = readdirSync(installRoot)
    .map((entry) => join(installRoot, entry, "resources", "app", "out", "cli.js"))
    .filter(existsSync)
    .sort((left, right) => statSync(left).mtimeMs - statSync(right).mtimeMs);
  if (candidates.length === 0)
    throw new Error(`Cannot locate the VS Code CLI under ${installRoot}.`);
  return candidates.at(-1);
}

function assertExtensionVersion(output, id, version, state) {
  if (!new RegExp(`^${escapeRegExp(id)}@${escapeRegExp(version)}$`, "im").test(output)) {
    throw new Error(`Expected ${id}@${version} to be ${state}; received:\n${output.trim()}`);
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
