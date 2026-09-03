# Bridge response protocol v2 实施结果

- 完成时间：2026-09-03
- 状态：completed
- 实施依据：`audit.md`、`plan.md`、`acceptance.md` 与 `full-parameter-result-v1.md`

## 结果

Bridge response protocol v2 已接入 bundled Pi extension 与 VS Code loopback bridge。Pi 工具调用
默认显式注入 `responseVersion: 2`；未声明该版本的直接 RPC 调用继续走 legacy 裸响应分支。

已落实的实验参数为：一般工具 `compact`、通知 `minimal`、diagnostics 100、references 75、
workspace symbols 200、默认/调用方最大/Pi 硬输出预算 32/40/50 KiB、snapshot TTL 120 秒、
snapshot 16 个/50000 canonical items、edit text 24 KiB、notification limit/ring 50/500，默认
`start=buffer` 且启用 coalescing。

## 实现范围

- 新增统一 envelope、结构化错误、UTF-8 byte budget、compact path 和 instance-bound snapshot
  cursor；分页只读取冻结 canonical snapshot，支持 limit/byteBudget 原因、TTL 和容量淘汰。
- diagnostics 支持 active/open/workspace/uris scope、severity filter、稳定排序与三级投影；active
  editor 不存在时返回空结果和 warning，不扩大到 workspace。
- definitions、type definitions、implementations、declarations、references 共用 location 投影和分页；
  document symbols 使用稳定前序扁平结构，workspace symbols 按文件分组。
- editor state 提供 minimal/compact/full；full 区分 tabs、visible editors 和 open text documents，
  compact 不返回 selection text 或完整 URI。
- workspace edit、document format、range format 使用统一回执。默认不回显文本；显式文本超阈值会在
  apply 前拒绝，失败操作不会计入已应用 edit/files，diagnostics 标记为 immediate observation。
- notifications 改用 bridge instance + 单调 sequence cursor，支持 buffer/now、类型过滤、稳定正向
  分页、合并规则和 ring gap resync 提示。
- 新增 `vscode_bridge_help`，提供工具索引、参数、默认值、detail 字段矩阵、分页单位和成本提示。
- Pi 最后一道 50 KiB 保护对 v2 返回结构化 `V2_RESPONSE_TOO_LARGE`，不再输出不完整
  `resultJsonPrefix`；旧 bridge 返回仍保留 legacy fallback。
- bridge dispose 会释放 snapshot；高频内部 `getStatus` 保持原有轻量 legacy 路径。

## 主要文件

- `src/bridge/protocol.ts`：envelope、错误、预算、path、snapshot 与 sequence cursor。
- `src/bridge/projections.ts`：canonical 类型、稳定排序、detail 投影与 notification 合并/窗口。
- `src/bridge/handlers-v2.ts`：v2 diagnostics、locations、symbols、editor、edits、notifications 和 help。
- `src/bridge/handlers.ts`：显式 v2 分流及 legacy 保留。
- `src/bridge/state.ts`、`src/bridge/types.ts`、`src/bridge/server.ts`：instance、sequence、ring、
  snapshot 生命周期。
- `bridge/pi-vscode-bridge.js`：v2 参数注入、公开 schema/description、help tool 和 Pi 硬上限保护。
- `test/bridge-*.test.*`、`test/integration/*`：纯协议、Pi 注册契约与真实 loopback 集成覆盖。

## 自动化验证

| 命令                                                                         | 结果                                                      |
| ---------------------------------------------------------------------------- | --------------------------------------------------------- |
| `pnpm lint`                                                                  | PASS，0 warnings / 0 errors                               |
| `pnpm typecheck`                                                             | PASS                                                      |
| `pnpm test:unit`                                                             | PASS，15 files / 107 tests（含后续消融实验）              |
| `pnpm build`                                                                 | PASS                                                      |
| `pnpm test:pi 0.84.4`                                                        | PASS，真实 Pi CLI、offline RPC 与 bundled bridge 加载通过 |
| `pnpm test:integration`（`VSCODE_EXECUTABLE_PATH` 指向本机 VS Code 1.136.0） | PASS                                                      |
| `pnpm package`                                                               | PASS，生成 `pi-vscode-fork-0.1.0.vsix`                    |
| `node scripts/verify-vsix.mjs`                                               | PASS，7 个必需 artifact 均存在                            |
| `pnpm test:vsix`（本机 VS Code 1.136.0）                                     | PASS，安装、激活、terminal 启动和卸载通过                 |
| `git diff --check`                                                           | PASS                                                      |

Extension Host 集成测试新增真实 loopback RPC 覆盖：legacy/v2 分流、三种 editor detail、diagnostics、
精确 help、超大 edit text 操作前拒绝、成功 edit 回执，以及 edit 后 sequence notification 读取。
单元测试覆盖 envelope、跨平台/multi-root path、snapshot 稳定分页/过期/淘汰/预算、diagnostics、
locations、symbols、editor、edits、notification coalescing/cursor/ring 和 Pi tool schema/硬上限。

默认测试入口尝试下载 VS Code 1.110.0 时，上游连接三次中止；随后使用已安装的 VS Code 1.136.0
完成相同 Extension Host 与 VSIX smoke。该下载问题未涉及仓库代码或持久环境修改。

## 与计划的偏差

- 未向 full location 的 `meta` 增加请求位置；计划将其列为可选调试信息，当前实现继续避免扩大公共
  meta。
- 对 edit text 的调用方 byte budget 使用与 24 KiB 阈值相同的
  `EDIT_TEXT_RESPONSE_TOO_LARGE` 操作前错误，明确满足最终安全预算约束。
- 固定 VS Code 1.110.0 的下载受网络中止影响，真实运行验证改用本机 1.136.0；Pi 0.84.4 仍按指定
  版本执行。

## 兼容与遗留边界

- legacy RPC 分支保留；移除必须在后续兼容周期单独决定。
- 本轮重点字段矩阵覆盖设计中列出的 diagnostics、locations、symbols、editor、edits 和
  notifications。selection、hover、code actions 等非重点工具已经进入 v2 envelope，但仍复用 legacy
  业务 payload，后续可独立做字段压缩。
- snapshot 与 notification cursor 都是进程内协议，不跨 extension restart 持久化。
- 实验给出的默认值已经落地；真实 provider/Agent 长周期观测若显示偏差，应以新的测量变更参数。

## 回滚

回滚协议实现时，应恢复 `bridge/pi-vscode-bridge.js`、`src/bridge/handlers.ts`、
`src/bridge/server.ts`、`src/bridge/state.ts` 和 `src/bridge/types.ts`，并移除新增的
`handlers-v2.ts`、`protocol.ts`、`projections.ts` 及对应测试。参数实验及其结果文档相互独立，可保留
作为后续设计依据。当前未创建 commit、未发布扩展，也未修改机器级或用户级持久配置。

## 后续消融验证

实现完成后增加 9 项独立机制消融。结果确认 snapshot、byte-budget pagination、sequence cursor、
edit-text preflight 和显式 version gate 承担正确性/安全不变量；compact grouping、diagnostics 默认过滤、
notification coalescing 和 editor compact 默认承担显著输出成本控制。详见
[ablation-result-v1.md](ablation-result-v1.md)。
