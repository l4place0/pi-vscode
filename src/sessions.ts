import { existsSync } from "node:fs";
import * as vscode from "vscode";
import { TERMINAL_TITLE } from "./constants.ts";
import { parseStoredSessions, type TerminalSession } from "./session-state.ts";
import { createNewTerminal } from "./terminal.ts";

const SESSIONS_KEY = "pi-vscode-fork.terminalSessions";

export interface SessionTracker {
  update(terminalId: string, sessionFile: string): Promise<void>;
  track(terminal: vscode.Terminal, terminalId: string, cwd?: string): void;
  onClose(terminal: vscode.Terminal): void;
  restore(extensionUri: vscode.Uri, bridgeConfig: { url: string; token: string }): Promise<void>;
}

export function createSessionTracker(context: vscode.ExtensionContext): SessionTracker {
  const terminalIds = new WeakMap<vscode.Terminal, string>();
  const terminalCwds = new Map<string, string | undefined>();

  const read = () => parseStoredSessions(context.workspaceState.get(SESSIONS_KEY));
  const write = (sessions: Record<string, TerminalSession>) =>
    context.workspaceState.update(SESSIONS_KEY, { version: 1, sessions });

  return {
    async update(terminalId, sessionFile) {
      const sessions = read();
      const next = { sessionFile, cwd: terminalCwds.get(terminalId) };
      if (
        sessions[terminalId]?.sessionFile === next.sessionFile &&
        sessions[terminalId]?.cwd === next.cwd
      )
        return;
      sessions[terminalId] = next;
      await write(sessions);
    },
    track(terminal, terminalId, cwd) {
      terminalIds.set(terminal, terminalId);
      terminalCwds.set(terminalId, cwd);
    },
    onClose(terminal) {
      if (terminal.name !== TERMINAL_TITLE) return;
      if (terminal.exitStatus?.reason === vscode.TerminalExitReason.Shutdown) return;
      const id = terminalIds.get(terminal);
      if (!id) return;
      terminalCwds.delete(id);
      const sessions = read();
      if (!(id in sessions)) return;
      delete sessions[id];
      void write(sessions);
    },
    async restore(extensionUri, bridgeConfig) {
      const sessions = read();
      const valid: Record<string, TerminalSession> = {};
      for (const [terminalId, session] of Object.entries(sessions)) {
        if (existsSync(session.sessionFile)) valid[terminalId] = session;
      }
      if (Object.keys(valid).length !== Object.keys(sessions).length) {
        await write(valid);
      }
      for (const [terminalId, session] of Object.entries(valid)) {
        const terminal = await createNewTerminal({
          extensionUri,
          bridgeConfig,
          terminalId,
          sessionFile: session.sessionFile,
          cwd: session.cwd,
        });
        if (terminal) {
          terminalIds.set(terminal, terminalId);
          terminalCwds.set(terminalId, session.cwd);
          terminal.show(true);
        }
      }
    },
  };
}
