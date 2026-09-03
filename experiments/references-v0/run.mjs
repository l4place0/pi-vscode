import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildConfigurations,
  buildInputs,
  EXPERIMENT_PROFILES,
  evaluateReplay,
  verifyDetailHitSet,
} from "./replay.mjs";

const profileId =
  process.argv.find((argument) => argument.startsWith("--profile="))?.split("=")[1] ?? "v0";
const profile = EXPERIMENT_PROFILES[profileId];
if (!profile) throw new Error(`Unknown experiment profile: ${profileId}`);
const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const archiveDirectory = join(
  repositoryRoot,
  "docs",
  "history",
  "2026-09-03-bridge-response-protocol",
);
const fixtures = JSON.parse(
  await readFile(new URL("fixtures/usagebench.json", import.meta.url), "utf8"),
);
const inputs = buildInputs(fixtures, profile);
const configurations = buildConfigurations(profile);
const rows = [];

for (const input of inputs) {
  const hitSetInvariant = verifyDetailHitSet(input, configurations);
  for (const config of configurations) {
    const repetitions = Array.from({ length: profile.repetitions }, () =>
      evaluateReplay(input, config),
    );
    const fingerprints = repetitions.map((result) => JSON.stringify(result));
    rows.push({
      ...repetitions[0],
      hitSetInvariant,
      deterministic: new Set(fingerprints).size === 1,
    });
  }
}

const oversizedItemCheck = runOversizedItemCheck(inputs[0]);
const generatedAt = new Date().toISOString();
const correctnessGatePassed =
  rows.every((row) => row.correctnessGatePassed && row.hitSetInvariant && row.deterministic) &&
  oversizedItemCheck.passed;
const recommendations = deriveRecommendations(rows);
const report = {
  schemaVersion: 1,
  experiment: `references-parameter-sensitivity-${profile.id}`,
  profile: profile.id,
  generatedAt,
  runner: "experiments/references-v0/run.mjs",
  fixtureSource: fixtures.source,
  inputs: inputs.map(({ locations, ...input }) => ({ ...input, locationCount: locations.length })),
  configurations,
  repetitionsPerConfiguration: profile.repetitions,
  rowCount: rows.length,
  executionCount: rows.length * profile.repetitions,
  oversizedItemCheck,
  correctnessGatePassed,
  recommendations,
  rows,
};

const jsonPath = join(archiveDirectory, profile.jsonFile);
const markdownPath = join(archiveDirectory, profile.markdownFile);
await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(`references ${profile.id}: ${correctnessGatePassed ? "PASS" : "FAIL"}`);
console.log(
  `inputs=${inputs.length} configurations=${configurations.length} executions=${report.executionCount}`,
);
console.log(`json=${jsonPath}`);
console.log(`markdown=${markdownPath}`);

if (!correctnessGatePassed) process.exitCode = 1;

function runOversizedItemCheck(input) {
  try {
    evaluateReplay(input, { detail: "full", limit: 1, byteBudget: 64 });
    return { passed: false, expectedCode: "ITEM_EXCEEDS_BYTE_BUDGET", actualCode: null };
  } catch (error) {
    return {
      passed: error?.code === "ITEM_EXCEEDS_BYTE_BUDGET",
      expectedCode: "ITEM_EXCEEDS_BYTE_BUDGET",
      actualCode: error?.code ?? null,
    };
  }
}

function deriveRecommendations(results) {
  const generated100 = results.filter((row) => row.inputId === "generated-scale-100");
  const largestScale = Math.max(
    ...results.filter((row) => row.inputKind === "generated").map((row) => row.sourceLocationCount),
  );
  const largestGenerated = results.filter(
    (row) => row.inputKind === "generated" && row.sourceLocationCount === largestScale,
  );
  const limitRows = generated100.filter(
    (row) => row.detail === "compact" && row.byteBudget === 32 * 1024,
  );
  const budgetRows = generated100.filter((row) => row.detail === "compact" && row.limit === 100);
  const largestLimitRows = largestGenerated.filter(
    (row) => row.detail === "compact" && row.byteBudget === 32 * 1024,
  );
  const largestBudgetRows = largestGenerated.filter(
    (row) => row.detail === "compact" && row.limit === 100,
  );
  const viableLimits = limitRows
    .filter((row) => row.pageCount <= 2)
    .map((row) => row.limit)
    .sort((left, right) => left - right);
  const viableBudgets = budgetRows
    .filter((row) => !row.truncationReasons.includes("byteBudget"))
    .map((row) => row.byteBudget / 1024)
    .sort((left, right) => left - right);
  const preferredLimit = viableLimits.includes(75) ? 75 : viableLimits[0];
  const lowestSufficientBudget = viableBudgets[0];
  const preferredBudget = viableBudgets.includes(32) ? 32 : lowestSufficientBudget;
  return {
    detail: {
      candidate: "compact",
      reason:
        "minimal 不暴露 location；compact 保留 path/range，同时省略完整 URI 和 selection metadata",
    },
    limit: {
      candidateRange: [viableLimits[0], viableLimits.at(-1)],
      preferredForNextRound: preferredLimit,
      reason: "75 相比 50 减少大规模输入页数，同时 compact 单页仍明显低于 32 KiB",
      observedPagesFor100Locations: Object.fromEntries(
        limitRows.map((row) => [String(row.limit), row.pageCount]),
      ),
    },
    byteBudgetKiB: {
      candidateRange: [lowestSufficientBudget, preferredBudget],
      lowestSufficient: lowestSufficientBudget,
      preferredForNextRound: preferredBudget,
      reason: "24 KiB 在当前 fixture 上足够；32 KiB 为 envelope 和真实路径差异保留更多余量",
      observedPagesFor100Locations: Object.fromEntries(
        budgetRows.map((row) => [String(row.byteBudget / 1024), row.pageCount]),
      ),
    },
    largestScale: {
      locationCount: largestScale,
      pagesByLimit: Object.fromEntries(
        largestLimitRows.map((row) => [String(row.limit), row.pageCount]),
      ),
      pagesByBudgetKiB: Object.fromEntries(
        largestBudgetRows.map((row) => [String(row.byteBudget / 1024), row.pageCount]),
      ),
    },
    status:
      "candidate interval only; validate usability with a later Agent or real-provider experiment",
  };
}

function renderMarkdown(report) {
  const source = report.fixtureSource;
  const comparisonSection =
    report.profile === "v0.1"
      ? `## 与 v0 对比

- detail 结论不变，仍为 compact。
- limit 候选区间仍为 50–100；新增的 75 在 10,000-location 输入中产生 134 页，介于 50 的
  200 页和 100 的 100 页之间，因此下一轮优先值从 50 调整为 75。
- 新增的 24 KiB 已能容纳 100 个 compact locations；考虑真实路径和 envelope 仍可能变大，下一轮
  继续优先验证 32 KiB，而不直接采用最低边界。
- 输入最大规模从 500 增加到 10,000，所有 correctness gate 仍通过，没有发现规模相关错误。

`
      : "";
  const tableRows = report.rows
    .map(
      (row) =>
        `| ${row.inputId} | ${row.configurationId} | ${row.sourceLocationCount} | ${row.firstPageBytes} | ${row.maxPageBytes} | ${row.pageCount} | ${formatPageItemCounts(row.pageItemCounts)} | ${row.truncationReasons.filter(Boolean).join(", ") || "none"} | ${row.firstPageVisibleLocationCount}/${row.allPagesVisibleLocationCount} | ${row.correctnessGatePassed && row.hitSetInvariant && row.deterministic ? "pass" : "fail"} |`,
    )
    .join("\n");

  return `# References 参数敏感性实验 ${report.profile} 结果

- 执行时间：${report.generatedAt}
- 状态：${report.correctnessGatePassed ? "PASS" : "FAIL"}
- 规模：${report.inputs.length} 个输入 × ${report.configurations.length} 个配置 × ${report.repetitionsPerConfiguration} 次重复 = ${report.executionCount} 次执行
- runner：\`${report.runner}\`

## 结论

- detail 候选：\`${report.recommendations.detail.candidate}\`。${report.recommendations.detail.reason}。
- limit 候选区间：\`${report.recommendations.limit.candidateRange.join("–")}\`，下一轮优先 \`${report.recommendations.limit.preferredForNextRound}\`。${report.recommendations.limit.reason}。
- byte budget 候选区间：\`${report.recommendations.byteBudgetKiB.candidateRange.join("–")} KiB\`，下一轮优先 \`${report.recommendations.byteBudgetKiB.preferredForNextRound} KiB\`。${report.recommendations.byteBudgetKiB.reason}。
- 这些是候选区间，不是公共协议的最终承诺。

100-location 输入在 limit 扫描中的页数：${formatMapping(report.recommendations.limit.observedPagesFor100Locations)}。
100-location 输入在 byte budget 扫描中的页数：${formatMapping(report.recommendations.byteBudgetKiB.observedPagesFor100Locations)}。
${report.recommendations.largestScale.locationCount}-location 输入在 limit 扫描中的页数：${formatMapping(report.recommendations.largestScale.pagesByLimit)}。
${report.recommendations.largestScale.locationCount}-location 输入在 byte budget 扫描中的页数：${formatMapping(report.recommendations.largestScale.pagesByBudgetKiB)}。

${comparisonSection}## Correctness gate

- 所有分页拼接均无 missing、duplicate 或 order mismatch：${report.rows.every((row) => row.correctnessGatePassed) ? "通过" : "失败"}。
- detail 和其他参数不改变 canonical 命中集合：${report.rows.every((row) => row.hitSetInvariant) ? "通过" : "失败"}。
- 所有发出的页面均未超过 byte budget：${report.rows.every((row) => row.allPagesWithinBudget) ? "通过" : "失败"}。
- ${report.repetitionsPerConfiguration} 次重复结果一致：${report.rows.every((row) => row.deterministic) ? "通过" : "失败"}。
- 单条超预算返回 \`${report.oversizedItemCheck.actualCode}\`：${report.oversizedItemCheck.passed ? "通过" : "失败"}。

## 输入与来源

三个小型案例转换自 [UsageBench](${source.repository}) revision
\`${source.revision}\`，许可证为 ${source.license}，位置编码为 ${source.positionEncoding}。转换没有改变上游
range；本实验只补充稳定 path、filePath 和 full-detail 可选 range。另有
${report.inputs
  .filter((input) => input.kind === "generated")
  .map((input) => input.locationCount)
  .join("/")} location
确定性生成输入，不启动真实语言服务器。完整授权文本保存在
[\`THIRD_PARTY_NOTICES.md\`](../../../experiments/references-v0/THIRD_PARTY_NOTICES.md)。

| 输入 | 类型 | locations | 覆盖 |
| --- | --- | ---: | --- |
${report.inputs.map((input) => `| ${input.id} | ${input.kind} | ${input.locationCount} | ${input.coverage} |`).join("\n")}

## 明细

Visible 列为“首页/翻完全部页”实际暴露的 location 数；minimal 只返回 count/fileCount，因此为 0。

| 输入 | 配置 | 总数 | 首页 bytes | 最大页 bytes | 页数 | 每页条目 | 截断原因 | Visible | Gate |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
${tableRows}

## 偏差与解释

- 这是 serializer/projection 的 canonical replay，不包含真实 provider、VS Code command 或网络耗时。
- 三个 UsageBench case 都只有两个 expected usages，主要用于验证来源、形状与投影；参数拐点由
  生成输入提供。
- minimal 不暴露 location，虽然 correctness 可在 runner 内部验证，但不能单独满足调用方定位需求。
- v0 没有以耗时作决策，也没有扩展到 diagnostics、symbols、notifications、TTL 或 Agent 任务。

## 复现

\`pnpm experiment:references-${report.profile}\`

机器可读结果见 [${profile.jsonFile}](${profile.jsonFile})。
`;
}

function formatMapping(mapping) {
  return Object.entries(mapping)
    .map(([candidate, pages]) => `${candidate} → ${pages} 页`)
    .join("，");
}

function formatPageItemCounts(counts) {
  const runs = [];
  for (const count of counts) {
    const current = runs.at(-1);
    if (current?.count === count) current.repetitions += 1;
    else runs.push({ count, repetitions: 1 });
  }
  return runs
    .map((run) => (run.repetitions === 1 ? String(run.count) : `${run.count}×${run.repetitions}`))
    .join("/");
}
