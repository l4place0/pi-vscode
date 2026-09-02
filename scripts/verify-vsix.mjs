#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const vsixPath = process.argv[2]
  ? resolve(process.argv[2])
  : resolve(readdirSync(".").find((entry) => entry.endsWith(".vsix")) || "");
if (!vsixPath.endsWith(".vsix")) throw new Error("No VSIX file found.");

const archive = readFileSync(vsixPath);
const entries = listZipEntries(archive);
const required = [
  ["extension/package.json"],
  ["extension/dist/extension.cjs"],
  ["extension/bridge/pi-vscode-bridge.js"],
  ["extension/assets/icon.png"],
  ["extension/assets/logo.svg"],
  ["extension/license", "extension/license.txt"],
  ["extension/readme.md"],
];
const normalizedEntries = new Set([...entries].map((entry) => entry.toLowerCase()));
const missing = required.filter((alternatives) =>
  alternatives.every((entry) => !normalizedEntries.has(entry)),
);
if (missing.length > 0)
  throw new Error(`VSIX is missing: ${missing.map((entry) => entry.join(" or ")).join(", ")}`);
console.log(`Verified ${required.length} required artifacts in ${vsixPath}.`);

function listZipEntries(buffer) {
  const endSignature = 0x06054b50;
  let endOffset = -1;
  for (let offset = buffer.length - 22; offset >= Math.max(0, buffer.length - 65_557); offset--) {
    if (buffer.readUInt32LE(offset) === endSignature) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error("Invalid VSIX: ZIP directory not found.");
  const entryCount = buffer.readUInt16LE(endOffset + 10);
  let offset = buffer.readUInt32LE(endOffset + 16);
  const entries = new Set();
  for (let index = 0; index < entryCount; index++) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Invalid VSIX directory.");
    const nameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    entries.add(buffer.subarray(offset + 46, offset + 46 + nameLength).toString("utf8"));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}
