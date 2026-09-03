import { Buffer } from "node:buffer";
import * as vscode from "vscode";
import { resolveWorkingDirectory } from "../workspace.ts";
import { captureSelection, getEditorInfo, serializeRange } from "./serialize.ts";
import {
  coalesceNotifications,
  diagnosticCounts,
  flattenDocumentSymbols,
  projectDiagnostics,
  projectDocumentSymbols,
  projectEditorState,
  projectEditResult,
  projectLocations,
  projectNotification,
  projectWorkspaceSymbols,
  selectNotificationWindow,
  sortDiagnostics,
  sortLocations,
  sortWorkspaceSymbols,
  type CanonicalDiagnostic,
  type CanonicalDocumentSymbol,
  type CanonicalEdit,
  type CanonicalEditorState,
  type CanonicalLocation,
  type CanonicalWorkspaceSymbol,
  type FlatDocumentSymbol,
} from "./projections.ts";
import {
  BridgeProtocolError,
  createEnvelope,
  decodeSequenceCursor,
  DEFAULT_EDIT_TEXT_BYTES,
  DEFAULT_NOTIFICATION_LIMIT,
  encodeSequenceCursor,
  jsonByteLength,
  readCursor,
  readDetail,
  readLimit,
  readMaxOutputBytes,
  stableFingerprint,
  type BridgeDetail,
  type BridgeEnvelope,
  type WorkspacePathRoot,
} from "./protocol.ts";
import type { BridgeNotification, BridgeState } from "./types.ts";
import {
  createRange,
  getFileUri,
  readOptionalBoolean,
  readOptionalString,
  readRequiredPosition,
  readRequiredString,
  readSelection,
  readWorkspaceEditEntries,
} from "./utils.ts";

type LegacyHandler = () => Promise<unknown>;

const DIAGNOSTIC_SEVERITIES = ["error", "warning", "information", "hint"] as const;
const LOCATION_METHODS: Record<
  string,
  { command: string; resultKey: string; defaultLimit: number }
> = {
  getDefinitions: {
    command: "vscode.executeDefinitionProvider",
    resultKey: "definitions",
    defaultLimit: 75,
  },
  getTypeDefinitions: {
    command: "vscode.executeTypeDefinitionProvider",
    resultKey: "typeDefinitions",
    defaultLimit: 75,
  },
  getImplementations: {
    command: "vscode.executeImplementationProvider",
    resultKey: "implementations",
    defaultLimit: 75,
  },
  getDeclarations: {
    command: "vscode.executeDeclarationProvider",
    resultKey: "declarations",
    defaultLimit: 75,
  },
  getReferences: {
    command: "vscode.executeReferenceProvider",
    resultKey: "references",
    defaultLimit: 75,
  },
};

export async function handleRpcV2(
  method: string,
  params: Record<string, unknown>,
  state: BridgeState,
  legacy: LegacyHandler,
): Promise<unknown> {
  if (method === "bridgeHelp") return getBridgeHelp(params);
  if (method === "getEditorState") return getEditorStateV2(params, state);
  if (method === "getDiagnostics") return getDiagnosticsV2(params, state);
  if (method === "getDocumentSymbols") return getDocumentSymbolsV2(params, state);
  if (LOCATION_METHODS[method]) return getLocationsV2(method, params, state);
  if (method === "getWorkspaceSymbols") return getWorkspaceSymbolsV2(params, state);
  if (method === "applyWorkspaceEdit") return applyWorkspaceEditV2(params);
  if (method === "formatDocument") return formatDocumentV2(params);
  if (method === "formatRange") return formatRangeV2(params);
  if (method === "getNotifications") return getNotificationsV2(params, state);

  const detail = readDetail(params);
  return ensureEnvelopeBudget(createEnvelope(detail, await legacy()), readMaxOutputBytes(params));
}

async function getDiagnosticsV2(params: Record<string, unknown>, state: BridgeState) {
  const detail = readDetail(params);
  const legacyFilePath = readOptionalString(params.filePath);
  if (legacyFilePath && (params.scope !== undefined || params.uris !== undefined)) {
    throw new BridgeProtocolError(
      "INVALID_PARAMS",
      "filePath compatibility input cannot be combined with scope or uris",
    );
  }
  const scope =
    params.scope === undefined && legacyFilePath ? "uris" : readDiagnosticsScope(params.scope);
  const severity = readDiagnosticSeverities(params.severity);
  const uris = legacyFilePath
    ? [getFileUri(legacyFilePath).toString()]
    : readDiagnosticUris(params, scope);
  const cursor = readCursor(params);
  const roots = workspaceRoots();
  const warnings: string[] = [];
  const fingerprint = stableFingerprint({
    method: "getDiagnostics",
    scope,
    severity,
    uris,
  });
  let diagnostics: CanonicalDiagnostic[] | undefined;
  if (!cursor) {
    const entries = getDiagnosticEntries(scope, uris, warnings);
    const uriOrder = scope === "uris" ? new Map(uris.map((uri, index) => [uri, index])) : undefined;
    diagnostics = sortDiagnostics(
      entries.flatMap(([uri, values]) =>
        values
          .map((diagnostic) => canonicalDiagnostic(uri, diagnostic))
          .filter((diagnostic) => severity.includes(diagnostic.severity)),
      ),
      uriOrder,
    );
  }
  return projectPage({
    state,
    method: "getDiagnostics",
    fingerprint,
    detail,
    cursor,
    items: diagnostics,
    limit: readLimit(params, 100),
    maxOutputBytes: readMaxOutputBytes(params),
    project: (page) => projectDiagnostics(page, detail, roots),
    warnings,
  });
}

async function getLocationsV2(method: string, params: Record<string, unknown>, state: BridgeState) {
  const definition = LOCATION_METHODS[method];
  if (!definition) throw new Error(`Missing location method definition: ${method}`);
  const detail = readDetail(params);
  const filePath = readRequiredString(params.filePath, "filePath");
  const position = readRequiredPosition(params.position, "position");
  const uri = getFileUri(filePath);
  const cursor = readCursor(params);
  const fingerprint = stableFingerprint({
    method,
    uri: uri.toString(),
    position: { line: position.line, character: position.character },
  });
  let locations: CanonicalLocation[] | undefined;
  if (!cursor) {
    const result = await vscode.commands.executeCommand<(vscode.Location | vscode.LocationLink)[]>(
      definition.command,
      uri,
      position,
    );
    locations = sortLocations((result ?? []).map(canonicalLocation));
  }
  const roots = workspaceRoots();
  return projectPage({
    state,
    method,
    fingerprint,
    detail,
    cursor,
    items: locations,
    limit: readLimit(params, definition.defaultLimit),
    maxOutputBytes: readMaxOutputBytes(params),
    project: (page) => ({
      ...(projectLocations(page, detail, roots) as Record<string, unknown>),
      ...(detail === "full" ? { command: definition.command } : {}),
    }),
  });
}

async function getDocumentSymbolsV2(params: Record<string, unknown>, state: BridgeState) {
  const detail = readDetail(params);
  const filePath = readRequiredString(params.filePath, "filePath");
  const uri = getFileUri(filePath);
  const cursor = readCursor(params);
  const fingerprint = stableFingerprint({
    method: "getDocumentSymbols",
    uri: uri.toString(),
  });
  let symbols: FlatDocumentSymbol[] | undefined;
  if (!cursor) {
    const result = await vscode.commands.executeCommand<
      (vscode.DocumentSymbol | vscode.SymbolInformation)[]
    >("vscode.executeDocumentSymbolProvider", uri);
    symbols = canonicalDocumentSymbolResults(result ?? []);
  }
  const roots = workspaceRoots();
  return projectPage({
    state,
    method: "getDocumentSymbols",
    fingerprint,
    detail,
    cursor,
    items: symbols,
    limit: readLimit(params, 200),
    maxOutputBytes: readMaxOutputBytes(params),
    project: (page) =>
      projectDocumentSymbols(page, detail, { filePath: uri.fsPath, uri: uri.toString() }, roots),
  });
}

async function getWorkspaceSymbolsV2(params: Record<string, unknown>, state: BridgeState) {
  const detail = readDetail(params);
  const query = readRequiredString(params.query, "query");
  const cursor = readCursor(params);
  const fingerprint = stableFingerprint({
    method: "getWorkspaceSymbols",
    query,
  });
  let symbols: CanonicalWorkspaceSymbol[] | undefined;
  if (!cursor) {
    const result = await vscode.commands.executeCommand<vscode.SymbolInformation[]>(
      "vscode.executeWorkspaceSymbolProvider",
      query,
    );
    symbols = sortWorkspaceSymbols((result ?? []).map(canonicalWorkspaceSymbol));
  }
  const roots = workspaceRoots();
  return projectPage({
    state,
    method: "getWorkspaceSymbols",
    fingerprint,
    detail,
    cursor,
    items: symbols,
    limit: readLimit(params, 200),
    maxOutputBytes: readMaxOutputBytes(params),
    project: (page) => projectWorkspaceSymbols(page, detail, roots),
  });
}

function getEditorStateV2(params: Record<string, unknown>, state: BridgeState) {
  const detail = readDetail(params);
  const roots = workspaceRoots();
  const editorState = captureEditorState(state);
  return ensureEnvelopeBudget(
    createEnvelope(detail, projectEditorState(editorState, detail, roots)),
    readMaxOutputBytes(params),
  );
}

async function applyWorkspaceEditV2(params: Record<string, unknown>) {
  const entries = readWorkspaceEditEntries(params.edits);
  const prepared = await Promise.all(
    entries.map(async (entry) => {
      const uri = getFileUri(entry.filePath);
      const document =
        vscode.workspace.textDocuments.find(
          (candidate) => candidate.uri.toString() === uri.toString(),
        ) ?? (await vscode.workspace.openTextDocument(uri));
      const range = createRange(entry.range);
      return {
        canonical: canonicalEdit(uri, range, document.getText(range), entry.newText),
        uri,
        range,
        newText: entry.newText,
      };
    }),
  );
  return applyPreparedEdits(params, prepared, entries.length);
}

async function formatDocumentV2(params: Record<string, unknown>) {
  const uri = getFileUri(readRequiredString(params.filePath, "filePath"));
  const document = await openDocument(uri);
  const options = formattingOptions(document);
  const edits =
    (await vscode.commands.executeCommand<vscode.TextEdit[]>(
      "vscode.executeFormatDocumentProvider",
      uri,
      options,
    )) ?? [];
  const prepared = edits.map((edit) => ({
    canonical: canonicalEdit(uri, edit.range, document.getText(edit.range), edit.newText),
    uri,
    range: edit.range,
    newText: edit.newText,
  }));
  return applyPreparedEdits(params, prepared, edits.length);
}

async function formatRangeV2(params: Record<string, unknown>) {
  const uri = getFileUri(readRequiredString(params.filePath, "filePath"));
  const selection = readSelection(params.selection);
  const range = selection
    ? new vscode.Range(selection.start, selection.end)
    : new vscode.Range(
        readRequiredPosition(params.start, "start"),
        readRequiredPosition(params.end, "end"),
      );
  const document = await openDocument(uri);
  const edits =
    (await vscode.commands.executeCommand<vscode.TextEdit[]>(
      "vscode.executeFormatRangeProvider",
      uri,
      range,
      formattingOptions(document),
    )) ?? [];
  const prepared = edits.map((edit) => ({
    canonical: canonicalEdit(uri, edit.range, document.getText(edit.range), edit.newText),
    uri,
    range: edit.range,
    newText: edit.newText,
  }));
  return applyPreparedEdits(params, prepared, edits.length);
}

async function applyPreparedEdits(
  params: Record<string, unknown>,
  prepared: readonly {
    canonical: CanonicalEdit;
    uri: vscode.Uri;
    range: vscode.Range;
    newText: string;
  }[],
  requestedEditCount: number,
) {
  const detail = readDetail(params);
  const includeEditText = readOptionalBoolean(params.includeEditText) ?? false;
  const maxOutputBytes = readMaxOutputBytes(params);
  validateEditProjection(
    detail,
    includeEditText,
    prepared.map((entry) => entry.canonical),
  );
  const roots = workspaceRoots();
  const plannedData = projectEditResult(
    {
      applied: true,
      requestedEditCount,
      edits: prepared.map((entry) => entry.canonical),
      diagnostics: {
        counts: {
          errors: Number.MAX_SAFE_INTEGER,
          warnings: Number.MAX_SAFE_INTEGER,
          infos: Number.MAX_SAFE_INTEGER,
          hints: Number.MAX_SAFE_INTEGER,
        },
        fileCount: Number.MAX_SAFE_INTEGER,
      },
      observation: "immediate",
    },
    detail,
    roots,
    includeEditText,
  );
  const plannedEnvelope = createEnvelope(detail, plannedData, {
    warnings: ["x".repeat(280)],
  });
  const plannedBytes = jsonByteLength(plannedEnvelope);
  if (includeEditText && plannedBytes > maxOutputBytes) {
    throw new BridgeProtocolError(
      "EDIT_TEXT_RESPONSE_TOO_LARGE",
      "Requested edit text cannot fit the response byte budget",
      { bytes: plannedBytes, maxOutputBytes },
    );
  }
  ensureEnvelopeBudget(plannedEnvelope, maxOutputBytes);

  const workspaceEdit = new vscode.WorkspaceEdit();
  for (const edit of prepared) workspaceEdit.replace(edit.uri, edit.range, edit.newText);
  let applied = true;
  let applyFailure: string | undefined;
  if (prepared.length > 0) {
    try {
      applied = await vscode.workspace.applyEdit(workspaceEdit);
    } catch (error) {
      applied = false;
      applyFailure = (error instanceof Error ? error.message : String(error)).slice(0, 256);
    }
  }
  const diagnostics = immediateDiagnosticSummary(prepared.map((entry) => entry.uri));
  const data = projectEditResult(
    {
      applied,
      requestedEditCount,
      edits: prepared.map((entry) => entry.canonical),
      diagnostics,
      observation: "immediate",
    },
    detail,
    roots,
    includeEditText,
  );
  return ensureEnvelopeBudget(
    createEnvelope(detail, data, {
      total: requestedEditCount,
      returned: applied ? prepared.length : 0,
      warnings: applyFailure ? [`Workspace edit failed: ${applyFailure}`] : undefined,
    }),
    maxOutputBytes,
  );
}

function getNotificationsV2(params: Record<string, unknown>, state: BridgeState) {
  const detail = readDetail(params, "minimal");
  const limit = readLimit(params, DEFAULT_NOTIFICATION_LIMIT, 500);
  const maxOutputBytes = readMaxOutputBytes(params);
  const coalesce = readOptionalBoolean(params.coalesce) ?? true;
  const types = readNotificationTypes(params.types);
  const start = readNotificationStart(params.start);
  const afterCursor = readOptionalString(params.afterCursor);
  if (afterCursor && params.start !== undefined) {
    throw new BridgeProtocolError("INVALID_PARAMS", "start cannot be combined with afterCursor");
  }
  const latest = state.nextNotificationSequence - 1;
  let afterSequence = afterCursor
    ? decodeSequenceCursor(afterCursor, state.instanceId)
    : start === "now"
      ? latest
      : (state.notifications[0]?.sequence ?? state.nextNotificationSequence) - 1;
  const window = selectNotificationWindow(
    state.notifications,
    state.nextNotificationSequence,
    afterSequence,
    types,
  );
  if (window.gap) {
    const cursor = encodeSequenceCursor(state.instanceId, latest);
    return createEnvelope(
      detail,
      {
        notifications: [],
        cursor,
        gap: window.gap,
      },
      {
        total: 0,
        returned: 0,
        warnings: ["Notification cursor fell behind the ring buffer"],
      },
    );
  }
  let selected = window.notifications;
  if (coalesce) selected = coalesceNotifications(selected);
  if (selected.length === 0) {
    afterSequence = latest;
    return createEnvelope(
      detail,
      {
        notifications: [],
        cursor: encodeSequenceCursor(state.instanceId, afterSequence),
      },
      { total: 0, returned: 0 },
    );
  }
  const roots = workspaceRoots();
  let accepted = 0;
  for (let count = 1; count <= Math.min(limit, selected.length); count += 1) {
    const events = selected.slice(0, count);
    const sequence = events.at(-1)?.sequence ?? afterSequence;
    const hasNext = count < selected.length;
    const candidate = createEnvelope(
      detail,
      {
        notifications: events.map((event) => projectNotification(event, detail, roots)),
        cursor: encodeSequenceCursor(state.instanceId, sequence),
      },
      {
        total: selected.length,
        returned: count,
        truncated: hasNext,
        nextCursor: hasNext ? encodeSequenceCursor(state.instanceId, sequence) : undefined,
        reason: hasNext ? "byteBudget" : undefined,
      },
    );
    if (jsonByteLength(candidate) > maxOutputBytes) break;
    accepted = count;
  }
  if (accepted === 0) {
    throw new BridgeProtocolError(
      "ITEM_EXCEEDS_BYTE_BUDGET",
      "A single notification exceeds maxOutputBytes",
    );
  }
  const events = selected.slice(0, accepted);
  const sequence = events.at(-1)?.sequence ?? afterSequence;
  const hasNext = accepted < selected.length;
  const reason = hasNext ? (accepted === limit ? "limit" : "byteBudget") : undefined;
  return createEnvelope(
    detail,
    {
      notifications: events.map((event) => projectNotification(event, detail, roots)),
      cursor: encodeSequenceCursor(state.instanceId, sequence),
    },
    {
      total: selected.length,
      returned: accepted,
      truncated: hasNext,
      nextCursor: hasNext ? encodeSequenceCursor(state.instanceId, sequence) : undefined,
      reason,
    },
  );
}

function getBridgeHelp(params: Record<string, unknown>) {
  const tool = readOptionalString(params.tool);
  const topic = readOptionalString(params.topic) ?? "overview";
  const level = params.level === undefined ? undefined : readDetail({ detail: params.level });
  const topics = new Set([
    "overview",
    "parameters",
    "detail",
    "pagination",
    "paths",
    "cost",
    "compatibility",
    "notifications",
  ]);
  if (!topics.has(topic)) {
    throw new BridgeProtocolError("INVALID_PARAMS", `Unknown help topic: ${topic}`);
  }
  const tools = bridgeHelpTools(level);
  if (tool && !tools[tool]) {
    const matches = Object.keys(tools).filter((candidate) => candidate.includes(tool));
    throw new BridgeProtocolError("INVALID_PARAMS", `Unknown bridge tool: ${tool}`, {
      candidates: (matches.length > 0 ? matches : Object.keys(tools)).slice(0, 5),
    });
  }
  return createEnvelope("compact", {
    topic,
    ...(level ? { level } : {}),
    categories: {
      state: ["vscode_get_editor_state"],
      diagnostics: ["vscode_get_diagnostics"],
      navigation: [
        "vscode_get_definitions",
        "vscode_get_type_definitions",
        "vscode_get_implementations",
        "vscode_get_declarations",
        "vscode_get_references",
      ],
      symbols: ["vscode_get_document_symbols", "vscode_get_workspace_symbols"],
      edits: ["vscode_apply_workspace_edit", "vscode_format_document", "vscode_format_range"],
      events: ["vscode_get_notifications"],
    },
    defaults: {
      detail: "compact",
      maxOutputBytes: 32 * 1024,
      notificationDetail: "minimal",
    },
    tools: tool ? { [tool]: tools[tool] } : tools,
    notes: helpNotes(topic),
  });
}

function projectPage<T>(options: {
  state: BridgeState;
  method: string;
  fingerprint: string;
  detail: BridgeDetail;
  cursor?: string;
  items?: readonly T[];
  limit: number;
  maxOutputBytes: number;
  project(items: readonly T[]): unknown;
  warnings?: string[];
}): BridgeEnvelope<unknown> {
  if (options.detail === "minimal") {
    if (options.cursor) {
      throw new BridgeProtocolError(
        "CURSOR_MISMATCH",
        "minimal aggregate responses do not paginate",
      );
    }
    const items = options.items ?? [];
    return ensureEnvelopeBudget(
      createEnvelope("minimal", options.project(items), {
        total: items.length,
        returned: items.length,
        warnings: options.warnings,
      }),
      options.maxOutputBytes,
    );
  }
  return options.state.snapshotStore.page({
    method: options.method,
    fingerprint: options.fingerprint,
    detail: options.detail,
    cursor: options.cursor,
    items: options.items,
    limit: options.limit,
    maxOutputBytes: options.maxOutputBytes,
    project: options.project,
    warnings: options.warnings,
  });
}

function ensureEnvelopeBudget<T>(
  envelope: BridgeEnvelope<T>,
  maxOutputBytes: number,
): BridgeEnvelope<T> {
  const bytes = jsonByteLength(envelope);
  if (bytes > maxOutputBytes) {
    throw new BridgeProtocolError("V2_RESPONSE_TOO_LARGE", "V2 response exceeds maxOutputBytes", {
      bytes,
      maxOutputBytes,
    });
  }
  return envelope;
}

function readDiagnosticsScope(value: unknown): "active" | "open" | "workspace" | "uris" {
  if (value === undefined) return "active";
  if (value === "active" || value === "open" || value === "workspace" || value === "uris") {
    return value;
  }
  throw new BridgeProtocolError("INVALID_PARAMS", "scope must be active, open, workspace, or uris");
}

function readDiagnosticSeverities(value: unknown): CanonicalDiagnostic["severity"][] {
  if (value === undefined) return ["error", "warning"];
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => !DIAGNOSTIC_SEVERITIES.includes(entry))
  ) {
    throw new BridgeProtocolError("INVALID_PARAMS", "severity must be a non-empty severity array");
  }
  return [...new Set(value)] as CanonicalDiagnostic["severity"][];
}

function readDiagnosticUris(
  params: Record<string, unknown>,
  scope: "active" | "open" | "workspace" | "uris",
): string[] {
  if (scope !== "uris") {
    if (params.uris !== undefined) {
      throw new BridgeProtocolError("INVALID_PARAMS", "uris is only valid with scope=uris");
    }
    return [];
  }
  if (!Array.isArray(params.uris) || params.uris.length === 0) {
    throw new BridgeProtocolError("INVALID_PARAMS", "scope=uris requires a non-empty uris array");
  }
  return params.uris.map((value, index) => {
    if (typeof value !== "string" || value.length === 0) {
      throw new BridgeProtocolError("INVALID_PARAMS", `uris[${index}] must be a non-empty string`);
    }
    return uriFromInput(value).toString();
  });
}

function getDiagnosticEntries(
  scope: "active" | "open" | "workspace" | "uris",
  uris: readonly string[],
  warnings: string[],
): [vscode.Uri, readonly vscode.Diagnostic[]][] {
  if (scope === "active") {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      warnings.push("No active editor; diagnostics scope remained active and returned no results");
      return [];
    }
    return [[editor.document.uri, vscode.languages.getDiagnostics(editor.document.uri)]];
  }
  if (scope === "open") {
    return vscode.workspace.textDocuments.map((document) => [
      document.uri,
      vscode.languages.getDiagnostics(document.uri),
    ]);
  }
  if (scope === "uris") {
    return uris.map((uri) => {
      const parsed = vscode.Uri.parse(uri);
      return [parsed, vscode.languages.getDiagnostics(parsed)];
    });
  }
  return vscode.languages.getDiagnostics().map(([uri, diagnostics]) => [uri, diagnostics]);
}

function canonicalDiagnostic(uri: vscode.Uri, diagnostic: vscode.Diagnostic): CanonicalDiagnostic {
  return {
    filePath: uri.fsPath,
    uri: uri.toString(),
    range: serializeRange(diagnostic.range),
    severity: diagnosticSeverity(diagnostic.severity),
    severityNumber: diagnostic.severity,
    message: diagnostic.message,
    source: diagnostic.source,
    code: canonicalDiagnosticCode(diagnostic.code),
    tags: diagnostic.tags,
    relatedInformation: diagnostic.relatedInformation?.map((information) => ({
      message: information.message,
      filePath: information.location.uri.fsPath,
      uri: information.location.uri.toString(),
      range: serializeRange(information.location.range),
    })),
  };
}

function canonicalDiagnosticCode(code: vscode.Diagnostic["code"]): CanonicalDiagnostic["code"] {
  if (!code || typeof code === "string" || typeof code === "number") return code;
  return { value: code.value, target: code.target.toString() };
}

function diagnosticSeverity(severity: vscode.DiagnosticSeverity): CanonicalDiagnostic["severity"] {
  if (severity === vscode.DiagnosticSeverity.Error) return "error";
  if (severity === vscode.DiagnosticSeverity.Warning) return "warning";
  if (severity === vscode.DiagnosticSeverity.Information) return "information";
  return "hint";
}

function canonicalLocation(location: vscode.Location | vscode.LocationLink): CanonicalLocation {
  if (location instanceof vscode.Location) {
    return {
      filePath: location.uri.fsPath,
      uri: location.uri.toString(),
      range: serializeRange(location.range),
    };
  }
  return {
    filePath: location.targetUri.fsPath,
    uri: location.targetUri.toString(),
    range: serializeRange(location.targetRange),
    ...(location.targetSelectionRange
      ? { targetSelectionRange: serializeRange(location.targetSelectionRange) }
      : {}),
    ...(location.originSelectionRange
      ? { originSelectionRange: serializeRange(location.originSelectionRange) }
      : {}),
  };
}

function canonicalDocumentSymbolResults(
  symbols: readonly (vscode.DocumentSymbol | vscode.SymbolInformation)[],
): FlatDocumentSymbol[] {
  const documentSymbols = symbols.filter(
    (symbol): symbol is vscode.DocumentSymbol => symbol instanceof vscode.DocumentSymbol,
  );
  if (documentSymbols.length === symbols.length) {
    return flattenDocumentSymbols(documentSymbols.map(canonicalDocumentSymbol));
  }
  return (symbols as readonly vscode.SymbolInformation[]).map((symbol, index) => ({
    id: `symbol-${index}`,
    depth: 0,
    name: symbol.name,
    kind: vscode.SymbolKind[symbol.kind],
    tags: symbol.tags,
    range: serializeRange(symbol.location.range),
    selectionRange: serializeRange(symbol.location.range),
  }));
}

function canonicalDocumentSymbol(symbol: vscode.DocumentSymbol): CanonicalDocumentSymbol {
  return {
    name: symbol.name,
    detail: symbol.detail,
    kind: vscode.SymbolKind[symbol.kind],
    tags: symbol.tags,
    range: serializeRange(symbol.range),
    selectionRange: serializeRange(symbol.selectionRange),
    children: symbol.children.map(canonicalDocumentSymbol),
  };
}

function canonicalWorkspaceSymbol(symbol: vscode.SymbolInformation): CanonicalWorkspaceSymbol {
  return {
    name: symbol.name,
    kind: vscode.SymbolKind[symbol.kind],
    container: symbol.containerName,
    tags: symbol.tags,
    filePath: symbol.location.uri.fsPath,
    uri: symbol.location.uri.toString(),
    range: serializeRange(symbol.location.range),
    targetSelectionRange: serializeRange(symbol.location.range),
  };
}

function captureEditorState(state: BridgeState): CanonicalEditorState {
  const activeEditor = vscode.window.activeTextEditor;
  return {
    cwd: resolveWorkingDirectory(),
    workspaceFolders: (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
      name: folder.name,
      filePath: folder.uri.fsPath,
      uri: folder.uri.toString(),
    })),
    activeEditor: activeEditor ? canonicalEditor(activeEditor) : undefined,
    currentSelection: canonicalSelection(captureSelection(activeEditor)),
    latestSelection: canonicalSelection(state.latestSelection),
    openEditors: vscode.workspace.textDocuments
      .filter((document) => document.uri.scheme === "file")
      .map((document) => canonicalDocumentEditor(document, activeEditor)),
    tabs: captureTabs(activeEditor),
    visibleEditors: vscode.window.visibleTextEditors.map(canonicalEditor),
  };
}

function canonicalEditor(editor: vscode.TextEditor) {
  const info = getEditorInfo(editor);
  return {
    filePath: info.filePath,
    uri: info.fileUri,
    languageId: info.languageId,
    isDirty: info.isDirty,
    isActive: info.isActive,
    viewColumn: info.viewColumn,
    visibleRanges: editor.visibleRanges.map(serializeRange),
  };
}

function canonicalDocumentEditor(
  document: vscode.TextDocument,
  activeEditor: vscode.TextEditor | undefined,
) {
  return {
    filePath: document.uri.fsPath,
    uri: document.uri.toString(),
    languageId: document.languageId,
    isDirty: document.isDirty,
    isActive: activeEditor?.document.uri.toString() === document.uri.toString(),
  };
}

function captureTabs(activeEditor: vscode.TextEditor | undefined) {
  return vscode.window.tabGroups.all.flatMap((group) =>
    group.tabs.flatMap((tab) => {
      const input = tab.input;
      if (!(input instanceof vscode.TabInputText)) return [];
      const document = vscode.workspace.textDocuments.find(
        (candidate) => candidate.uri.toString() === input.uri.toString(),
      );
      return [
        {
          filePath: input.uri.fsPath,
          uri: input.uri.toString(),
          languageId: document?.languageId ?? "",
          isDirty: tab.isDirty,
          isActive: tab.isActive,
          viewColumn: group.viewColumn,
          visibleRanges:
            activeEditor?.document.uri.toString() === input.uri.toString()
              ? activeEditor.visibleRanges.map(serializeRange)
              : undefined,
        },
      ];
    }),
  );
}

function canonicalSelection(selection: ReturnType<typeof captureSelection>) {
  return selection
    ? {
        text: selection.text,
        isEmpty: selection.isEmpty,
        filePath: selection.filePath,
        uri: selection.fileUri,
        languageId: selection.languageId,
        range: { start: selection.start, end: selection.end },
      }
    : undefined;
}

function canonicalEdit(
  uri: vscode.Uri,
  range: vscode.Range,
  oldText: string,
  newText: string,
): CanonicalEdit {
  return {
    filePath: uri.fsPath,
    uri: uri.toString(),
    range: serializeRange(range),
    oldLength: oldText.length,
    newLength: newText.length,
    oldText,
    newText,
  };
}

function validateEditProjection(
  detail: BridgeDetail,
  includeEditText: boolean,
  edits: readonly CanonicalEdit[],
) {
  if (includeEditText && detail !== "full") {
    throw new BridgeProtocolError(
      "EDIT_TEXT_REQUIRES_FULL",
      "includeEditText=true requires detail=full",
    );
  }
  if (!includeEditText) return;
  const bytes = edits.reduce(
    (total, edit) =>
      total +
      Buffer.byteLength(edit.oldText ?? "", "utf8") +
      Buffer.byteLength(edit.newText ?? "", "utf8"),
    0,
  );
  if (bytes > DEFAULT_EDIT_TEXT_BYTES) {
    throw new BridgeProtocolError(
      "EDIT_TEXT_RESPONSE_TOO_LARGE",
      "Requested edit text exceeds the safe response threshold",
      { bytes, threshold: DEFAULT_EDIT_TEXT_BYTES },
    );
  }
}

function immediateDiagnosticSummary(uris: readonly vscode.Uri[]) {
  const unique = [...new Map(uris.map((uri) => [uri.toString(), uri])).values()];
  const diagnostics = unique.flatMap((uri) =>
    vscode.languages.getDiagnostics(uri).map((diagnostic) => canonicalDiagnostic(uri, diagnostic)),
  );
  return { counts: diagnosticCounts(diagnostics), fileCount: unique.length };
}

async function openDocument(uri: vscode.Uri) {
  return (
    vscode.workspace.textDocuments.find((document) => document.uri.toString() === uri.toString()) ??
    (await vscode.workspace.openTextDocument(uri))
  );
}

function formattingOptions(document: vscode.TextDocument) {
  return {
    insertSpaces:
      vscode.workspace.getConfiguration("editor", document).get<boolean>("insertSpaces") ?? true,
    tabSize: vscode.workspace.getConfiguration("editor", document).get<number>("tabSize") ?? 2,
  };
}

function workspaceRoots(): WorkspacePathRoot[] {
  return (vscode.workspace.workspaceFolders ?? []).map((folder) => ({
    name: folder.name,
    filePath: folder.uri.fsPath,
  }));
}

function uriFromInput(value: string): vscode.Uri {
  return value.includes("://") ? vscode.Uri.parse(value) : getFileUri(value);
}

function readNotificationTypes(value: unknown): Set<BridgeNotification["type"]> | undefined {
  if (value === undefined) return undefined;
  const allowed = new Set<BridgeNotification["type"]>([
    "selection_changed",
    "diagnostics_changed",
    "active_editor_changed",
    "visible_editors_changed",
    "document_dirty_changed",
    "document_saved",
  ]);
  if (!Array.isArray(value) || value.some((entry) => !allowed.has(entry))) {
    throw new BridgeProtocolError("INVALID_PARAMS", "types must contain known notification types");
  }
  return new Set(value as BridgeNotification["type"][]);
}

function readNotificationStart(value: unknown): "buffer" | "now" {
  if (value === undefined || value === "buffer") return "buffer";
  if (value === "now") return "now";
  throw new BridgeProtocolError("INVALID_PARAMS", "start must be buffer or now");
}

function bridgeHelpTools(level?: BridgeDetail): Record<string, unknown> {
  const fields = (matrix: Record<BridgeDetail, string[]>) =>
    level ? { [level]: matrix[level] } : matrix;
  const location = {
    parameters: ["filePath", "position", "detail", "limit", "cursor", "maxOutputBytes"],
    defaults: { detail: "compact", limit: 75, maxOutputBytes: 32 * 1024 },
    pageableBy: "location",
    fields: fields({
      minimal: ["count", "fileCount"],
      compact: ["files.path", "files.locations.range"],
      full: ["filePath", "uri", "selection/origin ranges", "provider command"],
    }),
    cost: "full adds operational file identities and all standard ranges",
  };
  const edit = {
    parameters: ["detail", "includeEditText", "maxOutputBytes"],
    defaults: { detail: "compact", includeEditText: false },
    pageable: false,
    fields: fields({
      minimal: ["applied", "requestedEditCount", "editCount", "filesChanged"],
      compact: ["minimal fields", "files", "ranges", "immediate diagnostics"],
      full: ["compact fields", "filePath", "uri", "edit lengths", "optional edit text"],
    }),
    cost: "includeEditText requires full and has a 24 KiB pre-apply threshold",
  };
  return {
    vscode_get_editor_state: {
      parameters: ["detail", "maxOutputBytes"],
      defaults: { detail: "compact", maxOutputBytes: 32 * 1024 },
      pageable: false,
      fields: fields({
        minimal: ["cwd", "active", "cursor/selection", "dirty"],
        compact: ["minimal fields", "selectionSource", "workspaceFolders", "openEditors"],
        full: ["compact fields", "URIs", "selection text", "tabs", "visibleEditors"],
      }),
    },
    vscode_get_diagnostics: {
      parameters: ["detail", "scope", "uris", "severity", "limit", "cursor", "maxOutputBytes"],
      defaults: {
        detail: "compact",
        scope: "active",
        severity: ["error", "warning"],
        limit: 100,
      },
      pageableBy: "diagnostic",
      fields: fields({
        minimal: ["counts", "fileCount"],
        compact: ["counts", "files", "severity", "message", "range", "code", "source"],
        full: ["compact fields", "filePath", "uri", "tags", "relatedInformation"],
      }),
    },
    vscode_get_document_symbols: {
      parameters: ["filePath", "detail", "limit", "cursor", "maxOutputBytes"],
      defaults: { detail: "compact", limit: 200 },
      pageableBy: "symbol",
      fields: fields({
        minimal: ["count", "topLevelCount", "countsByKind"],
        compact: ["id", "parentId", "depth", "name", "kind", "range"],
        full: ["compact fields", "detail", "tags", "selectionRange", "file identity"],
      }),
    },
    vscode_get_definitions: location,
    vscode_get_type_definitions: location,
    vscode_get_implementations: location,
    vscode_get_declarations: location,
    vscode_get_references: location,
    vscode_get_workspace_symbols: {
      parameters: ["query", "detail", "limit", "cursor", "maxOutputBytes"],
      defaults: { detail: "compact", limit: 200 },
      pageableBy: "symbol",
      fields: fields({
        minimal: ["count", "countsByKind"],
        compact: ["files", "name", "kind", "range", "container"],
        full: ["compact fields", "filePath", "uri", "tags", "selectionRange"],
      }),
    },
    vscode_get_notifications: {
      parameters: [
        "afterCursor",
        "start",
        "detail",
        "limit",
        "types",
        "coalesce",
        "maxOutputBytes",
      ],
      defaults: { detail: "minimal", start: "buffer", limit: 50, coalesce: true },
      pageableBy: "event",
      fields: fields({
        minimal: ["sequence", "type", "path"],
        compact: ["minimal fields", "business payload"],
        full: ["compact fields", "id", "timestamp", "raw", "coalescedCount"],
      }),
    },
    vscode_apply_workspace_edit: edit,
    vscode_format_document: edit,
    vscode_format_range: edit,
  };
}

function helpNotes(topic: string): string[] {
  const notes = [
    "All v2 sizes use final UTF-8 bytes.",
    "compact paths are workspace-relative; full adds filePath and URI.",
  ];
  if (topic === "pagination") {
    notes.push("Continue with nextCursor without changing method, query, filters, or detail.");
  }
  if (topic === "compatibility") {
    notes.push("Only responseVersion=2 selects envelopes; omitted versions remain legacy.");
  }
  if (topic === "cost") {
    notes.push("Default output budget is 32 KiB; caller maximum is 40 KiB.");
  }
  return notes;
}
