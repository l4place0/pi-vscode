import { Buffer } from "node:buffer";

export const BASELINE = Object.freeze({ detail: "compact", limit: 50, byteBudget: 32 * 1024 });

export const EXPERIMENT_PROFILES = Object.freeze({
  v0: Object.freeze({
    id: "v0",
    generatedSizes: [100, 500],
    limits: [20, 50, 100],
    budgetsKiB: [16, 32, 64],
    repetitions: 3,
    jsonFile: "experiment-results-v0.json",
    markdownFile: "result.md",
  }),
  "v0.1": Object.freeze({
    id: "v0.1",
    generatedSizes: [100, 500, 1_000, 10_000],
    limits: [20, 50, 75, 100],
    budgetsKiB: [16, 24, 32, 40, 64],
    repetitions: 5,
    jsonFile: "experiment-results-v0.1.json",
    markdownFile: "result-v0.1.md",
  }),
});

export function buildConfigurations(profile = EXPERIMENT_PROFILES.v0) {
  const candidates = [
    ...["minimal", "compact", "full"].map((detail) => ({ ...BASELINE, detail })),
    ...profile.limits.map((limit) => ({ ...BASELINE, limit })),
    ...profile.budgetsKiB.map((kib) => ({
      ...BASELINE,
      limit: 100,
      byteBudget: kib * 1024,
    })),
  ];
  const unique = new Map(candidates.map((config) => [configurationId(config), config]));
  return [...unique.values()];
}

export function configurationId(config) {
  return `${config.detail}-l${config.limit}-b${config.byteBudget / 1024}k`;
}

export function buildInputs(fixtureDocument, profile = EXPERIMENT_PROFILES.v0) {
  const selected = fixtureDocument.cases.map((fixtureCase) => ({
    id: fixtureCase.id,
    kind: "usagebench",
    coverage: fixtureCase.coverage,
    sourceFile: fixtureCase.sourceFile,
    locations: fixtureCase.expectedUsages.map((usage, index) =>
      makeCanonicalLocation({
        id: `${fixtureCase.id}:${index}`,
        uri: usage.uri,
        range: usage.range,
        originSelectionRange: fixtureCase.declaration.range,
        workspaceFolder: "usagebench",
      }),
    ),
  }));

  return [...selected, ...profile.generatedSizes.map((size) => generateScaleInput(size))];
}

export function generateScaleInput(size) {
  const locations = Array.from({ length: size }, (_, index) => {
    const ordinal = String(index + 1).padStart(4, "0");
    const path = `src/generated/reference-consumer-${ordinal}-with-a-descriptive-name.ts`;
    return makeCanonicalLocation({
      id: `scale-${size}:${ordinal}`,
      uri: `file:///workspace/scale-${size}/${path}`,
      range: {
        start: { line: 2, character: 20 },
        end: { line: 2, character: 32 },
      },
      originSelectionRange: {
        start: { line: 0, character: 13 },
        end: { line: 0, character: 25 },
      },
      workspaceFolder: `scale-${size}`,
    });
  });
  return {
    id: `generated-scale-${size}`,
    kind: "generated",
    coverage: `${size} files referencing one shared symbol`,
    sourceFile: null,
    locations,
  };
}

export function makeCanonicalLocation({ id, uri, range, originSelectionRange, workspaceFolder }) {
  const url = new URL(uri);
  const path = decodeURIComponent(url.pathname).replace(/^\/+/, "");
  return {
    id,
    uri,
    path,
    workspaceFolder,
    filePath: `/${workspaceFolder}/${path}`,
    range,
    targetSelectionRange: range,
    originSelectionRange,
  };
}

export function paginateReferences(input, config) {
  validateConfiguration(config);
  const sorted = [...input.locations].sort(compareLocations);
  const pages = [];
  let offset = 0;

  while (offset < sorted.length) {
    const remainingLimit = Math.min(config.limit, sorted.length - offset);
    let accepted = [];

    for (let count = 1; count <= remainingLimit; count += 1) {
      const candidate = sorted.slice(offset, offset + count);
      const hasNext = offset + count < sorted.length;
      const response = buildResponse({
        items: candidate,
        detail: config.detail,
        total: sorted.length,
        offset,
        hasNext,
        truncationReason: hasNext ? "byteBudget" : null,
      });
      if (jsonBytes(response) > config.byteBudget) break;
      accepted = candidate;
    }

    if (accepted.length === 0) {
      const error = new Error(
        `The item at offset ${offset} cannot fit within byteBudget=${config.byteBudget}`,
      );
      error.code = "ITEM_EXCEEDS_BYTE_BUDGET";
      throw error;
    }

    const nextOffset = offset + accepted.length;
    const hasNext = nextOffset < sorted.length;
    const reason = hasNext ? (accepted.length === config.limit ? "limit" : "byteBudget") : null;
    const response = buildResponse({
      items: accepted,
      detail: config.detail,
      total: sorted.length,
      offset,
      hasNext,
      truncationReason: reason,
    });
    const bytes = jsonBytes(response);
    if (bytes > config.byteBudget) {
      throw new Error(`Internal error: emitted ${bytes} bytes over budget ${config.byteBudget}`);
    }
    pages.push({ response, bytes, itemIds: accepted.map((item) => item.id) });
    offset = nextOffset;
  }

  return pages;
}

export function evaluateReplay(input, config) {
  const pages = paginateReferences(input, config);
  const canonicalIds = [...input.locations].sort(compareLocations).map((item) => item.id);
  const observedIds = pages.flatMap((page) => page.itemIds);
  const observedCounts = new Map();
  for (const id of observedIds) observedCounts.set(id, (observedCounts.get(id) ?? 0) + 1);
  const missing = canonicalIds.filter((id) => !observedCounts.has(id));
  const duplicate = [...observedCounts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id]) => id);
  const orderMismatch = canonicalIds.filter((id, index) => observedIds[index] !== id);
  const allPagesWithinBudget = pages.every((page) => page.bytes <= config.byteBudget);
  const visibleCounts = pages.map((page) => countVisibleLocations(page.response));

  return {
    inputId: input.id,
    inputKind: input.kind,
    sourceLocationCount: canonicalIds.length,
    configurationId: configurationId(config),
    ...config,
    firstPageBytes: pages[0]?.bytes ?? 0,
    maxPageBytes: Math.max(...pages.map((page) => page.bytes)),
    pageCount: pages.length,
    pageItemCounts: pages.map((page) => page.itemIds.length),
    truncationReasons: [...new Set(pages.map((page) => page.response.meta.truncationReason))],
    firstPageVisibleLocationCount: visibleCounts[0] ?? 0,
    allPagesVisibleLocationCount: visibleCounts.reduce((total, count) => total + count, 0),
    missingCount: missing.length,
    duplicateCount: duplicate.length,
    orderMismatchCount: orderMismatch.length,
    allPagesWithinBudget,
    correctnessGatePassed:
      missing.length === 0 &&
      duplicate.length === 0 &&
      orderMismatch.length === 0 &&
      allPagesWithinBudget,
  };
}

export function verifyDetailHitSet(input, configurations) {
  const reference = [...input.locations].sort(compareLocations).map((item) => item.id);
  return configurations.every((config) => {
    const observed = paginateReferences(input, config).flatMap((page) => page.itemIds);
    return JSON.stringify(observed) === JSON.stringify(reference);
  });
}

function buildResponse({ items, detail, total, offset, hasNext, truncationReason }) {
  return {
    protocolVersion: 2,
    data: projectLocations(items, detail),
    meta: {
      detail,
      total,
      offset,
      returned: items.length,
      truncated: hasNext,
      truncationReason,
      nextCursor: hasNext ? `references-v0:${offset + items.length}` : null,
    },
  };
}

function projectLocations(items, detail) {
  if (detail === "minimal") {
    return { count: items.length, fileCount: new Set(items.map((item) => item.uri)).size };
  }

  const groups = new Map();
  for (const item of items) {
    let group = groups.get(item.uri);
    if (!group) {
      group = {
        path: item.path,
        workspaceFolder: item.workspaceFolder,
        ...(detail === "full" ? { filePath: item.filePath, uri: item.uri } : {}),
        locations: [],
      };
      groups.set(item.uri, group);
    }
    group.locations.push({
      range: item.range,
      ...(detail === "full"
        ? {
            targetSelectionRange: item.targetSelectionRange,
            originSelectionRange: item.originSelectionRange,
          }
        : {}),
    });
  }
  return { files: [...groups.values()] };
}

function countVisibleLocations(response) {
  if (!("files" in response.data)) return 0;
  return response.data.files.reduce((total, file) => total + file.locations.length, 0);
}

function compareLocations(left, right) {
  return (
    left.uri.localeCompare(right.uri) ||
    left.range.start.line - right.range.start.line ||
    left.range.start.character - right.range.start.character ||
    left.range.end.line - right.range.end.line ||
    left.range.end.character - right.range.end.character ||
    left.id.localeCompare(right.id)
  );
}

function validateConfiguration(config) {
  if (!["minimal", "compact", "full"].includes(config.detail)) {
    throw new TypeError(`Unsupported detail: ${config.detail}`);
  }
  if (!Number.isInteger(config.limit) || config.limit <= 0) {
    throw new TypeError("limit must be a positive integer");
  }
  if (!Number.isInteger(config.byteBudget) || config.byteBudget <= 0) {
    throw new TypeError("byteBudget must be a positive integer");
  }
}

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}
