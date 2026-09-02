import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { extname } from "node:path";

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
  const invocation = createPiInvocation(piPath, args, options);
  return { shellPath: invocation.command, shellArgs: invocation.args };
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
