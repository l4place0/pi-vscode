# 实施方案

## 1. Namespace 迁移

将真实安装、升级和提示字符串迁移到：

```text
@earendil-works/pi-coding-agent
```

npm 默认安装命令：

```text
npm install --global --ignore-scripts @earendil-works/pi-coding-agent@latest
```

不替换历史 changelog；同步更新测试和正式文档。

## 2. 工作目录 abstraction

新增 `src/workspace.ts`：

```ts
resolveWorkingDirectory(resourceUri?: vscode.Uri): string | undefined
```

优先级：

1. 显式 `resourceUri` 所属 workspace。
2. active editor 所属 workspace。
3. 预留 SCM/repository root 扩展点，本版本不实现。
4. 第一个 workspace folder。
5. `undefined`，由终端或子进程继承默认 cwd。

统一调用方：

- 新 Pi terminal。
- Terminal Profile。
- Open with File。
- Send Selection。
- `@pi` RPC。
- Packages 命令。
- Session restore。

`buildOpenWithFileContext(resourceUri?)` 返回 `{cwd, contextLines}`：

- Explorer URI 优先于 active editor。
- 未打开的 Explorer 文件只提供真实路径，不伪造 selection。
- URI 与 active editor 为同一文档时才附带 cursor/selection。
- Explorer 目录使用所属 workspace 作为 cwd，并描述为目录上下文。

Session state 升级为带版本结构并保存 cwd，同时兼容旧的 `terminalId -> sessionFile` 数据。

## 3. Pi process abstraction

新增 `src/pi-process.ts`：

```ts
spawnPi(piPath, args, options);
execPi(piPath, args, options);
createPiTerminalLaunch(piPath, args);
```

内部执行计划：

```ts
interface PiInvocation {
  command: string;
  args: string[];
}
```

平台策略：

- Windows `.exe`：直接执行。
- Windows `.cmd/.bat`：显式调用 `ComSpec`，不全局设置 `shell: true`。
- Windows `.ps1`：显式调用 PowerShell，使用 `-NoProfile -NonInteractive -File`。
- Unix executable：直接执行。

要求：

- `cwd`、`env`、`stdio` 和 cancellation 完整透传。
- `execPi` 基于 `spawnPi` 收集 stdout/stderr，不再另走 `execFile`。
- 同步 spawn 异常转成正常 rejection。
- `.cmd` 转义覆盖空格、引号和 `& | < > ^ % !`。
- Webview message 不能形成任意 shell 命令。
- Terminal 与子进程共用 binary 类型判断。

## 4. RPC UI 与生命周期

将 JSONL reader 和 extension UI request handler 提取为可单测模块：

- `select` → `vscode.window.showQuickPick()`。
- `confirm` → 原生 warning/QuickPick 确认 UI。
- `input` → `showInputBox()`。
- `editor` → 暂时返回 `cancelled: true`。
- 用户关闭 UI → `cancelled: true`。
- `agent_settled` → 正常关闭 stdin。
- 兼容只发送 `agent_end` 的旧 Pi；`willRetry: true` 时不得关闭。
- Cancellation 先发送 `abort`，短超时后 kill。
- `extension_error` 转换为可诊断日志或 Chat 错误。

## 5. Packages sidebar 收口

- `list/install/remove` 使用 `execPi/spawnPi`。
- Webview 添加 CSP，限制 script/connect/img/media 来源。
- 校验消息类型、package source 和取消操作。
- 本版本不重写 registry 搜索 UI。

## 6. Fork 本地身份隔离

为了本地安装官方插件与 fork 做 A/B，隔离以下全局 contribution IDs：

```text
pi-vscode-fork.chat
pi-vscode-fork.open
pi-vscode-fork.openWithFile
pi-vscode-fork.sendSelection
pi-vscode-fork.updatePackages
pi-vscode-fork.terminal-profile
pi-vscode-fork.packages
pi-vscode-fork.path
pi-vscode-fork.terminalSessions
```

`name` 计划改为 `pi-vscode-fork`，`displayName` 改为 `Pi VSCode Fork`。正式 publisher 和 Marketplace identity 留到未来决定，本版本不执行 Marketplace/Open VSX publish。

以下进程内部协议名可以保留：

- `PI_VSCODE_BRIDGE_URL`
- `PI_VSCODE_BRIDGE_TOKEN`
- `x-pi-vscode-authorization`
- `vscode_*` bridge tools

## 7. 开发与 F5

环境基线：

- Node.js 22 LTS。
- pnpm 10.32.1。
- VS Code 1.110 或更新版本。
- Pi 0.84.4 或更新版本。

目标 scripts：

```json
{
  "build": "rolldown -c rolldown.config.ts",
  "dev": "rolldown -c rolldown.config.ts -w",
  "fmt": "oxlint . --fix && oxfmt .",
  "lint": "oxlint . && oxfmt --check .",
  "typecheck": "tsgo --noEmit --skipLibCheck",
  "test:unit": "vitest run",
  "test": "pnpm lint && pnpm typecheck && pnpm test:unit",
  "package": "pnpm build && pnpm exec vsce package --no-dependencies"
}
```

增加 `.gitattributes`：

```gitattributes
* text=auto eol=lf
*.cmd text eol=crlf
*.bat text eol=crlf
```

修复 VS Code 配置：

- `launch.json` 使用 `preLaunchTask`。
- 只传递 `--extensionDevelopmentPath=${workspaceFolder}`。
- `tasks.json` 删除硬编码 `zsh`，使用跨平台 `pnpm build` task。

开发流程：

```text
corepack enable
pnpm install
pnpm test
pnpm build
```

然后按 F5；需要持续构建时单独运行 `pnpm dev`。

## 8. CI 与本地 release

Pull Request 使用 Ubuntu、Windows、macOS 矩阵，运行 frozen install、lint、typecheck、unit tests、build 和 Pi 0.84.4 smoke。

附加 job：

- Windows 运行真实 `.cmd` integration test。
- Ubuntu 运行 Extension Host integration test。
- Ubuntu 生成一次 VSIX、验证内容并上传 CI artifact。
- 定时任务检测 Pi latest；release candidate 要求固定基线和当时 latest 均通过。

本版本只生成本地 VSIX 和 GitHub artifact。当前 `release.ts` 中自动改版本、commit、tag、push、Unix-only 删除和 Marketplace/Open VSX publish 行为应移除或重写。

## 9. 建议提交序列

```text
test: run unit tests in the standard check pipeline
fix: migrate Pi package namespace to @earendil-works
fix: centralize workspace and cwd resolution
fix: honor Explorer resource URIs in multi-root workspaces
fix: centralize cross-platform Pi process execution
fix: support interactive Pi RPC UI requests
fix: wait for settled Pi RPC sessions
fix: make VS Code extension debugging cross-platform
chore: isolate fork contribution identifiers
ci: add cross-platform checks and Pi compatibility smoke tests
docs: document fork development and local release workflow
```

每个实现提交完成后运行 `pnpm fmt`、`pnpm typecheck` 和 `pnpm test:unit`。
