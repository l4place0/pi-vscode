import { describe, expect, it, vi } from "vitest";
import { getTextDelta, handleExtensionUiRequest, JsonlReader } from "../src/rpc.ts";

describe("JsonlReader", () => {
  it("preserves UTF-8 characters split across chunks and accepts CRLF", () => {
    const events: Record<string, unknown>[] = [];
    const reader = new JsonlReader((event) => events.push(event));
    const encoded = Buffer.from('{"type":"message_update","text":"你好"}\r\n');
    const split = encoded.indexOf(Buffer.from("你")) + 1;
    reader.push(encoded.subarray(0, split));
    reader.push(encoded.subarray(split));
    reader.end();
    expect(events).toEqual([{ type: "message_update", text: "你好" }]);
  });

  it("reports malformed JSON and continues with later lines", () => {
    const events: Record<string, unknown>[] = [];
    const malformed = vi.fn();
    const reader = new JsonlReader((event) => events.push(event), malformed);
    reader.push('not-json\n{"type":"ok"}\n');
    expect(malformed).toHaveBeenCalledOnce();
    expect(events).toEqual([{ type: "ok" }]);
  });
});

describe("extension UI requests", () => {
  const ui = {
    select: vi.fn(async () => "Allow"),
    confirm: vi.fn(async () => true as boolean | undefined),
    input: vi.fn(async () => "typed" as string | undefined),
  };

  it("maps select, confirm, and input results to Pi responses", async () => {
    await expect(
      handleExtensionUiRequest(
        {
          type: "extension_ui_request",
          id: "select",
          method: "select",
          title: "Pick",
          options: ["Allow", "Block"],
        },
        ui,
      ),
    ).resolves.toEqual({ type: "extension_ui_response", id: "select", value: "Allow" });
    await expect(
      handleExtensionUiRequest(
        {
          type: "extension_ui_request",
          id: "confirm",
          method: "confirm",
          title: "Sure?",
          message: "Continue",
        },
        ui,
      ),
    ).resolves.toEqual({ type: "extension_ui_response", id: "confirm", confirmed: true });
    await expect(
      handleExtensionUiRequest(
        {
          type: "extension_ui_request",
          id: "input",
          method: "input",
          title: "Value",
          placeholder: "Type",
        },
        ui,
      ),
    ).resolves.toEqual({ type: "extension_ui_response", id: "input", value: "typed" });
  });

  it("cancels dismissed and unsupported editor requests", async () => {
    const cancellingUi = { ...ui, input: vi.fn(async () => undefined) };
    await expect(
      handleExtensionUiRequest(
        { type: "extension_ui_request", id: "input", method: "input", title: "Value" },
        cancellingUi,
      ),
    ).resolves.toEqual({ type: "extension_ui_response", id: "input", cancelled: true });
    await expect(
      handleExtensionUiRequest(
        { type: "extension_ui_request", id: "editor", method: "editor" },
        ui,
      ),
    ).resolves.toEqual({ type: "extension_ui_response", id: "editor", cancelled: true });
  });
});

describe("RPC lifecycle", () => {
  it("extracts streamed text deltas", () => {
    expect(
      getTextDelta({
        type: "message_update",
        assistantMessageEvent: { type: "text_delta", delta: "hello" },
      }),
    ).toBe("hello");
  });
});
