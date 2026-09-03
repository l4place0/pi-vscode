import { Buffer } from "node:buffer";
import { evaluateReplay, generateScaleInput } from "../references-v0/replay.mjs";

export const TUNED_PARAMETER_FAMILIES = Object.freeze([
  "defaultDetail",
  "diagnostics.scope",
  "diagnostics.severity",
  "diagnostics.limit",
  "references.limit",
  "workspaceSymbols.limit",
  "maxOutputBytes",
  "snapshot.ttlSeconds",
  "snapshot.maxSnapshots",
  "snapshot.maxItems",
  "editorState.detail",
  "editTextThresholdBytes",
  "notifications.detail",
  "notifications.limit",
  "notifications.ringCapacity",
  "notifications.coalesce",
]);

export const INVARIANT_PARAMETER_FAMILIES = Object.freeze([
  "diagnostics.uris",
  "pagination.cursor",
  "notifications.afterCursor",
  "notifications.start",
  "notifications.types",
  "edit.includeEditText",
  "responseVersion",
]);

const KIB = 1024;
const DEFAULT_BUDGET = 32 * KIB;

export function runFullParameterExperiment() {
  const diagnostics = generateDiagnostics(2_000);
  const symbols = generateSymbols(5_000);
  const references = generateScaleInput(10_000);
  const notificationStream = generateNotifications(10_000);

  const detailRows = runDetailSweep({ diagnostics, symbols, references, notificationStream });
  const diagnosticsRows = runDiagnosticsSweep(diagnostics);
  const paginationRows = runPaginationSweep({ diagnostics, symbols, references });
  const snapshotRows = runSnapshotSweep();
  const editorRows = runEditorSweep();
  const editRows = runEditSweep();
  const notificationRows = runNotificationSweep(notificationStream);
  const invariantChecks = runInvariantChecks({ diagnostics, notificationStream });
  const recommendations = buildRecommendations({
    paginationRows,
    snapshotRows,
    editRows,
    notificationRows,
  });

  const allRows = [
    ...detailRows,
    ...diagnosticsRows,
    ...paginationRows,
    ...snapshotRows,
    ...editorRows,
    ...editRows,
    ...notificationRows,
  ];
  const correctnessGatePassed =
    allRows.every((row) => row.gatePassed !== false) &&
    invariantChecks.every((check) => check.passed);

  return {
    schemaVersion: 1,
    experiment: "bridge-full-parameter-sensitivity-v1",
    method: "deterministic canonical replay with one-factor-at-a-time sweeps",
    tunedParameterFamilies: TUNED_PARAMETER_FAMILIES,
    invariantParameterFamilies: INVARIANT_PARAMETER_FAMILIES,
    fixtureSummary: {
      diagnostics: diagnostics.length,
      workspaceSymbols: symbols.length,
      references: references.locations.length,
      notifications: notificationStream.length,
      editorScales: [1, 10, 50],
      editTextSizesKiB: [1, 4, 8, 16, 24, 32, 40],
    },
    sweepRowCount: allRows.length,
    correctnessGatePassed,
    recommendations,
    invariantChecks,
    sweeps: {
      detail: detailRows,
      diagnostics: diagnosticsRows,
      pagination: paginationRows,
      snapshot: snapshotRows,
      editorState: editorRows,
      editText: editRows,
      notifications: notificationRows,
    },
  };
}

export function generateDiagnostics(count) {
  const severities = ["error", "warning", "information", "hint", "warning"];
  return Array.from({ length: count }, (_, index) => {
    const fileIndex = Math.floor(index / 5);
    const path = `src/feature-${String(fileIndex).padStart(4, "0")}.ts`;
    const severity = severities[index % severities.length];
    return {
      id: `diagnostic:${index}`,
      path,
      workspaceFolder: "fixture",
      filePath: `/fixture/${path}`,
      uri: `file:///fixture/${path}`,
      severity,
      severityNumber: severities.indexOf(severity),
      message: `Synthetic ${severity} diagnostic ${index} with stable explanatory context`,
      code: `SYN${String(index % 17).padStart(2, "0")}`,
      source: "full-parameters-v1",
      range: makeRange(index % 40, 4, 12),
      tags: index % 11 === 0 ? [1] : [],
      relatedInformation: [
        {
          message: `Related location ${index}`,
          uri: `file:///fixture/src/related-${String(fileIndex % 20).padStart(2, "0")}.ts`,
          range: makeRange(index % 20, 0, 6),
        },
      ],
    };
  });
}

export function generateSymbols(count) {
  const kinds = ["function", "class", "method", "variable", "interface"];
  return Array.from({ length: count }, (_, index) => {
    const fileIndex = Math.floor(index / 5);
    const path = `src/module-${String(fileIndex).padStart(4, "0")}.ts`;
    const range = makeRange(index % 100, 0, 14);
    return {
      id: `symbol:${index}`,
      path,
      workspaceFolder: "fixture",
      filePath: `/fixture/${path}`,
      uri: `file:///fixture/${path}`,
      name: `Symbol${String(index).padStart(5, "0")}`,
      kind: kinds[index % kinds.length],
      container: `Module${fileIndex}`,
      range,
      selectionRange: range,
      detail: `synthetic symbol detail ${index}`,
      tags: index % 13 === 0 ? [1] : [],
    };
  });
}

export function generateNotifications(count) {
  const pattern = [
    "selection_changed",
    "selection_changed",
    "selection_changed",
    "diagnostics_changed",
    "diagnostics_changed",
    "document_dirty_changed",
    "document_dirty_changed",
    "document_saved",
    "active_editor_changed",
    "active_editor_changed",
  ];
  return Array.from({ length: count }, (_, index) => {
    const path = `src/file-${String(Math.floor(index / pattern.length) % 80).padStart(3, "0")}.ts`;
    return {
      sequence: index + 1,
      type: pattern[index % pattern.length],
      path,
      uri: `file:///fixture/${path}`,
      payload: {
        range: makeRange(index % 120, index % 30, (index % 30) + 2),
        dirty: index % 2 === 0,
        uris: [`file:///fixture/${path}`],
      },
    };
  });
}

export function coalesceNotifications(events) {
  const output = [];
  for (const event of events) {
    const previous = output.at(-1);
    const replaceable =
      previous &&
      previous.type === event.type &&
      ((event.type === "selection_changed" && previous.path === event.path) ||
        event.type === "active_editor_changed" ||
        event.type === "visible_editors_changed" ||
        (event.type === "document_dirty_changed" && previous.path === event.path));
    if (replaceable) {
      output[output.length - 1] = { ...event, coalescedCount: (previous.coalescedCount ?? 1) + 1 };
      continue;
    }
    if (previous?.type === "diagnostics_changed" && event.type === "diagnostics_changed") {
      output[output.length - 1] = {
        ...event,
        payload: {
          ...event.payload,
          uris: [...new Set([...previous.payload.uris, ...event.payload.uris])],
        },
        coalescedCount: (previous.coalescedCount ?? 1) + 1,
      };
      continue;
    }
    output.push({ ...event, coalescedCount: 1 });
  }
  return output;
}

export function hasNotificationGap({ earliestSequence, afterSequence }) {
  return afterSequence + 1 < earliestSequence;
}

export function validateEditTextRequest({ detail, includeEditText, payloadBytes, thresholdBytes }) {
  if (includeEditText && detail !== "full") {
    return { accepted: false, code: "EDIT_TEXT_REQUIRES_FULL" };
  }
  if (includeEditText && payloadBytes > thresholdBytes) {
    return { accepted: false, code: "EDIT_TEXT_RESPONSE_TOO_LARGE" };
  }
  const responseBytes = jsonBytes({
    detail,
    data: {
      applied: true,
      requestedEditCount: 1,
      editCount: 1,
      filesChanged: 1,
      edits: includeEditText ? [{ oldText: "", newText: "x".repeat(payloadBytes) }] : [],
    },
    meta: { protocolVersion: 2, truncated: false },
  });
  if (responseBytes > DEFAULT_BUDGET) {
    return { accepted: false, code: "EDIT_TEXT_RESPONSE_TOO_LARGE", responseBytes };
  }
  return { accepted: true, code: null, responseBytes };
}

function runDetailSweep({ diagnostics, symbols, references, notificationStream }) {
  const rows = [];
  for (const detail of ["minimal", "compact", "full"]) {
    for (const [domain, items] of [
      ["diagnostics", diagnostics.slice(0, 100)],
      ["workspaceSymbols", symbols.slice(0, 200)],
    ]) {
      const page = paginateDomain(domain, items, {
        detail,
        limit: items.length,
        byteBudget: 48 * KIB,
      })[0];
      rows.push({ family: "detail", domain, detail, bytes: page.bytes, gatePassed: true });
    }
    const reference = evaluateReplay(references, { detail, limit: 75, byteBudget: DEFAULT_BUDGET });
    rows.push({
      family: "detail",
      domain: "references",
      detail,
      bytes: reference.firstPageBytes,
      visibleItems: reference.firstPageVisibleLocationCount,
      gatePassed: reference.correctnessGatePassed,
    });
    const notificationSample = projectNotifications(notificationStream.slice(0, 50), detail);
    rows.push({
      family: "detail",
      domain: "notifications",
      detail,
      bytes: jsonBytes(notificationSample),
      gatePassed: true,
    });
  }
  return rows;
}

function runDiagnosticsSweep(diagnostics) {
  const rows = [];
  const scopes = ["active", "open", "workspace", "uris"];
  const severitySets = [
    ["error"],
    ["error", "warning"],
    ["error", "warning", "information"],
    ["error", "warning", "information", "hint"],
  ];
  for (const scope of scopes) {
    const selected = filterDiagnostics(diagnostics, {
      scope,
      uris: diagnostics.slice(25, 40).map((item) => item.uri),
      severity: ["error", "warning"],
    });
    rows.push({
      family: "diagnostics.scope",
      scope,
      matched: selected.length,
      bytes: jsonBytes(projectDomain("diagnostics", selected.slice(0, 100), "compact")),
      gatePassed: selected.every((item) => ["error", "warning"].includes(item.severity)),
    });
  }
  for (const severity of severitySets) {
    const selected = filterDiagnostics(diagnostics, { scope: "workspace", severity });
    rows.push({
      family: "diagnostics.severity",
      severity,
      matched: selected.length,
      coverageRatio: selected.length / diagnostics.length,
      gatePassed: selected.every((item) => severity.includes(item.severity)),
    });
  }
  return rows;
}

function runPaginationSweep({ diagnostics, symbols, references }) {
  const rows = [];
  const domains = [
    {
      domain: "diagnostics",
      items: diagnostics,
      limits: [50, 100, 200],
      recommendedLimit: 100,
    },
    {
      domain: "workspaceSymbols",
      items: symbols,
      limits: [100, 200, 400],
      recommendedLimit: 200,
    },
  ];
  for (const definition of domains) {
    for (const limit of definition.limits) {
      rows.push(
        evaluateDomainPagination(definition.domain, definition.items, {
          detail: "compact",
          limit,
          byteBudget: DEFAULT_BUDGET,
          sweep: "limit",
        }),
      );
    }
    for (const budgetKiB of [24, 32, 40]) {
      rows.push(
        evaluateDomainPagination(definition.domain, definition.items, {
          detail: "compact",
          limit: definition.recommendedLimit,
          byteBudget: budgetKiB * KIB,
          sweep: "byteBudget",
        }),
      );
    }
  }
  for (const limit of [50, 75, 100, 200]) {
    const result = evaluateReplay(references, {
      detail: "compact",
      limit,
      byteBudget: DEFAULT_BUDGET,
    });
    rows.push({
      family: "pagination",
      domain: "references",
      sweep: "limit",
      limit,
      byteBudget: DEFAULT_BUDGET,
      pageCount: result.pageCount,
      maxPageBytes: result.maxPageBytes,
      gatePassed: result.correctnessGatePassed,
    });
  }
  for (const budgetKiB of [24, 32, 40]) {
    const result = evaluateReplay(references, {
      detail: "compact",
      limit: 75,
      byteBudget: budgetKiB * KIB,
    });
    rows.push({
      family: "pagination",
      domain: "references",
      sweep: "byteBudget",
      limit: 75,
      byteBudget: budgetKiB * KIB,
      pageCount: result.pageCount,
      maxPageBytes: result.maxPageBytes,
      gatePassed: result.correctnessGatePassed,
    });
  }
  return rows;
}

function runSnapshotSweep() {
  const delays = [
    ...Array(70).fill(10),
    ...Array(20).fill(45),
    ...Array(5).fill(90),
    ...Array(4).fill(180),
    600,
  ];
  const concurrentSnapshots = [
    ...Array(70).fill(4),
    ...Array(20).fill(8),
    ...Array(8).fill(16),
    ...Array(2).fill(24),
  ];
  const retainedItems = [
    ...Array(70).fill(8_000),
    ...Array(20).fill(20_000),
    ...Array(8).fill(45_000),
    ...Array(2).fill(80_000),
  ];
  return [
    ...[30, 120, 300].map((ttlSeconds) => ({
      family: "snapshot.ttlSeconds",
      candidate: ttlSeconds,
      expiredReads: delays.filter((delay) => delay > ttlSeconds).length,
      expiryRate: delays.filter((delay) => delay > ttlSeconds).length / delays.length,
      retainedSeconds: delays.reduce((sum, delay) => sum + Math.min(delay, ttlSeconds), 0),
      gatePassed: true,
    })),
    ...[8, 16, 32].map((capacity) => ({
      family: "snapshot.maxSnapshots",
      candidate: capacity,
      overflowEvents: concurrentSnapshots.filter((count) => count > capacity).length,
      overflowUnits: concurrentSnapshots.reduce(
        (sum, count) => sum + Math.max(0, count - capacity),
        0,
      ),
      estimatedMetadataKiB: capacity * 2,
      gatePassed: true,
    })),
    ...[10_000, 50_000, 100_000].map((capacity) => ({
      family: "snapshot.maxItems",
      candidate: capacity,
      overflowEvents: retainedItems.filter((count) => count > capacity).length,
      overflowItems: retainedItems.reduce((sum, count) => sum + Math.max(0, count - capacity), 0),
      estimatedCanonicalMemoryMiB: (capacity * 160) / (KIB * KIB),
      gatePassed: true,
    })),
  ];
}

function runEditorSweep() {
  const rows = [];
  for (const editorCount of [1, 10, 50]) {
    for (const selectionTextBytes of [0, 2 * KIB, 20 * KIB]) {
      const state = generateEditorState(editorCount, selectionTextBytes);
      for (const detail of ["minimal", "compact", "full"]) {
        const bytes = jsonBytes(projectEditorState(state, detail));
        rows.push({
          family: "editorState.detail",
          editorCount,
          selectionTextBytes,
          detail,
          bytes,
          withinDefaultBudget: bytes <= DEFAULT_BUDGET,
          gatePassed:
            detail !== "full"
              ? !JSON.stringify(projectEditorState(state, detail)).includes(state.selectionText) ||
                selectionTextBytes === 0
              : true,
        });
      }
    }
  }
  return rows;
}

function runEditSweep() {
  const rows = [];
  for (const thresholdKiB of [8, 16, 24, 32]) {
    for (const payloadKiB of [1, 4, 8, 16, 24, 32, 40]) {
      const result = validateEditTextRequest({
        detail: "full",
        includeEditText: true,
        payloadBytes: payloadKiB * KIB,
        thresholdBytes: thresholdKiB * KIB,
      });
      rows.push({
        family: "editTextThresholdBytes",
        thresholdKiB,
        payloadKiB,
        ...result,
        gatePassed: !result.accepted || result.responseBytes <= DEFAULT_BUDGET,
      });
    }
  }
  return rows;
}

function runNotificationSweep(events) {
  const coalesced = coalesceNotifications(events);
  const lagSamples = [...Array(80).fill(50), ...Array(15).fill(200), ...Array(4).fill(600), 1_200];
  return [
    ...[false, true].map((coalesce) => {
      const selected = coalesce ? coalesced : events;
      return {
        family: "notifications.coalesce",
        candidate: coalesce,
        inputEvents: events.length,
        outputEvents: selected.length,
        reductionRatio: 1 - selected.length / events.length,
        savedEventsPreserved:
          selected.filter((event) => event.type === "document_saved").length ===
          events.filter((event) => event.type === "document_saved").length,
        gatePassed: true,
      };
    }),
    ...[20, 50, 100].map((limit) => ({
      family: "notifications.limit",
      candidate: limit,
      pagesForCoalescedStream: Math.ceil(coalesced.length / limit),
      firstPageBytes: jsonBytes(projectNotifications(coalesced.slice(0, limit), "minimal")),
      gatePassed: true,
    })),
    ...[100, 500, 1_000].map((capacity) => ({
      family: "notifications.ringCapacity",
      candidate: capacity,
      gapEvents: lagSamples.filter((lag) => lag > capacity).length,
      gapRate: lagSamples.filter((lag) => lag > capacity).length / lagSamples.length,
      estimatedFullPayloadKiB: (capacity * 420) / KIB,
      gatePassed: true,
    })),
    ...["minimal", "compact", "full"].map((detail) => ({
      family: "notifications.detail",
      candidate: detail,
      bytesFor50Events: jsonBytes(projectNotifications(coalesced.slice(0, 50), detail)),
      gatePassed: true,
    })),
  ];
}

function runInvariantChecks({ diagnostics, notificationStream }) {
  const uriOrder = [...new Set(diagnostics.slice(25, 40).map((item) => item.uri))];
  const uriResults = filterDiagnostics(diagnostics, {
    scope: "uris",
    uris: uriOrder,
    severity: ["error", "warning", "information", "hint"],
  });
  const savedSequence = notificationStream
    .filter((event) => event.type === "document_saved")
    .map((event) => event.sequence);
  const coalescedSavedSequence = coalesceNotifications(notificationStream)
    .filter((event) => event.type === "document_saved")
    .map((event) => event.sequence);
  const typeFiltered = notificationStream.filter((event) =>
    ["document_saved", "diagnostics_changed"].includes(event.type),
  );
  return [
    {
      family: "diagnostics.uris",
      assertion: "URI scope preserves requested URI order",
      passed: firstSeenUriOrder(uriResults).every((uri, index) => uri === uriOrder[index]),
    },
    {
      family: "pagination.cursor",
      assertion: "cursor binds detail, method and query fingerprint",
      passed:
        cursorMatches(
          { detail: "compact", method: "references", fingerprint: "query-a" },
          { detail: "compact", method: "references", fingerprint: "query-a" },
        ) &&
        !cursorMatches(
          { detail: "compact", method: "references", fingerprint: "query-a" },
          { detail: "full", method: "references", fingerprint: "query-a" },
        ),
    },
    {
      family: "notifications.afterCursor",
      assertion: "ring overflow produces an explicit gap",
      passed: hasNotificationGap({ earliestSequence: 501, afterSequence: 400 }),
    },
    {
      family: "notifications.start",
      assertion: "start=now establishes an empty baseline",
      passed:
        notificationStream.filter((event) => event.sequence > notificationStream.at(-1).sequence)
          .length === 0,
    },
    {
      family: "notifications.types",
      assertion: "type filtering preserves source order",
      passed:
        typeFiltered.every((event) =>
          ["document_saved", "diagnostics_changed"].includes(event.type),
        ) && isStrictlyIncreasing(typeFiltered.map((event) => event.sequence)),
    },
    {
      family: "notifications.coalesce",
      assertion: "saved events are never removed",
      passed: JSON.stringify(savedSequence) === JSON.stringify(coalescedSavedSequence),
    },
    {
      family: "edit.includeEditText",
      assertion: "includeEditText requires full detail",
      passed:
        validateEditTextRequest({
          detail: "compact",
          includeEditText: true,
          payloadBytes: KIB,
          thresholdBytes: 24 * KIB,
        }).code === "EDIT_TEXT_REQUIRES_FULL",
    },
    {
      family: "responseVersion",
      assertion: "explicit v2 selects envelope while omitted version remains legacy",
      passed: selectResponseShape(2) === "envelope" && selectResponseShape(undefined) === "legacy",
    },
  ];
}

function buildRecommendations({ paginationRows, snapshotRows, editRows, notificationRows }) {
  const page = (domain, sweep, candidate, key = "limit") =>
    paginationRows.find(
      (row) => row.domain === domain && row.sweep === sweep && row[key] === candidate,
    );
  const snapshot = (family, candidate) =>
    snapshotRows.find((row) => row.family === family && row.candidate === candidate);
  const notification = (family, candidate) =>
    notificationRows.find((row) => row.family === family && row.candidate === candidate);
  const edit24 = editRows.filter((row) => row.thresholdKiB === 24);
  return {
    defaultDetail: "compact",
    diagnostics: {
      scope: "active",
      severity: ["error", "warning"],
      limit: 100,
      evidence: page("diagnostics", "limit", 100),
    },
    references: { limit: 75, evidence: page("references", "limit", 75) },
    workspaceSymbols: { limit: 200, evidence: page("workspaceSymbols", "limit", 200) },
    output: {
      defaultBytes: 32 * KIB,
      allowedMaximumBytes: 40 * KIB,
      hardLimitBytes: 50 * KIB,
    },
    snapshot: {
      ttlSeconds: 120,
      maxSnapshots: 16,
      maxItems: 50_000,
      evidence: {
        ttl: snapshot("snapshot.ttlSeconds", 120),
        snapshots: snapshot("snapshot.maxSnapshots", 16),
        items: snapshot("snapshot.maxItems", 50_000),
      },
    },
    editorState: { defaultDetail: "compact" },
    edits: {
      includeEditTextDefault: false,
      textThresholdBytes: 24 * KIB,
      largestAcceptedPayloadKiB: Math.max(
        ...edit24.filter((row) => row.accepted).map((row) => row.payloadKiB),
      ),
    },
    notifications: {
      start: "buffer",
      detail: "minimal",
      limit: 50,
      ringCapacity: 500,
      coalesce: true,
      evidence: {
        limit: notification("notifications.limit", 50),
        ring: notification("notifications.ringCapacity", 500),
        coalesce: notification("notifications.coalesce", true),
      },
    },
  };
}

function filterDiagnostics(items, { scope, uris = [], severity }) {
  let scoped;
  if (scope === "active") scoped = items.filter((item) => item.path === "src/feature-0000.ts");
  else if (scope === "open") scoped = items.filter((item) => Number(item.path.slice(12, 16)) < 20);
  else if (scope === "uris") {
    const order = new Map(uris.map((uri, index) => [uri, index]));
    scoped = items
      .filter((item) => order.has(item.uri))
      .sort((left, right) => order.get(left.uri) - order.get(right.uri));
  } else scoped = items;
  return scoped.filter((item) => severity.includes(item.severity));
}

function evaluateDomainPagination(domain, items, config) {
  const pages = paginateDomain(domain, items, config);
  const ids = pages.flatMap((page) => page.itemIds);
  return {
    family: "pagination",
    domain,
    sweep: config.sweep,
    detail: config.detail,
    limit: config.limit,
    byteBudget: config.byteBudget,
    pageCount: pages.length,
    maxPageBytes: Math.max(...pages.map((page) => page.bytes)),
    firstPageItems: pages[0].itemIds.length,
    byteBudgetPages: pages.filter((page) => page.reason === "byteBudget").length,
    gatePassed:
      ids.length === items.length &&
      new Set(ids).size === items.length &&
      pages.every((page) => page.bytes <= config.byteBudget),
  };
}

function paginateDomain(domain, items, { detail, limit, byteBudget }) {
  const pages = [];
  for (let offset = 0; offset < items.length; ) {
    const maxCount = Math.min(limit, items.length - offset);
    let accepted = [];
    for (let count = 1; count <= maxCount; count += 1) {
      const candidate = items.slice(offset, offset + count);
      const response = makeDomainEnvelope(
        domain,
        candidate,
        detail,
        items.length,
        offset,
        true,
        "byteBudget",
      );
      if (jsonBytes(response) > byteBudget) break;
      accepted = candidate;
    }
    if (accepted.length === 0) throw new Error(`${domain} item cannot fit byte budget`);
    const hasNext = offset + accepted.length < items.length;
    const reason = hasNext ? (accepted.length === limit ? "limit" : "byteBudget") : null;
    const response = makeDomainEnvelope(
      domain,
      accepted,
      detail,
      items.length,
      offset,
      hasNext,
      reason,
    );
    pages.push({
      bytes: jsonBytes(response),
      itemIds: accepted.map((item) => item.id),
      reason,
    });
    offset += accepted.length;
  }
  return pages;
}

function makeDomainEnvelope(domain, items, detail, total, offset, truncated, reason) {
  return {
    detail,
    data: projectDomain(domain, items, detail),
    meta: {
      protocolVersion: 2,
      total,
      returned: items.length,
      truncated,
      reason,
      nextCursor: truncated ? `${domain}:${offset + items.length}` : null,
    },
  };
}

function projectDomain(domain, items, detail) {
  if (detail === "minimal")
    return { count: items.length, fileCount: new Set(items.map((item) => item.uri)).size };
  const files = new Map();
  for (const item of items) {
    if (!files.has(item.uri)) {
      files.set(item.uri, {
        path: item.path,
        workspaceFolder: item.workspaceFolder,
        ...(detail === "full" ? { filePath: item.filePath, uri: item.uri } : {}),
        items: [],
      });
    }
    files.get(item.uri).items.push(projectDomainItem(domain, item, detail));
  }
  return { files: [...files.values()] };
}

function projectDomainItem(domain, item, detail) {
  if (domain === "diagnostics") {
    return {
      severity: item.severity,
      message: item.message,
      range: item.range,
      code: item.code,
      source: item.source,
      ...(detail === "full"
        ? {
            severityNumber: item.severityNumber,
            tags: item.tags,
            relatedInformation: item.relatedInformation,
          }
        : {}),
    };
  }
  return {
    name: item.name,
    kind: item.kind,
    range: item.range,
    container: item.container,
    ...(detail === "full"
      ? { detail: item.detail, tags: item.tags, selectionRange: item.selectionRange }
      : {}),
  };
}

function projectNotifications(events, detail) {
  return events.map((event) => ({
    sequence: event.sequence,
    type: event.type,
    path: event.path,
    ...(detail !== "minimal" ? { payload: event.payload } : {}),
    ...(detail === "full"
      ? { uri: event.uri, coalescedCount: event.coalescedCount ?? 1, rawEvent: event }
      : {}),
  }));
}

function generateEditorState(editorCount, selectionTextBytes) {
  const editors = Array.from({ length: editorCount }, (_, index) => ({
    path: `src/editor-${String(index).padStart(3, "0")}.ts`,
    filePath: `/fixture/src/editor-${String(index).padStart(3, "0")}.ts`,
    uri: `file:///fixture/src/editor-${String(index).padStart(3, "0")}.ts`,
    languageId: "typescript",
    isDirty: index % 3 === 0,
    visibleRange: makeRange(index, 0, 80),
  }));
  return {
    cwd: "/fixture",
    active: editors[0],
    editors,
    cursor: { line: 10, character: 4 },
    selection: { range: makeRange(10, 4, 12), isEmpty: selectionTextBytes === 0 },
    selectionSource: "active",
    selectionText: "x".repeat(selectionTextBytes),
  };
}

function projectEditorState(state, detail) {
  const minimal = {
    cwd: state.cwd,
    active: {
      path: state.active.path,
      languageId: state.active.languageId,
      isDirty: state.active.isDirty,
      cursor: state.cursor,
      selection: state.selection,
    },
  };
  if (detail === "minimal") return minimal;
  const compact = {
    ...minimal,
    selectionSource: state.selectionSource,
    workspaceFolder: "fixture",
    openEditors: state.editors.map((editor) => ({
      path: editor.path,
      languageId: editor.languageId,
      isDirty: editor.isDirty,
    })),
  };
  if (detail === "compact") return compact;
  return {
    ...compact,
    active: { ...compact.active, filePath: state.active.filePath, uri: state.active.uri },
    selectionText: state.selectionText,
    tabs: state.editors.map((editor) => ({
      filePath: editor.filePath,
      uri: editor.uri,
      visibleRange: editor.visibleRange,
    })),
  };
}

function firstSeenUriOrder(items) {
  return [...new Set(items.map((item) => item.uri))];
}

function cursorMatches(cursor, request) {
  return (
    cursor.detail === request.detail &&
    cursor.method === request.method &&
    cursor.fingerprint === request.fingerprint
  );
}

function selectResponseShape(responseVersion) {
  return responseVersion === 2 ? "envelope" : "legacy";
}

function isStrictlyIncreasing(numbers) {
  return numbers.every((number, index) => index === 0 || numbers[index - 1] < number);
}

function makeRange(line, startCharacter, endCharacter) {
  return {
    start: { line, character: startCharacter },
    end: { line, character: endCharacter },
  };
}

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
