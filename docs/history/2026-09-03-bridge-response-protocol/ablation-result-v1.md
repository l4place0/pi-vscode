# Bridge response protocol v2 消融实验 v1 结果

- 执行时间：2026-09-03T14:02:15.128Z
- 状态：PASS
- 方法：deterministic canonical replay; one implemented mechanism removed per row
- 基线：implemented Bridge Response Protocol v2 defaults
- 覆盖：9 个独立机制消融

## 结果总览

| 消融机制 | 移除内容 | v2 基线 | 消融后 | Gate |
| --- | --- | --- | --- | --- |
| compactGrouping | Remove per-file grouping and repeat filePath/URI per hit | bytes=800686 | bytes=1646090 | pass |
| diagnosticDefaults | Replace active error/warning defaults with unfiltered workspace | returned=3; relevantReturned=3; noise=0 | returned=2000; relevantReturned=3; noise=1997 | pass |
| snapshotFreeze | Re-run a changed provider for page two | returned=50; unique=50; duplicates=0; missing=0; complete=true | returned=50; unique=49; duplicates=1; missing=1; complete=false | pass |
| byteBudgetPaging | Return all logical items without byte-boundary paging | pageCount=45; maxPageBytes=32734; completeItems=10000 | pageCount=1; bytes=800686; exceedsPiHardLimit=true | pass |
| sequenceCursor | Use millisecond timestamp as the exclusive consumption cursor | unread=10; lost=0 | unread=0; lost=10 | pass |
| notificationCoalescing | Disable semantic event coalescing | events=5000; bytes=1382264; savedEvents=1000 | events=10000; bytes=2578523; savedEvents=1000 | pass |
| editorCompactProjection | Make full editor payload the default | bytes=3659; includesSelectionText=false | bytes=32303; includesSelectionText=true | pass |
| editTextPreflight | Apply before checking edit-text and final output budgets | applied=false; code=EDIT_TEXT_RESPONSE_TOO_LARGE; responseBytes=180 | applied=true; code=null; responseBytes=65650 | pass |
| explicitVersionGate | Infer v2 from detail instead of responseVersion=2 | routes=legacy,v2; legacyPreserved=true | routes=v2,v2; legacyPreserved=false | pass |

## 主要结论

1. **正确性/安全不可消融**：snapshot freeze、byte-budget paging、sequence cursor、edit-text
   preflight 和显式 responseVersion gate。移除后分别出现翻页重复/遗漏、超过 Pi 硬上限、同毫秒事件
   丢失、先修改后无法安全回执，以及 legacy 调用被错误切换。
2. **效率不可轻易消融**：compact 分组在本 fixture 中减少 51.4%
   字节；notification coalescing 减少 50.0% 事件且保留全部
   saved 事件；默认 full editor payload 是 compact 的 8.83 倍。
3. diagnostics 的 active + error/warning 默认没有降低当前文件可操作诊断召回，但避免返回大量与当前
   操作无关的 workspace 诊断；scope/severity 仍可由调用方显式扩大。
4. 这些机制不是单纯“输出美化”：五项承担协议正确性或修改安全，四项承担显著的噪声/输出成本控制。

## Fixture

- locations：10000，分布于 200 个文件
- diagnostics：2000
- notifications：10000
- 同毫秒事件：10
- editor：50 个，selection text 20 KiB
- edit echo：old/new 合计 64 KiB

## 边界

- 本实验是确定性 canonical replay，隔离单项机制贡献，不测真实 LSP 延迟或 Agent task success。
- 各消融使用针对该机制的压力 fixture；不同 row 的绝对字节数不能横向解释为生产流量占比。
- 正确性 gate 的目标是证明“移除会破坏哪个不变量”，不是重新调参。

## 复现

`pnpm experiment:bridge-v2-ablation-v1`

机器可读明细见 [ablation-results-v1.json](ablation-results-v1.json)。
