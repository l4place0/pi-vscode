import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  buildConfigurations,
  buildInputs,
  EXPERIMENT_PROFILES,
  evaluateReplay,
  paginateReferences,
  verifyDetailHitSet,
} from "../experiments/references-v0/replay.mjs";

const fixtures = JSON.parse(
  await readFile(
    new URL("../experiments/references-v0/fixtures/usagebench.json", import.meta.url),
    "utf8",
  ),
);

describe("references v0 canonical replay", () => {
  const inputs = buildInputs(fixtures);
  const configurations = buildConfigurations();

  it("builds the specified five inputs and seven unique configurations", () => {
    expect(inputs.map((input) => input.locations.length)).toEqual([2, 2, 2, 100, 500]);
    expect(configurations).toHaveLength(7);
    expect(new Set(configurations.map((config) => JSON.stringify(config))).size).toBe(7);
  });

  it("builds the expanded v0.1 scale and denser parameter grid", () => {
    const profile = EXPERIMENT_PROFILES["v0.1"];
    const expandedInputs = buildInputs(fixtures, profile);
    const expandedConfigurations = buildConfigurations(profile);

    expect(expandedInputs.map((input) => input.locations.length)).toEqual([
      2, 2, 2, 100, 500, 1_000, 10_000,
    ]);
    expect(expandedConfigurations).toHaveLength(10);
    expect(expandedConfigurations.some((config) => config.limit === 75)).toBe(true);
    expect(expandedConfigurations.some((config) => config.byteBudget === 24 * 1024)).toBe(true);
    expect(expandedConfigurations.some((config) => config.byteBudget === 40 * 1024)).toBe(true);
  });

  it("passes completeness, ordering, budget, and detail hit-set gates", () => {
    for (const input of inputs) {
      expect(verifyDetailHitSet(input, configurations)).toBe(true);
      for (const config of configurations) {
        const result = evaluateReplay(input, config);
        expect(result.correctnessGatePassed).toBe(true);
        expect(result.missingCount).toBe(0);
        expect(result.duplicateCount).toBe(0);
        expect(result.orderMismatchCount).toBe(0);
        expect(result.allPagesWithinBudget).toBe(true);
      }
    }
  });

  it("is deterministic across repeated replays", () => {
    const input = inputs.at(-1);
    const config = configurations.at(-1);
    expect(evaluateReplay(input, config)).toEqual(evaluateReplay(input, config));
  });

  it("exposes the intended limit and byte-budget sensitivity", () => {
    const input = inputs.find((candidate) => candidate.id === "generated-scale-100");
    const evaluate = (detail, limit, budgetKiB) =>
      evaluateReplay(input, { detail, limit, byteBudget: budgetKiB * 1024 });

    expect([20, 50, 100].map((limit) => evaluate("compact", limit, 32).pageCount)).toEqual([
      5, 2, 1,
    ]);
    expect([16, 32, 64].map((budget) => evaluate("compact", 100, budget).pageCount)).toEqual([
      2, 1, 1,
    ]);
    expect(evaluate("minimal", 50, 32).firstPageVisibleLocationCount).toBe(0);
    expect(evaluate("compact", 50, 32).firstPageVisibleLocationCount).toBe(50);
  });

  it("returns an explicit error when one logical item cannot fit", () => {
    expect(() =>
      paginateReferences(inputs[0], { detail: "full", limit: 1, byteBudget: 64 }),
    ).toThrowError(expect.objectContaining({ code: "ITEM_EXCEEDS_BYTE_BUDGET" }));
  });
});
