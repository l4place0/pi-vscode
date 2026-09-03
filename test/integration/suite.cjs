const assert = require("node:assert/strict");
const vscode = require("vscode");

async function run() {
  const extension = vscode.extensions.getExtension("pi0.pi-vscode-fork");
  assert.ok(extension, "fork extension is discoverable");
  await extension.activate();
  assert.equal(extension.isActive, true);

  const commands = await vscode.commands.getCommands(true);
  for (const id of [
    "pi-vscode-fork.open",
    "pi-vscode-fork.openWithFile",
    "pi-vscode-fork.sendSelection",
    "pi-vscode-fork.openInNewWindow",
    "pi-vscode-fork.updatePackages",
  ]) {
    assert.ok(commands.includes(id), `${id} is registered`);
  }

  assert.equal(extension.packageJSON.contributes.chatParticipants[0].id, "pi-vscode-fork.chat");
  assert.equal(
    extension.packageJSON.contributes.terminal.profiles[0].id,
    "pi-vscode-fork.terminal-profile",
  );
  assert.equal(
    extension.packageJSON.contributes.views["pi-vscode-fork"][0].id,
    "pi-vscode-fork.packages",
  );

  if (process.platform === "win32" && process.env.PI_TERMINAL_INTEGRATION === "1") {
    await assertWindowsTerminalStaysOpen();
  }
}

async function assertWindowsTerminalStaysOpen() {
  const existingTerminals = new Set(vscode.window.terminals);
  await vscode.commands.executeCommand("pi-vscode-fork.open");
  const terminal = vscode.window.terminals.find(
    (candidate) => !existingTerminals.has(candidate) && candidate.name === "Pi Fork",
  );
  assert.ok(terminal, "Pi Fork terminal is created");

  let closed = false;
  const closeSubscription = vscode.window.onDidCloseTerminal((candidate) => {
    if (candidate === terminal) closed = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  closeSubscription.dispose();

  assert.equal(closed, false, "Pi Fork terminal remains open after launch");
  terminal.dispose();
}

module.exports = { run };
