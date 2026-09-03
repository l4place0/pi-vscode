import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

async function readSource(relativePath: string): Promise<string> {
  return readFile(new URL(relativePath, import.meta.url), "utf8");
}

describe("extension wiring contracts", () => {
  it("routes Pi UI requests back through the RPC process", async () => {
    const source = await readSource("../src/chat.ts");
    expect(source).toContain('event.type === "extension_ui_request"');
    expect(source).toContain("handleExtensionUiRequest(event, ui)");
    expect(source).toMatch(/if \(response && !child\.stdin\.destroyed\) sendCommand\(response\)/);
  });

  it("restores saved terminal sessions during activation", async () => {
    const source = await readSource("../src/extension.ts");
    const sessions = await readSource("../src/sessions.ts");
    const handlers = await readSource("../src/bridge/handlers.ts");
    expect(source).toContain("if (bridgeConfig) void sessions.restore(extensionUri, bridgeConfig)");
    expect(sessions).toContain("await write(sessions)");
    expect(handlers).toContain("await state.reportTerminalSession(terminalId, sessionFile)");
  });

  it("routes validated Packages messages to process actions", async () => {
    const source = await readSource("../src/packages.ts");
    expect(source).toContain('msg.type === "install" && packageSource');
    expect(source).toContain('msg.type === "uninstall" && packageSource');
    expect(source).toContain('msg.type === "cancel"');
    expect(source).toContain('msg.type === "refresh"');
    expect(source).toContain('msg.type === "upgrade"');
  });
});
