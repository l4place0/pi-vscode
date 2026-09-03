# 验收方案

## 1. 单元测试

### Working directory

- resource URI 位于 workspace B。
- active editor 位于 workspace B。
- resource URI 优先于 active editor。
- 单 workspace、无 workspace、URI 不属于 workspace。
- Explorer 文件未打开。
- Session restore 保留 cwd。

### Process execution

- `C:\\tools\\pi.cmd`
- `C:\\tools\\pi.exe`
- `C:\\tools\\pi.ps1`
- `/usr/local/bin/pi`
- 带空格路径和 shell 元字符参数。
- cwd/env/stdio 透传。
- spawn 同步异常。
- cancellation 和 kill。

Windows CI 运行临时 `.cmd` fixture，证明测试不只验证字符串规划。

Windows terminal launch 还必须使用 `createPiTerminalLaunch()` 返回的
`shellPath`/`shellArgs`，按 VS Code Terminal/Node PTY 的普通参数序列化方式启动真实
`.cmd` fixture。该路径不能依赖 `windowsVerbatimArguments`，因为 VS Code
`TerminalOptions` 不提供这个选项。

### RPC

- UTF-8 字符跨 chunk。
- LF/CRLF JSONL。
- malformed JSON 不导致宿主崩溃。
- `message_update/text_delta`。
- `agent_end` with `willRetry: true` 不提前关闭。
- `agent_settled` 正常结束。
- select/confirm/input/cancelled response。
- abort 和非零退出。

## 2. 无 API key 的 Pi smoke

固定 Pi 0.84.4：

1. `pi --version` 可以执行。
2. `pi --help` 包含关键 CLI flags。
3. `pi --mode rpc --no-session --offline` 可以启动。
4. 发送 `get_state` 并收到成功 response。
5. bundled bridge extension 可以加载。
6. 临时 loopback bridge 收到 `getStatus` 或 session report 请求。
7. 没有 `extension_error`，进程可以正常关闭。

真实 prompt/text delta 测试只放在可选的手动或定时任务中，不把付费 API key 作为普通 PR 的要求。

## 3. Extension Host 集成测试

- Extension activation 成功。
- fork command IDs 全部注册。
- bridge 能绑定动态 loopback 端口。
- Terminal Profile 注册成功。
- Packages view provider 注册成功。
- deactivate 能释放 bridge。

## 4. 跨平台 CI

平台矩阵：

```text
ubuntu-latest
windows-latest
macos-latest
```

每个平台执行：

```text
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm build
Pi 0.84.4 smoke
```

PR 中 Pi 0.84.4 为阻断基线；Pi latest 提供兼容报告。定时任务运行 latest smoke，release candidate 要求固定版本和当时 latest 都通过。

## 5. VSIX 验收

VSIX 内容至少包括：

```text
extension/package.json
extension/dist/extension.cjs
extension/bridge/pi-vscode-bridge.js
extension/assets/icon.png
extension/assets/logo.svg
extension/LICENSE
extension/README.md
```

本地安装流程：

```text
pnpm build
pnpm exec vsce package --no-dependencies
code --install-extension <generated.vsix> --force
```

在独立 `--user-data-dir` 和 `--extensions-dir` 中验证安装、激活和卸载，避免污染日常 VS Code 环境。

上述隔离流程由 `pnpm test:vsix` 自动执行，并额外调用 `Pi Fork: Open`、使用临时 Pi
fixture 检查终端不会立即退出。完整自动门禁使用 `pnpm acceptance`；长期流程见
`docs/acceptance.md`。

## 6. 手工验收

Windows、macOS、Linux 各执行一次：

1. `pnpm install && pnpm test && pnpm build`。
2. F5 打开 Extension Development Host。
3. 状态栏出现 fork 标识。
4. `Pi Fork: Open` 正常启动且终端保持运行；Windows npm/Scoop `.cmd` shim 不得闪退。
5. multi-root active editor 在 repo B 时 cwd 为 repo B。
6. Explorer 右键 repo B 文件时路径和 cwd 正确。
7. `@pi` 能流式输出。
8. confirm/select/input 使用原生 VS Code UI。
9. Session 重载后恢复原 cwd。
10. Packages list/install/remove 在隔离的 Pi 配置目录中验证。
11. 官方插件与 fork 同时安装时，命令、设置、sidebar 和 session state 不冲突。
12. 本地 VSIX 在干净 profile 中安装、激活、卸载成功。

## 7. Release candidate 门禁

- 所有三平台阻断检查通过。
- Pi 0.84.4 和当时 latest smoke 通过。
- Git worktree 只包含预期 release 修改。
- VSIX 内容检查通过。
- 干净 profile 安装验收通过。
- `result.md` 已记录实际提交、验证结果、遗留问题和回滚方式。
