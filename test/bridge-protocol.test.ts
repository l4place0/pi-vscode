import { describe, expect, it } from "vitest";
import {
  BridgeProtocolError,
  compactPath,
  createEnvelope,
  decodeSequenceCursor,
  encodeSequenceCursor,
  jsonByteLength,
  readDetail,
  readLimit,
  readMaxOutputBytes,
  SnapshotStore,
  stableFingerprint,
} from "../src/bridge/protocol.ts";

describe("bridge protocol primitives", () => {
  it("validates detail, limit, and output budgets", () => {
    expect(readDetail({})).toBe("compact");
    expect(readDetail({ detail: "full" })).toBe("full");
    expect(() => readDetail({ detail: "wide" })).toThrowError(BridgeProtocolError);
    expect(readLimit({}, 75)).toBe(75);
    expect(() => readLimit({ limit: 0 }, 75)).toThrowError(BridgeProtocolError);
    expect(readMaxOutputBytes({})).toBe(32 * 1024);
    expect(() => readMaxOutputBytes({ maxOutputBytes: 41 * 1024 })).toThrowError(
      expect.objectContaining({ code: "INVALID_PARAMS" }),
    );
  });

  it("creates a compact envelope without undefined fields", () => {
    const envelope = createEnvelope("compact", { files: [] }, { total: 0, returned: 0 });
    expect(envelope).toEqual({
      detail: "compact",
      data: { files: [] },
      meta: { protocolVersion: 2, truncated: false, total: 0, returned: 0 },
    });
    expect(JSON.stringify(envelope)).not.toContain("undefined");
  });

  it("projects POSIX, Windows, multi-root, and external paths", () => {
    expect(compactPath("/repo/src/a.ts", [{ name: "repo", filePath: "/repo" }])).toEqual({
      path: "src/a.ts",
    });
    expect(
      compactPath("C:\\work\\two\\src\\a.ts", [
        { name: "one", filePath: "C:\\work\\one" },
        { name: "two", filePath: "C:\\work\\two" },
      ]),
    ).toEqual({ path: "src/a.ts", workspaceFolder: "two" });
    expect(compactPath("/outside/a.ts", [{ name: "repo", filePath: "/repo" }])).toEqual({
      path: "/outside/a.ts",
      pathKind: "absolute",
    });
  });

  it("generates order-independent query fingerprints", () => {
    expect(stableFingerprint({ scope: "active", detail: "compact" })).toBe(
      stableFingerprint({ detail: "compact", scope: "active" }),
    );
  });

  it("binds notification sequence cursors to a bridge instance", () => {
    const cursor = encodeSequenceCursor("instance-a", 42);
    expect(decodeSequenceCursor(cursor, "instance-a")).toBe(42);
    expect(() => decodeSequenceCursor(cursor, "instance-b")).toThrowError(
      expect.objectContaining({ code: "CURSOR_MISMATCH" }),
    );
  });
});

describe("snapshot pagination", () => {
  function createStore(options: ConstructorParameters<typeof SnapshotStore>[0] = {}) {
    let id = 0;
    return new SnapshotStore({
      instanceId: "instance-a",
      createId: () => `snapshot-${++id}`,
      ...options,
    });
  }

  it("freezes a result and returns complete stable pages", () => {
    const store = createStore();
    const items = Array.from({ length: 5 }, (_, id) => ({ id, text: `item-${id}` }));
    const first = store.page({
      method: "references",
      fingerprint: "query-a",
      detail: "compact",
      items,
      limit: 2,
      maxOutputBytes: 4096,
      project: (page) => page,
    });
    items.reverse();
    const second = store.page({
      method: "references",
      fingerprint: "query-a",
      detail: "compact",
      cursor: first.meta.nextCursor,
      limit: 2,
      maxOutputBytes: 4096,
      project: (page) => page,
    });
    const third = store.page({
      method: "references",
      fingerprint: "query-a",
      detail: "compact",
      cursor: second.meta.nextCursor,
      limit: 2,
      maxOutputBytes: 4096,
      project: (page) => page,
    });
    expect([...first.data, ...second.data, ...third.data].map((item) => item.id)).toEqual([
      0, 1, 2, 3, 4,
    ]);
    expect(first.meta.reason).toBe("limit");
    expect(third.meta.truncated).toBe(false);
    expect(store.stats().snapshots).toBe(0);
  });

  it("returns an untruncated empty page without creating a cursor", () => {
    const store = createStore();
    const result = store.page({
      method: "diagnostics",
      fingerprint: "empty",
      detail: "compact",
      items: [],
      limit: 100,
      maxOutputBytes: 4096,
      project: (page) => ({ diagnostics: page }),
    });
    expect(result).toEqual({
      detail: "compact",
      data: { diagnostics: [] },
      meta: { protocolVersion: 2, truncated: false, total: 0, returned: 0 },
    });
    expect(store.stats()).toMatchObject({ snapshots: 0, items: 0 });
  });

  it("binds cursors to instance, query, method, and detail", () => {
    const store = createStore();
    const first = store.page({
      method: "references",
      fingerprint: "query-a",
      detail: "compact",
      items: [1, 2],
      limit: 1,
      maxOutputBytes: 4096,
      project: (page) => page,
    });
    expect(() =>
      store.page({
        method: "references",
        fingerprint: "query-a",
        detail: "full",
        cursor: first.meta.nextCursor,
        limit: 1,
        maxOutputBytes: 4096,
        project: (page) => page,
      }),
    ).toThrowError(expect.objectContaining({ code: "CURSOR_MISMATCH" }));
    expect(() =>
      new SnapshotStore({ instanceId: "instance-b" }).page({
        method: "references",
        fingerprint: "query-a",
        detail: "compact",
        cursor: first.meta.nextCursor,
        limit: 1,
        maxOutputBytes: 4096,
        project: (page) => page,
      }),
    ).toThrowError(expect.objectContaining({ code: "CURSOR_MISMATCH" }));
    expect(() =>
      store.page({
        method: "definitions",
        fingerprint: "query-b",
        detail: "compact",
        cursor: first.meta.nextCursor,
        limit: 1,
        maxOutputBytes: 4096,
        project: (page) => page,
      }),
    ).toThrowError(expect.objectContaining({ code: "CURSOR_MISMATCH" }));
  });

  it("expires cursors without rerunning a provider", () => {
    let now = 0;
    const store = createStore({ ttlMs: 100, now: () => now });
    const first = store.page({
      method: "symbols",
      fingerprint: "query",
      detail: "compact",
      items: [1, 2],
      limit: 1,
      maxOutputBytes: 4096,
      project: (page) => page,
    });
    now = 101;
    expect(() =>
      store.page({
        method: "symbols",
        fingerprint: "query",
        detail: "compact",
        cursor: first.meta.nextCursor,
        limit: 1,
        maxOutputBytes: 4096,
        project: (page) => page,
      }),
    ).toThrowError(expect.objectContaining({ code: "CURSOR_EXPIRED" }));
  });

  it("evicts old snapshots at count and item limits", () => {
    const store = createStore({ maxSnapshots: 1, maxItems: 3 });
    const first = store.page({
      method: "one",
      fingerprint: "one",
      detail: "compact",
      items: [1, 2],
      limit: 1,
      maxOutputBytes: 4096,
      project: (page) => page,
    });
    store.page({
      method: "two",
      fingerprint: "two",
      detail: "compact",
      items: [3, 4],
      limit: 1,
      maxOutputBytes: 4096,
      project: (page) => page,
    });
    expect(store.stats()).toMatchObject({ snapshots: 1, items: 2, evictions: 1 });
    expect(() =>
      store.page({
        method: "one",
        fingerprint: "one",
        detail: "compact",
        cursor: first.meta.nextCursor,
        limit: 1,
        maxOutputBytes: 4096,
        project: (page) => page,
      }),
    ).toThrowError(expect.objectContaining({ code: "CURSOR_EXPIRED" }));
  });

  it("never emits a partial item or an over-budget envelope", () => {
    const store = createStore();
    expect(() =>
      store.page({
        method: "references",
        fingerprint: "large",
        detail: "full",
        items: [{ text: "x".repeat(4096) }],
        limit: 1,
        maxOutputBytes: 1024,
        project: (page) => page,
      }),
    ).toThrowError(expect.objectContaining({ code: "ITEM_EXCEEDS_BYTE_BUDGET" }));

    const envelope = createEnvelope("compact", { value: "你好" });
    expect(jsonByteLength(envelope)).toBe(Buffer.byteLength(JSON.stringify(envelope), "utf8"));
  });

  it("reports byte-budget truncation with a continuation cursor", () => {
    const store = createStore();
    const first = store.page({
      method: "references",
      fingerprint: "bytes",
      detail: "compact",
      items: [1, 2, 3].map((id) => ({ id, text: "x".repeat(400) })),
      limit: 3,
      maxOutputBytes: 1024,
      project: (page) => page,
    });
    expect(first.meta).toMatchObject({
      truncated: true,
      reason: "byteBudget",
      returned: 1,
      nextCursor: expect.any(String),
    });
  });
});
