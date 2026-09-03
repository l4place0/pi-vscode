import { describe, expect, it } from "vitest";
import {
  ABLATIONS,
  ablateEditTextPreflight,
  ablateSnapshotFreeze,
  ablateSequenceCursor,
  runBridgeV2AblationExperiment,
} from "../experiments/bridge-v2-ablation-v1/experiment.mjs";

describe("bridge response protocol v2 ablation v1", () => {
  it("runs every declared ablation deterministically", () => {
    const first = runBridgeV2AblationExperiment();
    const second = runBridgeV2AblationExperiment();
    expect(first).toEqual(second);
    expect(first.rows.map((row) => row.mechanism)).toEqual(ABLATIONS);
    expect(first.correctnessGatePassed).toBe(true);
  }, 30_000);

  it("demonstrates snapshot instability when the provider is rerun", () => {
    const result = ablateSnapshotFreeze();
    expect(result.baseline.complete).toBe(true);
    expect(result.ablated.complete).toBe(false);
    expect(result.effect).toMatchObject({ duplicatesIntroduced: 1, missingIntroduced: 1 });
  });

  it("demonstrates same-millisecond loss with a timestamp cursor", () => {
    const result = ablateSequenceCursor();
    expect(result.baseline.lost).toBe(0);
    expect(result.ablated.lost).toBe(10);
  });

  it("demonstrates that edit preflight prevents an unsafe mutation and oversized receipt", () => {
    const result = ablateEditTextPreflight();
    expect(result.baseline).toMatchObject({ applied: false, code: "EDIT_TEXT_RESPONSE_TOO_LARGE" });
    expect(result.ablated.applied).toBe(true);
    expect(result.effect.hardLimitOverrunBytes).toBeGreaterThan(0);
  });
});
