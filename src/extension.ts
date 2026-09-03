import { randomUUID } from "node:crypto";
import * as vscode from "vscode";
import { createBridge } from "./bridge/server.ts";
import { createChatHandler } from "./chat.ts";
import { CONTRIBUTION_IDS, TERMINAL_TITLE } from "./constants.ts";
import { createPiEnvironment, createPiShellArgs, findPiBinary, upgradePiBinary } from "./pi.ts";
import { createPiTerminalLaunch } from "./pi-process.ts";
import { createPackagesViewProvider } from "./packages.ts";
import { createSessionTracker } from "./sessions.ts";
import { buildOpenWithFileContext, createNewTerminal } from "./terminal.ts";
import { resolveWorkingDirectory } from "./workspace.ts";

let extensionUri: vscode.Uri;
let bridgeConfig: { url: string; token: string } | undefined;
let bridgeDispose: (() => Promise<void>) | undefined;

export async function activate(context: vscode.ExtensionContext) {
  extensionUri = context.extensionUri;

  const sessions = createSessionTracker(context);
  const bridge = await createBridge(context, async (terminalId, sessionFile) => {
    await sessions.update(terminalId, sessionFile);
  });
  bridgeConfig = { url: bridge.url, token: bridge.token };
  bridgeDispose = () => bridge.dispose();
  context.subscriptions.push({
    dispose: () => {
      const dispose = bridgeDispose;
      bridgeDispose = undefined;
      bridgeConfig = undefined;
      void dispose?.();
    },
  });

  const openTerminal = async (
    extraArgs?: string[],
    contextLines?: string[],
    cwd = resolveWorkingDirectory(),
  ): Promise<vscode.Terminal | undefined> => {
    const terminalId = randomUUID();
    const terminal = await createNewTerminal({
      extensionUri,
      bridgeConfig,
      extraArgs,
      contextLines,
      terminalId,
      cwd,
    });
    if (terminal) sessions.track(terminal, terminalId, cwd);
    return terminal;
  };

  const participant = vscode.chat.createChatParticipant(
    CONTRIBUTION_IDS.chat,
    createChatHandler({
      extensionUri,
      getBridgeConfig: () => bridgeConfig,
    }),
  );
  const logoIcon = {
    light: vscode.Uri.joinPath(extensionUri, "assets", "logo-light.svg"),
    dark: vscode.Uri.joinPath(extensionUri, "assets", "logo.svg"),
  };
  participant.iconPath = logoIcon;

  const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
  statusBarItem.text = "$(pi-vscode-fork-logo) Pi Fork";
  statusBarItem.tooltip = "Open Pi Terminal";
  statusBarItem.command = CONTRIBUTION_IDS.open;
  statusBarItem.show();

  context.subscriptions.push(
    participant,
    statusBarItem,
    vscode.window.onDidCloseTerminal((terminal) => sessions.onClose(terminal)),
    vscode.commands.registerCommand(CONTRIBUTION_IDS.open, async () => {
      const terminal = await openTerminal();
      terminal?.show();
    }),
    vscode.commands.registerCommand(
      CONTRIBUTION_IDS.openWithFile,
      async (resourceUri?: vscode.Uri) => {
        const { cwd, contextLines } = await buildOpenWithFileContext(resourceUri);
        const terminal = await openTerminal(undefined, contextLines, cwd);
        terminal?.show();
      },
    ),
    vscode.commands.registerCommand(CONTRIBUTION_IDS.sendSelection, async () => {
      const editor = vscode.window.activeTextEditor;
      if (!editor) return;
      const selection = editor.document.getText(editor.selection);
      if (!selection) return;
      const terminal = await openTerminal([selection]);
      terminal?.show();
    }),
    vscode.commands.registerCommand(CONTRIBUTION_IDS.openInNewWindow, async () => {
      const terminal = await openTerminal();
      if (!terminal) return;
      terminal.show();
      await vscode.commands.executeCommand("workbench.action.moveEditorToNewWindow");
    }),
    vscode.commands.registerCommand(CONTRIBUTION_IDS.updatePackages, upgradePiBinary),
    vscode.window.registerWebviewViewProvider(
      CONTRIBUTION_IDS.packagesView,
      createPackagesViewProvider(findPiBinary),
    ),
    vscode.window.registerTerminalProfileProvider(CONTRIBUTION_IDS.terminalProfile, {
      provideTerminalProfile() {
        const terminalId = randomUUID();
        const baseEnv = createPiEnvironment(bridgeConfig);
        const launch = createPiTerminalLaunch(findPiBinary(), createPiShellArgs(extensionUri));
        return new vscode.TerminalProfile({
          name: TERMINAL_TITLE,
          shellPath: launch.shellPath,
          shellArgs: launch.shellArgs,
          cwd: resolveWorkingDirectory(),
          env: { ...baseEnv, PI_VSCODE_TERMINAL_ID: terminalId },
          iconPath: logoIcon,
        });
      },
    }),
  );

  if (bridgeConfig) void sessions.restore(extensionUri, bridgeConfig);
}

export async function deactivate() {
  for (const terminal of vscode.window.terminals) {
    if (terminal.name === TERMINAL_TITLE) terminal.dispose();
  }
  const dispose = bridgeDispose;
  bridgeDispose = undefined;
  bridgeConfig = undefined;
  await dispose?.();
}
