# 实施结果

- 状态：实施完成，跨平台外部验收待运行
- 实施日期：2026-09-02
- 最终版本：0.1.0
- 档案状态：`in-progress`

## 实际修改

- 标准 `pnpm test` 已包含 lint、typecheck 和 Vitest；当前共有 6 个测试文件、54 个单元/Windows integration 用例。
- Pi 安装 namespace 已迁移到 `@earendil-works/pi-coding-agent`；npm 安装使用 `--ignore-scripts`。
- 新增统一 workspace/cwd resolution，按 Explorer resource、active editor、首个 workspace 的顺序解析；session state 升级为保存 cwd 的 v1 结构并兼容旧 map。
- Explorer 文件和目录上下文已使用传入的 `resourceUri`；未打开文件不再伪造 selection。
- 新增跨平台 Pi process abstraction：Unix 与 `.exe` 直接执行，`.cmd/.bat` 显式使用 ComSpec 和转义，`.ps1` 显式使用 PowerShell；Terminal、RPC 和 Packages 共用该策略。
- Windows VS Code Terminal 的 `.cmd/.bat` 路径不再直接复用 Node
  `windowsVerbatimArguments` 调用；改由 Base64 编码的 PowerShell bootstrap 通过 .NET
  `ProcessStartInfo` 传入已转义的原始 ComSpec 参数。多行 prompt 在仅限该路径中压平为空格，
  避免 `cmd` 把换行解释为命令边界。
- Pi upgrade 已改为结构化参数并顺序执行 package manager 与 `pi update`，不再依赖默认终端的 `&&` 或 shell path quoting。
- RPC JSONL parser 兼容 UTF-8 跨 chunk、LF/CRLF 和 malformed line；select/confirm/input 使用 VS Code 原生 UI，editor 明确取消，extension error 可诊断。
- RPC 在 `agent_settled` 后结束，并通过 1 秒 grace 兼容旧 Pi 的 `agent_end`；`willRetry: true` 不提前关闭，Chat cancellation 不再打开 fallback terminal。
- Packages sidebar 保留，但增加 package source/message 校验、单 active process、nonce CSP、安全 URL 过滤和无 inline handler 的事件委托。
- F5 task 已跨平台化；新增 LF policy；删除会自动改版本、commit、tag、push 和发布市场的旧 release 脚本。
- fork 的 extension、command、chat、icon、terminal profile、activity/view、setting 和 session storage ID 已统一隔离为 `pi-vscode-fork.*`。
- CI 已改为 Windows/macOS/Linux 矩阵，并增加 Pi 0.84.4 smoke、Pi latest 报告、Ubuntu Extension Host、VSIX 内容校验和 artifact；没有 publish job。
- 新增可重复的 Pi smoke、Extension Host 和 VSIX ZIP central-directory 验证脚本。
- 新增 `pnpm test:vsix`，在 run-owned 隔离 profile 中自动完成 VSIX 安装、版本确认、
  激活、Open command、终端存活、卸载确认和清理；`pnpm acceptance` 串联完整自动门禁，
  长期自动/CI/手工流程固化在 `docs/acceptance.md`。
- `.vscode-test` 与 `.tmp` 已从 Git、Oxlint 和 Oxfmt 检查中排除，避免本地验收缓存污染标准检查。

## 提交记录

- `f23863b` `docs: establish v0.1 foundation archive`：隔离提交文档工程基线并进入实施状态。
- `1cc9326` `test: run unit tests in the standard check pipeline`：让标准测试链执行 Vitest。
- `2b4cf5a` `fix: migrate Pi package namespace to @earendil-works`：迁移安装 namespace 与提示。
- `f763e0b` `fix: centralize workspace and cwd resolution`：统一 cwd 并持久化 session cwd。
- `fdd89bf` `fix: honor Explorer resource URIs in multi-root workspaces`：修复 Explorer/multi-root 上下文。
- `92bdb0a` `fix: centralize cross-platform Pi process execution`：增加跨平台执行 abstraction 和真实 `.cmd` 测试。
- `c0a6cdb` `fix: support interactive Pi RPC UI requests`：提取 JSONL 与原生 UI handler。
- `905ca3e` `fix: wait for settled Pi RPC sessions`：兼容 `agent_settled`、retry 和旧 Pi。
- `743244d` `fix: harden package execution and webview messages`：收口 Packages 执行、输入与 CSP。
- `dc644bc` `fix: make VS Code extension debugging cross-platform`：修复 F5、LF 和本地打包，移除发布脚本。
- `5c5763e` `chore: isolate fork contribution identifiers`：隔离 fork contribution IDs。
- `3a70c60` `ci: add cross-platform checks and Pi compatibility smoke tests`：增加 CI、Pi、Extension Host 和 VSIX 验收。
- `0c61bda` `fix: stop cleanly when Pi chat is cancelled`：取消 Chat 时停止且不 fallback。
- `42eb357` `chore: prepare v0.1.0 local package`：将本地 artifact 版本更新为 0.1.0。
- `044b3ff` `test: allow local Extension Host reuse`：允许本地复用已安装 VS Code，CI 仍固定 1.110。
- `8e9ef97` `fix: keep generated test profiles out of checks`：隔离本地 Extension Host/VSIX 临时目录。
- `2257ed0` `docs: document fork development and local release workflow`：本结果档案与最终使用说明。
- `ba16b92` `fix: run Pi upgrades without shell pipelines`：让跨平台升级也使用结构化 process abstraction。
- `docs: record final upgrade verification`：记录最终升级执行与验收事实。
- `a546a85` `docs: record Windows terminal launch regression`：记录真实 VSIX 点击闪退、根因和新增验收门禁。
- `df4c20f` `fix: launch Windows cmd shims from VS Code terminals`：增加 Terminal 专用 Windows launcher 和真实 `.cmd` 回归测试。
- `e77b029` `test: exercise Windows Pi terminal lifetime`：在 Windows Extension Host 中实际调用 open command 并检查终端不会立即退出。
- `e26014a` `test: automate isolated VSIX acceptance`：自动化干净 profile VSIX smoke，接入 CI 并持久化完整验收流程。

## 验证结果

- `pnpm fmt`：通过，0 warnings / 0 errors。
- `pnpm typecheck`：通过。
- `pnpm test:unit`：通过，6 files / 55 tests；Windows 真实 `.cmd` fixture 覆盖 cwd/env、空格、引号、换行及 `& | < > ^ % !`，并按 VS Code Terminal 的普通参数序列化方式执行 launcher。
- `pnpm build`：通过，生成 `dist/extension.cjs`。
- `pnpm test:pi -- 0.84.4`：通过；版本、关键 flags、offline RPC `get_state`、bundled bridge `getStatus` 和无 `extension_error` 均通过。
- `pnpm test:pi -- latest`：通过；2026-09-02 registry latest 仍解析为 0.84.4。
- Extension Host：本机 VS Code 1.136.0 通过，扩展激活以及 fork commands/profile/view 注册成功；Windows 专项实际执行 `pi-vscode-fork.open`，终端在 2 秒观察窗内保持运行，之后由测试主动关闭，Extension Host 退出码 0。固定 VS Code 1.110 下载再次长时间无进展后中止；Ubuntu CI 仍固定该版本。
- `pnpm package`：通过，重新生成 `pi-vscode-fork-0.1.0.vsix`，12 files，约 34.68 KB。
- `node scripts/verify-vsix.mjs pi-vscode-fork-0.1.0.vsix`：通过，7 类必需 artifact 齐全。
- 干净 profile：0.1.0 VSIX 安装、`pi0.pi-vscode-fork@0.1.0` 列出和卸载均成功；临时 profile 已移入 Windows 回收站。
- 日常 profile：修复后的 VSIX 已使用 `--force` 覆盖安装，`code --list-extensions --show-versions` 返回 `pi0.pi-vscode-fork@0.1.0`。
- `pnpm test:vsix -- .\pi-vscode-fork-0.1.0.vsix`：本机 VS Code 1.136.0 通过；隔离 profile 中安装、激活、Pi fixture terminal 2 秒存活、卸载和临时目录清理均成功。
- Windows 真实 Pi 手工 smoke：用户确认修复后的日常 profile 可以正常启动 Pi TUI，原“一闪即关”回归关闭。
- 本机工具事实：Node 24.20.0、pnpm 10.32.1、VS Code 1.136.0；CI 固定 Node 22、pnpm 10.32.1、VS Code 1.110。

## 与原计划的差异

- manifest 从 0.0.9 更新为 0.1.0；计划未单列版本 bump，但档案目标和最终 VSIX 需要一致版本。
- 为提高可测性，workspace、session、open context 和 Packages 校验分别增加纯 helper 模块，没有引入 Pi SDK 或 UI framework。
- `.cmd` 使用成熟的双层 cmd metachar escaping，以兼容 npm/pnpm shim 的 `%*` 二次解析。
- VS Code `TerminalOptions` 无法设置 `windowsVerbatimArguments`。Windows Terminal 因此增加一层编码 bootstrap，并只在 `.cmd/.bat` terminal 参数中把 CR/LF 改为空格；后台 RPC、Packages、smoke 与 upgrade 的参数语义不变。
- VSCE 将根目录 `LICENSE` 和 `README.md` 规范化打包为 `extension/LICENSE.txt` 与 `extension/readme.md`；验证器按大小写无关及 license 两种合法名称验收。
- 本机是 Node 24.20.0，而既定开发/CI 基线仍固定 Node 22；本机所有检查通过，三平台 CI 将验证 Node 22。
- 本地 Extension Host 最终使用现有 VS Code 1.135.0；固定 1.110 的下载因网络中止未完成，本版本 CI 仍固定 1.110。
- 没有实现 `.pi/APPEND_SYSTEM.md` discovery，没有删除 Packages sidebar，也没有增加 Marketplace/Open VSX 发布。

## 遗留问题

- 需要把当前提交推送到远端后观察 Windows/macOS/Linux CI、固定 VS Code 1.110 Extension Host job 和 VSIX artifact job；本任务未执行 push。
- macOS/Linux F5 与手工功能验收尚未执行。
- Windows 真实 Pi TUI 启动已手工通过。F5 UI、multi-root Explorer 行为、session restore、真实 `@pi-fork` text delta/native UI、Packages install/remove 和官方扩展 A/B 仍待手工验证。
- 官方扩展与 fork 同时安装的完整 A/B 手工流程尚未执行；所有已知全局 contribution/storage IDs 已隔离并有 manifest 测试。
- Packages registry browser 的 250 次 metadata fan-out 仍保留，后续版本可独立评估产品和性能取舍。

## 回滚方式

- 功能变更均按上面的独立提交边界存在，可按逆序逐个 `git revert <commit>`；不需要 destructive reset。
- fork session 使用新的 `pi-vscode-fork.terminalSessions` v1 storage，不修改官方 `pi-vscode.terminalSessions`；回滚身份提交不会自动迁移 fork session state。
- fork setting 改为 `pi-vscode-fork.path`，旧官方 setting 保持不变。
- 本机环境协调仅执行 `corepack enable pnpm`，创建 Scoop Node 目录下 pnpm/pnpx shim；如需回滚，执行 `corepack disable pnpm`。Node、PATH 和全局 package 未改变。
- 本地产物 `pi-vscode-fork-0.1.0.vsix` 可直接删除；它没有发布到任何市场。旧 0.0.9 VSIX 和测试 profile 已进入回收站，可恢复。
