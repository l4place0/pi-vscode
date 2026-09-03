const assert = require("node:assert/strict");
const { readFileSync, realpathSync } = require("node:fs");
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

  await assertMultiRootTerminalContexts();
}

async function assertMultiRootTerminalContexts() {
  const binary = process.env.PI_VSCODE_TEST_BINARY;
  const invocationLog = process.env.PI_VSCODE_TEST_INVOCATIONS;
  const rootA = process.env.PI_VSCODE_TEST_ROOT_A;
  const rootB = process.env.PI_VSCODE_TEST_ROOT_B;
  const activeFile = process.env.PI_VSCODE_TEST_ACTIVE_FILE;
  const selectedFile = process.env.PI_VSCODE_TEST_SELECTED_FILE;
  const selectedDirectory = process.env.PI_VSCODE_TEST_SELECTED_DIRECTORY;
  for (const [name, value] of Object.entries({
    binary,
    invocationLog,
    rootA,
    rootB,
    activeFile,
    selectedFile,
    selectedDirectory,
  })) {
    assert.ok(value, `${name} integration fixture is configured`);
  }

  await vscode.workspace
    .getConfiguration("pi-vscode-fork")
    .update("path", binary, vscode.ConfigurationTarget.Workspace);
  const document = await vscode.workspace.openTextDocument(activeFile);
  await vscode.window.showTextDocument(document);

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

  await vscode.commands.executeCommand(
    "pi-vscode-fork.openWithFile",
    vscode.Uri.file(selectedFile),
  );
  await vscode.commands.executeCommand(
    "pi-vscode-fork.openWithFile",
    vscode.Uri.file(selectedDirectory),
  );
  const invocations = await waitForInvocations(invocationLog, 3);
  const fileInvocation = invocations.find((entry) =>
    includesPath(getSystemPrompt(entry.args), selectedFile),
  );
  const directoryInvocation = invocations.find((entry) =>
    includesPath(getSystemPrompt(entry.args), selectedDirectory),
  );
  const activeEditorInvocation = invocations.find(
    (entry) => entry !== fileInvocation && entry !== directoryInvocation,
  );
  assert.ok(fileInvocation, "Explorer file invocation is recorded");
  assert.ok(directoryInvocation, "Explorer directory invocation is recorded");
  assert.ok(activeEditorInvocation, "active editor invocation is recorded");

  assert.equal(realpathSync(activeEditorInvocation.cwd), realpathSync(rootB));
  assert.equal(realpathSync(fileInvocation.cwd), realpathSync(rootA));
  assert.match(getSystemPrompt(fileInvocation.args), /selected this file in the VS Code Explorer/);
  assert.equal(realpathSync(directoryInvocation.cwd), realpathSync(rootB));
  assert.match(
    getSystemPrompt(directoryInvocation.args),
    /selected this directory in the VS Code Explorer/,
  );

  for (const candidate of vscode.window.terminals) {
    if (!existingTerminals.has(candidate) && candidate.name === "Pi Fork") candidate.dispose();
  }
}

function getSystemPrompt(args) {
  const index = args.indexOf("--append-system-prompt");
  assert.notEqual(index, -1, "Pi invocation includes the system prompt");
  return args[index + 1];
}

function includesPath(text, path) {
  return process.platform === "win32"
    ? text.toLowerCase().includes(path.toLowerCase())
    : text.includes(path);
}

async function waitForInvocations(logPath, expectedCount) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const invocations = readFileSync(logPath, "utf8")
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      if (invocations.length >= expectedCount) return invocations;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for ${expectedCount} Pi terminal invocations.`);
}

module.exports = { run };
