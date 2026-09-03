import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import manifest from "../package.json";

async function readJson(relativePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8")) as Record<
    string,
    unknown
  >;
}

describe("development workflow contracts", () => {
  it("keeps Vitest in the standard test command", () => {
    expect(manifest.scripts.test).toMatch(/(?:^|&&\s*)pnpm test:unit(?:\s*&&|$)/);
  });

  it("keeps F5 on the cross-platform build task", async () => {
    const tasks = await readJson("../.vscode/tasks.json");
    const launch = await readJson("../.vscode/launch.json");
    expect(tasks).toMatchObject({
      tasks: [
        expect.objectContaining({
          label: "build",
          command: "pnpm build",
        }),
      ],
    });
    expect(launch).toMatchObject({
      configurations: [
        expect.objectContaining({
          type: "extensionHost",
          request: "launch",
          preLaunchTask: "build",
        }),
      ],
    });
  });

  it("keeps a nonce-bound CSP on the Packages webview", async () => {
    const source = await readFile(new URL("../src/packages.ts", import.meta.url), "utf8");
    expect(source).toContain('http-equiv="Content-Security-Policy"');
    expect(source).toContain("default-src 'none'");
    expect(source).toContain("script-src 'nonce-${nonce}'");
    expect(source).toContain('<script nonce="${nonce}">');
  });
});
