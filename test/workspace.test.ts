import { describe, expect, it } from "vitest";
import { parseStoredSessions } from "../src/session-state.ts";
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
