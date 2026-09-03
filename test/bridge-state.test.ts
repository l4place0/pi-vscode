import { describe, expect, it, vi } from "vitest";
import { createBridgeState } from "../src/bridge/state.ts";

describe("bridge session reporting", () => {
  it("waits for session persistence before acknowledging the report", async () => {
    let finishPersistence!: () => void;
    const persistence = new Promise<void>((resolve) => {
      finishPersistence = resolve;
    });
    const onTerminalSession = vi.fn(() => persistence);
    const state = createBridgeState(undefined, onTerminalSession);

    let acknowledged = false;
    const report = state.reportTerminalSession("terminal-1", "/sessions/one.jsonl").then(() => {
      acknowledged = true;
    });
    await Promise.resolve();

    expect(onTerminalSession).toHaveBeenCalledWith("terminal-1", "/sessions/one.jsonl");
    expect(acknowledged).toBe(false);

    finishPersistence();
    await report;
    expect(acknowledged).toBe(true);
  });

  it("assigns strictly increasing sequences and bounds the notification ring", () => {
    const state = createBridgeState(undefined);
    const now = vi.spyOn(Date, "now").mockReturnValue(1234);
    for (let index = 0; index < 502; index += 1) {
      state.enqueue("document_saved", { filePath: `/workspace/${index}.ts` });
    }
    expect(state.notifications).toHaveLength(500);
    expect(state.notifications[0]?.sequence).toBe(3);
    expect(state.notifications.at(-1)?.sequence).toBe(502);
    expect(new Set(state.notifications.map((event) => event.sequence)).size).toBe(500);
    now.mockRestore();
  });
});
