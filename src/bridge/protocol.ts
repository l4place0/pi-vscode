import { randomUUID } from "node:crypto";
import { Buffer } from "node:buffer";
import { posix, win32 } from "node:path";

export type BridgeDetail = "minimal" | "compact" | "full";
export type TruncationReason = "limit" | "byteBudget";

export const BRIDGE_PROTOCOL_VERSION = 2 as const;
export const DEFAULT_OUTPUT_BYTES = 32 * 1024;
export const MAX_OUTPUT_BYTES = 40 * 1024;
export const PI_HARD_OUTPUT_BYTES = 50 * 1024;
export const DEFAULT_SNAPSHOT_TTL_MS = 120_000;
export const DEFAULT_MAX_SNAPSHOTS = 16;
export const DEFAULT_MAX_SNAPSHOT_ITEMS = 50_000;
export const DEFAULT_EDIT_TEXT_BYTES = 24 * 1024;
export const DEFAULT_NOTIFICATION_LIMIT = 50;
export const DEFAULT_NOTIFICATION_CAPACITY = 500;

export interface BridgeMeta {
  protocolVersion: typeof BRIDGE_PROTOCOL_VERSION;
  total?: number;
  returned?: number;
  truncated: boolean;
  nextCursor?: string;
  snapshotId?: string;
  reason?: TruncationReason;
  warnings?: string[];
  request?: Record<string, unknown>;
}

export interface BridgeEnvelope<T> {
  detail: BridgeDetail;
  data: T;
  meta: BridgeMeta;
}

export interface CompactPath {
  path: string;
  workspaceFolder?: string;
  pathKind?: "relative" | "absolute";
}

export interface WorkspacePathRoot {
  name: string;
  filePath: string;
}

export type BridgeProtocolErrorCode =
  | "INVALID_PARAMS"
  | "CURSOR_MISMATCH"
  | "CURSOR_EXPIRED"
  | "SNAPSHOT_CAPACITY_EXCEEDED"
  | "ITEM_EXCEEDS_BYTE_BUDGET"
  | "EDIT_TEXT_REQUIRES_FULL"
  | "EDIT_TEXT_RESPONSE_TOO_LARGE"
  | "V2_RESPONSE_TOO_LARGE";

export class BridgeProtocolError extends Error {
  readonly code: BridgeProtocolErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(code: BridgeProtocolErrorCode, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = "BridgeProtocolError";
    this.code = code;
    this.details = details;
  }
}

export function isV2Request(params: Record<string, unknown>): boolean {
  return params.responseVersion === BRIDGE_PROTOCOL_VERSION;
}

export function readDetail(
  params: Record<string, unknown>,
  fallback: BridgeDetail = "compact",
): BridgeDetail {
  const value = params.detail;
  if (value === undefined) return fallback;
  if (value === "minimal" || value === "compact" || value === "full") return value;
  throw invalidParameter("detail", "minimal, compact, or full");
}

export function readLimit(
  params: Record<string, unknown>,
  fallback: number,
  maximum = 1_000,
): number {
  const value = params.limit;
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > maximum) {
    throw invalidParameter("limit", `an integer between 1 and ${maximum}`);
  }
  return value as number;
}

export function readMaxOutputBytes(params: Record<string, unknown>): number {
  const value = params.maxOutputBytes;
  if (value === undefined) return DEFAULT_OUTPUT_BYTES;
  if (
    !Number.isInteger(value) ||
    (value as number) < 1024 ||
    (value as number) > MAX_OUTPUT_BYTES
  ) {
    throw invalidParameter("maxOutputBytes", `an integer between 1024 and ${MAX_OUTPUT_BYTES}`);
  }
  return value as number;
}

export function readCursor(params: Record<string, unknown>): string | undefined {
  const value = params.cursor;
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length === 0) {
    throw invalidParameter("cursor", "a non-empty string");
  }
  return value;
}

export function createEnvelope<T>(
  detail: BridgeDetail,
  data: T,
  meta: Omit<BridgeMeta, "protocolVersion" | "truncated"> & {
    truncated?: boolean;
  } = {},
): BridgeEnvelope<T> {
  return {
    detail,
    data,
    meta: {
      protocolVersion: BRIDGE_PROTOCOL_VERSION,
      truncated: meta.truncated ?? false,
      ...(meta.total === undefined ? {} : { total: meta.total }),
      ...(meta.returned === undefined ? {} : { returned: meta.returned }),
      ...(meta.nextCursor ? { nextCursor: meta.nextCursor } : {}),
      ...(meta.snapshotId ? { snapshotId: meta.snapshotId } : {}),
      ...(meta.reason ? { reason: meta.reason } : {}),
      ...(meta.warnings?.length ? { warnings: meta.warnings } : {}),
      ...(meta.request ? { request: meta.request } : {}),
    },
  };
}

export function createErrorEnvelope(error: unknown): {
  error: { code: string; message: string; details?: Record<string, unknown> };
  meta: { protocolVersion: 2 };
} {
  if (error instanceof BridgeProtocolError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        ...(error.details ? { details: error.details } : {}),
      },
      meta: { protocolVersion: BRIDGE_PROTOCOL_VERSION },
    };
  }
  return {
    error: {
      code: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : String(error),
    },
    meta: { protocolVersion: BRIDGE_PROTOCOL_VERSION },
  };
}

export function jsonByteLength(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

export function stableFingerprint(value: unknown): string {
  return Buffer.from(stableStringify(value), "utf8").toString("base64url");
}

export function encodeSequenceCursor(instanceId: string, sequence: number): string {
  return Buffer.from(JSON.stringify({ version: 1, instanceId, sequence }), "utf8").toString(
    "base64url",
  );
}

export function decodeSequenceCursor(value: string, instanceId: string): number {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
    if (
      parsed.version !== 1 ||
      parsed.instanceId !== instanceId ||
      !Number.isInteger(parsed.sequence) ||
      (parsed.sequence as number) < 0
    ) {
      throw new Error("mismatch");
    }
    return parsed.sequence as number;
  } catch {
    throw new BridgeProtocolError(
      "CURSOR_MISMATCH",
      "Notification cursor does not match this bridge instance",
    );
  }
}

export function compactPath(
  filePath: string,
  workspaceRoots: readonly WorkspacePathRoot[],
): CompactPath {
  const windows = win32.isAbsolute(filePath);
  const pathApi = windows ? win32 : posix;
  const normalizedTarget = pathApi.normalize(filePath);
  const candidates = workspaceRoots
    .filter((root) => (windows ? win32.isAbsolute(root.filePath) : posix.isAbsolute(root.filePath)))
    .map((root) => ({ ...root, normalized: pathApi.normalize(root.filePath) }))
    .filter((root) => isPathInside(normalizedTarget, root.normalized, pathApi, windows))
    .sort((left, right) => right.normalized.length - left.normalized.length);
  const workspace = candidates[0];
  if (!workspace) {
    return {
      path: normalizedTarget.replaceAll("\\", "/"),
      pathKind: "absolute",
    };
  }
  const relative = pathApi.relative(workspace.normalized, normalizedTarget).replaceAll("\\", "/");
  return {
    path: relative || ".",
    ...(workspaceRoots.length > 1 ? { workspaceFolder: workspace.name } : {}),
  };
}

interface SnapshotCursor {
  version: 1;
  instanceId: string;
  snapshotId: string;
  offset: number;
  method: string;
  fingerprint: string;
  detail: BridgeDetail;
}

interface StoredSnapshot {
  id: string;
  method: string;
  fingerprint: string;
  detail: BridgeDetail;
  items: readonly unknown[];
  expiresAt: number;
}

export interface SnapshotStoreOptions {
  instanceId?: string;
  ttlMs?: number;
  maxSnapshots?: number;
  maxItems?: number;
  now?: () => number;
  createId?: () => string;
}

export interface SnapshotPageRequest<T, TData> {
  method: string;
  fingerprint: string;
  detail: BridgeDetail;
  cursor?: string;
  items?: readonly T[];
  limit: number;
  maxOutputBytes: number;
  project(items: readonly T[]): TData;
  warnings?: string[];
}

export class SnapshotStore {
  readonly instanceId: string;
  readonly ttlMs: number;
  readonly maxSnapshots: number;
  readonly maxItems: number;
  readonly #now: () => number;
  readonly #createId: () => string;
  readonly #snapshots = new Map<string, StoredSnapshot>();
  #itemCount = 0;
  #evictionCount = 0;

  constructor(options: SnapshotStoreOptions = {}) {
    this.instanceId = options.instanceId ?? randomUUID();
    this.ttlMs = options.ttlMs ?? DEFAULT_SNAPSHOT_TTL_MS;
    this.maxSnapshots = options.maxSnapshots ?? DEFAULT_MAX_SNAPSHOTS;
    this.maxItems = options.maxItems ?? DEFAULT_MAX_SNAPSHOT_ITEMS;
    this.#now = options.now ?? Date.now;
    this.#createId = options.createId ?? randomUUID;
  }

  page<T, TData>(request: SnapshotPageRequest<T, TData>): BridgeEnvelope<TData> {
    this.pruneExpired();
    const resolved = request.cursor
      ? this.#resolve<T>(request.cursor, request)
      : this.#create<T>(request);
    const { snapshot, offset } = resolved;
    if (snapshot.items.length === 0 && offset === 0) {
      this.#deleteSnapshot(snapshot.id);
      return createEnvelope(request.detail, request.project([]), {
        total: 0,
        returned: 0,
        warnings: request.warnings,
      });
    }
    const remaining = snapshot.items.length - offset;
    if (remaining <= 0) {
      throw new BridgeProtocolError("CURSOR_MISMATCH", "Cursor points beyond the snapshot");
    }
    const maximum = Math.min(request.limit, remaining);
    let accepted = 0;
    for (let count = 1; count <= maximum; count += 1) {
      const nextOffset = offset + count;
      const hasNext = nextOffset < snapshot.items.length;
      const candidate = createEnvelope(
        request.detail,
        request.project(snapshot.items.slice(offset, nextOffset) as readonly T[]),
        {
          total: snapshot.items.length,
          returned: count,
          truncated: hasNext,
          snapshotId: snapshot.id,
          nextCursor: hasNext ? this.#encodeCursor(snapshot, nextOffset) : undefined,
          reason: hasNext ? "byteBudget" : undefined,
          warnings: request.warnings,
        },
      );
      if (jsonByteLength(candidate) > request.maxOutputBytes) break;
      accepted = count;
    }
    if (accepted === 0) {
      if (!request.cursor) this.#deleteSnapshot(snapshot.id);
      throw new BridgeProtocolError(
        "ITEM_EXCEEDS_BYTE_BUDGET",
        `A single ${request.method} item exceeds maxOutputBytes`,
        { maxOutputBytes: request.maxOutputBytes },
      );
    }
    const nextOffset = offset + accepted;
    const hasNext = nextOffset < snapshot.items.length;
    const reason: TruncationReason | undefined = hasNext
      ? accepted === request.limit
        ? "limit"
        : "byteBudget"
      : undefined;
    const envelope = createEnvelope(
      request.detail,
      request.project(snapshot.items.slice(offset, nextOffset) as readonly T[]),
      {
        total: snapshot.items.length,
        returned: accepted,
        truncated: hasNext,
        snapshotId: snapshot.id,
        nextCursor: hasNext ? this.#encodeCursor(snapshot, nextOffset) : undefined,
        reason,
        warnings: request.warnings,
      },
    );
    if (jsonByteLength(envelope) > request.maxOutputBytes) {
      throw new BridgeProtocolError("V2_RESPONSE_TOO_LARGE", "V2 page exceeded its byte budget");
    }
    if (!hasNext) this.#deleteSnapshot(snapshot.id);
    return envelope;
  }

  pruneExpired(): void {
    const now = this.#now();
    for (const [id, snapshot] of this.#snapshots) {
      if (snapshot.expiresAt <= now) this.#deleteSnapshot(id);
    }
  }

  clear(): void {
    this.#snapshots.clear();
    this.#itemCount = 0;
  }

  stats(): { snapshots: number; items: number; evictions: number } {
    return {
      snapshots: this.#snapshots.size,
      items: this.#itemCount,
      evictions: this.#evictionCount,
    };
  }

  #create<T>(request: SnapshotPageRequest<T, unknown>): {
    snapshot: StoredSnapshot;
    offset: 0;
  } {
    if (!request.items) {
      throw new BridgeProtocolError("INVALID_PARAMS", "Initial paginated request requires items");
    }
    if (request.items.length > this.maxItems) {
      throw new BridgeProtocolError(
        "SNAPSHOT_CAPACITY_EXCEEDED",
        `Result has ${request.items.length} items; snapshot capacity is ${this.maxItems}`,
      );
    }
    while (
      this.#snapshots.size >= this.maxSnapshots ||
      this.#itemCount + request.items.length > this.maxItems
    ) {
      const oldest = this.#snapshots.keys().next().value;
      if (typeof oldest !== "string") break;
      this.#deleteSnapshot(oldest);
      this.#evictionCount += 1;
    }
    const snapshot: StoredSnapshot = {
      id: this.#createId(),
      method: request.method,
      fingerprint: request.fingerprint,
      detail: request.detail,
      items: Object.freeze([...request.items]),
      expiresAt: this.#now() + this.ttlMs,
    };
    this.#snapshots.set(snapshot.id, snapshot);
    this.#itemCount += snapshot.items.length;
    return { snapshot, offset: 0 };
  }

  #resolve<T>(
    cursorText: string,
    request: SnapshotPageRequest<T, unknown>,
  ): { snapshot: StoredSnapshot; offset: number } {
    const cursor = decodeCursor(cursorText);
    if (
      cursor.instanceId !== this.instanceId ||
      cursor.method !== request.method ||
      cursor.fingerprint !== request.fingerprint ||
      cursor.detail !== request.detail
    ) {
      throw new BridgeProtocolError("CURSOR_MISMATCH", "Cursor does not match this request");
    }
    const snapshot = this.#snapshots.get(cursor.snapshotId);
    if (!snapshot || snapshot.expiresAt <= this.#now()) {
      if (snapshot) this.#deleteSnapshot(snapshot.id);
      throw new BridgeProtocolError("CURSOR_EXPIRED", "Snapshot cursor has expired");
    }
    return { snapshot, offset: cursor.offset };
  }

  #encodeCursor(snapshot: StoredSnapshot, offset: number): string {
    const cursor: SnapshotCursor = {
      version: 1,
      instanceId: this.instanceId,
      snapshotId: snapshot.id,
      offset,
      method: snapshot.method,
      fingerprint: snapshot.fingerprint,
      detail: snapshot.detail,
    };
    return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
  }

  #deleteSnapshot(id: string): void {
    const snapshot = this.#snapshots.get(id);
    if (!snapshot) return;
    this.#snapshots.delete(id);
    this.#itemCount -= snapshot.items.length;
  }
}

function decodeCursor(value: string): SnapshotCursor {
  try {
    const parsed = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    ) as Partial<SnapshotCursor>;
    if (
      parsed.version !== 1 ||
      typeof parsed.instanceId !== "string" ||
      typeof parsed.snapshotId !== "string" ||
      !Number.isInteger(parsed.offset) ||
      (parsed.offset as number) < 0 ||
      typeof parsed.method !== "string" ||
      typeof parsed.fingerprint !== "string" ||
      (parsed.detail !== "minimal" && parsed.detail !== "compact" && parsed.detail !== "full")
    ) {
      throw new Error("invalid cursor fields");
    }
    return parsed as SnapshotCursor;
  } catch {
    throw new BridgeProtocolError("CURSOR_MISMATCH", "Invalid pagination cursor");
  }
}

function invalidParameter(name: string, expected: string): BridgeProtocolError {
  return new BridgeProtocolError("INVALID_PARAMS", `${name} must be ${expected}`, {
    parameter: name,
  });
}

function isPathInside(
  target: string,
  root: string,
  pathApi: typeof posix | typeof win32,
  caseInsensitive: boolean,
): boolean {
  const relative = pathApi.relative(root, target);
  const comparison = caseInsensitive ? relative.toLowerCase() : relative;
  return comparison === "" || (!comparison.startsWith("..") && !pathApi.isAbsolute(relative));
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
