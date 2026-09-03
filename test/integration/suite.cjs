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

  await assertBridgeProtocol(activeEditorInvocation, activeFile, document);

  for (const candidate of vscode.window.terminals) {
    if (!existingTerminals.has(candidate) && candidate.name === "Pi Fork") candidate.dispose();
  }
}

async function assertBridgeProtocol(invocation, activeFile, document) {
  assert.ok(invocation.bridgeUrl, "Pi invocation receives the bridge URL");
  assert.ok(invocation.bridgeToken, "Pi invocation receives the bridge token");
  const rpc = (method, params = {}) => bridgeRpc(invocation, method, params);

  const legacy = await rpc("getEditorState");
  assert.ok(Array.isArray(legacy.workspaceFolders), "legacy RPC retains its bare editor response");
  assert.equal(legacy.detail, undefined, "legacy RPC has no detail wrapper");
  assert.equal(legacy.meta, undefined, "legacy RPC does not gain a v2 envelope");

  for (const detail of ["minimal", "compact", "full"]) {
    const result = await rpc("getEditorState", { responseVersion: 2, detail });
    assert.equal(result.detail, detail);
    assert.equal(result.meta.protocolVersion, 2);
    assert.equal(result.meta.truncated, false);
  }

  const diagnostics = await rpc("getDiagnostics", {
    responseVersion: 2,
    detail: "compact",
    scope: "active",
    severity: ["error", "warning", "information", "hint"],
  });
  assert.equal(diagnostics.meta.protocolVersion, 2);
  assert.equal(diagnostics.meta.total, diagnostics.meta.returned);
  if (!legacy.activeEditor) {
    assert.ok(
      diagnostics.meta.warnings.some((warning) => warning.includes("No active editor")),
      "active diagnostics remains empty and warns when no editor is active",
    );
  }

  const help = await rpc("bridgeHelp", {
    responseVersion: 2,
    tool: "vscode_get_diagnostics",
    topic: "parameters",
    level: "compact",
  });
  assert.deepEqual(Object.keys(help.data.tools), ["vscode_get_diagnostics"]);
  assert.equal(help.data.tools.vscode_get_diagnostics.defaults.limit, 100);

  const original = document.getText();
  const invalidTextDetail = await rpc("applyWorkspaceEdit", {
    responseVersion: 2,
    detail: "compact",
    includeEditText: true,
    edits: [
      {
        filePath: activeFile,
        range: positionRange(0, 0, 0, 0),
        newText: "",
      },
    ],
  });
  assert.equal(invalidTextDetail.error.code, "EDIT_TEXT_REQUIRES_FULL");
  assert.equal(document.getText(), original);

  const rejected = await rpc("applyWorkspaceEdit", {
    responseVersion: 2,
    detail: "full",
    includeEditText: true,
    edits: [
      {
        filePath: activeFile,
        range: positionRange(0, 0, 0, 0),
        newText: "x".repeat(25 * 1024),
      },
    ],
  });
  assert.equal(rejected.error.code, "EDIT_TEXT_RESPONSE_TOO_LARGE");
  assert.equal(document.getText(), original, "oversized edit text is rejected before mutation");

  const budgetRejected = await rpc("applyWorkspaceEdit", {
    responseVersion: 2,
    detail: "full",
    includeEditText: true,
    maxOutputBytes: 1024,
    edits: [
      {
        filePath: activeFile,
        range: positionRange(0, 0, 0, 0),
        newText: "x".repeat(2 * 1024),
      },
    ],
  });
  assert.equal(budgetRejected.error.code, "EDIT_TEXT_RESPONSE_TOO_LARGE");
  assert.equal(document.getText(), original, "edit text exceeding caller budget is not applied");

  const baseline = await rpc("getNotifications", {
    responseVersion: 2,
    start: "now",
  });
  const applied = await rpc("applyWorkspaceEdit", {
    responseVersion: 2,
    detail: "compact",
    edits: [
      {
        filePath: activeFile,
        range: positionRange(0, 22, 0, 26),
        newText: "false",
      },
    ],
  });
  assert.equal(applied.data.applied, true);
  assert.equal(applied.data.requestedEditCount, 1);
  assert.equal(applied.data.editCount, 1);
  assert.equal(applied.data.filesChanged, 1);
  assert.equal(JSON.stringify(applied).includes('newText":"false"'), false);
  assert.match(document.getText(), /active = false/);

  const notifications = await rpc("getNotifications", {
    responseVersion: 2,
    afterCursor: baseline.data.cursor,
    coalesce: false,
  });
  assert.ok(
    notifications.data.notifications.some(
      (notification) => notification.type === "document_dirty_changed",
    ),
    "v2 notification cursor observes the edit event",
  );
}

function positionRange(startLine, startCharacter, endLine, endCharacter) {
  return {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
  };
}

async function bridgeRpc(invocation, method, params = {}) {
  const response = await fetch(`${invocation.bridgeUrl}/rpc`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-pi-vscode-authorization": invocation.bridgeToken,
    },
    body: JSON.stringify({ method, params }),
  });
  assert.equal(response.status, 200, `bridge ${method} returns HTTP 200`);
  const payload = await response.json();
  return payload.result;
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
