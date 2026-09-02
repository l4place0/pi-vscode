import { describe, expect, it } from "vitest";
import { parseStoredSessions } from "../src/session-state.ts";
import { createOpenContextLines } from "../src/open-context.ts";
import {
  selectWorkingDirectory,
  type UriLike,
  type WorkspaceFolderLike,
} from "../src/workspace-core.ts";

interface TestUri extends UriLike {
  workspace?: string;
}

const folder = (fsPath: string): WorkspaceFolderLike => ({ uri: { fsPath } });

function context(options: { activeDocumentUri?: TestUri; folders?: WorkspaceFolderLike[] }) {
  return {
    workspaceFolders: options.folders,
    activeDocumentUri: options.activeDocumentUri,
    getWorkspaceFolder: (uri: TestUri) =>
      options.folders?.find((entry) => entry.uri.fsPath === uri.workspace),
  };
}

describe("selectWorkingDirectory", () => {
  const folders = [folder("/repo/a"), folder("/repo/b")];

  it("prefers the explicit resource workspace over the active editor", () => {
    expect(
      selectWorkingDirectory(
        context({ activeDocumentUri: { fsPath: "/repo/a/file", workspace: "/repo/a" }, folders }),
        { fsPath: "/repo/b/file", workspace: "/repo/b" },
      ),
    ).toBe("/repo/b");
  });

  it("uses the active editor workspace when there is no matching resource", () => {
    expect(
      selectWorkingDirectory(
        context({ activeDocumentUri: { fsPath: "/repo/b/file", workspace: "/repo/b" }, folders }),
      ),
    ).toBe("/repo/b");
  });

  it("falls back to the first workspace", () => {
    expect(selectWorkingDirectory(context({ folders }))).toBe("/repo/a");
    expect(
      selectWorkingDirectory(context({ folders }), {
        fsPath: "/outside/file",
        workspace: "/outside",
      }),
    ).toBe("/repo/a");
  });

  it("returns undefined without a workspace", () => {
    expect(selectWorkingDirectory(context({}))).toBeUndefined();
  });
});

describe("parseStoredSessions", () => {
  it("preserves cwd from versioned session state", () => {
    expect(
      parseStoredSessions({
        version: 1,
        sessions: { terminal: { sessionFile: "/sessions/one.jsonl", cwd: "/repo/b" } },
      }),
    ).toEqual({ terminal: { sessionFile: "/sessions/one.jsonl", cwd: "/repo/b" } });
  });

  it("migrates legacy terminal-to-session maps", () => {
    expect(parseStoredSessions({ terminal: "/sessions/legacy.jsonl" })).toEqual({
      terminal: { sessionFile: "/sessions/legacy.jsonl" },
    });
  });
});

describe("createOpenContextLines", () => {
  it("describes an unopened Explorer file without inventing a selection", () => {
    expect(
      createOpenContextLines({
        cwd: "/repo/b",
        targetPath: "/repo/b/new.ts",
        targetIsExplorerResource: true,
      }),
    ).toEqual([
      "The workspace root is: /repo/b",
      "The user selected this file in the VS Code Explorer: /repo/b/new.ts",
    ]);
  });

  it("describes an Explorer directory", () => {
    expect(
      createOpenContextLines({
        cwd: "/repo/b",
        targetPath: "/repo/b/src",
        targetIsDirectory: true,
      }),
    ).toEqual([
      "The workspace root is: /repo/b",
      "The user selected this directory in the VS Code Explorer: /repo/b/src",
    ]);
  });

  it("includes the selection only for the matching open editor", () => {
    expect(
      createOpenContextLines({
        cwd: "/repo/b",
        targetPath: "/repo/b/open.ts",
        editor: {
          filePath: "/repo/b/open.ts",
          cursor: { line: 4, character: 2 },
          selection: { startLine: 2, endLine: 4 },
        },
      }),
    ).toContain(
      "The current selection spans lines 3-5. Use the VS Code bridge to inspect the exact selected text if needed.",
    );
  });
});
