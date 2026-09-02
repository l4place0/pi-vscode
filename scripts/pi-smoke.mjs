#!/usr/bin/env node
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const requestedVersion = process.argv[2] || "0.84.4";
const packageSpec = `@earendil-works/pi-coding-agent@${requestedVersion}`;
const temporaryRoot = await mkdtemp(join(tmpdir(), "pi-vscode-smoke-"));

try {
  const npmCli = join(dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js");
  await run(process.execPath, [
    npmCli,
    "install",
    "--prefix",
    temporaryRoot,
    "--cache",
    join(temporaryRoot, "npm-cache"),
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    packageSpec,
  ]);

  const piCli = join(
    temporaryRoot,
    "node_modules",
    "@earendil-works",
    "pi-coding-agent",
    "dist",
    "bundle",
    "cli.js",
  );
  const version = await run(process.execPath, [piCli, "--version"]);
  if (requestedVersion !== "latest" && !version.stdout.includes(requestedVersion)) {
    throw new Error(`Expected Pi ${requestedVersion}, received: ${version.stdout.trim()}`);
  }

  const help = await run(process.execPath, [piCli, "--help"]);
  for (const flag of ["--mode", "--no-session", "--offline", "--extension"]) {
    if (!help.stdout.includes(flag)) throw new Error(`Pi help is missing ${flag}`);
  }

  await runRpcSmoke(piCli);
  console.log(`Pi ${version.stdout.trim()} smoke passed.`);
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}

async function runRpcSmoke(piCli) {
  const token = "pi-vscode-smoke-token";
  const bridgeMethods = [];
  const server = createServer(async (request, response) => {
    if (
      request.method !== "POST" ||
      request.url !== "/rpc" ||
      request.headers["x-pi-vscode-authorization"] !== token
    ) {
      response.writeHead(401).end();
      return;
    }
    const chunks = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    bridgeMethods.push(body.method);
    const result =
      body.method === "getStatus"
        ? {
            workspaceFolders: [],
            diagnostics: { errors: 0, warnings: 0, infos: 0, hints: 0 },
          }
        : { received: true };
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ result }));
  });
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });

  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Smoke bridge did not bind.");
    const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const child = spawn(
      process.execPath,
      [
        piCli,
        "--mode",
        "rpc",
        "--no-session",
        "--offline",
        "--extension",
        join(projectRoot, "bridge", "pi-vscode-bridge.js"),
      ],
      {
        cwd: projectRoot,
        env: {
          ...process.env,
          PI_VSCODE_BRIDGE_URL: `http://127.0.0.1:${address.port}`,
          PI_VSCODE_BRIDGE_TOKEN: token,
        },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );

    let stdout = "";
    let stderr = "";
    const events = [];
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
      while (stdout.includes("\n")) {
        const index = stdout.indexOf("\n");
        const line = stdout.slice(0, index).replace(/\r$/, "");
        stdout = stdout.slice(index + 1);
        if (!line) continue;
        try {
          events.push(JSON.parse(line));
        } catch {}
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.stdin.write(`${JSON.stringify({ id: "state-1", type: "get_state" })}\n`);

    await waitUntil(
      () =>
        events.some(
          (event) =>
            event.type === "response" && event.command === "get_state" && event.success === true,
        ) && bridgeMethods.includes("getStatus"),
      15_000,
    );
    if (events.some((event) => event.type === "extension_error")) {
      throw new Error(`Pi bridge extension failed: ${JSON.stringify(events)}`);
    }
    child.stdin.end();
    const exit = await waitForExit(child, 5_000);
    if (exit.code !== 0) throw new Error(stderr.trim() || `Pi RPC exited with ${exit.code}.`);
  } finally {
    await new Promise((resolveClose, rejectClose) => {
      server.close((error) => (error ? rejectClose(error) : resolveClose()));
    });
  }
}

function run(command, args) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk.toString()));
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));
    child.once("error", rejectRun);
    child.once("close", (code) => {
      if (code === 0) resolveRun({ stdout, stderr });
      else rejectRun(new Error(stderr.trim() || `${command} exited with ${code}.`));
    });
  });
}

async function waitUntil(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline)
      throw new Error("Timed out waiting for Pi RPC state and bridge calls.");
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
}

function waitForExit(child, timeoutMs) {
  return new Promise((resolveExit, rejectExit) => {
    const timer = setTimeout(() => {
      child.kill();
      rejectExit(new Error("Timed out waiting for Pi RPC to exit."));
    }, timeoutMs);
    child.once("close", (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal });
    });
    child.once("error", (error) => {
      clearTimeout(timer);
      rejectExit(error);
    });
  });
}
