import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBridgeV2AblationExperiment } from "./experiment.mjs";

const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));
const archiveDirectory = join(
  repositoryRoot,
  "docs",
  "history",
  "2026-09-03-bridge-response-protocol",
);
const report = { ...runBridgeV2AblationExperiment(), generatedAt: new Date().toISOString() };
const jsonPath = join(archiveDirectory, "ablation-results-v1.json");
const markdownPath = join(archiveDirectory, "ablation-result-v1.md");

await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
await writeFile(markdownPath, renderMarkdown(report), "utf8");

console.log(`bridge v2 ablation v1: ${report.correctnessGatePassed ? "PASS" : "FAIL"}`);
console.log(`ablations=${report.rows.length}`);
console.log(`json=${jsonPath}`);
console.log(`markdown=${markdownPath}`);
if (!report.correctnessGatePassed) process.exitCode = 1;

function renderMarkdown(result) {
  const rows = result.rows
    .map(
      (item) =>
        `| ${item.mechanism} | ${item.removed} | ${formatOutcome(item.baseline)} | ${formatOutcome(item.ablated)} | ${item.gatePassed ? "pass" : "fail"} |`,
    )
    .join("\n");
  return `# Bridge response protocol v2 消融实验 v1 结果

- 执行时间：${result.generatedAt}
- 状态：${result.correctnessGatePassed ? "PASS" : "FAIL"}
- 方法：${result.method}
- 基线：${result.baseline}
- 覆盖：${result.rows.length} 个独立机制消融

## 结果总览

| 消融机制 | 移除内容 | v2 基线 | 消融后 | Gate |
| --- | --- | --- | --- | --- |
${rows}

## 主要结论

1. **正确性/安全不可消融**：snapshot freeze、byte-budget paging、sequence cursor、edit-text
   preflight 和显式 responseVersion gate。移除后分别出现翻页重复/遗漏、超过 Pi 硬上限、同毫秒事件
   丢失、先修改后无法安全回执，以及 legacy 调用被错误切换。
2. **效率不可轻易消融**：compact 分组在本 fixture 中减少 ${percent(result.summary.compactGroupingByteReduction)}
   字节；notification coalescing 减少 ${percent(result.summary.notificationEventReduction)} 事件且保留全部
   saved 事件；默认 full editor payload 是 compact 的 ${result.summary.editorFullByteMultiplier} 倍。
3. diagnostics 的 active + error/warning 默认没有降低当前文件可操作诊断召回，但避免返回大量与当前
   操作无关的 workspace 诊断；scope/severity 仍可由调用方显式扩大。
4. 这些机制不是单纯“输出美化”：五项承担协议正确性或修改安全，四项承担显著的噪声/输出成本控制。

## Fixture

- locations：${result.fixtureSummary.locations}，分布于 ${result.fixtureSummary.locationFiles} 个文件
- diagnostics：${result.fixtureSummary.diagnostics}
- notifications：${result.fixtureSummary.notifications}
- 同毫秒事件：${result.fixtureSummary.sameTimestampEvents}
- editor：${result.fixtureSummary.editorCount} 个，selection text ${result.fixtureSummary.selectionTextKiB} KiB
- edit echo：old/new 合计 ${result.fixtureSummary.editEchoKiB} KiB

## 边界

- 本实验是确定性 canonical replay，隔离单项机制贡献，不测真实 LSP 延迟或 Agent task success。
- 各消融使用针对该机制的压力 fixture；不同 row 的绝对字节数不能横向解释为生产流量占比。
- 正确性 gate 的目标是证明“移除会破坏哪个不变量”，不是重新调参。

## 复现

\`pnpm experiment:bridge-v2-ablation-v1\`

机器可读明细见 [ablation-results-v1.json](ablation-results-v1.json)。
`;
}

function formatOutcome(value) {
  return Object.entries(value)
    .map(([key, entry]) => `${key}=${typeof entry === "number" ? round(entry) : entry}`)
    .join("; ");
}

function percent(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function round(value) {
  return Number.isInteger(value) ? value : value.toFixed(2);
}
