# 验收方案

## 1. 公共 envelope

- minimal、compact、full 都返回合法 v2 envelope。
- `protocolVersion=2`、detail 和实际投影一致。
- 空结果返回零计数或空数组，不出现无意义的空文件组。
- `undefined` 字段不进入 JSON。
- detail 改变字段但不改变同一过滤条件的 `total`。
- minimal 完整聚合不被标记为 truncated。

## 2. 路径投影

- 单 workspace 文件返回正斜杠相对路径。
- multi-root 中同名相对路径可由 workspace folder 区分。
- workspace 外文件返回规范化绝对路径和 pathKind。
- compact 不包含 file URI 或重复绝对路径。
- full 包含可用于 VS Code 操作的 filePath 和 URI。

Windows、macOS/Linux 路径 fixture 都需要覆盖。

## 3. Diagnostics

- active、open、workspace、uris 四种 scope 行为明确。
- active editor 不存在时不退化为 workspace。
- severity filter 在三个 detail level 下命中集合一致。
- compact 只返回有命中诊断的文件。
- related information 仅在 full 返回，且字段无损。
- limit 按诊断条数分页，文件组跨页时仍是合法结构。
- 同样 snapshot 的所有页合并后无重复、无漏项。

## 4. Locations 与 symbols

- definitions、type definitions、implementations、declarations 和 references 共用一致结构。
- compact 每个文件只出现一次路径。
- Location 与 LocationLink 在 full 下保留各自 selection/origin ranges。
- document symbol 扁平化保持稳定前序、parentId 和 depth。
- workspace symbols 按文件分组，container 不丢失。
- full 不虚构 provider identity。

## 5. Snapshot pagination

- 首次查询只调用 provider 一次；后续页面只读 snapshot。
- provider 原始结果顺序不稳定时，规范化结果仍稳定。
- 编辑文档后继续旧 cursor，不会混入新 provider 结果。
- 参数或 detail 改变返回 CURSOR_MISMATCH。
- snapshot 到期返回 CURSOR_EXPIRED，不自动重查。
- limit 和 byte budget 两种截断都返回 reason 与 continuation cursor。
- snapshot 数量、条目数和 TTL 上限能释放内存。

## 6. Editor state

- minimal 只含 cwd、active file、cursor/selection 和 dirty state。
- compact 增加 workspace/open editor 摘要，但不重复 current/latest selection text。
- selectionSource 能区分 active 与 cached latest selection。
- full 能区分 tabs、visible editors 和 open text documents。
- multi-root active editor 对应正确 cwd 和 workspace folder。
- 状态栏 `getStatus` 的频率和现有显示不因公开协议变重。

## 7. 修改工具

- no-op format 返回 applied=true、editCount=0、filesChanged=0。
- 单文件和多文件 edit 的 requested/edit/file counts 正确。
- apply 失败时不把计划 edit 计为已应用。
- compact 按文件合并 ranges，不回显 newText。
- full 默认只返回 edit metadata。
- includeEditText 与非 full 组合被拒绝。
- includeEditText 超出安全预算时在 apply 前失败，文件和 editor buffer 保持不变。
- 即时 diagnostics 明确标记 observation，不宣称已稳定。

## 8. 输出预算

- 结果不会在字符串中间或 JSON 条目中间截断。
- v2 正常路径不返回 resultJsonPrefix。
- 所有 truncated v2 响应都说明原因；可分页结果都提供 nextCursor。
- 单条超大且初版不可分页的显式文本请求返回明确错误。
- Pi tool 最终文本保持在硬上限内。

## 9. Notifications

- sequence 在一个 bridge instance 内严格递增。
- 同一毫秒生成多个事件不会漏读。
- 分页从旧到新返回最早未读事件，不跳过中间事件。
- coalesce=true 符合 selection、editor、diagnostics、dirty 和 saved 合并规则。
- coalesce=false 可用于 full 调试且保持原始顺序。
- ring buffer 覆盖未读事件时返回 resyncRequired gap。
- 旧 instance cursor 在 extension restart 后返回 cursor/instance mismatch。
- start=now 能建立空基线并返回可继续使用的 cursor。

## 10. Help 与工具描述

- 无参数 help 返回工具索引和默认 detail。
- tool/topic/level 查询返回精确字段与默认值。
- help 说明分页单位、scope/filter 和 full 成本。
- 未知工具不会触发模糊匹配执行。
- 每个业务工具自身 description 足以在不调用 help 时选择默认或 full。

## 11. Legacy compatibility

- 未声明 responseVersion 2 的 RPC fixture 继续获得当前裸响应。
- bundled Pi extension 发出的新调用默认获得 compact/minimal v2 envelope。
- 显式 full 调用获得 v2 full，不进入 legacy 分支。
- Pi smoke、Extension Host integration 和 VSIX smoke 均继续通过。
- compatibility 分支的移除必须是后续单独决策，不能随 v2 初版隐式删除。

## 12. 标准验证

实施阶段每批提交至少运行：

```text
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
```

协议全部接入后运行仓库长期门禁中与 bridge、Pi smoke、Extension Host 和 VSIX 相关的检查，
并在 `result.md` 记录实际命令、结果、遗留问题和回滚方式。
