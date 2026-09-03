# 实施方案

## 1. 公共协议类型

引入公共 detail、envelope、meta、path reference 和分页错误类型。公开 v2 响应统一为：

```ts
type Detail = "minimal" | "compact" | "full";

interface BridgeEnvelope<T> {
  detail: Detail;
  data: T;
  meta: {
    protocolVersion: 2;
    total?: number;
    returned?: number;
    truncated: boolean;
    nextCursor?: string;
    snapshotId?: string;
    reason?: "limit" | "byteBudget";
    warnings?: string[];
  };
}
```

compact path reference：

```ts
interface CompactPath {
  path: string;
  workspaceFolder?: string;
  pathKind?: "relative" | "absolute";
}
```

workspace 内路径使用正斜杠和 workspace-relative path。multi-root 下返回 workspace folder name；
workspace 外路径使用规范化绝对路径并标记 `pathKind: "absolute"`。full 才增加平台原始
`filePath` 和完整 `uri`。

## 2. Detail 与过滤规则

- detail 只控制返回字段，不能隐式改变 scope、severity 或其他过滤条件。
- 一般工具默认 `compact`。
- `getStatus` 等内部高频接口保持固定轻量结构。
- `vscode_get_notifications` 默认 `minimal`。
- `full` 必须显式请求。
- minimal 的聚合是完整字段投影，不设置 `truncated=true`。
- full 表示 bridge 能取得并安全序列化的完整标准字段，不等于暴露 VS Code 内部对象。

## 3. Diagnostics

参数：

```ts
interface DiagnosticsParams {
  detail?: Detail;
  scope?: "active" | "open" | "workspace" | "uris";
  uris?: string[];
  severity?: Array<"error" | "warning" | "information" | "hint">;
  limit?: number;
  cursor?: string;
}
```

v2 默认 `detail=compact`、`scope=active`、severity 为 error 与 warning。`scope=uris` 时 `uris`
必需；其他 scope 出现 `uris` 时返回参数错误。

| detail  | data 字段                                                     |
| ------- | ------------------------------------------------------------- |
| minimal | `counts`、`fileCount`                                         |
| compact | `counts`、`files[].path/workspaceFolder/counts/diagnostics[]` |
| full    | compact 加 `filePath/uri` 和诊断完整标准字段                  |

compact diagnostic 返回 `severity`、`message`、`range`，以及存在时的 `code`、`source`。
full 增加数值 severity、tags、完整 code 和 relatedInformation。compact 只返回至少包含一个命中
诊断的文件；limit 按 diagnostic 数而不是文件数计算。

排序规则：scope=uris 保持输入 URI 顺序，其余按规范化路径、range、severity、message 排序。
active editor 不存在时返回空结果和 warning，不退化为 workspace。

## 4. Location provider 结果

definitions、type definitions、implementations、declarations 和 references 共用同一投影器与分页器。

| detail  | data 字段                                                            |
| ------- | -------------------------------------------------------------------- |
| minimal | `count`、`fileCount`                                                 |
| compact | `files[].path/workspaceFolder/locations[].range`                     |
| full    | compact 加文件 `filePath/uri` 和 location 的 selection/origin ranges |

查询的 filePath 与 position 默认不回显。full 可以在 `meta.request` 中记录规范化查询位置，但初版
优先避免扩大公共 meta，待实现时确认是否确有调试需要。

每个文件只出现一次 path header。location 按规范化 URI、target range、selection range 排序。
full 可以记录使用的 `vscode.execute*Provider` command，但不得声明实际 provider identity。

## 5. Symbols

document symbols 先转为稳定的前序扁平列表，以兼容分页：

```ts
interface FlatDocumentSymbol {
  id: string;
  parentId?: string;
  depth: number;
  name: string;
  kind: string;
  range: Range;
  detail?: string;
  tags?: number[];
  selectionRange?: Range;
}
```

| detail  | document symbols                                       |
| ------- | ------------------------------------------------------ |
| minimal | `count`、`topLevelCount`、`countsByKind`               |
| compact | `id,parentId,depth,name,kind,range`                    |
| full    | compact 加 `detail,tags,selectionRange` 和完整文件身份 |

workspace symbols 按文件分组。compact symbol 返回 `name`、`kind`、`range` 和存在时的
`container`；full 增加 tags、selectionRange、filePath 和 URI。

初版不在 full 中恢复递归 children，避免同一 symbol 同时拥有分页和不完整子树两种表示。

## 6. Snapshot pagination

首次 provider 调用取得完整结果后执行：

1. 规范化和稳定排序。
2. 建立随机 snapshot ID，保存轻量 canonical result。
3. 根据 limit 与 byte budget 投影第一页。
4. 生成绑定 snapshot、offset、method、查询 fingerprint 和 detail 的不透明 cursor。

后续页只读取 snapshot。改变绑定参数返回 `CURSOR_MISMATCH`；TTL 到期返回
`CURSOR_EXPIRED`，不得自动重跑 provider。

全参数 canonical 实验确认的初版值：

- snapshot TTL：2 分钟；
- 单页默认 logical item limit：diagnostics 100、references 75、workspace symbols 200；
- snapshot 数量上限 16，总 canonical item 数上限 50000；
- 翻页期间不允许改变 detail。

## 7. Editor state

`vscode_get_editor_state` 改为接受可选 detail。

| detail  | data 字段                                                                            |
| ------- | ------------------------------------------------------------------------------------ |
| minimal | `cwd`、`active.path/languageId/isDirty/cursor/selection`                             |
| compact | minimal 加 `selectionSource`、workspace folder 和 open editor 摘要                   |
| full    | compact 加完整 URI、current/latest selection、selection text、tabs 和 visible ranges |

`cwd` 复用 `resolveWorkingDirectory()`，保持 multi-root 规则。minimal selection 只包含 range 与
`isEmpty`。compact 只返回一份有效 selection，并用 `selectionSource: active | latest` 说明来源。
full 才返回 current/latest 两套状态和选中文本。

实现 full 时分别采集 `window.tabGroups` 和 `visibleTextEditors`，不再把 textDocuments 描述为
tabs。公开 editor state 与专用 selection/open editors 工具的长期去重策略在初版实施后再评估。

## 8. 修改工具

apply workspace edit、format document 和 format range 使用统一结果摘要：

| detail      | data 字段                                                        |
| ----------- | ---------------------------------------------------------------- |
| minimal     | `applied,requestedEditCount,editCount,filesChanged`              |
| compact     | minimal 加按文件分组的 ranges、editCount 和即时 diagnostics 摘要 |
| full        | compact 加完整路径、URI 和 edits metadata                        |
| full + text | edits 增加完整 `oldText/newText`                                 |

规则：

- `includeEditText=true` 只允许与 `detail=full` 组合。
- 默认 edit metadata 只含 range、oldLength/newLength，不含文本。
- apply 失败时 `editCount=0`、`filesChanged=0`；`requestedEditCount` 保留计划值。
- diagnostics 标记 `observation: "immediate"`，不得暗示 provider 已稳定。
- 显式文本预计超过安全输出预算时，在 apply 前返回 `EDIT_TEXT_RESPONSE_TOO_LARGE`。
- 初版不实现单个 edit text 的分块 continuation。

## 9. Help 工具

新增：

```ts
vscode_bridge_help({
  tool?: string,
  topic?: "overview" | "parameters" | "detail" | "pagination" |
    "paths" | "cost" | "compatibility" | "notifications",
  level?: Detail
})
```

无参数时返回分类、工具索引和默认 detail。指定 tool 时返回参数、默认值、字段矩阵、分页单位和
成本提示；指定 level 时只展开对应 detail。未知工具返回明确错误及有限候选，不做模糊执行。

help 自身返回固定 compact envelope，不要求分页。每个业务工具 description 仍需说明默认 detail、
是否分页、full 成本和 includeEditText 限制。

## 10. 输出预算

协议使用 UTF-8 byte budget，不使用依赖具体模型 tokenizer 的 token budget。计划支持：

```ts
limit?: number;
maxOutputBytes?: number;
```

初版默认软预算为 32 KiB，调用方允许请求的最大值为 40 KiB，严格低于 Pi extension 当前
50 KiB 硬上限。序列化器
只在完整逻辑条目边界分页。达到 limit 或预算时设置 `truncated=true`、`nextCursor` 和
`reason`。

v2 不返回 `resultJsonPrefix`。现有 `boundedJson()` 只作为 legacy 和最后一道保护；如果 v2
envelope 仍超过硬上限，应返回明确的内部协议错误，暴露预算实现缺陷。

## 11. Notification cursor 与合并

每个 bridge instance 生成 instance ID；事件使用进程内单调递增 sequence。cursor 绑定 instance
和最后读取 sequence，替代毫秒 timestamp。

```ts
interface NotificationParams {
  afterCursor?: string;
  start?: "buffer" | "now";
  detail?: Detail;
  limit?: number;
  types?: string[];
  coalesce?: boolean;
}
```

无 cursor 时默认 `start=buffer`。响应从旧到新返回最早的未读 limit 条，不得取最后若干条。

合并规则：

- 同一文档的连续 selection events 只保留最后一个；
- 连续 active/visible editor events 各保留最后一个；
- 连续 diagnostics events 合并 URI 集合；
- dirty events 按文件保留最后状态；
- saved event 不丢弃，并构成 dirty 合并屏障；
- 不跨不同语义事件任意重排。

minimal 返回 sequence、type、path 等事件头；compact 增加合并后的业务 payload；full 增加完整
路径、URI、原始事件和 coalescing 信息。

若 consumer cursor 已落后于 ring buffer，返回 `gap.resyncRequired=true` 和最早可用 sequence，
不能静默继续。调用方随后重新读取 editor state 或 diagnostics。`clearNotifications` 初版保留兼容，
但不作为 v2 正常消费流程。

## 12. 兼容迁移

1. bundled Pi extension 内部为新调用注入 `responseVersion: 2`，并补全工具默认 detail。
2. 未声明 v2 的直接 RPC 调用继续获得现有裸响应。
3. 新 schema 暴露 detail、scope、limit 和 cursor；公开结果使用 envelope。
4. `meta.protocolVersion` 固定为 2。
5. README 同时记录 v2 和 legacy 兼容窗口。
6. 经过至少一个兼容周期并检查 smoke fixture 后，再单独决定是否移除 legacy 分支。

不得只根据是否出现 detail 猜测协议版本。

## 13. 实施顺序与提交边界

```text
docs: design bridge response protocol v2
refactor: add bridge response envelopes and compact paths
feat: add scoped paginated diagnostics
feat: add snapshot pagination for locations and symbols
feat: add detailed editor state projections
feat: summarize bridge edit results
feat: add sequence cursors for bridge notifications
feat: add bridge protocol help
docs: document bridge response protocol migration
```

每个功能提交增加对应单元测试。公共 envelope 和 compatibility 完成前，不批量切换所有 handler。
