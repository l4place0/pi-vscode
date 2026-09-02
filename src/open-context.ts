export interface EditorSelectionContext {
  filePath: string;
  cursor: { line: number; character: number };
  selection?: { startLine: number; endLine: number };
}

export function createOpenContextLines(options: {
  cwd?: string;
  targetPath?: string;
  targetIsDirectory?: boolean;
  targetIsExplorerResource?: boolean;
  editor?: EditorSelectionContext;
}): string[] {
  const lines: string[] = [];
  if (options.cwd) lines.push(`The workspace root is: ${options.cwd}`);
  if (!options.targetPath) return lines;

  if (options.targetIsDirectory) {
    lines.push(`The user selected this directory in the VS Code Explorer: ${options.targetPath}`);
    return lines;
  }

  lines.push(
    options.targetIsExplorerResource
      ? `The user selected this file in the VS Code Explorer: ${options.targetPath}`
      : `The user is currently viewing this file in their editor: ${options.targetPath}`,
  );
  if (!options.editor || options.editor.filePath !== options.targetPath) return lines;

  if (options.editor.selection) {
    lines.push(
      `The current selection spans lines ${options.editor.selection.startLine + 1}-${options.editor.selection.endLine + 1}. Use the VS Code bridge to inspect the exact selected text if needed.`,
    );
  } else {
    lines.push(
      `The cursor is at line ${options.editor.cursor.line + 1}, character ${options.editor.cursor.character + 1}.`,
    );
  }
  return lines;
}
