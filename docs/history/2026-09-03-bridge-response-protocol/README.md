# Bridge response protocol v2

- 状态：`completed`
- 启动日期：2026-09-03
- 适用范围：bundled Pi extension 与 VS Code loopback bridge
- 兼容目标：现有 `vscode_*` 工具名和未声明 v2 的 legacy RPC 调用方

## 背景

当前 bridge 多数读取接口直接序列化 VS Code 对象。workspace、open editors、diagnostics、
symbols、references 和 definitions 会重复返回绝对路径与 URI；format 工具还会无条件回显
formatter 产生的完整 `newText`。超过 Pi extension 输出上限时，当前实现返回 JSON 前缀，
调用方既无法继续分页，也无法把前缀当成完整结构处理。

本变更引入显式的响应细节等级、结构化分页和稳定增量游标，在不把 Agent 能力搬入 VS Code
extension 的前提下，降低 bridge 工具的 token 成本和无关噪声。

## 已确认决策

1. 公开读取和修改工具采用 `minimal`、`compact`、`full` 三个 detail level。
2. 一般工具默认 `compact`；高频状态和通知可以默认 `minimal`；`full` 必须显式请求。
3. detail 只控制字段投影，不改变查询命中集合；过滤由 scope、severity 等独立参数控制。
4. 不允许静默截断。达到条目或字节预算时返回 `truncated`、`nextCursor` 和原因。
5. 可分页 provider 结果基于冻结 snapshot；后续页不得重新调用 provider 冒充同一结果集。
6. compact 按文件分组并使用 workspace-relative path，消除每条结果中的重复路径和 URI。
7. 修改工具默认不回显 edit text；只有 `detail=full` 且 `includeEditText=true` 时返回。
8. 增加 `vscode_bridge_help`，但各工具自身仍声明默认 detail、分页和高成本字段。
9. v2 使用统一 envelope；legacy RPC 在兼容期内继续获得原有裸响应。

## 统一响应形状

```json
{
  "detail": "compact",
  "data": {},
  "meta": {
    "protocolVersion": 2,
    "total": 42,
    "returned": 20,
    "truncated": true,
    "nextCursor": "opaque-token",
    "snapshotId": "uuid",
    "reason": "limit"
  }
}
```

- `total` 是过滤后的逻辑结果总数，不是文件组数或 JSON 数组长度。
- `returned` 是当前响应覆盖的逻辑结果数；minimal 聚合全部结果时可以等于 `total`。
- minimal 的字段投影不算截断。
- `truncated` 只表示受 limit 或 byte budget 影响，当前响应没有覆盖全部匹配结果。
- `nextCursor` 只在可继续读取时出现；snapshot 过期必须显式报错，不能静默重查。
- 空结果必须返回明确的空数组或零计数；不输出值为 `undefined` 的字段。

## 架构边界

- bridge 继续是 VS Code API 与 Pi tool API 之间的薄 adapter。
- 不引入语义搜索、Agent 规划、结果相关性排序或长期索引。
- 不把 cursor 当作跨 VS Code 窗口或跨 extension restart 的持久协议。
- 不承诺 VS Code command API 没有提供的信息。现有
  `vscode.executeDefinitionProvider` 等命令不返回实际 provider 身份，full 最多记录调用的
  VS Code command，不能声称返回语言扩展或 provider 名称。
- `workspace.applyEdit()` 完成不代表语言服务器诊断已稳定；修改响应只能标记即时诊断观察，
  最终诊断通过后续 `diagnostics_changed` 和 diagnostics 查询取得。

## 文档

- [audit.md](audit.md)：当前实现事实、重复输出和协议风险。
- [plan.md](plan.md)：字段矩阵、分页、预算、通知和兼容迁移设计。
- [acceptance.md](acceptance.md)：自动化与集成验收标准。
- [open-source-test-corpora.md](open-source-test-corpora.md)：参数实验可复用的开源语料、框架与许可证评估。
- [experiments.md](experiments.md)：只针对 references 的最小参数敏感性实验 v0。
- [result.md](result.md)：参数实验 v0 的执行结果、候选区间、偏差和复现方式。
- [result-v0.1.md](result-v0.1.md)：扩大规模与参数分辨率后的复跑结果。
- [full-parameter-experiments.md](full-parameter-experiments.md)：全参数分层扫描的范围、矩阵和 gate。
- [full-parameter-result-v1.md](full-parameter-result-v1.md)：全参数实验结果和候选默认值。
- [implementation-result.md](implementation-result.md)：实际实现、验证、兼容边界和回滚说明。
- [ablation-experiments.md](ablation-experiments.md)：逐项移除 v2 机制的实验设计与 gate。
- [ablation-result-v1.md](ablation-result-v1.md)：消融实验结果与机制贡献结论。

机器可读实验明细见 [experiment-results-v0.json](experiment-results-v0.json) 和
[experiment-results-v0.1.json](experiment-results-v0.1.json)。
全参数机器可读明细见 [full-parameter-results-v1.json](full-parameter-results-v1.json)。

## 暂未纳入初版

- hover、selection、code actions 等其余工具的完整字段矩阵。
- 跨重启 snapshot 或通知消费位置持久化。
- provider 相关性排序或结果去重启发式。
- edit text 的分块下载协议；初版在操作前拒绝无法完整返回的显式文本请求。
- 移除 `vscode_clear_notifications`；初版只标记为兼容接口。

## 状态清单

- [x] 完成初始代码审计。
- [x] 固化 v2 响应与四类重点工具的初版设计。
- [x] 定义验收边界。
- [x] 收敛首轮参数实验范围。
- [x] 完成 references 参数敏感性实验 v0。
- [x] 完成全参数 canonical 敏感性实验 v1。
- [x] 确认剩余未决参数。
- [x] 开始代码实现。
- [x] 完成兼容迁移与验收。
