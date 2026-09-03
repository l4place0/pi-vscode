import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runFullParameterExperiment } from "./experiment.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const archiveDirectory = join(
  repositoryRoot,
  "docs",
  "history",
  "2026-09-03-bridge-response-protocol",
);
const report = { ...runFullParameterExperiment(), generatedAt: new Date().toISOString() };
const jsonPath = join(archiveDirectory, "full-parameter-results-v1.json");
const markdownPath = join(archiveDirectory, "full-parameter-result-v1.md");

await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(`full parameters v1: ${report.correctnessGatePassed ? "PASS" : "FAIL"}`);
console.log(
  `tuned=${report.tunedParameterFamilies.length} invariants=${report.invariantParameterFamilies.length} sweepRows=${report.sweepRowCount}`,
);
console.log(`json=${jsonPath}`);
console.log(`markdown=${markdownPath}`);
if (!report.correctnessGatePassed) process.exitCode = 1;

function renderMarkdown(result) {
  const recommendation = result.recommendations;
  const paginationRows = result.sweeps.pagination
    .map(
      (row) =>
        `| ${row.domain} | ${row.sweep} | ${row.limit} | ${row.byteBudget / 1024} | ${row.pageCount} | ${row.firstPageItems ?? "—"} | ${row.maxPageBytes} | ${row.gatePassed ? "pass" : "fail"} |`,
    )
    .join("\n");
  const snapshotRows = result.sweeps.snapshot
    .map(
      (row) =>
        `| ${row.family} | ${formatCandidate(row.candidate)} | ${formatPercent(row.expiryRate)} | ${row.overflowEvents ?? "—"} | ${row.overflowUnits ?? row.overflowItems ?? "—"} |`,
    )
    .join("\n");
  const notificationRows = result.sweeps.notifications
    .map(
      (row) =>
        `| ${row.family} | ${formatCandidate(row.candidate)} | ${row.outputEvents ?? row.pagesForCoalescedStream ?? row.bytesFor50Events ?? "—"} | ${formatPercent(row.reductionRatio ?? row.gapRate)} | ${row.gatePassed ? "pass" : "fail"} |`,
    )
    .join("\n");
  const invariantRows = result.invariantChecks
    .map((check) => `| ${check.family} | ${check.assertion} | ${check.passed ? "pass" : "fail"} |`)
    .join("\n");

  return `# Bridge 全参数敏感性实验 v1 结果

- 执行时间：${result.generatedAt}
- 状态：${result.correctnessGatePassed ? "PASS" : "FAIL"}
- 方法：${result.method}
- 覆盖：${result.tunedParameterFamilies.length} 个待定参数族、${result.invariantParameterFamilies.length} 个语义参数族、${result.sweepRowCount} 行扫描结果

## 建议参数

| 参数 | 建议值 | 说明 |
| --- | --- | --- |
| 一般工具默认 detail | \`${recommendation.defaultDetail}\` | 保留可操作信息，避免 full 重复字段 |
| diagnostics scope | \`${recommendation.diagnostics.scope}\` | 默认只读当前活动文件 |
| diagnostics severity | \`${recommendation.diagnostics.severity.join(" + ")}\` | 默认保留可立即处理的诊断 |
| diagnostics limit | ${recommendation.diagnostics.limit} | 32 KiB 下保持完整逻辑条目分页 |
| references limit | ${recommendation.references.limit} | 延续扩大规模实验的折中点 |
| workspace symbols limit | ${recommendation.workspaceSymbols.limit} | 利用按文件分组降低路径重复 |
| 默认输出预算 | ${recommendation.output.defaultBytes / 1024} KiB | 给 50 KiB Pi 硬上限保留安全余量 |
| 用户可请求最大输出 | ${recommendation.output.allowedMaximumBytes / 1024} KiB | 必须严格低于硬上限 |
| snapshot TTL | ${recommendation.snapshot.ttlSeconds} 秒 | 合成翻页间隔下过期率不高于 5% |
| snapshot 数量上限 | ${recommendation.snapshot.maxSnapshots} | 覆盖常见并发，极端情况显式淘汰 |
| snapshot canonical items 上限 | ${recommendation.snapshot.maxItems} | 估算约 ${((recommendation.snapshot.maxItems * 160) / 1024 / 1024).toFixed(1)} MiB canonical 数据 |
| editor state 默认 detail | \`${recommendation.editorState.defaultDetail}\` | 不默认返回 selection text、tabs 和 URI |
| includeEditText 默认值 | \`${recommendation.edits.includeEditTextDefault}\` | 保持显式 opt-in |
| edit text 阈值 | ${recommendation.edits.textThresholdBytes / 1024} KiB | 在 apply 前拒绝超预算回显 |
| notifications start | \`${recommendation.notifications.start}\` | 首次读取包含当前 buffer |
| notifications detail | \`${recommendation.notifications.detail}\` | 默认只返回事件头 |
| notifications limit | ${recommendation.notifications.limit} | 控制单次事件批量 |
| notifications ring capacity | ${recommendation.notifications.ringCapacity} | 合成 consumer lag 下 gap 率不高于 5% |
| notifications coalesce | \`${recommendation.notifications.coalesce}\` | 保留 saved 屏障并减少连续重复事件 |

这些值是实现初版的候选默认值；真实 provider 和 Agent 可用性实验仍可调整它们。

## 数据规模

- diagnostics：${result.fixtureSummary.diagnostics}
- workspace symbols：${result.fixtureSummary.workspaceSymbols}
- references：${result.fixtureSummary.references}
- notifications：${result.fixtureSummary.notifications}
- editor state：${result.fixtureSummary.editorScales.join("/")} 个 editors，selection text 为 0/2/20 KiB
- edit text：${result.fixtureSummary.editTextSizesKiB.join("/")} KiB

## Pagination 扫描

| domain | 扫描 | limit | budget KiB | 页数 | 首页 items | 最大页 bytes | Gate |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
${paginationRows}

## Snapshot 扫描

| 参数族 | 候选值 | 过期率 | overflow events | overflow units/items |
| --- | ---: | ---: | ---: | ---: |
${snapshotRows}

## Notification 扫描

| 参数族 | 候选值 | 输出/页数/bytes | reduction/gap | Gate |
| --- | --- | ---: | ---: | --- |
${notificationRows}

## 语义参数不变量

| 参数族 | 检查 | Gate |
| --- | --- | --- |
${invariantRows}

## 解释与边界

- 本轮覆盖所有当前文档中需要确定默认值或验证约束的参数族，但不是全笛卡尔积；各族采用单因素扫描。
- diagnostics 的 scope/severity 建议体现默认噪声控制，不代表 information/hint 不可按需请求。
- TTL、cache 和 ring 结论来自确定性合成 trace；淘汰或过期必须返回明确错误，不能静默重查或漏事件。
- 24 KiB 可容纳当前 references compact 页，但统一默认仍建议 32 KiB；用户请求上限建议 40 KiB。
- 本轮不含真实语言服务器、Extension Host、Agent tokens-to-success 或跨机器性能比较。

## 复现

\`pnpm experiment:full-parameters-v1\`

机器可读明细见 [full-parameter-results-v1.json](full-parameter-results-v1.json)。
`;
}

function formatCandidate(candidate) {
  return typeof candidate === "boolean" ? String(candidate) : candidate;
}

function formatPercent(value) {
  return value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
}
