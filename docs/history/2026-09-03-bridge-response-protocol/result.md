# References 参数敏感性实验 v0 结果

- 执行时间：2026-09-03T11:46:04.344Z
- 状态：PASS
- 规模：5 个输入 × 7 个配置 × 3 次重复 = 105 次执行
- runner：`experiments/references-v0/run.mjs`

## 结论

- detail 候选：`compact`。minimal 不暴露 location；compact 保留 path/range，同时省略完整 URI 和 selection metadata。
- limit 候选区间：`50–100`，下一轮优先 `50`。
- byte budget 候选区间：`32–64 KiB`，下一轮优先 `32 KiB`。
- 这些是候选区间，不是公共协议的最终承诺。

100-location 输入在 limit 扫描中的页数：20 → 5 页，50 → 2 页，100 → 1 页。
100-location 输入在 byte budget 扫描中的页数：16 → 2 页，32 → 1 页，64 → 1 页。

## Correctness gate

- 所有分页拼接均无 missing、duplicate 或 order mismatch：通过。
- detail 和其他参数不改变 canonical 命中集合：通过。
- 所有发出的页面均未超过 byte budget：通过。
- 三次重复结果一致：通过。
- 单条超预算返回 `ITEM_EXCEEDS_BYTE_BUDGET`：通过。

## 输入与来源

三个小型案例转换自 [UsageBench](https://github.com/BrokkAi/usagebench) revision
`87b72a5b5291c24e259db9b1e70b27f246f13ef4`，许可证为 MIT，位置编码为 utf-16。转换没有改变上游
range；本实验只补充稳定 path、filePath 和 full-detail 可选 range。另有 100/500 location 两个确定性
生成输入，不启动真实语言服务器。完整授权文本保存在
[`THIRD_PARTY_NOTICES.md`](../../../experiments/references-v0/THIRD_PARTY_NOTICES.md)。

| 输入 | 类型 | locations | 覆盖 |
| --- | --- | ---: | --- |
| js-parity-object-literal-method-call | usagebench | 2 | single-file and cross-file method references |
| ts-named-export-import-function | usagebench | 2 | cross-file named export and import |
| ts-default-class-import-and-construction | usagebench | 2 | class and constructor references |
| generated-scale-100 | generated | 100 | 100 files referencing one shared symbol |
| generated-scale-500 | generated | 500 | 500 files referencing one shared symbol |

## 明细

Visible 列为“首页/翻完全部页”实际暴露的 location 数；minimal 只返回 count/fileCount，因此为 0。

| 输入 | 配置 | 总数 | 首页 bytes | 最大页 bytes | 页数 | 每页条目 | 截断原因 | Visible | Gate |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- |
| js-parity-object-literal-method-call | minimal-l50-b32k | 2 | 176 | 176 | 1 | 2 | none | 0/0 | pass |
| js-parity-object-literal-method-call | compact-l50-b32k | 2 | 462 | 462 | 1 | 2 | none | 2/2 | pass |
| js-parity-object-literal-method-call | full-l50-b32k | 2 | 992 | 992 | 1 | 2 | none | 2/2 | pass |
| js-parity-object-literal-method-call | compact-l20-b32k | 2 | 462 | 462 | 1 | 2 | none | 2/2 | pass |
| js-parity-object-literal-method-call | compact-l100-b32k | 2 | 462 | 462 | 1 | 2 | none | 2/2 | pass |
| js-parity-object-literal-method-call | compact-l100-b16k | 2 | 462 | 462 | 1 | 2 | none | 2/2 | pass |
| js-parity-object-literal-method-call | compact-l100-b64k | 2 | 462 | 462 | 1 | 2 | none | 2/2 | pass |
| ts-named-export-import-function | minimal-l50-b32k | 2 | 176 | 176 | 1 | 2 | none | 0/0 | pass |
| ts-named-export-import-function | compact-l50-b32k | 2 | 463 | 463 | 1 | 2 | none | 2/2 | pass |
| ts-named-export-import-function | full-l50-b32k | 2 | 992 | 992 | 1 | 2 | none | 2/2 | pass |
| ts-named-export-import-function | compact-l20-b32k | 2 | 463 | 463 | 1 | 2 | none | 2/2 | pass |
| ts-named-export-import-function | compact-l100-b32k | 2 | 463 | 463 | 1 | 2 | none | 2/2 | pass |
| ts-named-export-import-function | compact-l100-b16k | 2 | 463 | 463 | 1 | 2 | none | 2/2 | pass |
| ts-named-export-import-function | compact-l100-b64k | 2 | 463 | 463 | 1 | 2 | none | 2/2 | pass |
| ts-default-class-import-and-construction | minimal-l50-b32k | 2 | 176 | 176 | 1 | 2 | none | 0/0 | pass |
| ts-default-class-import-and-construction | compact-l50-b32k | 2 | 463 | 463 | 1 | 2 | none | 2/2 | pass |
| ts-default-class-import-and-construction | full-l50-b32k | 2 | 996 | 996 | 1 | 2 | none | 2/2 | pass |
| ts-default-class-import-and-construction | compact-l20-b32k | 2 | 463 | 463 | 1 | 2 | none | 2/2 | pass |
| ts-default-class-import-and-construction | compact-l100-b32k | 2 | 463 | 463 | 1 | 2 | none | 2/2 | pass |
| ts-default-class-import-and-construction | compact-l100-b16k | 2 | 463 | 463 | 1 | 2 | none | 2/2 | pass |
| ts-default-class-import-and-construction | compact-l100-b64k | 2 | 463 | 463 | 1 | 2 | none | 2/2 | pass |
| generated-scale-100 | minimal-l50-b32k | 100 | 197 | 197 | 2 | 50/50 | limit | 0/0 | pass |
| generated-scale-100 | compact-l50-b32k | 100 | 11081 | 11081 | 2 | 50/50 | limit | 50/100 | pass |
| generated-scale-100 | full-l50-b32k | 100 | 30678 | 30678 | 2 | 50/50 | limit | 50/100 | pass |
| generated-scale-100 | compact-l20-b32k | 100 | 4541 | 4542 | 5 | 20/20/20/20/20 | limit | 20/100 | pass |
| generated-scale-100 | compact-l100-b32k | 100 | 21966 | 21966 | 1 | 100 | none | 100/100 | pass |
| generated-scale-100 | compact-l100-b16k | 100 | 16318 | 16318 | 2 | 74/26 | byteBudget | 74/100 | pass |
| generated-scale-100 | compact-l100-b64k | 100 | 21966 | 21966 | 1 | 100 | none | 100/100 | pass |
| generated-scale-500 | minimal-l50-b32k | 500 | 197 | 200 | 10 | 50/50/50/50/50/50/50/50/50/50 | limit | 0/0 | pass |
| generated-scale-500 | compact-l50-b32k | 500 | 11081 | 11084 | 10 | 50/50/50/50/50/50/50/50/50/50 | limit | 50/500 | pass |
| generated-scale-500 | full-l50-b32k | 500 | 30678 | 30681 | 10 | 50/50/50/50/50/50/50/50/50/50 | limit | 50/500 | pass |
| generated-scale-500 | compact-l20-b32k | 500 | 4541 | 4544 | 25 | 20/20/20/20/20/20/20/20/20/20/20/20/20/20/20/20/20/20/20/20/20/20/20/20/20 | limit | 20/500 | pass |
| generated-scale-500 | compact-l100-b32k | 500 | 21983 | 21985 | 5 | 100/100/100/100/100 | limit | 100/500 | pass |
| generated-scale-500 | compact-l100-b16k | 500 | 16318 | 16321 | 7 | 74/74/74/74/74/74/56 | byteBudget | 74/500 | pass |
| generated-scale-500 | compact-l100-b64k | 500 | 21983 | 21985 | 5 | 100/100/100/100/100 | limit | 100/500 | pass |

## 偏差与解释

- 这是 serializer/projection 的 canonical replay，不包含真实 provider、VS Code command 或网络耗时。
- 三个 UsageBench case 都只有两个 expected usages，主要用于验证来源、形状与投影；参数拐点由
  100/500 location 生成输入提供。
- minimal 不暴露 location，虽然 correctness 可在 runner 内部验证，但不能单独满足调用方定位需求。
- v0 没有以耗时作决策，也没有扩展到 diagnostics、symbols、notifications、TTL 或 Agent 任务。

## 复现

`pnpm experiment:references-v0`

机器可读结果见 [experiment-results-v0.json](experiment-results-v0.json)。
