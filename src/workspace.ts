import * as vscode from "vscode";
import { selectWorkingDirectory } from "./workspace-core.ts";

export function resolveWorkingDirectory(resourceUri?: vscode.Uri): string | undefined {
  return selectWorkingDirectory(
    {
      workspaceFolders: vscode.workspace.workspaceFolders,
      activeDocumentUri: vscode.window.activeTextEditor?.document.uri,
      getWorkspaceFolder: (uri) => vscode.workspace.getWorkspaceFolder(uri),
    },
    resourceUri,
  );
}
