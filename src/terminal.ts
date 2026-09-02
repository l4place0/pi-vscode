import * as vscode from "vscode";
import { TERMINAL_TITLE } from "./constants.ts";
import { createOpenContextLines, type EditorSelectionContext } from "./open-context.ts";
import { createPiEnvironment, createPiShellArgs, ensurePiBinary } from "./pi.ts";
import { resolveWorkingDirectory } from "./workspace.ts";

export async function createNewTerminal(options: {
  extensionUri: vscode.Uri;
  bridgeConfig?: { url: string; token: string };
  extraArgs?: string[];
  contextLines?: string[];
  terminalId?: string;
  sessionFile?: string;
  cwd?: string;
}): Promise<vscode.Terminal | undefined> {
  const piPath = await ensurePiBinary();
  if (!piPath) return undefined;

  const cwd = options.cwd ?? resolveWorkingDirectory();
  const viewColumn = findPiColumn() ?? findUnusedColumn() ?? vscode.ViewColumn.Beside;
  const extraArgs = options.sessionFile
    ? ["--session", options.sessionFile, ...(options.extraArgs ?? [])]
    : options.extraArgs;
  const shellArgs = createPiShellArgs(options.extensionUri, {
    extraArgs,
    contextLines: options.contextLines,
  });

  const baseEnv = createPiEnvironment(options.bridgeConfig);
  const env = options.terminalId
    ? { ...baseEnv, PI_VSCODE_TERMINAL_ID: options.terminalId }
    : baseEnv;

  const terminal = vscode.window.createTerminal({
    name: TERMINAL_TITLE,
    shellPath: piPath,
    shellArgs: shellArgs.length > 0 ? shellArgs : undefined,
    location: { viewColumn },
    isTransient: true,
    cwd,
    env,
    iconPath: {
      light: vscode.Uri.joinPath(options.extensionUri, "assets", "logo-light.svg"),
      dark: vscode.Uri.joinPath(options.extensionUri, "assets", "logo.svg"),
    },
  });

  void vscode.commands.executeCommand("workbench.action.lockEditorGroup");
  return terminal;
}

export async function buildOpenWithFileContext(
  resourceUri?: vscode.Uri,
): Promise<{ cwd?: string; contextLines: string[] }> {
  const cwd = resolveWorkingDirectory(resourceUri);
  const editor = vscode.window.activeTextEditor;
  const targetUri = resourceUri ?? editor?.document.uri;
  let targetIsDirectory = false;
  if (resourceUri) {
    try {
      targetIsDirectory =
        (await vscode.workspace.fs.stat(resourceUri)).type === vscode.FileType.Directory;
    } catch {}
  }

  const editorContext =
    editor && targetUri && editor.document.uri.toString() === targetUri.toString()
      ? toEditorSelectionContext(editor)
      : undefined;
  return {
    cwd,
    contextLines: createOpenContextLines({
      cwd,
      targetPath: targetUri?.fsPath,
      targetIsDirectory,
      targetIsExplorerResource: !!resourceUri,
      editor: editorContext,
    }),
  };
}

function toEditorSelectionContext(editor: vscode.TextEditor): EditorSelectionContext {
  const selection = editor.selection;
  return {
    filePath: editor.document.uri.fsPath,
    cursor: { line: selection.active.line, character: selection.active.character },
    selection: selection.isEmpty
      ? undefined
      : { startLine: selection.start.line, endLine: selection.end.line },
  };
}

function findPiColumn(): vscode.ViewColumn | undefined {
  for (const group of vscode.window.tabGroups.all) {
    for (const tab of group.tabs) {
      if (tab.input instanceof vscode.TabInputTerminal && tab.label === TERMINAL_TITLE) {
        return group.viewColumn;
      }
    }
  }
  return undefined;
}

function findUnusedColumn(): vscode.ViewColumn | undefined {
  const used = new Set<vscode.ViewColumn>();
  for (const group of vscode.window.tabGroups.all) {
    if (group.viewColumn !== undefined) used.add(group.viewColumn);
  }
  for (let column = vscode.ViewColumn.One; column <= vscode.ViewColumn.Nine; column++) {
    if (!used.has(column)) return column;
  }
  return undefined;
}
