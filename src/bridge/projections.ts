import type { BridgeNotification } from "./types.ts";
import { compactPath, type BridgeDetail, type WorkspacePathRoot } from "./protocol.ts";

export interface ProtocolPosition {
  line: number;
  character: number;
}

export interface ProtocolRange {
  start: ProtocolPosition;
  end: ProtocolPosition;
}

export interface CanonicalLocation {
  filePath: string;
  uri: string;
  range: ProtocolRange;
  targetSelectionRange?: ProtocolRange;
  originSelectionRange?: ProtocolRange;
}

export interface CanonicalDiagnostic extends CanonicalLocation {
  severity: "error" | "warning" | "information" | "hint";
  severityNumber: number;
  message: string;
  source?: string;
  code?: string | number | { value: string | number; target?: string };
  tags?: readonly number[];
  relatedInformation?: readonly {
    message: string;
    filePath: string;
    uri: string;
    range: ProtocolRange;
  }[];
}

export interface CanonicalDocumentSymbol {
  name: string;
  detail?: string;
  kind: string;
  tags?: readonly number[];
  range: ProtocolRange;
  selectionRange: ProtocolRange;
  children: readonly CanonicalDocumentSymbol[];
}

export interface FlatDocumentSymbol {
  id: string;
  parentId?: string;
  depth: number;
  name: string;
  detail?: string;
  kind: string;
  tags?: readonly number[];
  range: ProtocolRange;
  selectionRange: ProtocolRange;
}

export interface CanonicalWorkspaceSymbol extends CanonicalLocation {
  name: string;
  kind: string;
  container?: string;
  tags?: readonly number[];
}

export interface CanonicalEditorSummary {
  filePath: string;
  uri: string;
  languageId: string;
  isDirty: boolean;
  isActive: boolean;
  viewColumn?: number;
  visibleRanges?: readonly ProtocolRange[];
}

export interface CanonicalSelection {
  text: string;
  isEmpty: boolean;
  filePath: string;
  uri: string;
  languageId: string;
  range: ProtocolRange;
}

export interface CanonicalEditorState {
  cwd?: string;
  workspaceFolders: readonly { name: string; filePath: string; uri: string }[];
  activeEditor?: CanonicalEditorSummary;
  currentSelection?: CanonicalSelection;
  latestSelection?: CanonicalSelection;
  openEditors: readonly CanonicalEditorSummary[];
  tabs: readonly CanonicalEditorSummary[];
  visibleEditors: readonly CanonicalEditorSummary[];
}

export interface CanonicalEdit {
  filePath: string;
  uri: string;
  range: ProtocolRange;
  oldLength: number;
  newLength: number;
  oldText?: string;
  newText?: string;
}

export function sortLocations<T extends CanonicalLocation>(items: readonly T[]): T[] {
  return [...items].sort(
    (left, right) =>
      normalizePath(left.uri).localeCompare(normalizePath(right.uri)) ||
      compareRange(left.range, right.range) ||
      compareOptionalRange(left.targetSelectionRange, right.targetSelectionRange) ||
      compareOptionalRange(left.originSelectionRange, right.originSelectionRange),
  );
}

export function sortWorkspaceSymbols(
  items: readonly CanonicalWorkspaceSymbol[],
): CanonicalWorkspaceSymbol[] {
  return sortLocations(items).sort(
    (left, right) =>
      normalizePath(left.uri).localeCompare(normalizePath(right.uri)) ||
      compareRange(left.range, right.range) ||
      left.name.localeCompare(right.name) ||
      left.kind.localeCompare(right.kind) ||
      (left.container ?? "").localeCompare(right.container ?? ""),
  );
}

export function projectLocations(
  items: readonly CanonicalLocation[],
  detail: BridgeDetail,
  roots: readonly WorkspacePathRoot[],
): unknown {
  if (detail === "minimal") {
    return {
      count: items.length,
      fileCount: new Set(items.map((item) => item.uri)).size,
    };
  }
  return {
    files: groupByUri(items).map(([sample, locations]) => ({
      ...compactPath(sample.filePath, roots),
      ...(detail === "full" ? { filePath: sample.filePath, uri: sample.uri } : {}),
      locations: locations.map((location) => ({
        range: location.range,
        ...(detail === "full" && location.targetSelectionRange
          ? { targetSelectionRange: location.targetSelectionRange }
          : {}),
        ...(detail === "full" && location.originSelectionRange
          ? { originSelectionRange: location.originSelectionRange }
          : {}),
      })),
    })),
  };
}

export function sortDiagnostics(
  items: readonly CanonicalDiagnostic[],
  uriOrder?: ReadonlyMap<string, number>,
): CanonicalDiagnostic[] {
  return [...items].sort((left, right) => {
    if (uriOrder) {
      const order =
        (uriOrder.get(left.uri) ?? Number.MAX_SAFE_INTEGER) -
        (uriOrder.get(right.uri) ?? Number.MAX_SAFE_INTEGER);
      if (order !== 0) return order;
    }
    return (
      normalizePath(left.filePath).localeCompare(normalizePath(right.filePath)) ||
      left.uri.localeCompare(right.uri) ||
      compareRange(left.range, right.range) ||
      left.severityNumber - right.severityNumber ||
      left.message.localeCompare(right.message)
    );
  });
}

export function diagnosticCounts(items: readonly CanonicalDiagnostic[]): {
  errors: number;
  warnings: number;
  infos: number;
  hints: number;
} {
  const counts = { errors: 0, warnings: 0, infos: 0, hints: 0 };
  for (const diagnostic of items) {
    if (diagnostic.severity === "error") counts.errors += 1;
    else if (diagnostic.severity === "warning") counts.warnings += 1;
    else if (diagnostic.severity === "information") counts.infos += 1;
    else counts.hints += 1;
  }
  return counts;
}

export function projectDiagnostics(
  items: readonly CanonicalDiagnostic[],
  detail: BridgeDetail,
  roots: readonly WorkspacePathRoot[],
): unknown {
  if (detail === "minimal") {
    return {
      counts: diagnosticCounts(items),
      fileCount: new Set(items.map((item) => item.uri)).size,
    };
  }
  return {
    counts: diagnosticCounts(items),
    files: groupByUri(items).map(([sample, diagnostics]) => ({
      ...compactPath(sample.filePath, roots),
      ...(detail === "full" ? { filePath: sample.filePath, uri: sample.uri } : {}),
      counts: diagnosticCounts(diagnostics),
      diagnostics: diagnostics.map((diagnostic) => ({
        severity: diagnostic.severity,
        message: diagnostic.message,
        range: diagnostic.range,
        ...(diagnostic.code === undefined
          ? {}
          : {
              code:
                detail === "full" || typeof diagnostic.code !== "object"
                  ? diagnostic.code
                  : diagnostic.code.value,
            }),
        ...(diagnostic.source ? { source: diagnostic.source } : {}),
        ...(detail === "full"
          ? {
              severityNumber: diagnostic.severityNumber,
              ...(diagnostic.tags?.length ? { tags: diagnostic.tags } : {}),
              ...(diagnostic.relatedInformation?.length
                ? {
                    relatedInformation: diagnostic.relatedInformation.map((information) => ({
                      message: information.message,
                      ...compactPath(information.filePath, roots),
                      filePath: information.filePath,
                      uri: information.uri,
                      range: information.range,
                    })),
                  }
                : {}),
            }
          : {}),
      })),
    })),
  };
}

export function flattenDocumentSymbols(
  symbols: readonly CanonicalDocumentSymbol[],
): FlatDocumentSymbol[] {
  const flattened: FlatDocumentSymbol[] = [];
  const visit = (
    entries: readonly CanonicalDocumentSymbol[],
    parentId: string | undefined,
    depth: number,
    prefix: string,
  ) => {
    entries.forEach((symbol, index) => {
      const id = `${prefix}${index}`;
      flattened.push({
        id,
        ...(parentId ? { parentId } : {}),
        depth,
        name: symbol.name,
        detail: symbol.detail,
        kind: symbol.kind,
        tags: symbol.tags,
        range: symbol.range,
        selectionRange: symbol.selectionRange,
      });
      visit(symbol.children, id, depth + 1, `${id}.`);
    });
  };
  visit(symbols, undefined, 0, "symbol-");
  return flattened;
}

export function projectDocumentSymbols(
  items: readonly FlatDocumentSymbol[],
  detail: BridgeDetail,
  file: { filePath: string; uri: string },
  roots: readonly WorkspacePathRoot[],
): unknown {
  if (detail === "minimal") {
    return {
      count: items.length,
      topLevelCount: items.filter((item) => item.depth === 0).length,
      countsByKind: countBy(items, (item) => item.kind),
    };
  }
  return {
    file: {
      ...compactPath(file.filePath, roots),
      ...(detail === "full" ? file : {}),
    },
    symbols: items.map((item) => ({
      id: item.id,
      ...(item.parentId ? { parentId: item.parentId } : {}),
      depth: item.depth,
      name: item.name,
      kind: item.kind,
      range: item.range,
      ...(detail === "full"
        ? {
            ...(item.detail ? { detail: item.detail } : {}),
            ...(item.tags?.length ? { tags: item.tags } : {}),
            selectionRange: item.selectionRange,
          }
        : {}),
    })),
  };
}

export function projectWorkspaceSymbols(
  items: readonly CanonicalWorkspaceSymbol[],
  detail: BridgeDetail,
  roots: readonly WorkspacePathRoot[],
): unknown {
  if (detail === "minimal") {
    return {
      count: items.length,
      countsByKind: countBy(items, (item) => item.kind),
    };
  }
  return {
    files: groupByUri(items).map(([sample, symbols]) => ({
      ...compactPath(sample.filePath, roots),
      ...(detail === "full" ? { filePath: sample.filePath, uri: sample.uri } : {}),
      symbols: symbols.map((symbol) => ({
        name: symbol.name,
        kind: symbol.kind,
        range: symbol.range,
        ...(symbol.container ? { container: symbol.container } : {}),
        ...(detail === "full" && symbol.tags?.length ? { tags: symbol.tags } : {}),
        ...(detail === "full" && symbol.targetSelectionRange
          ? { selectionRange: symbol.targetSelectionRange }
          : {}),
      })),
    })),
  };
}

export function projectEditorState(
  state: CanonicalEditorState,
  detail: BridgeDetail,
  roots: readonly WorkspacePathRoot[],
): unknown {
  const selection = state.currentSelection ?? state.latestSelection;
  const active = state.activeEditor
    ? {
        ...compactPath(state.activeEditor.filePath, roots),
        languageId: state.activeEditor.languageId,
        isDirty: state.activeEditor.isDirty,
        ...(selection
          ? {
              selection: { range: selection.range, isEmpty: selection.isEmpty },
            }
          : {}),
      }
    : undefined;
  const minimal = { cwd: state.cwd, ...(active ? { active } : {}) };
  if (detail === "minimal") return minimal;
  const compact = {
    ...minimal,
    ...(selection
      ? {
          selectionSource: state.currentSelection ? "active" : "latest",
          ...(!active
            ? {
                selection: {
                  ...compactPath(selection.filePath, roots),
                  languageId: selection.languageId,
                  range: selection.range,
                  isEmpty: selection.isEmpty,
                },
              }
            : {}),
        }
      : {}),
    workspaceFolders: state.workspaceFolders.map((folder) => ({
      ...compactPath(folder.filePath, roots),
      name: folder.name,
    })),
    openEditors: state.openEditors.map((editor) => ({
      ...compactPath(editor.filePath, roots),
      languageId: editor.languageId,
      isDirty: editor.isDirty,
      isActive: editor.isActive,
    })),
  };
  if (detail === "compact") return compact;
  return {
    ...compact,
    ...(state.activeEditor
      ? {
          active: {
            ...active,
            filePath: state.activeEditor.filePath,
            uri: state.activeEditor.uri,
          },
        }
      : {}),
    currentSelection: state.currentSelection,
    latestSelection: state.latestSelection,
    selectionText: selection?.text,
    tabs: state.tabs,
    visibleEditors: state.visibleEditors,
  };
}

export function projectEditResult(
  input: {
    applied: boolean;
    requestedEditCount: number;
    edits: readonly CanonicalEdit[];
    diagnostics?: unknown;
    observation?: "immediate";
  },
  detail: BridgeDetail,
  roots: readonly WorkspacePathRoot[],
  includeEditText: boolean,
): unknown {
  const files = groupByFilePath(input.edits);
  const base = {
    applied: input.applied,
    requestedEditCount: input.requestedEditCount,
    editCount: input.applied ? input.edits.length : 0,
    filesChanged: input.applied ? files.length : 0,
  };
  if (detail === "minimal") return base;
  return {
    ...base,
    files: files.map(([sample, edits]) => ({
      ...compactPath(sample.filePath, roots),
      editCount: input.applied ? edits.length : 0,
      ...(detail === "full" ? { filePath: sample.filePath, uri: sample.uri } : {}),
      edits: edits.map((edit) => ({
        range: edit.range,
        ...(detail === "full"
          ? {
              oldLength: edit.oldLength,
              newLength: edit.newLength,
              ...(includeEditText ? { oldText: edit.oldText, newText: edit.newText } : {}),
            }
          : {}),
      })),
    })),
    ...(input.diagnostics === undefined ? {} : { diagnostics: input.diagnostics }),
    ...(input.observation ? { observation: input.observation } : {}),
  };
}

export function coalesceNotifications(
  notifications: readonly BridgeNotification[],
): BridgeNotification[] {
  const output: BridgeNotification[] = [];
  for (const notification of notifications) {
    const previous = output.at(-1);
    if (canReplaceNotification(previous, notification)) {
      output[output.length - 1] = {
        ...notification,
        coalescedCount: (previous?.coalescedCount ?? 1) + 1,
      };
      continue;
    }
    if (previous?.type === "diagnostics_changed" && notification.type === "diagnostics_changed") {
      output[output.length - 1] = {
        ...notification,
        data: mergeDiagnosticNotificationData(previous.data, notification.data),
        coalescedCount: (previous.coalescedCount ?? 1) + 1,
      };
      continue;
    }
    if (notification.type === "document_dirty_changed") {
      const key = notificationPath(notification);
      for (let index = output.length - 1; index >= 0; index -= 1) {
        const candidate = output[index];
        if (candidate?.type !== "document_dirty_changed") break;
        if (notificationPath(candidate) === key) {
          output.splice(index, 1);
          break;
        }
      }
    }
    output.push({
      ...notification,
      coalescedCount: notification.coalescedCount ?? 1,
    });
  }
  return output;
}

export function selectNotificationWindow(
  notifications: readonly BridgeNotification[],
  nextSequence: number,
  afterSequence: number,
  types?: ReadonlySet<BridgeNotification["type"]>,
): {
  notifications: BridgeNotification[];
  earliest: number;
  latest: number;
  gap?: { resyncRequired: true; earliestAvailableSequence: number };
} {
  const earliest = notifications[0]?.sequence ?? nextSequence;
  const latest = nextSequence - 1;
  if (afterSequence + 1 < earliest) {
    return {
      notifications: [],
      earliest,
      latest,
      gap: { resyncRequired: true, earliestAvailableSequence: earliest },
    };
  }
  return {
    notifications: notifications.filter(
      (notification) =>
        notification.sequence > afterSequence && (!types || types.has(notification.type)),
    ),
    earliest,
    latest,
  };
}

export function projectNotification(
  notification: BridgeNotification,
  detail: BridgeDetail,
  roots: readonly WorkspacePathRoot[],
): unknown {
  const path = notificationPath(notification);
  const header = {
    sequence: notification.sequence,
    type: notification.type,
    ...(path ? compactPath(path, roots) : {}),
  };
  if (detail === "minimal") return header;
  return {
    ...header,
    data: notification.data,
    ...(detail === "full"
      ? {
          id: notification.id,
          timestamp: notification.timestamp,
          coalescedCount: notification.coalescedCount ?? 1,
          raw: notification.raw ?? notification.data,
        }
      : {}),
  };
}

function canReplaceNotification(
  previous: BridgeNotification | undefined,
  next: BridgeNotification,
): boolean {
  if (!previous || previous.type !== next.type) return false;
  if (next.type === "selection_changed")
    return notificationPath(previous) === notificationPath(next);
  return next.type === "active_editor_changed" || next.type === "visible_editors_changed";
}

function mergeDiagnosticNotificationData(left: unknown, right: unknown): unknown {
  const leftUris = readNotificationUris(left);
  const rightUris = readNotificationUris(right);
  return {
    uris: [...new Map([...leftUris, ...rightUris].map((value) => [value.uri, value])).values()],
  };
}

function readNotificationUris(value: unknown): { filePath: string; uri: string }[] {
  if (!value || typeof value !== "object") return [];
  const uris = (value as { uris?: unknown }).uris;
  if (!Array.isArray(uris)) return [];
  return uris.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const record = entry as Record<string, unknown>;
    const filePath = typeof record.filePath === "string" ? record.filePath : undefined;
    const uri =
      typeof record.uri === "string"
        ? record.uri
        : typeof record.fileUri === "string"
          ? record.fileUri
          : undefined;
    return filePath && uri ? [{ filePath, uri }] : [];
  });
}

function notificationPath(notification: BridgeNotification): string | undefined {
  const data = notification.data;
  if (!data || typeof data !== "object") return undefined;
  const record = data as Record<string, unknown>;
  if (typeof record.filePath === "string") return record.filePath;
  if (record.activeEditor && typeof record.activeEditor === "object") {
    const filePath = (record.activeEditor as Record<string, unknown>).filePath;
    if (typeof filePath === "string") return filePath;
  }
  return undefined;
}

function groupByUri<T extends { uri: string }>(items: readonly T[]): [T, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(item.uri) ?? [];
    group.push(item);
    groups.set(item.uri, group);
  }
  return [...groups.values()].map((group) => [group[0] as T, group]);
}

function groupByFilePath<T extends { filePath: string }>(items: readonly T[]): [T, T[]][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const group = groups.get(item.filePath) ?? [];
    group.push(item);
    groups.set(item.filePath, group);
  }
  return [...groups.values()].map((group) => [group[0] as T, group]);
}

function countBy<T>(items: readonly T[], key: (item: T) => string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of items) {
    const value = key(item);
    counts[value] = (counts[value] ?? 0) + 1;
  }
  return counts;
}

function compareRange(left: ProtocolRange, right: ProtocolRange): number {
  return (
    left.start.line - right.start.line ||
    left.start.character - right.start.character ||
    left.end.line - right.end.line ||
    left.end.character - right.end.character
  );
}

function compareOptionalRange(
  left: ProtocolRange | undefined,
  right: ProtocolRange | undefined,
): number {
  if (!left && !right) return 0;
  if (!left) return -1;
  if (!right) return 1;
  return compareRange(left, right);
}

function normalizePath(value: string): string {
  return value.replaceAll("\\", "/");
}
