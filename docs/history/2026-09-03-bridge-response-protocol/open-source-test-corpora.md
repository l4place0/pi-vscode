# 开源测试集调研

- 调研日期：2026-09-03
- 目标：为 bridge response protocol v2 的参数敏感性实验选择可复用语料和方法
- 结论置信度：高；候选项目的官方仓库、结构和许可证已交叉核对

## 结论

没有找到能直接覆盖 VS Code bridge 的 detail 投影、snapshot 分页、notification cursor、editor
state 和修改回执的单一开源测试集。最合适的是组合采用：

1. 用 [UsageBench](https://github.com/BrokkAi/usagebench) 提供 references、definitions 和 type
   definitions 的精确 ground truth。
2. 借鉴 [vue-benchmarks](https://github.com/pikax/vue-benchmarks) 的 20/100/500 文件规模梯度、
   全语料共享 symbol 和 edit→diagnostics 状态变化设计。
3. 借鉴 [lsp-bench](https://github.com/asyncswap/lsp-bench) 与
   [python-lsp-compare](https://github.com/microsoft/python-lsp-compare) 的完整响应、字节、延迟、
   RSS 和报告结构，但在本仓库实现轻量 TypeScript replay runner。
4. Agent 效果层采用 tokens-to-success、iso-accuracy、reference F1 和 tool-call count；方法可参考
   [LSP-vs-grep token study](https://github.com/agentconnect-md/lsp-vs-grep-token-study)，但该仓库
   当前没有 LICENSE，不能直接复制代码、任务或 raw runs。
5. diagnostics、editor state、notifications、分页错误和修改回执仍需本项目自行构造 canonical
   fixtures。

## 候选对比

| 项目                                                                                       | 可用内容                                                         | 与本项目匹配度                | 许可证                          | 建议                                      |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ----------------------------- | ------------------------------- | ----------------------------------------- |
| [UsageBench](https://github.com/BrokkAi/usagebench)                                        | declaration、expected usages、反向 definition probes、LSP ranges | 高：location 类工具           | MIT                             | 选取 TS/JS cases 并保留归属信息           |
| [vue-benchmarks](https://github.com/pikax/vue-benchmarks)                                  | 规模生成器、references、edit/diagnostic loop、correctness gates  | 高：压力与状态变化            | MIT                             | 改造成轻量 plain TypeScript fixtures      |
| [lsp-bench](https://github.com/asyncswap/lsp-bench)                                        | 多 LSP method、完整响应、p50/p95、RSS、expect                    | 中：框架而非语料              | MIT                             | 借鉴指标和报告，不引入 Rust runner        |
| [python-lsp-compare](https://github.com/microsoft/python-lsp-compare)                      | 确定性 suite、bytes、JSON/CSV/Markdown、edit-then-query          | 中：Python 为主               | MIT                             | 借鉴 runner/reporting 和 fake server 测试 |
| [LSPFuzz](https://github.com/henryhchchc/lsp-fuzz)                                         | 状态化 mutation、workspace + request export                      | 低：故障测试方法              | MIT                             | 只提炼 adversarial cases                  |
| [LSP-vs-grep token study](https://github.com/agentconnect-md/lsp-vs-grep-token-study)      | Agent arms、T2S、F1、tool calls、raw episodes                    | 高：Agent 指标                | 未发现许可证                    | 仅引用方法，独立实现                      |
| [SWE-bench Lite](https://github.com/SWE-bench/SWE-bench/blob/main/docs/guides/datasets.md) | issue、base commit、gold patch；官方文档列 534 项                | 中：端到端任务                | MIT harness；上游 repo 各自授权 | 后续选极小固定子集                        |
| [CrossCodeEval](https://github.com/amazon-science/cceval)                                  | 多语言跨文件 completion 与 retrieval variants                    | 低：不是 location/stream 协议 | Apache-2.0                      | 可用于未来上下文充分性实验                |

## 1. UsageBench：最适合直接借用的导航语料

[官方说明](https://github.com/BrokkAi/usagebench/blob/main/README.md)将 benchmark case 定义为源码位置，
而不是 analyzer-specific symbol ID。每个 case 包含 declaration、expected usage sites 和从 usage
反查 declaration/type 的 probes，位置使用 LSP-shaped range。MIT 许可证明确覆盖 corpus fixtures、
assertions、adapter profiles 和 harness code。

对当前 `main` 的固定检查显示：

- 59 个 YAML case documents；
- 194 个 case records；
- development corpus 覆盖 C++、C#、Go、Java、JavaScript、PHP、Python、Ruby、Rust、Scala 和
  TypeScript；
- 另有独立、冻结的 real-project evaluation；
- TypeScript case 使用 UTF-16 position encoding，和 VS Code 坐标语义一致。

[TypeScript 示例](https://github.com/BrokkAi/usagebench/blob/main/benchmarks/cases/typescript-baseline.yaml)
已经覆盖 import/export、函数、class、constructor、跨文件 usage 和允许的额外 definition targets。

适合复用：

- references/definitions 分页后的无重复、无漏项验证；
- 文件分组和 multi-file location 投影；
- stable result IDs 和 exact expected locations；
- provider 原始顺序打乱后的规范化排序。

不覆盖：diagnostics、workspace/document symbols、editor state、notifications、formatting。

建议只导入约 12 个 TypeScript/JavaScript fixture cases，不引入完整 Rust runner 和所有语言服务。
导入时固定 tag/commit，并记录上游 URL、revision、MIT license 和本地转换。

## 2. vue-benchmarks：最适合借鉴规模与状态变化

[方法文档](https://github.com/pikax/vue-benchmarks/blob/main/docs/methodology.md)明确区分 correctness
gate 与性能排名，不允许“少做工作”被计为更快，并避免跨机器拼接性能结果。项目为 MIT license。

它的 [scale suite](https://github.com/pikax/vue-benchmarks/blob/main/scripts/lib/ide-ops/suites/scale.mjs)
生成 20、100、500 文件 workspace，并让一个 symbol 被所有生成文件使用，随后实际查询 references。
这非常适合观察 page limit 和 byte budget 的拐点。

[edit-loop suite](https://github.com/pikax/vue-benchmarks/blob/main/scripts/lib/ide-ops/suites/edit-loop.mjs)
覆盖：

- edit 植入类型错误；
- diagnostics 出现和清除；
- edit 后 hover 状态；
- 跨文件类型变化引发 diagnostics；
- 暂态错误结果和最终稳定结果的区分。

这直接支持本协议的 `diagnostics.observation = "immediate"` 决策。不过完整 Vue/TypeScript
toolchain 太重，建议把“共享 symbol + 植入错误 + eventual diagnostics”模式改写成 plain
TypeScript fixture，而不是复制整套 benchmark。

## 3. lsp-bench：通用测量框架参考

[lsp-bench](https://github.com/asyncswap/lsp-bench/blob/main/README.md) 支持 diagnostics、definitions、
declarations、type definitions、implementations、references、document symbols、formatting 和
workspace symbols 等相关 method。它记录完整原生 JSON response、mean/p50/p95 latency 和 RSS，
并支持用 `expect` 检查结果。

它的限制是需要调用方提供 project、file、position 和 expected result，本身不是现成多语言
ground-truth corpus；它测量 stdio LSP，而不是 VS Code provider 与 bridge projection。因此适合借鉴
指标和 JSON report shape，不适合直接作为本项目测试集。

## 4. python-lsp-compare：确定性 runner 与报告参考

[Microsoft 的项目](https://github.com/microsoft/python-lsp-compare)使用 MIT license，提供隔离的
suite environment、raw JSON-RPC transport、每次调用的 bytes/latency、JSON/CSV/Markdown 报告和
fake LSP server tests。

[bundled benchmarks](https://github.com/microsoft/python-lsp-compare/tree/main/benchmarks)包含六个
面向真实依赖面的 Python LSP suites，以及 definitions、references、document symbols 和
edit-then-query probes。它很适合参考以下实现：

- 精确统计 UTF-8 payload bytes；
- 记录 mean、median、min、max、p95；
- 相同 suite 比较多个配置；
- 用 fake server 隔离 runner 自身正确性。

主要缺口是 Python-only，且 semantic validation 多为 non-empty/minimum count，而不是精确 location
集合，所以不能代替 UsageBench 的导航真值。

## 5. LSPFuzz：只适合提炼故障场景

[LSPFuzz](https://github.com/henryhchchc/lsp-fuzz)是 MIT licensed 的状态化 language-server fuzzer。
它会组合 workspace mutation 与 editor operations，并能导出 `workspace/` 和按顺序排列的
`requests/`。

但当前 main 没有可直接使用的导出 corpus；生成需要 fuzz target、代码片段和 AFL 风格运行环境，
而且导出的 requests 含固定绝对路径。初版不应引入该 fuzzer，可以只借鉴这些故障类型：

- provider 返回 `undefined`、重复项或异常；
- 文档变化与查询交错；
- cursor 过期、错用或对应状态已被淘汰；
- 高频通知、顺序屏障和宿主重启。

## 6. Agent 层候选

### LSP-vs-grep token study

[研究仓库](https://github.com/agentconnect-md/lsp-vs-grep-token-study)把模型、任务和 agent loop 固定，
比较 grep-only、LSP-only、两者可选和 semantic-first 四种 arms。它记录 tokens-to-success、成功率、
reference F1/precision/recall、tool calls 和 raw JSONL episodes。这些指标比单纯比较输出 token 更适合
本项目，因为 token 降低只有在任务准确率相同时才有意义。

重要限制：截至检查的 commit `58b0c1a`，仓库文件树没有 LICENSE、COPYING 或 NOTICE。可以引用
公开方法和事实，但不应复制 harness、raw runs 或 task definitions，除非作者补充许可证或授权。

### SWE-bench Lite

[官方 dataset guide](https://github.com/SWE-bench/SWE-bench/blob/main/docs/guides/datasets.md)列出
534 个 Lite instances，每项包含 repo、base commit、问题描述和 gold patch。它适合未来验证
compact/full 是否影响真实 Agent 成功率，但运行与仓库准备成本高，而且原始仓库仍有各自许可证。

初版应先用本项目自有任务；需要外部 Agent tasks 时，再从许可清晰的仓库中选 6–12 个固定任务，
而不是直接引入完整 SWE-bench。

### CrossCodeEval

[CrossCodeEval](https://github.com/amazon-science/cceval)为 Apache-2.0，多语言且包含跨文件 retrieval
variants，但目标是 code completion。它不能验证分页、通知和修改回执，只适合以后研究 compact
上下文是否仍足以完成跨文件代码任务。

## 推荐组合测试集

以下是完整演进方向，不要求第一轮全部建设。最小实验 v0 只选取少量 UsageBench TS/JS case，
补充 100/500 文件生成数据，并只测试 `references` 的 detail、limit 和 byte budget；具体矩阵见
[experiments.md](experiments.md)。其余分层按实验结果逐步引入。

### A. Canonical replay：本项目自建，普通 CI 阻断

直接构造 diagnostics、locations、symbols、editor state、edits 和 notifications canonical objects，
不启动语言服务器。用于验证 detail 投影、按文件分组、UTF-8 字节预算、snapshot cursor、gap 和错误。

### B. Navigation truth：选择性导入 UsageBench，普通 CI 阻断

首批约 12 个 TS/JS cases，覆盖：

- 单文件和跨文件 references；
- import/export；
- function、method、class、constructor；
- allowed extra target；
- 同名 symbol 与不同 container。

只转换 fixture/schema，不引入 UsageBench Rust runtime。

### C. Generated scale：借鉴 vue-benchmarks，benchmark/定时运行

生成 plain TypeScript 20、100、500 文件 workspace，每个文件引用共享 symbol。另为 projection-only
replay 生成 1k 和 10k canonical items，避免真实 provider 时间掩盖 serializer 参数差异。

### D. Edit/notification state：本项目自建

复用 planted-state 思路，覆盖 clean → error → cleared、cross-file diagnostics、stale immediate
observation、dirty/save barrier、事件合并和 ring overflow。没有现成项目覆盖 VS Code tab/editor state
与通知 gap，这一层必须本地定义。

### E. Agent effect：初版非阻断

独立实现 iso-accuracy 评估，记录：

- 任务是否成功；
- 必须找到的 canonical result IDs；
- tool calls 和翻页次数；
- bridge output bytes；
- 模型 API 报告的 tokens；
- 是否正确升级 detail 或在 gap 后 resync。

先使用 pi-vscode 自有任务，后续再评估小型 SWE-bench 子集。

## 对参数实验的直接影响

| 待定参数                           | 主要数据来源                                      |
| ---------------------------------- | ------------------------------------------------- |
| page limit、byte budget            | UsageBench locations + TypeScript scale generator |
| snapshot TTL/cache capacity        | canonical replay + 模拟翻页间隔和并发查询         |
| diagnostics scope/severity         | 自建 diagnostics + edit loop + Agent tasks        |
| notification limit/ring/coalescing | 自建状态序列；LSPFuzz 仅提供故障思路              |
| compact/full 字段选择              | UsageBench exact IDs + Agent iso-accuracy         |
| edit text threshold                | 自建 large edit canonical fixtures                |

## 不建议

- 不直接采用完整 SWE-bench 作为协议参数实验主体。
- 不把 CodeSearchNet/RepoBench 当作 location ground truth；它们解决代码检索或补全问题。
- 不在普通 PR CI 启动十一种语言服务器。
- 不把第三方 benchmark 的绝对延迟直接当成本项目阈值。
- 不复制没有明确许可证的 token-study 代码或数据。
- 不使用完整 JSON golden snapshot 验证所有规模；小型 shape 用 snapshot，大型分页用 IDs 与 invariants。

## 下一步建议

1. 按 [experiments.md](experiments.md) 跑 5 个输入、7 个配置的最小回放。
2. 确认是否接受选择性导入 3 个 UsageBench MIT fixtures；若转换成本过高，v0 先用等价 canonical
   数据。
3. 先输出 references 默认 detail、limit 和 byte budget 的候选区间。
4. 只有 v0 无法区分候选值时，才增加中间参数或进入 Agent task 层。

## 局限

- 未找到专门针对 VS Code editor/tab state 或 extension event stream 的公开 corpus。
- 没有候选提供 snapshot pagination 或 notification cursor ground truth。
- 候选 main branch 会继续变化；本报告只支持选型，真正导入时必须再次核对固定 revision 和许可证。
- 外部 benchmark 的硬件性能结果不可直接迁移，本项目只采用方法、fixture shape 和可验证真值。
