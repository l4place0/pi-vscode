import { runTests } from "@vscode/test-electron";
import { chmod, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const runRoot = join(projectRoot, ".tmp", `integration-${process.pid}-${Date.now()}`);
const rootA = join(runRoot, "workspace-a");
const rootB = join(runRoot, "workspace-b");
const selectedDirectory = join(rootB, "selected-directory");
const activeFile = join(rootB, "active.ts");
const selectedFile = join(rootA, "selected.ts");
const invocationLog = join(runRoot, "pi-invocations.jsonl");
const workspaceFile = join(runRoot, "multi-root.code-workspace");

try {
  await Promise.all([
    mkdir(rootA, { recursive: true }),
    mkdir(rootB, { recursive: true }),
    mkdir(selectedDirectory, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(activeFile, "export const active = true;\n", "utf8"),
    writeFile(selectedFile, "export const selected = true;\n", "utf8"),
    writeFile(
      workspaceFile,
      JSON.stringify({ folders: [{ path: rootA }, { path: rootB }] }),
      "utf8",
    ),
  ]);
  const piFixture = await createPiFixture(runRoot, invocationLog);
  const options = {
    extensionDevelopmentPath: projectRoot,
    extensionTestsPath: resolve(projectRoot, "test", "integration", "suite.cjs"),
    extensionTestsEnv: {
      PI_VSCODE_TEST_BINARY: piFixture,
      PI_VSCODE_TEST_INVOCATIONS: invocationLog,
      PI_VSCODE_TEST_ROOT_A: rootA,
      PI_VSCODE_TEST_ROOT_B: rootB,
      PI_VSCODE_TEST_ACTIVE_FILE: activeFile,
      PI_VSCODE_TEST_SELECTED_FILE: selectedFile,
      PI_VSCODE_TEST_SELECTED_DIRECTORY: selectedDirectory,
    },
    launchArgs: [workspaceFile, "--disable-extensions"],
  };

  await runTests(
    process.env.VSCODE_EXECUTABLE_PATH
      ? { ...options, vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH }
      : { ...options, version: "1.110.0" },
  );
} finally {
  await rm(runRoot, { recursive: true, force: true, maxRetries: 3, retryDelay: 250 });
}

async function createPiFixture(directory, logPath) {
  const scriptPath = join(directory, "pi-fixture.cjs");
  await writeFile(
    scriptPath,
    `require("node:fs").appendFileSync(${JSON.stringify(logPath)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + "\\n"); setTimeout(() => {}, 30000);\n`,
    "utf8",
  );
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
