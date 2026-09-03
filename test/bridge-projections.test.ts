import { describe, expect, it } from "vitest";
import {
  coalesceNotifications,
  flattenDocumentSymbols,
  projectDiagnostics,
  projectDocumentSymbols,
  projectEditorState,
  projectEditResult,
  projectLocations,
  projectNotification,
  projectWorkspaceSymbols,
  selectNotificationWindow,
  sortLocations,
  sortWorkspaceSymbols,
  type CanonicalDiagnostic,
  type CanonicalEditorState,
  type CanonicalLocation,
} from "../src/bridge/projections.ts";
import type { BridgeNotification } from "../src/bridge/types.ts";

const roots = [
  { name: "one", filePath: "/workspace/one" },
  { name: "two", filePath: "/workspace/two" },
];
const range = {
  start: { line: 1, character: 2 },
  end: { line: 1, character: 5 },
};

describe("bridge v2 projections", () => {
  it("sorts and groups locations while keeping full LocationLink ranges", () => {
    const locations: CanonicalLocation[] = [
      {
        filePath: "/workspace/two/b.ts",
        uri: "file:///workspace/two/b.ts",
        range,
        targetSelectionRange: range,
        originSelectionRange: range,
      },
      {
        filePath: "/workspace/one/a.ts",
        uri: "file:///workspace/one/a.ts",
        range,
      },
    ];
    const sorted = sortLocations(locations);
    expect((projectLocations(sorted, "minimal", roots) as { count: number }).count).toBe(2);
    const compact = projectLocations(sorted, "compact", roots) as {
      files: { path: string; workspaceFolder: string; locations: unknown[] }[];
    };
    expect(compact.files).toHaveLength(2);
    expect(compact.files[0]).toMatchObject({ path: "a.ts", workspaceFolder: "one" });
    expect(JSON.stringify(compact)).not.toContain("file://");
    const full = projectLocations(sorted, "full", roots) as { files: unknown[] };
    expect(JSON.stringify(full)).toContain("originSelectionRange");
  });

  it("projects diagnostic aggregates, compact fields, and full related information", () => {
    const diagnostic: CanonicalDiagnostic = {
      filePath: "/workspace/one/a.ts",
      uri: "file:///workspace/one/a.ts",
      range,
      severity: "warning",
      severityNumber: 1,
      message: "warning",
      code: "W1",
      source: "fixture",
      tags: [1],
      relatedInformation: [
        {
          message: "related",
          filePath: "/workspace/two/b.ts",
          uri: "file:///workspace/two/b.ts",
          range,
        },
      ],
    };
    expect(projectDiagnostics([diagnostic], "minimal", roots)).toMatchObject({
      counts: { warnings: 1 },
      fileCount: 1,
    });
    expect(JSON.stringify(projectDiagnostics([diagnostic], "compact", roots))).not.toContain(
      "relatedInformation",
    );
    expect(JSON.stringify(projectDiagnostics([diagnostic], "full", roots))).toContain(
      "relatedInformation",
    );
  });

  it("keeps diagnostic code targets in full detail only", () => {
    const diagnostic: CanonicalDiagnostic = {
      filePath: "/workspace/one/a.ts",
      uri: "file:///workspace/one/a.ts",
      range,
      severity: "error",
      severityNumber: 0,
      message: "error",
      code: { value: "E1", target: "https://example.invalid/E1" },
    };
    expect(JSON.stringify(projectDiagnostics([diagnostic], "compact", roots))).not.toContain(
      "example.invalid",
    );
    expect(JSON.stringify(projectDiagnostics([diagnostic], "full", roots))).toContain(
      "example.invalid",
    );
  });

  it("flattens document symbols in stable preorder", () => {
    const symbols = flattenDocumentSymbols([
      {
        name: "Parent",
        kind: "class",
        range,
        selectionRange: range,
        children: [
          {
            name: "child",
            kind: "method",
            range,
            selectionRange: range,
            children: [],
          },
        ],
      },
    ]);
    expect(symbols.map(({ id, parentId, depth }) => ({ id, parentId, depth }))).toEqual([
      { id: "symbol-0", parentId: undefined, depth: 0 },
      { id: "symbol-0.0", parentId: "symbol-0", depth: 1 },
    ]);
    expect(
      projectDocumentSymbols(
        symbols,
        "minimal",
        { filePath: "/workspace/one/a.ts", uri: "file:///workspace/one/a.ts" },
        roots,
      ),
    ).toMatchObject({ count: 2, topLevelCount: 1 });
  });

  it("groups workspace symbols without compact absolute paths", () => {
    const compact = projectWorkspaceSymbols(
      [
        {
          name: "run",
          kind: "function",
          container: "tools",
          filePath: "/workspace/one/a.ts",
          uri: "file:///workspace/one/a.ts",
          range,
          targetSelectionRange: range,
        },
      ],
      "compact",
      roots,
    );
    expect(compact).toMatchObject({ files: [{ path: "a.ts", symbols: [{ container: "tools" }] }] });
    expect(JSON.stringify(compact)).not.toContain("/workspace/one");
  });

  it("stabilizes workspace symbol ties by semantic fields", () => {
    const base = {
      kind: "function",
      filePath: "/workspace/one/a.ts",
      uri: "file:///workspace/one/a.ts",
      range,
    };
    expect(
      sortWorkspaceSymbols([
        { ...base, name: "z" },
        { ...base, name: "a" },
      ]),
    ).toMatchObject([{ name: "a" }, { name: "z" }]);
  });

  it("keeps selection text and tab detail out of compact editor state", () => {
    const editor = {
      filePath: "/workspace/one/a.ts",
      uri: "file:///workspace/one/a.ts",
      languageId: "typescript",
      isDirty: true,
      isActive: true,
      visibleRanges: [range],
    };
    const state: CanonicalEditorState = {
      cwd: "/workspace/one",
      workspaceFolders: [{ name: "one", filePath: "/workspace/one", uri: "file:///workspace/one" }],
      activeEditor: editor,
      currentSelection: {
        text: "secret selection",
        isEmpty: false,
        filePath: editor.filePath,
        uri: editor.uri,
        languageId: editor.languageId,
        range,
      },
      openEditors: [editor],
      tabs: [editor],
      visibleEditors: [editor],
    };
    expect(JSON.stringify(projectEditorState(state, "compact", roots))).not.toContain(
      "secret selection",
    );
    expect(projectEditorState(state, "full", roots)).toMatchObject({
      selectionText: "secret selection",
      tabs: [expect.anything()],
      visibleEditors: [expect.anything()],
    });
  });

  it("returns one cached selection summary when no editor is active", () => {
    const state: CanonicalEditorState = {
      cwd: "/workspace/one",
      workspaceFolders: [],
      latestSelection: {
        text: "cached secret",
        isEmpty: false,
        filePath: "/workspace/one/a.ts",
        uri: "file:///workspace/one/a.ts",
        languageId: "typescript",
        range,
      },
      openEditors: [],
      tabs: [],
      visibleEditors: [],
    };
    const compact = projectEditorState(state, "compact", roots);
    expect(compact).toMatchObject({
      selectionSource: "latest",
      selection: { path: "a.ts", range, isEmpty: false },
    });
    expect(JSON.stringify(compact)).not.toContain("cached secret");
  });

  it("reports only applied edit counts and gates text projection", () => {
    const edit = {
      filePath: "/workspace/one/a.ts",
      uri: "file:///workspace/one/a.ts",
      range,
      oldLength: 1,
      newLength: 3,
      oldText: "a",
      newText: "abc",
    };
    expect(
      projectEditResult(
        { applied: false, requestedEditCount: 1, edits: [edit] },
        "compact",
        roots,
        false,
      ),
    ).toMatchObject({ editCount: 0, filesChanged: 0 });
    expect(
      JSON.stringify(
        projectEditResult(
          { applied: true, requestedEditCount: 1, edits: [edit] },
          "full",
          roots,
          false,
        ),
      ),
    ).not.toContain("abc");
    expect(
      JSON.stringify(
        projectEditResult(
          { applied: true, requestedEditCount: 1, edits: [edit] },
          "full",
          roots,
          true,
        ),
      ),
    ).toContain("abc");
  });

  it("reports a successful no-op edit receipt", () => {
    expect(
      projectEditResult(
        { applied: true, requestedEditCount: 0, edits: [] },
        "compact",
        roots,
        false,
      ),
    ).toMatchObject({ applied: true, requestedEditCount: 0, editCount: 0, filesChanged: 0 });
  });
});

describe("notification projections", () => {
  function notification(
    sequence: number,
    type: BridgeNotification["type"],
    filePath: string,
  ): BridgeNotification {
    return {
      id: `event-${sequence}`,
      sequence,
      timestamp: sequence,
      type,
      data: { filePath, fileUri: `file://${filePath}`, isDirty: true },
    };
  }

  it("coalesces consecutive updates without crossing a saved barrier", () => {
    const events = [
      notification(1, "selection_changed", "/workspace/one/a.ts"),
      notification(2, "selection_changed", "/workspace/one/a.ts"),
      notification(3, "document_dirty_changed", "/workspace/one/a.ts"),
      notification(4, "document_saved", "/workspace/one/a.ts"),
      notification(5, "document_dirty_changed", "/workspace/one/a.ts"),
    ];
    const result = coalesceNotifications(events);
    expect(result.map((event) => event.sequence)).toEqual([2, 3, 4, 5]);
    expect(result.find((event) => event.sequence === 2)?.coalescedCount).toBe(2);
  });

  it("keeps notification payload out of minimal detail", () => {
    const event = notification(1, "document_saved", "/workspace/one/a.ts");
    expect(projectNotification(event, "minimal", roots)).toEqual({
      sequence: 1,
      type: "document_saved",
      path: "a.ts",
      workspaceFolder: "one",
    });
    expect(JSON.stringify(projectNotification(event, "full", roots))).toContain("timestamp");
  });

  it("detects a ring gap and otherwise returns unread events oldest first", () => {
    const events = [
      notification(3, "document_saved", "/workspace/one/a.ts"),
      notification(4, "document_dirty_changed", "/workspace/one/a.ts"),
      notification(5, "document_saved", "/workspace/one/b.ts"),
    ];
    expect(selectNotificationWindow(events, 6, 1)).toMatchObject({
      notifications: [],
      gap: { resyncRequired: true, earliestAvailableSequence: 3 },
    });
    expect(
      selectNotificationWindow(events, 6, 3, new Set(["document_saved"])).notifications.map(
        (event) => event.sequence,
      ),
    ).toEqual([5]);
  });
});
