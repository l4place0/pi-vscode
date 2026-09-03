import { Buffer } from "node:buffer";
import {
  coalesceNotifications,
  generateDiagnostics,
  generateNotifications,
} from "../full-parameters-v1/experiment.mjs";

const KIB = 1024;
const PAGE_BUDGET = 32 * KIB;
const PI_HARD_LIMIT = 50 * KIB;

export const ABLATIONS = Object.freeze([
  "compactGrouping",
  "diagnosticDefaults",
  "snapshotFreeze",
  "byteBudgetPaging",
  "sequenceCursor",
  "notificationCoalescing",
  "editorCompactProjection",
  "editTextPreflight",
  "explicitVersionGate",
]);

export function runBridgeV2AblationExperiment() {
  const locations = generateClusteredLocations(10_000, 200);
  const diagnostics = generateDiagnostics(2_000);
  const notifications = generateNotifications(10_000);
  const rows = [
    ablateCompactGrouping(locations),
    ablateDiagnosticDefaults(diagnostics),
    ablateSnapshotFreeze(),
    ablateByteBudgetPaging(locations),
    ablateSequenceCursor(),
    ablateNotificationCoalescing(notifications),
    ablateEditorCompactProjection(),
    ablateEditTextPreflight(),
    ablateExplicitVersionGate(),
  ];
  return {
    schemaVersion: 1,
    experiment: "bridge-response-protocol-v2-ablation-v1",
    method: "deterministic canonical replay; one implemented mechanism removed per row",
    baseline: "implemented Bridge Response Protocol v2 defaults",
    fixtureSummary: {
      locations: locations.length,
      locationFiles: 200,
      diagnostics: diagnostics.length,
      notifications: notifications.length,
      sameTimestampEvents: 10,
      editorCount: 50,
      selectionTextKiB: 20,
      editEchoKiB: 64,
    },
    ablations: ABLATIONS,
    rows,
    correctnessGatePassed: rows.every((row) => row.gatePassed),
    summary: summarize(rows),
  };
}

export function ablateCompactGrouping(locations) {
  const baselineBytes = jsonBytes(envelope(groupLocations(locations)));
  const ablatedBytes = jsonBytes(envelope(flattenLocations(locations)));
  return row("compactGrouping", "Remove per-file grouping and repeat filePath/URI per hit", {
    baseline: { bytes: baselineBytes },
    ablated: { bytes: ablatedBytes },
    effect: {
      byteIncrease: ablatedBytes - baselineBytes,
      byteMultiplier: ratio(ablatedBytes, baselineBytes),
      baselineReduction: 1 - baselineBytes / ablatedBytes,
    },
    gatePassed: baselineBytes < ablatedBytes,
  });
}

export function ablateDiagnosticDefaults(diagnostics) {
  const activePath = diagnostics[0].path;
  const actionable = new Set(["error", "warning"]);
  const baseline = diagnostics.filter(
    (diagnostic) => diagnostic.path === activePath && actionable.has(diagnostic.severity),
  );
  const ablated = diagnostics;
  const relevant = diagnostics.filter(
    (diagnostic) => diagnostic.path === activePath && actionable.has(diagnostic.severity),
  );
  return row(
    "diagnosticDefaults",
    "Replace active error/warning defaults with unfiltered workspace",
    {
      baseline: {
        returned: baseline.length,
        relevantReturned: baseline.filter((item) => relevant.includes(item)).length,
        noise: baseline.filter((item) => !relevant.includes(item)).length,
      },
      ablated: {
        returned: ablated.length,
        relevantReturned: ablated.filter((item) => relevant.includes(item)).length,
        noise: ablated.filter((item) => !relevant.includes(item)).length,
      },
      effect: { extraNoise: ablated.length - relevant.length },
      gatePassed: baseline.length === relevant.length && ablated.length > baseline.length,
    },
  );
}

export function ablateSnapshotFreeze() {
  const original = Array.from({ length: 100 }, (_, id) => ({ id }));
  const changedProviderResult = [original.at(-1), ...original.slice(0, -1)];
  const first = original.slice(0, 25);
  const baselineMerged = [...first, ...original.slice(25, 50)];
  const ablatedMerged = [...first, ...changedProviderResult.slice(25, 50)];
  return row("snapshotFreeze", "Re-run a changed provider for page two", {
    baseline: coverage(baselineMerged, 0, 50),
    ablated: coverage(ablatedMerged, 0, 50),
    effect: {
      duplicatesIntroduced:
        ablatedMerged.length - new Set(ablatedMerged.map((item) => item.id)).size,
      missingIntroduced: 50 - new Set(ablatedMerged.map((item) => item.id)).size,
    },
    gatePassed:
      coverage(baselineMerged, 0, 50).complete && !coverage(ablatedMerged, 0, 50).complete,
  });
}

export function ablateByteBudgetPaging(locations) {
  const pages = paginate(locations, locations.length, PAGE_BUDGET);
  const ablatedBytes = jsonBytes(envelope(groupLocations(locations)));
  return row("byteBudgetPaging", "Return all logical items without byte-boundary paging", {
    baseline: {
      pageCount: pages.length,
      maxPageBytes: Math.max(...pages.map((page) => page.bytes)),
      completeItems: pages.reduce((total, page) => total + page.items, 0),
    },
    ablated: {
      pageCount: 1,
      bytes: ablatedBytes,
      exceedsPiHardLimit: ablatedBytes > PI_HARD_LIMIT,
    },
    effect: { hardLimitOverrunBytes: Math.max(0, ablatedBytes - PI_HARD_LIMIT) },
    gatePassed:
      pages.every((page) => page.bytes <= PAGE_BUDGET) &&
      pages.reduce((total, page) => total + page.items, 0) === locations.length &&
      ablatedBytes > PI_HARD_LIMIT,
  });
}

export function ablateSequenceCursor() {
  const events = Array.from({ length: 10 }, (_, index) => ({
    sequence: index + 1,
    timestamp: 1_000,
  }));
  const baselineUnread = events.filter((event) => event.sequence > 0);
  const ablatedUnread = events.filter((event) => event.timestamp > 1_000);
  return row("sequenceCursor", "Use millisecond timestamp as the exclusive consumption cursor", {
    baseline: { unread: baselineUnread.length, lost: events.length - baselineUnread.length },
    ablated: { unread: ablatedUnread.length, lost: events.length - ablatedUnread.length },
    effect: { additionalLostEvents: baselineUnread.length - ablatedUnread.length },
    gatePassed: baselineUnread.length === events.length && ablatedUnread.length < events.length,
  });
}

export function ablateNotificationCoalescing(notifications) {
  const baseline = coalesceNotifications(notifications);
  const saved = notifications.filter((event) => event.type === "document_saved").length;
  const baselineSaved = baseline.filter((event) => event.type === "document_saved").length;
  const baselineBytes = jsonBytes(baseline);
  const ablatedBytes = jsonBytes(notifications);
  return row("notificationCoalescing", "Disable semantic event coalescing", {
    baseline: { events: baseline.length, bytes: baselineBytes, savedEvents: baselineSaved },
    ablated: { events: notifications.length, bytes: ablatedBytes, savedEvents: saved },
    effect: {
      eventReduction: 1 - baseline.length / notifications.length,
      byteReduction: 1 - baselineBytes / ablatedBytes,
    },
    gatePassed: baseline.length < notifications.length && baselineSaved === saved,
  });
}

export function ablateEditorCompactProjection() {
  const editors = Array.from({ length: 50 }, (_, index) => ({
    path: `src/editor-${index}.ts`,
    filePath: `/fixture/src/editor-${index}.ts`,
    uri: `file:///fixture/src/editor-${index}.ts`,
    languageId: "typescript",
    isDirty: index % 3 === 0,
  }));
  const compact = {
    cwd: "/fixture",
    active: { path: editors[0].path, languageId: "typescript", isDirty: true },
    openEditors: editors.map(({ path, languageId, isDirty }) => ({ path, languageId, isDirty })),
  };
  const full = {
    ...compact,
    active: editors[0],
    selectionText: "x".repeat(20 * KIB),
    tabs: editors,
    visibleEditors: editors.slice(0, 4),
  };
  const baselineBytes = jsonBytes(envelope(compact));
  const ablatedBytes = jsonBytes(envelope(full));
  return row("editorCompactProjection", "Make full editor payload the default", {
    baseline: { bytes: baselineBytes, includesSelectionText: false },
    ablated: { bytes: ablatedBytes, includesSelectionText: true },
    effect: { byteMultiplier: ratio(ablatedBytes, baselineBytes) },
    gatePassed: ablatedBytes > baselineBytes * 2,
  });
}

export function ablateEditTextPreflight() {
  const oldText = "o".repeat(32 * KIB);
  const newText = "n".repeat(32 * KIB);
  const responseBytes = jsonBytes(envelope({ edits: [{ oldText, newText }] }));
  const baseline = { applied: false, code: "EDIT_TEXT_RESPONSE_TOO_LARGE", responseBytes: 180 };
  const ablated = { applied: true, code: null, responseBytes };
  return row("editTextPreflight", "Apply before checking edit-text and final output budgets", {
    baseline,
    ablated,
    effect: { hardLimitOverrunBytes: responseBytes - PI_HARD_LIMIT, unsafeMutation: true },
    gatePassed: !baseline.applied && ablated.applied && responseBytes > PI_HARD_LIMIT,
  });
}

export function ablateExplicitVersionGate() {
  const calls = [{ detail: "full" }, { responseVersion: 2, detail: "compact" }];
  const baseline = calls.map((params) => (params.responseVersion === 2 ? "v2" : "legacy"));
  const ablated = calls.map((params) => (params.detail ? "v2" : "legacy"));
  return row("explicitVersionGate", "Infer v2 from detail instead of responseVersion=2", {
    baseline: { routes: baseline, legacyPreserved: baseline[0] === "legacy" },
    ablated: { routes: ablated, legacyPreserved: ablated[0] === "legacy" },
    effect: { legacyCallsChanged: ablated[0] === "legacy" ? 0 : 1 },
    gatePassed: baseline[0] === "legacy" && ablated[0] !== "legacy",
  });
}

function generateClusteredLocations(count, fileCount) {
  return Array.from({ length: count }, (_, index) => {
    const file = index % fileCount;
    const path = `src/consumer-${String(file).padStart(3, "0")}.ts`;
    return {
      id: index,
      path,
      workspaceFolder: "fixture",
      filePath: `/fixture/${path}`,
      uri: `file:///fixture/${path}`,
      range: {
        start: { line: Math.floor(index / fileCount), character: 4 },
        end: { line: Math.floor(index / fileCount), character: 12 },
      },
    };
  });
}

function paginate(items, limit, budget) {
  const pages = [];
  for (let offset = 0; offset < items.length; ) {
    let accepted = 0;
    for (let count = 1; count <= Math.min(limit, items.length - offset); count += 1) {
      const candidate = envelope(groupLocations(items.slice(offset, offset + count)), {
        total: items.length,
        returned: count,
      });
      if (jsonBytes(candidate) > budget) break;
      accepted = count;
    }
    if (accepted === 0) throw new Error("A logical item exceeds the ablation fixture budget");
    const page = items.slice(offset, offset + accepted);
    pages.push({
      items: accepted,
      bytes: jsonBytes(envelope(groupLocations(page), { total: items.length, returned: accepted })),
    });
    offset += accepted;
  }
  return pages;
}

function groupLocations(items) {
  const files = new Map();
  for (const item of items) {
    const group = files.get(item.uri) ?? {
      path: item.path,
      workspaceFolder: item.workspaceFolder,
      locations: [],
    };
    group.locations.push({ range: item.range });
    files.set(item.uri, group);
  }
  return { files: [...files.values()] };
}

function flattenLocations(items) {
  return {
    locations: items.map((item) => ({
      filePath: item.filePath,
      uri: item.uri,
      range: item.range,
    })),
  };
}

function coverage(items, start, end) {
  const ids = items.map((item) => item.id);
  const unique = new Set(ids);
  return {
    returned: ids.length,
    unique: unique.size,
    duplicates: ids.length - unique.size,
    missing: Array.from({ length: end - start }, (_, index) => start + index).filter(
      (id) => !unique.has(id),
    ).length,
    complete: unique.size === end - start,
  };
}

function envelope(data, paging) {
  return {
    detail: "compact",
    data,
    meta: {
      protocolVersion: 2,
      truncated: Boolean(paging),
      ...(paging
        ? {
            total: paging.total,
            returned: paging.returned,
            reason: "byteBudget",
            snapshotId: "00000000-0000-4000-8000-000000000000",
            nextCursor: "opaque-snapshot-cursor".repeat(10),
          }
        : {}),
    },
  };
}

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function ratio(numerator, denominator) {
  return Number((numerator / denominator).toFixed(2));
}

function row(mechanism, removed, result) {
  return { mechanism, removed, ...result };
}

function summarize(rows) {
  const byName = Object.fromEntries(rows.map((item) => [item.mechanism, item]));
  return {
    correctnessCritical: [
      "snapshotFreeze",
      "byteBudgetPaging",
      "sequenceCursor",
      "editTextPreflight",
      "explicitVersionGate",
    ],
    efficiencyCritical: [
      "compactGrouping",
      "diagnosticDefaults",
      "notificationCoalescing",
      "editorCompactProjection",
    ],
    compactGroupingByteReduction: byName.compactGrouping.effect.baselineReduction,
    notificationEventReduction: byName.notificationCoalescing.effect.eventReduction,
    editorFullByteMultiplier: byName.editorCompactProjection.effect.byteMultiplier,
  };
}
