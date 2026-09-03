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
});
