import type { ChildProcessWithoutNullStreams } from "node:child_process";
import * as vscode from "vscode";
import { toErrorMessage } from "./bridge/utils.ts";
import { createPiEnvironment, createPiRpcArgs, ensurePiBinary } from "./pi.ts";
import { spawnPi } from "./pi-process.ts";
import { getTextDelta, handleExtensionUiRequest, JsonlReader, type RpcEvent } from "./rpc.ts";
import { createNewTerminal } from "./terminal.ts";
import { resolveWorkingDirectory } from "./workspace.ts";

export function createChatHandler(options: {
  extensionUri: vscode.Uri;
  getBridgeConfig(): { url: string; token: string } | undefined;
}): vscode.ChatRequestHandler {
  return async (request, _context, stream, token) => {
    const message = request.prompt.trim();
    if (!message) {
      stream.markdown("Please provide a message to send to Pi.");
      return;
    }

    const piPath = await ensurePiBinary();
    if (!piPath) {
      stream.markdown(
        "Pi is not installed. Please install it with `npm install --global --ignore-scripts @earendil-works/pi-coding-agent`.",
      );
      return;
    }

    try {
      const result = await runPiRpcPrompt({
        piPath,
        message,
        token,
        stream,
        extensionUri: options.extensionUri,
        bridgeConfig: options.getBridgeConfig(),
      });
      if (!result.hadOutput) stream.markdown("Pi did not return any text.");
    } catch (error) {
      const terminal = await createNewTerminal({
        extensionUri: options.extensionUri,
        bridgeConfig: options.getBridgeConfig(),
        extraArgs: [message],
      });
      terminal?.show();
      stream.markdown(
        `Pi RPC failed and fell back to the terminal.\n\nError: ${escapeMarkdownInline(toErrorMessage(error))}`,
      );
    }
  };
}

async function runPiRpcPrompt(options: {
  piPath: string;
  message: string;
  token: vscode.CancellationToken;
  stream: vscode.ChatResponseStream;
  extensionUri: vscode.Uri;
  bridgeConfig?: { url: string; token: string };
}): Promise<{ hadOutput: boolean }> {
  const cwd = resolveWorkingDirectory();
  const child = spawnPi(options.piPath, createPiRpcArgs(options.extensionUri), {
    cwd,
    env: {
      ...process.env,
      ...createPiEnvironment(options.bridgeConfig),
    },
    stdio: ["pipe", "pipe", "pipe"],
  }) as ChildProcessWithoutNullStreams;

  let stderrBuffer = "";
  let hadOutput = false;
  let resolved = false;

  const finish = (
    resolve: (value: { hadOutput: boolean }) => void,
    reject: (error: Error) => void,
    error?: Error,
  ) => {
    if (resolved) return;
    resolved = true;
    if (error) reject(error);
    else resolve({ hadOutput });
  };

  const sendCommand = (command: object) => {
    child.stdin.write(`${JSON.stringify(command)}\n`);
  };

  const ui = createRpcUiAdapter();
  const handleEvent = (event: RpcEvent) => {
    if (event.type === "extension_ui_request") {
      void handleExtensionUiRequest(event, ui).then((response) => {
        if (response && !child.stdin.destroyed) sendCommand(response);
      });
      return;
    }
    const delta = getTextDelta(event);
    if (delta !== undefined) {
      hadOutput = true;
      options.stream.markdown(delta);
      return;
    }
    if (event.type === "response" && event.command === "prompt" && event.success === false) {
      finish(
        resolvePromise,
        rejectPromise,
        new Error(String(event.error ?? "Pi RPC prompt failed")),
      );
      child.kill();
      return;
    }
    if (event.type === "extension_error") {
      finish(
        resolvePromise,
        rejectPromise,
        new Error(String(event.error ?? event.message ?? "Pi extension failed")),
      );
      child.kill();
      return;
    }
    if (event.type === "agent_end") {
      child.stdin.end();
    }
  };

  let resolvePromise!: (value: { hadOutput: boolean }) => void;
  let rejectPromise!: (error: Error) => void;
  const reader = new JsonlReader(handleEvent);

  return await new Promise<{ hadOutput: boolean }>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
    options.token.onCancellationRequested(() => {
      try {
        sendCommand({ type: "abort" });
      } catch {}
      setTimeout(() => {
        child.kill();
      }, 300);
    });

    child.stdout.on("data", (chunk) => {
      reader.push(chunk);
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
    });

    child.on("error", (error) => {
      finish(resolve, reject, error);
    });

    child.on("close", (code, signal) => {
      reader.end();
      if (resolved) return;
      if (options.token.isCancellationRequested) {
        finish(resolve, reject, new Error("Pi RPC request cancelled."));
        return;
      }
      if (code === 0 || signal === "SIGTERM") {
        finish(resolve, reject);
        return;
      }
      const message = stderrBuffer.trim() || `Pi RPC exited with code ${code ?? "unknown"}.`;
      finish(resolve, reject, new Error(message));
    });

    sendCommand({ id: "prompt-1", type: "prompt", message: options.message });
  });
}

function createRpcUiAdapter() {
  return {
    select: (title: string, items: string[]) =>
      vscode.window.showQuickPick(items, { title, placeHolder: title }),
    async confirm(title: string, message: string): Promise<boolean | undefined> {
      const result = await vscode.window.showWarningMessage(
        message || title,
        { modal: true, detail: message ? title : undefined },
        "Confirm",
        "Cancel",
      );
      if (result === undefined) return undefined;
      return result === "Confirm";
    },
    input: (title: string, placeHolder?: string) =>
      vscode.window.showInputBox({ title, placeHolder }),
  };
}

function escapeMarkdownInline(text: string): string {
  return text.replace(/[`*_{}[\]()#+\-.!]/g, "\\$&");
}
