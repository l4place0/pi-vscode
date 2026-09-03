import { randomUUID } from "node:crypto";
import { DEFAULT_NOTIFICATION_CAPACITY, SnapshotStore } from "./protocol.ts";
import type { BridgeState } from "./types.ts";

const MAX_CODE_ACTIONS = 100;

export function createBridgeState(
  initialSelection: BridgeState["latestSelection"],
  onTerminalSession?: (terminalId: string, sessionFile: string) => PromiseLike<void> | void,
): BridgeState {
  const instanceId = randomUUID();
  return {
    instanceId,
    snapshotStore: new SnapshotStore({ instanceId }),
    nextNotificationSequence: 1,
    latestSelection: initialSelection,
    notifications: [],
    codeActions: new Map(),
    enqueue(type, data) {
      this.notifications.push({
        id: randomUUID(),
        sequence: this.nextNotificationSequence++,
        type,
        data,
        raw: data,
        timestamp: Date.now(),
      });
      if (this.notifications.length > DEFAULT_NOTIFICATION_CAPACITY) {
        this.notifications.splice(0, this.notifications.length - DEFAULT_NOTIFICATION_CAPACITY);
      }
    },
    cacheCodeAction(action, filePath) {
      const id = randomUUID();
      this.codeActions.set(id, { action, filePath });
      while (this.codeActions.size > MAX_CODE_ACTIONS) {
        const oldest = this.codeActions.keys().next().value;
        if (!oldest) break;
        this.codeActions.delete(oldest);
      }
      return id;
    },
    async reportTerminalSession(terminalId, sessionFile) {
      await onTerminalSession?.(terminalId, sessionFile);
    },
  };
}
