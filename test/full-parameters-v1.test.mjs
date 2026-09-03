import { describe, expect, it } from "vitest";
import {
  coalesceNotifications,
  generateNotifications,
  hasNotificationGap,
  INVARIANT_PARAMETER_FAMILIES,
  runFullParameterExperiment,
  TUNED_PARAMETER_FAMILIES,
  validateEditTextRequest,
} from "../experiments/full-parameters-v1/experiment.mjs";

describe("full parameter experiment v1", () => {
  it("covers every documented tunable and semantic parameter family", () => {
    expect(TUNED_PARAMETER_FAMILIES).toEqual([
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
    expect(INVARIANT_PARAMETER_FAMILIES).toHaveLength(7);
  });

  it("passes every correctness gate deterministically", () => {
    const first = runFullParameterExperiment();
    const second = runFullParameterExperiment();
    expect(first.correctnessGatePassed).toBe(true);
    expect(first).toEqual(second);
    expect(first.invariantChecks.every((check) => check.passed)).toBe(true);
    expect(first.recommendations).toMatchObject({
      defaultDetail: "compact",
      diagnostics: { scope: "active", limit: 100 },
      references: { limit: 75 },
      workspaceSymbols: { limit: 200 },
      output: { defaultBytes: 32 * 1024, allowedMaximumBytes: 40 * 1024 },
      snapshot: { ttlSeconds: 120, maxSnapshots: 16, maxItems: 50_000 },
      edits: { textThresholdBytes: 24 * 1024 },
      notifications: { detail: "minimal", limit: 50, ringCapacity: 500, coalesce: true },
    });
  }, 30_000);

  it("keeps saved events as coalescing barriers", () => {
    const events = generateNotifications(100);
    const saved = events.filter((event) => event.type === "document_saved");
    const coalescedSaved = coalesceNotifications(events).filter(
      (event) => event.type === "document_saved",
    );
    expect(coalescedSaved.map((event) => event.sequence)).toEqual(
      saved.map((event) => event.sequence),
    );
  });

  it("reports an explicit notification gap", () => {
    expect(hasNotificationGap({ earliestSequence: 501, afterSequence: 400 })).toBe(true);
    expect(hasNotificationGap({ earliestSequence: 501, afterSequence: 500 })).toBe(false);
  });

  it("rejects invalid and oversized edit text before output", () => {
    expect(
      validateEditTextRequest({
        detail: "compact",
        includeEditText: true,
        payloadBytes: 1024,
        thresholdBytes: 24 * 1024,
      }).code,
    ).toBe("EDIT_TEXT_REQUIRES_FULL");
    expect(
      validateEditTextRequest({
        detail: "full",
        includeEditText: true,
        payloadBytes: 32 * 1024,
        thresholdBytes: 24 * 1024,
      }).code,
    ).toBe("EDIT_TEXT_RESPONSE_TOO_LARGE");
  });
});
