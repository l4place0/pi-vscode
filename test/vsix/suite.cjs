const assert = require("node:assert/strict");
const vscode = require("vscode");

async function run() {
  const extension = vscode.extensions.getExtension("pi0.pi-vscode-fork");
  assert.ok(extension, "the installed fork VSIX is discoverable");
  assert.equal(extension.packageJSON.version, process.env.PI_VSCODE_TEST_VERSION);
  assert.ok(
    extension.extensionPath.startsWith(process.env.PI_VSCODE_TEST_EXTENSION_DIR),
    "the tested extension comes from the isolated extensions directory",
  );

  await vscode.workspace
    .getConfiguration("pi-vscode-fork")
    .update("path", process.env.PI_VSCODE_TEST_BINARY, vscode.ConfigurationTarget.Global);
  await extension.activate();
  assert.equal(extension.isActive, true);

  const commands = await vscode.commands.getCommands(true);
  assert.ok(commands.includes("pi-vscode-fork.open"), "the open command is registered");
  const existingTerminals = new Set(vscode.window.terminals);
  await vscode.commands.executeCommand("pi-vscode-fork.open");
  const terminal = vscode.window.terminals.find(
    (candidate) => !existingTerminals.has(candidate) && candidate.name === "Pi Fork",
  );
  assert.ok(terminal, "the installed VSIX creates a Pi Fork terminal");

  let closed = false;
  const closeSubscription = vscode.window.onDidCloseTerminal((candidate) => {
    if (candidate === terminal) closed = true;
  });
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  closeSubscription.dispose();
  assert.equal(closed, false, "the Pi Fork terminal remains open after launch");
  terminal.dispose();
}

module.exports = { run };
