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
}

module.exports = { run };
