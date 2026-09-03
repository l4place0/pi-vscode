import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import registerBridge from "../bridge/pi-vscode-bridge.js";

describe("bundled Pi bridge v2 contract", () => {
  const originalUrl = process.env.PI_VSCODE_BRIDGE_URL;
  const originalToken = process.env.PI_VSCODE_BRIDGE_TOKEN;
  const originalFetch = globalThis.fetch;
  let tools;

  beforeEach(() => {
    process.env.PI_VSCODE_BRIDGE_URL = "http://127.0.0.1:12345";
    process.env.PI_VSCODE_BRIDGE_TOKEN = "test-token";
    tools = new Map();
    registerBridge({
      on: vi.fn(),
      registerTool: (definition) => tools.set(definition.name, definition),
    });
  });

  afterEach(() => {
    if (originalUrl === undefined) delete process.env.PI_VSCODE_BRIDGE_URL;
    else process.env.PI_VSCODE_BRIDGE_URL = originalUrl;
    if (originalToken === undefined) delete process.env.PI_VSCODE_BRIDGE_TOKEN;
    else process.env.PI_VSCODE_BRIDGE_TOKEN = originalToken;
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("injects responseVersion 2 without exposing it in tool schemas", async () => {
    let request;
    globalThis.fetch = vi.fn(async (_url, options) => {
      request = JSON.parse(options.body);
      return { ok: true, json: async () => ({ result: { detail: "full", data: {} } }) };
    });
    const editor = tools.get("vscode_get_editor_state");
    expect(editor.parameters.properties).toHaveProperty("detail");
    expect(editor.parameters.properties).not.toHaveProperty("responseVersion");
    await editor.execute("call", { detail: "full" });
    expect(request).toEqual({
      method: "getEditorState",
      params: { detail: "full", responseVersion: 2 },
    });
  });

  it("exposes paging, diagnostic, notification, edit, and help parameters", () => {
    expect(tools.get("vscode_get_references").parameters.properties).toMatchObject({
      detail: expect.any(Object),
      limit: expect.any(Object),
      cursor: expect.any(Object),
      maxOutputBytes: expect.any(Object),
    });
    expect(tools.get("vscode_get_diagnostics").parameters.properties).toMatchObject({
      scope: expect.any(Object),
      uris: expect.any(Object),
      severity: expect.any(Object),
    });
    expect(tools.get("vscode_get_notifications").parameters.properties).toMatchObject({
      afterCursor: expect.any(Object),
      start: expect.any(Object),
      types: expect.any(Object),
      coalesce: expect.any(Object),
    });
    expect(tools.get("vscode_apply_workspace_edit").parameters.properties).toHaveProperty(
      "includeEditText",
    );
    expect(tools.has("vscode_bridge_help")).toBe(true);
    expect(tools.get("vscode_bridge_help").parameters.properties).not.toHaveProperty("detail");
  });

  it("uses a structured v2 error instead of a truncated JSON prefix at the hard cap", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        result: {
          detail: "full",
          data: { text: "x".repeat(60 * 1024) },
          meta: { protocolVersion: 2, truncated: false },
        },
      }),
    }));
    const result = await tools.get("vscode_get_editor_state").execute("call", {
      detail: "full",
    });
    const payload = JSON.parse(result.content[0].text);
    expect(payload.error.code).toBe("V2_RESPONSE_TOO_LARGE");
    expect(payload).not.toHaveProperty("resultJsonPrefix");
    expect(Buffer.byteLength(result.content[0].text, "utf8")).toBeLessThan(50 * 1024);
  });

  it("keeps the legacy prefix fallback for non-v2 bridge results", async () => {
    globalThis.fetch = vi.fn(async () => ({
      ok: true,
      json: async () => ({ result: { text: "x".repeat(60 * 1024) } }),
    }));
    const result = await tools.get("vscode_get_selection").execute("call", {});
    const payload = JSON.parse(result.content[0].text);
    expect(payload.truncated).toBe(true);
    expect(payload).toHaveProperty("resultJsonPrefix");
  });
});
