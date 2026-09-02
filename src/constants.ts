export const TERMINAL_TITLE = "Pi Fork";

export const CONTRIBUTION_IDS = {
  chat: "pi-vscode-fork.chat",
  open: "pi-vscode-fork.open",
  openWithFile: "pi-vscode-fork.openWithFile",
  sendSelection: "pi-vscode-fork.sendSelection",
  openInNewWindow: "pi-vscode-fork.openInNewWindow",
  updatePackages: "pi-vscode-fork.updatePackages",
  terminalProfile: "pi-vscode-fork.terminal-profile",
  packagesView: "pi-vscode-fork.packages",
} as const;

export const BRIDGE_EXTENSION_PATH = "bridge/pi-vscode-bridge.js";

export const BRIDGE_BOOTSTRAP_LINES = [
  "You are running inside VS Code with a live IDE bridge.",
  "Prefer VS Code bridge tools over manual file reads or guesses: use them to get editor state, selection, diagnostics, symbols, definitions, hovers, references, code actions, workspace symbols, and open editors.",
  "After edits, check `vscode_get_diagnostics` for real-time type/lint errors from the IDE instead of running separate commands.",
];
