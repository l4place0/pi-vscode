import { runTests } from "@vscode/test-electron";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const options = {
  extensionDevelopmentPath: projectRoot,
  extensionTestsPath: resolve(projectRoot, "test", "integration", "suite.cjs"),
  launchArgs: ["--disable-extensions"],
};

await runTests(
  process.env.VSCODE_EXECUTABLE_PATH
    ? { ...options, vscodeExecutablePath: process.env.VSCODE_EXECUTABLE_PATH }
    : { ...options, version: "1.110.0" },
);
