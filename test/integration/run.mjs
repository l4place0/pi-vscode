import { runTests } from "@vscode/test-electron";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
await runTests({
  version: "1.110.0",
  extensionDevelopmentPath: projectRoot,
  extensionTestsPath: resolve(projectRoot, "test", "integration", "suite.cjs"),
  launchArgs: ["--disable-extensions"],
});
