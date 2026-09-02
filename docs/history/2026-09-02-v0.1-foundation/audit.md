# 实施前审计

## Pi namespace

仍使用旧 `@mariozechner/pi-coding-agent` 的实际位置：

- `src/upgrade.ts`
- `src/chat.ts`
- `README.md`
- `test/resolve.test.ts`

目标包名是 `@earendil-works/pi-coding-agent`。npm 安装命令应采用 Pi 当前推荐的 `--ignore-scripts`；其他包管理器分别确认参数形式，不机械复制 npm 参数。

## cwd 与 multi-root

以下位置直接使用 `workspaceFolders[0]`：

- `src/terminal.ts`：新终端 cwd、Open with File 上下文。
- `src/chat.ts`：RPC cwd。
- `src/extension.ts`：Terminal Profile cwd。
- `src/bridge/utils.ts`：相对路径解析。

Explorer 右键传入的 `resourceUri` 当前被忽略。Session restore 只保存 session file，没有保存原 cwd。

## Pi process execution

当前直接执行 Pi 的位置：

- `src/chat.ts`：`spawn()`。
- `src/packages.ts`：`execFile()` 和 `spawn()`。
- Terminal/Terminal Profile：直接把 Pi 路径作为 `shellPath`。
- Upgrade：拼接命令字符串后发送到终端。

Windows 实测结果：

- 直接 spawn/execFile `.cmd` 会抛出 `EINVAL`。
- 直接 spawn `.ps1` 会抛出 `EFTYPE`。
- `.exe` 可以直接执行。

因此 resolver 虽能找到 `.cmd/.ps1`，当前执行层并不兼容它们。

## RPC 与 Pi extension API

RPC 当前使用：

- `--mode rpc`
- `--no-session`
- `--extension <bridge>`
- `--append-system-prompt <text>`

终端恢复额外使用 `--session <sessionFile>`。

Bridge 使用的 Pi extension API：

- `pi.registerTool()`
- `pi.on()` 的 `session_start`、`input`、`agent_end`、`session_shutdown`
- `ctx.hasUI`
- `ctx.ui.theme.fg()`
- `ctx.ui.setStatus()`
- `ctx.sessionManager.getSessionFile()`

项目没有 import Pi SDK。主要耦合面是 CLI flags、RPC JSONL 和 Pi extension runtime API，符合薄 adapter 定位。

Pi 0.84.x 已区分 `agent_end` 和最终的 `agent_settled`。当前在 `agent_end` 后关闭 stdin 存在提前终止 retry、compaction retry 或 follow-up 的风险。

## Packages sidebar

当前 Webview 同时承担：

- 一次 npm registry search。
- 最多 250 次 latest metadata fan-out。
- Pi package schema 解释。
- 图片和视频展示。
- install/remove/update 与命令输出。

第一版不删除该功能，但执行方式、安全边界和输入校验需要收口。完整 registry browser 是否继续保留，留给后续版本决定。

## 测试、CI 与开发配置

- 现有 25 个 Vitest 用例通过。
- `pnpm test` 当前没有执行 Vitest，只运行 lint 和 typecheck。
- CI 只运行 Ubuntu，没有 Windows/macOS 和 Pi smoke test。
- `.vscode/launch.json` 使用错误字段 `preLaunchTask2`。
- `.vscode/tasks.json` 硬编码 `zsh`，Windows F5 不可用。
- 缺少 `.gitattributes`，Windows `core.autocrlf=true` 下 Oxfmt 会把整个 checkout 判为格式不合格。

## Fork identity

当前 manifest 和 contribution IDs 仍沿用上游身份。仅修改 extension `name` 不足以进行可靠 A/B 测试，因为 commands、chat participant、terminal profile、views、configuration 和 session storage 都使用全局 `pi-vscode.*` 标识。

Marketplace 发布不属于本变更范围，但本地 fork 的 contribution IDs 仍需隔离。
