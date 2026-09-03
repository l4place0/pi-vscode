# 实施前审计

## 1. 当前调用链

`bridge/pi-vscode-bridge.js` 注册 `vscode_*` Pi tools，通过带随机 token 的 loopback HTTP RPC
调用 `src/bridge/handlers.ts`。VS Code 侧返回 `{ result }`，Pi extension 再把 result 序列化为
tool text。

当前 Pi extension 设置 50 KiB 和 2000 行输出上限。超限时 `boundedJson()` 返回：

```json
{
  "truncated": true,
  "originalBytes": 0,
  "originalLines": 0,
  "resultJsonPrefix": "..."
}
```

该结构没有稳定 continuation cursor，JSON 前缀也不是可继续消费的完整业务结果。

## 2. Editor state

`getEditorState` 无参数并一次返回：

- workspace folders；
- active editor；
- current selection；
- cached latest selection；
- open editors。

editor、selection 和 workspace folder 都同时包含绝对路径与 URI。`getOpenEditors()` 合并
`visibleTextEditors` 和 `workspace.textDocuments`，所以结果不是严格意义上的 VS Code tabs，
也没有 tab group、pinned/preview 或 visible ranges 等信息。

`getStatus` 是状态栏轮询使用的内部紧凑接口，刷新周期为 1500 ms。它已经只返回 active editor、
selection status 和诊断计数，不需要为了公开 editor state 协议而扩张。

## 3. Diagnostics

`getDiagnostics(filePath?)` 只支持单文件或整个 workspace：

- 指定 `filePath` 时查询一个 URI；
- 未指定时调用 `vscode.languages.getDiagnostics()` 查询全部诊断；
- 每个文件即使没有诊断也返回 path、URI 和 diagnostics array；
- 每条 related information 再次返回 path 和 URI；
- 不支持 severity filter、scope、limit、cursor 或稳定分页。

`serializeDiagnostic()` 同时返回数值 severity 和文本 severityLabel。workspace 大或 provider 输出多时，
重复字段会显著增加结果尺寸。

## 4. Symbols 与 locations

document symbols 保留递归 children；workspace symbols 和 location 类结果逐项序列化。
references、definitions、type definitions、implementations 和 declarations 都会在每条 location 中
重复 filePath 与 fileUri。

所有 provider 命令先取得完整数组，再一次返回。当前没有分页、snapshot、TTL 或 cursor mismatch
检测。若简单增加 offset 而每页重新执行 provider，编辑、索引刷新或 provider 排序变化会造成重复或
漏项。

VS Code 的 `vscode.execute*Provider` command 返回标准 location/symbol 数据，不返回实际 provider
身份。协议不得把 command 名称误写成 provider 名称。

## 5. 修改工具

`applyWorkspaceEdit` 回显每个 edit 的文件路径和 range；`formatDocument` 与 `formatRange` 还会
无条件返回每个 formatter edit 的完整 `newText`。

当前响应没有统一区分：

- 调用方请求或 formatter 产生的 edit 数；
- apply 成功后实际改变的文件数；
- apply 失败时哪些计数仍只是计划值；
- 立即读取的诊断与 provider 已稳定后的诊断。

输入请求上限为 4 MiB，而输出硬上限为 50 KiB。若修改成功后才发现显式请求的 edit text 无法
完整返回，调用方会得到不可恢复的不完整结果，因此文本返回预算必须在 apply 前验证。

## 6. Notifications

通知存放在最多 100 条的进程内数组中。事件使用随机 UUID 和 `Date.now()` timestamp；查询使用
`timestamp > since`，然后 `slice(-limit)` 取得最新事件。

风险包括：

- 同一毫秒产生的事件可能被 `since` 过滤遗漏；
- 返回最新 limit 条会跳过更早的未读事件；
- ring buffer 溢出后调用方无法判断发生过数据缺口；
- selection、visible editors 和 diagnostics 高频事件没有合并；
- `clearNotifications` 会清除所有潜在消费者共享的状态。

## 7. 兼容约束

工具名由 bundled Pi extension 注册，extension 与 bridge server 通常同版本发布，但 loopback RPC
仍可能被 smoke fixture、旧 session 或外部调试调用。直接把所有裸返回替换成 envelope 会破坏这些
调用方。

初版需要显式的 v2 协议协商。仅以是否出现 `detail` 推断版本不够稳健，因为未来 legacy 参数也可能
重名。
