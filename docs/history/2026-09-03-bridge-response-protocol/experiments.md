# 参数敏感性实验 v0

## 目标

第一轮只回答一个问题：`references` 返回较多 location 时，detail、logical item limit 和 UTF-8
字节预算怎样影响响应大小、页数与结果完整性。

本轮是方向性实验，不要求覆盖完整协议，也不直接决定所有默认参数。输出应足以淘汰明显不合适的
组合，并为下一轮缩小参数范围。

## 范围

纳入：

- `references` canonical location 列表；
- `minimal`、`compact`、`full` 三种投影；
- logical item limit；
- 单页 UTF-8 byte budget；
- snapshot 分页后的完整性检查。

暂不纳入：

- diagnostics、symbols、editor state 和修改回执；
- notification cursor、gap 和 snapshot TTL；
- 真实语言服务器耗时、内存和跨机器性能比较；
- Agent tokens-to-success 或端到端任务成功率；
- 多语言与异常 provider 行为。

## 最小测试集

测试集只保留 5 个输入：

1. 从 UsageBench 选择 3 个 TypeScript/JavaScript case：单文件引用、跨文件 import/export、
   class/constructor；固定上游 revision 并保留 MIT 归属。
2. 本地生成 2 个 plain TypeScript workspace：100 和 500 个文件，每个文件引用同一 symbol。

若导入 UsageBench fixture 的转换成本超过半天，v0 可先使用等价的本地 canonical location 数据，
但必须把真实 fixture 回放列为下一步，避免长期只验证人工构造数据。

## 参数矩阵

采用单因素扫描，避免第一轮组合爆炸。基线为 `detail=compact`、`limit=50`、
`byteBudget=32 KiB`。

| 扫描        | 候选值                 | 其他参数           |
| ----------- | ---------------------- | ------------------ |
| detail      | minimal、compact、full | limit 50，32 KiB   |
| limit       | 20、50、100            | compact，32 KiB    |
| byte budget | 16、32、64 KiB         | compact，limit 100 |

去除重复基线后，每个输入运行 7 个配置，共 35 个确定性回放。每个配置重复执行 3 次只用于检测
非确定性；v0 不以耗时差异作决策。

## 记录指标

每次回放记录：

- 首页面向调用方的 UTF-8 bytes；
- 总页数和每页 logical item 数；
- `truncated` 与 `truncationReason`；
- 首页和全量可见 location 数；
- 全部分页拼接后的 missing、duplicate 和 order mismatch 数；
- 单个 logical item 超过预算时的明确错误。

结果按输入规模生成一张表即可，不建设数据库或 dashboard。

## 判定规则

候选组合必须先通过 correctness gate：

- 翻完所有页后没有 missing 或 duplicate；
- 相同查询的命中集合不因 detail 改变；
- 每页不超过 byte budget；
- 分页顺序稳定；
- 无法容纳单个条目时返回明确错误，而不是生成空页或死循环。

在通过 gate 的组合中，优先选择：

1. 首页可提供足够定位信息的最低 detail；
2. 100-file case 不产生过多碎页的最小 limit；
3. 能容纳常见 compact 页、同时避免大响应的最小 byte budget。

“足够定位信息”和“过多碎页”在 v0 中由结果审阅记录，不伪装成通用阈值。若多个组合接近，保留
较小输出的组合进入 v1 Agent 实验。

## 产出与停止条件

v0 产出：

- 5 个输入及来源记录；
- 35 个配置的 JSON/Markdown 汇总；
- correctness gate 结果；
- 对 references 默认 detail、limit 和 byte budget 的候选区间，而非最终承诺。

完成这些产出即停止。只有结果无法区分候选值时，才增加一个中间参数值；不在 v0 临时扩展到其他
工具或协议参数。

## 后续升级条件

以下任一情况出现后再启动 v1：

- 两组候选在响应指标上接近，需要 Agent 任务判断可用性；
- diagnostics 或 symbols 的结果形态显示 references 结论不可迁移；
- 实际 provider 返回暴露 canonical replay 未覆盖的顺序或位置差异。

v1 再考虑 Agent 成功率、真实 provider、notifications 和 TTL，不作为 v0 的完成条件。

## 扩大规模复跑 v0.1

v0.1 不增加协议覆盖面，只扩大同一实验：

- 生成规模从 100/500 扩为 100/500/1,000/10,000 locations；
- limit 增加 75，形成 20/50/75/100；
- byte budget 增加 24/40 KiB，形成 16/24/32/40/64 KiB；
- 每个配置从 3 次增加到 5 次。

去除重复基线后，每个输入有 10 个配置，共 7 个输入、70 个输入配置组合、350 次执行。v0.1
仍只用于观察 serializer/projection 和分页完整性，不引入真实 provider、Agent 或新协议类型。
