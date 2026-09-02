import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createPiInvocation, execPi } from "../src/pi-process.ts";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("createPiInvocation", () => {
  it("runs Unix executables and Windows exe files directly", () => {
    expect(createPiInvocation("/usr/local/bin/pi", ["--version"], { platform: "linux" })).toEqual({
      command: "/usr/local/bin/pi",
      args: ["--version"],
    });
    expect(createPiInvocation("C:\\tools\\pi.exe", ["--version"], { platform: "win32" })).toEqual({
      command: "C:\\tools\\pi.exe",
      args: ["--version"],
    });
  });

  it("uses an explicit PowerShell host for ps1 files", () => {
    expect(
      createPiInvocation("C:\\tools\\pi.ps1", ["--version"], {
        platform: "win32",
        powershellPath: "pwsh.exe",
      }),
    ).toEqual({
      command: "pwsh.exe",
      args: ["-NoProfile", "-NonInteractive", "-File", "C:\\tools\\pi.ps1", "--version"],
    });
  });

  it("uses ComSpec without enabling a global shell for cmd files", () => {
    const invocation = createPiInvocation("C:\\tools with spaces\\pi.cmd", ["A&B", "%PATH%"], {
      platform: "win32",
      comSpec: "C:\\Windows\\System32\\cmd.exe",
    });
    expect(invocation.command).toBe("C:\\Windows\\System32\\cmd.exe");
    expect(invocation.args.slice(0, 4)).toEqual(["/d", "/s", "/v:off", "/c"]);
    expect(invocation.args[4]).toContain("^&");
    expect(invocation.args[4]).toMatch(/\^+%PATH\^+%/);
    expect(invocation.windowsVerbatimArguments).toBe(true);
  });
});

describe.runIf(process.platform === "win32")("Windows Pi process integration", () => {
  it("passes cmd arguments with spaces and shell metacharacters literally", async () => {
    const directory = await mkdtemp(join(tmpdir(), "pi process "));
    temporaryDirectories.push(directory);
    const scriptPath = join(directory, "echo-args.cjs");
    const commandPath = join(directory, "pi.cmd");
    await writeFile(
      scriptPath,
      "process.stdout.write(JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), marker: process.env.PI_PROCESS_MARKER }));\n",
      "utf8",
    );
    await writeFile(
      commandPath,
      `@echo off\r\n"${process.execPath}" "%~dp0echo-args.cjs" %*\r\n`,
      "utf8",
    );
    const args = [
      "plain",
      "with spaces",
      'a"b',
      "A&B",
      "x|y",
      "a<b",
      "c>d",
      "caret^",
      "%PATH%",
      "bang!",
    ];

    const result = await execPi(commandPath, args, {
      cwd: directory,
      env: { ...process.env, PI_PROCESS_MARKER: "passed" },
    });

    expect(JSON.parse(result.stdout)).toEqual({ args, cwd: directory, marker: "passed" });
  });
});

describe("execPi", () => {
  it("converts synchronous spawn failures to rejections", async () => {
    await expect(execPi("bad\0path", [])).rejects.toThrow();
  });

  it("honors AbortSignal cancellation", async () => {
    const controller = new AbortController();
    const execution = execPi(process.execPath, ["-e", "setTimeout(() => {}, 10000)"], {
      signal: controller.signal,
    });
    controller.abort();
    await expect(execution).rejects.toThrow();
  });
});
