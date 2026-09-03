# 全参数敏感性实验 v1

## 目标

在不接入真实 provider 或 Agent 的前提下，为 bridge response protocol v2 当前所有待定参数提供一轮
可重复的 canonical sensitivity evidence，并验证其关联的错误和过滤语义。

## 方法

本轮采用分层单因素扫描，不执行全笛卡尔积。原因是 detail、scope、snapshot retention、notification
retention 和 edit text safety 属于不同机制，跨机制组合无法产生可解释的默认值。

### 待定参数族

- 一般工具和 editor state 默认 detail；
- diagnostics scope、severity、limit；
- references 和 workspace symbols limit；
- 默认与最大输出 byte budget；
- snapshot TTL、snapshot 数量和 canonical items 上限；
- edit text 回显阈值；
- notifications detail、limit、ring capacity 和 coalesce。

### 语义参数族

- diagnostics `uris`；
- pagination cursor 绑定；
- notifications `afterCursor`、`start` 和 `types`；
- edit `includeEditText`；
- `responseVersion` 兼容分支。

## 合成输入

- 2,000 diagnostics，severity 按稳定分布生成；
- 5,000 workspace symbols，每个文件 5 个；
- 10,000 references，复用 v0.1 canonical generator；
- 10,000 notifications，包含 selection、diagnostics、dirty、saved 和 editor 连续事件；
- 1/10/50 editors 与 0/2/20 KiB selection text；
- 1/4/8/16/24/32/40 KiB edit text。

## 扫描矩阵

| 参数                    | 候选值                 |
| ----------------------- | ---------------------- |
| detail                  | minimal、compact、full |
| diagnostics limit       | 50、100、200           |
| references limit        | 50、75、100、200       |
| workspace symbols limit | 100、200、400          |
| output budget           | 24、32、40 KiB         |
| snapshot TTL            | 30、120、300 秒        |
| snapshot count          | 8、16、32              |
| snapshot items          | 10k、50k、100k         |
| edit text threshold     | 8、16、24、32 KiB      |
| notification limit      | 20、50、100            |
| notification ring       | 100、500、1,000        |
| notification coalesce   | false、true            |

## Correctness gate

- 分页拼接无遗漏、重复或超预算页面；
- detail、scope、severity 和 types 不改变各自过滤语义；
- cursor 参数变化明确 mismatch；过期和淘汰不触发静默重查；
- notification gap 明确要求 resync，saved event 不被 coalesce；
- `start=now` 建立空基线；
- includeEditText 仅允许 full，超阈值在修改前失败；
- legacy 与显式 v2 分支可区分。

## 停止条件

生成 JSON/Markdown 结果、全部 gate 通过并给出每个待定参数的候选默认值后停止。本轮不扩展到真实
provider、Agent 成功率、token 使用量或跨机器性能。
