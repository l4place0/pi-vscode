import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { accessSync, constants } from "node:fs";
import { extname, join } from "node:path";

export interface PiInvocation {
  command: string;
  args: string[];
  windowsVerbatimArguments?: boolean;
}

export interface PiProcessOptions extends SpawnOptions {
  platform?: NodeJS.Platform;
  comSpec?: string;
  powershellPath?: string;
}

export interface PiExecResult {
  stdout: string;
  stderr: string;
}

export function resolveExecutablePath(
  command: string,
  options: {
    platform?: NodeJS.Platform;
    pathEnv?: string;
    access?: (path: string, mode: number) => void;
  } = {},
): string {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32" || extname(command)) return command;
  const access = options.access ?? accessSync;
  const extensions = [".cmd", ".exe", ".ps1", ".bat"];
  for (const directory of (options.pathEnv ?? process.env.PATH ?? "").split(";")) {
    if (!directory) continue;
    for (const extension of extensions) {
      const candidate = join(directory, command + extension);
      try {
        access(candidate, constants.F_OK);
        return candidate;
      } catch {}
    }
  }
  return command;
}

export function createPiInvocation(
  piPath: string,
  args: readonly string[],
  options: Pick<PiProcessOptions, "platform" | "comSpec" | "powershellPath"> = {},
): PiInvocation {
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") return { command: piPath, args: [...args] };

  switch (extname(piPath).toLowerCase()) {
    case ".cmd":
    case ".bat": {
      const commandLine = [escapeCmdCommand(piPath), ...args.map(escapeCmdArgument)].join(" ");
      return {
        command: options.comSpec ?? process.env.ComSpec ?? "cmd.exe",
        args: ["/d", "/s", "/v:off", "/c", `"${commandLine}"`],
        windowsVerbatimArguments: true,
      };
    }
    case ".ps1":
      return {
        command: options.powershellPath ?? "powershell.exe",
        args: ["-NoProfile", "-NonInteractive", "-File", piPath, ...args],
      };
    default:
      return { command: piPath, args: [...args] };
  }
}

export function spawnPi(
  piPath: string,
  args: readonly string[],
  options: PiProcessOptions = {},
): ChildProcess {
  const { platform, comSpec, powershellPath, ...spawnOptions } = options;
  const invocation = createPiInvocation(piPath, args, { platform, comSpec, powershellPath });
  return spawn(invocation.command, invocation.args, {
    ...spawnOptions,
    shell: false,
    windowsVerbatimArguments: invocation.windowsVerbatimArguments,
  });
}

export function execPi(
  piPath: string,
  args: readonly string[],
  options: PiProcessOptions = {},
): Promise<PiExecResult> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawnPi(piPath, args, { ...options, stdio: ["ignore", "pipe", "pipe"] });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }

    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
    });
    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const detail =
        stderr.trim() || `Pi exited with code ${code ?? "unknown"}${signal ? ` (${signal})` : ""}.`;
      reject(new Error(detail));
    });
  });
}

export function createPiTerminalLaunch(
  piPath: string,
  args: readonly string[],
  options: Pick<PiProcessOptions, "platform" | "comSpec" | "powershellPath"> = {},
): { shellPath: string; shellArgs: string[] } {
  const platform = options.platform ?? process.platform;
  if (platform === "win32" && [".cmd", ".bat"].includes(extname(piPath).toLowerCase())) {
    // TerminalOptions cannot request windowsVerbatimArguments. Use an encoded PowerShell
    // bootstrap to hand the already-escaped raw command line to ProcessStartInfo instead.
    // cmd treats literal newlines as command boundaries, so flatten multiline prompt text.
    const terminalArgs = args.map((argument) => argument.replace(/\r\n|[\r\n]/g, " "));
    const commandLine = [escapeCmdCommand(piPath), ...terminalArgs.map(escapeCmdArgument)].join(
      " ",
    );
    const command = options.comSpec ?? process.env.ComSpec ?? "cmd.exe";
    const encodedCommand = createPowerShellTerminalCommand(command, [
      "/d",
      "/s",
      "/v:off",
      "/c",
      `"${commandLine}"`,
    ]);
    return {
      shellPath: options.powershellPath ?? "powershell.exe",
      shellArgs: ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encodedCommand],
    };
  }

  const invocation = createPiInvocation(piPath, args, options);
  return { shellPath: invocation.command, shellArgs: invocation.args };
}

function createPowerShellTerminalCommand(command: string, args: readonly string[]): string {
  const payload = Buffer.from(
    JSON.stringify({ command, arguments: args.join(" ") }),
    "utf8",
  ).toString("base64");
  const script = [
    `$payload = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${payload}')) | ConvertFrom-Json`,
    "$startInfo = New-Object System.Diagnostics.ProcessStartInfo",
    "$startInfo.FileName = [string]$payload.command",
    "$startInfo.Arguments = [string]$payload.arguments",
    "$startInfo.UseShellExecute = $false",
    "$process = [Diagnostics.Process]::Start($startInfo)",
    "$process.WaitForExit()",
    "exit $process.ExitCode",
  ].join("; ");
  return Buffer.from(script, "utf16le").toString("base64");
}

function escapeCmdCommand(command: string): string {
  return escapeCmdMetaCharacters(command);
}

function escapeCmdArgument(argument: string): string {
  let escaped = argument.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"').replace(/(?=(\\+?)?)\1$/, "$1$1");
  escaped = `"${escaped}"`;
  return escapeCmdMetaCharacters(escapeCmdMetaCharacters(escaped));
}

function escapeCmdMetaCharacters(value: string): string {
  return value.replaceAll(/([()[\]%!^"`<>&|;, *?])/g, "^$1");
}
