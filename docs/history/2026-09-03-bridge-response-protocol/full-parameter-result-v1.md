# Bridge 全参数敏感性实验 v1 结果

- 执行时间：2026-09-03T12:52:52.153Z
- 状态：PASS
- 方法：deterministic canonical replay with one-factor-at-a-time sweeps
- 覆盖：16 个待定参数族、7 个语义参数族、114 行扫描结果

## 建议参数

| 参数 | 建议值 | 说明 |
| --- | --- | --- |
| 一般工具默认 detail | `compact` | 保留可操作信息，避免 full 重复字段 |
| diagnostics scope | `active` | 默认只读当前活动文件 |
| diagnostics severity | `error + warning` | 默认保留可立即处理的诊断 |
| diagnostics limit | 100 | 32 KiB 下保持完整逻辑条目分页 |
| references limit | 75 | 延续扩大规模实验的折中点 |
| workspace symbols limit | 200 | 利用按文件分组降低路径重复 |
| 默认输出预算 | 32 KiB | 给 50 KiB Pi 硬上限保留安全余量 |
| 用户可请求最大输出 | 40 KiB | 必须严格低于硬上限 |
| snapshot TTL | 120 秒 | 合成翻页间隔下过期率不高于 5% |
| snapshot 数量上限 | 16 | 覆盖常见并发，极端情况显式淘汰 |
| snapshot canonical items 上限 | 50000 | 估算约 7.6 MiB canonical 数据 |
| editor state 默认 detail | `compact` | 不默认返回 selection text、tabs 和 URI |
| includeEditText 默认值 | `false` | 保持显式 opt-in |
| edit text 阈值 | 24 KiB | 在 apply 前拒绝超预算回显 |
| notifications start | `buffer` | 首次读取包含当前 buffer |
| notifications detail | `minimal` | 默认只返回事件头 |
| notifications limit | 50 | 控制单次事件批量 |
| notifications ring capacity | 500 | 合成 consumer lag 下 gap 率不高于 5% |
| notifications coalesce | `true` | 保留 saved 屏障并减少连续重复事件 |

这些值是实现初版的候选默认值；真实 provider 和 Agent 可用性实验仍可调整它们。

## 数据规模

- diagnostics：2000
- workspace symbols：5000
- references：10000
- notifications：10000
- editor state：1/10/50 个 editors，selection text 为 0/2/20 KiB
- edit text：1/4/8/16/24/32/40 KiB

## Pagination 扫描

| domain | 扫描 | limit | budget KiB | 页数 | 首页 items | 最大页 bytes | Gate |
| --- | --- | ---: | ---: | ---: | ---: | ---: | --- |
| diagnostics | limit | 50 | 32 | 40 | 50 | 11961 | pass |
| diagnostics | limit | 100 | 32 | 20 | 100 | 23762 | pass |
| diagnostics | limit | 200 | 32 | 15 | 139 | 32763 | pass |
| diagnostics | byteBudget | 100 | 24 | 20 | 100 | 23762 | pass |
| diagnostics | byteBudget | 100 | 32 | 20 | 100 | 23762 | pass |
| diagnostics | byteBudget | 100 | 40 | 20 | 100 | 23762 | pass |
| workspaceSymbols | limit | 100 | 32 | 50 | 100 | 15627 | pass |
| workspaceSymbols | limit | 200 | 32 | 25 | 200 | 31087 | pass |
| workspaceSymbols | limit | 400 | 32 | 24 | 212 | 32708 | pass |
| workspaceSymbols | byteBudget | 200 | 24 | 32 | 159 | 24567 | pass |
| workspaceSymbols | byteBudget | 200 | 32 | 25 | 200 | 31087 | pass |
| workspaceSymbols | byteBudget | 200 | 40 | 25 | 200 | 31087 | pass |
| references | limit | 50 | 32 | 200 | — | 11289 | pass |
| references | limit | 75 | 32 | 134 | — | 16838 | pass |
| references | limit | 100 | 32 | 100 | — | 22390 | pass |
| references | limit | 200 | 32 | 69 | — | 32606 | pass |
| references | byteBudget | 75 | 24 | 134 | — | 16838 | pass |
| references | byteBudget | 75 | 32 | 134 | — | 16838 | pass |
| references | byteBudget | 75 | 40 | 134 | — | 16838 | pass |

## Snapshot 扫描

| 参数族 | 候选值 | 过期率 | overflow events | overflow units/items |
| --- | ---: | ---: | ---: | ---: |
| snapshot.ttlSeconds | 30 | 30.0% | — | — |
| snapshot.ttlSeconds | 120 | 5.0% | — | — |
| snapshot.ttlSeconds | 300 | 1.0% | — | — |
| snapshot.maxSnapshots | 8 | — | 10 | 96 |
| snapshot.maxSnapshots | 16 | — | 2 | 16 |
| snapshot.maxSnapshots | 32 | — | 0 | 0 |
| snapshot.maxItems | 10000 | — | 30 | 620000 |
| snapshot.maxItems | 50000 | — | 2 | 60000 |
| snapshot.maxItems | 100000 | — | 0 | 0 |

## Notification 扫描

| 参数族 | 候选值 | 输出/页数/bytes | reduction/gap | Gate |
| --- | --- | ---: | ---: | --- |
| notifications.coalesce | false | 10000 | 0.0% | pass |
| notifications.coalesce | true | 5000 | 50.0% | pass |
| notifications.limit | 20 | 250 | — | pass |
| notifications.limit | 50 | 100 | — | pass |
| notifications.limit | 100 | 50 | — | pass |
| notifications.ringCapacity | 100 | — | 20.0% | pass |
| notifications.ringCapacity | 500 | — | 5.0% | pass |
| notifications.ringCapacity | 1000 | — | 1.0% | pass |
| notifications.detail | minimal | 3478 | — | pass |
| notifications.detail | compact | 10752 | — | pass |
| notifications.detail | full | 27953 | — | pass |

## 语义参数不变量

| 参数族 | 检查 | Gate |
| --- | --- | --- |
| diagnostics.uris | URI scope preserves requested URI order | pass |
| pagination.cursor | cursor binds detail, method and query fingerprint | pass |
| notifications.afterCursor | ring overflow produces an explicit gap | pass |
| notifications.start | start=now establishes an empty baseline | pass |
| notifications.types | type filtering preserves source order | pass |
| notifications.coalesce | saved events are never removed | pass |
| edit.includeEditText | includeEditText requires full detail | pass |
| responseVersion | explicit v2 selects envelope while omitted version remains legacy | pass |

## 解释与边界

- 本轮覆盖所有当前文档中需要确定默认值或验证约束的参数族，但不是全笛卡尔积；各族采用单因素扫描。
- diagnostics 的 scope/severity 建议体现默认噪声控制，不代表 information/hint 不可按需请求。
- TTL、cache 和 ring 结论来自确定性合成 trace；淘汰或过期必须返回明确错误，不能静默重查或漏事件。
- 24 KiB 可容纳当前 references compact 页，但统一默认仍建议 32 KiB；用户请求上限建议 40 KiB。
- 本轮不含真实语言服务器、Extension Host、Agent tokens-to-success 或跨机器性能比较。

## 复现

`pnpm experiment:full-parameters-v1`

机器可读明细见 [full-parameter-results-v1.json](full-parameter-results-v1.json)。
