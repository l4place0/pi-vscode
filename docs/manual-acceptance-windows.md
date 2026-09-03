# Windows 手工验收 SOP

本文只覆盖 v0.1 当前仍需人工观察的 Windows UI、真实 Pi TUI、session、Chat 和 Packages。
官方扩展 A/B 以及 macOS/Linux F5 已延期，不阻塞本轮 Windows 收口。

所有测试状态都放在仓库 `.tmp/` 下的新目录中。不要点击 **Upgrade Pi and Packages**：该操作会
修改全局 Pi 安装，不属于本 SOP。

## 1. 准备隔离环境

在仓库根目录打开 PowerShell：

```powershell
$repo = (Get-Location).Path
$codeExe = "C:\Users\l4pla\AppData\Local\Programs\Microsoft VS Code\Code.exe"
$piCmd = (Get-Command pi.cmd -ErrorAction Stop).Source
$manualRoot = Join-Path $repo ".tmp\manual-v0.1-$(Get-Date -Format yyyyMMdd-HHmmss)"

$env:VSCODE_EXECUTABLE_PATH = $codeExe
$env:PI_CODING_AGENT_DIR = Join-Path $manualRoot "pi-config"
$env:PI_CODING_AGENT_SESSION_DIR = Join-Path $manualRoot "pi-sessions"

New-Item -ItemType Directory -Force $env:PI_CODING_AGENT_DIR | Out-Null
New-Item -ItemType Directory -Force $env:PI_CODING_AGENT_SESSION_DIR | Out-Null
New-Item -ItemType Directory -Force (Join-Path $env:PI_CODING_AGENT_DIR "extensions") | Out-Null
Copy-Item -LiteralPath (Join-Path $repo "test\fixtures\rpc-ui.ts") `
  -Destination (Join-Path $env:PI_CODING_AGENT_DIR "extensions\rpc-ui.ts")

& $piCmd --version
```

通过条件：

- `$manualRoot` 是本次新建目录。
- Pi 输出 `0.84.4` 或当前待验收兼容版本。
- 不复制日常 `~/.pi/agent`，也不把 API key 写入仓库或验收记录。
- 真实模型测试所需的 provider 环境变量，应在启动 VS Code 的同一 PowerShell 中临时提供。

## 2. 自动门禁和制品

```powershell
pnpm install --frozen-lockfile
pnpm acceptance
```

通过条件：命令退出码为 0，并生成 `pi-vscode-fork-0.1.0.vsix`。若失败，先停止手工验收，
保存完整终端输出。

## 3. F5 与视觉检查

从上面保留了隔离 Pi 环境变量的 PowerShell 启动源码窗口：

```powershell
& $codeExe --new-window $repo
```

在该窗口按 `F5`，等待 Extension Development Host 打开，然后检查：

1. 调试前自动执行 `build` task，且没有依赖 bash 的错误。
2. Activity Bar 出现 **Pi Fork** 图标。
3. 状态栏出现 **Pi Fork**，点击后创建名为 **Pi Fork** 的 terminal。
4. Pi TUI 不闪退；调整 terminal 宽高后布局仍可使用。
5. 关闭该 terminal，再次点击状态栏能够创建新 terminal。
6. Pi Fork sidebar 中 Packages view 能显示 loading、搜索框和升级按钮。

任一项失败时，在源码窗口查看 **Terminal → Tasks** 输出，在 Development Host 执行
`Developer: Show Running Extensions`，并在 Output 面板选择 `Log (Extension Host)` 保存日志。

## 4. Explorer 与 multi-root 入口

在 Development Host 中：

1. 使用 **File: Add Folder to Workspace** 加入另一个目录作为 workspace B。
2. 在 workspace B 新建一个文件和一个子目录。
3. 分别右键文件和目录，确认菜单中出现 **Pi Fork: Open with File**。
4. 触发两次，确认都创建 Pi terminal，且没有闪退或错误通知。
5. 打开 workspace B 的文件，再执行 **Pi Fork: Open**。

本步骤只判断菜单和交互是否真实可见；三种启动方式的实际 cwd/context 已由
`pnpm test:integration` 自动验证。

## 5. 干净 profile 安装

关闭 Development Host，在准备阶段的 PowerShell 中执行：

```powershell
$userData = Join-Path $manualRoot "vscode-user"
$extensions = Join-Path $manualRoot "vscode-extensions"
$vsix = Join-Path $repo "pi-vscode-fork-0.1.0.vsix"

& $codeExe --user-data-dir $userData --extensions-dir $extensions `
  --install-extension $vsix --force
& $codeExe --new-window --user-data-dir $userData --extensions-dir $extensions $repo
```

在新窗口 Settings 中把 `pi-vscode-fork.path` 设置为 `$piCmd` 显示的绝对 `.cmd` 路径。
确认扩展页显示 `pi0.pi-vscode-fork@0.1.0`，然后重复一次“Pi Fork: Open”，确认真实
Windows `.cmd` shim 不闪退。

## 6. Session 重载恢复

在干净 profile 中：

1. 从 workspace B 打开 Pi Fork terminal。
2. 输入一个唯一标记，例如 `Remember marker SESSION-WIN-V01`，等待 Pi 完整回复。
3. 等待 2 秒，让 Pi bridge 报告 session file。
4. 执行 `Developer: Reload Window`。
5. 等待扩展重新激活，确认 Pi terminal 自动恢复。
6. 检查重载前的消息仍在；追问标记内容，确认使用的是同一 session。
7. 让 Pi 仅执行并返回 PowerShell `Get-Location`，结果应为重载前的 workspace B。

同时可在外部 PowerShell 验证隔离 session 文件确实生成：

```powershell
Get-ChildItem -LiteralPath $env:PI_CODING_AGENT_SESSION_DIR -Recurse -Filter *.jsonl
```

失败时记录：重载前后 terminal 数量、session 文件列表、Extension Host 日志，以及是否出现
`--session` 相关错误。不要删除隔离目录，以便复盘。

## 7. `@pi-fork` Chat

### 7.1 真实 text delta

打开 VS Code Chat，新建会话并发送：

```text
@pi-fork 请分 8 行逐行输出数字 1 到 8，每行只输出一个数字。
```

通过条件：内容逐步追加，最终顺序完整，没有打开 fallback Pi terminal。此项需要隔离窗口继承
可用 provider 凭据；若没有凭据，应明确记录为 blocked，而不是判为通过。

### 7.2 原生 select、confirm、input

准备阶段复制的 `rpc-ui.ts` 会被隔离 Pi 配置自动发现。分别发送：

```text
@pi-fork /vscode-select
@pi-fork /vscode-confirm
@pi-fork /vscode-input
```

依次验证：

- select 显示 VS Code Quick Pick，选择 `Alpha` 或 `Beta` 后请求结束。
- confirm 显示 VS Code modal；分别测试一次 Confirm 和一次 Cancel。
- input 显示 VS Code Input Box；分别提交 `bridge-ok` 和按 Esc 取消。
- 关闭或取消 UI 后不挂起、不打开 fallback terminal。

这些 slash command 不需要模型调用。命令结束后显示 `Pi did not return any text.` 是允许结果，
因为 fixture 只测试 UI request/response。

### 7.3 Chat 取消

发送一个明显较长的真实模型请求，在仍然输出时点击 Stop。通过条件：输出停止、Chat 可继续使用，
并且没有自动打开 Pi terminal。

## 8. Packages 隔离验收

保持 `PI_CODING_AGENT_DIR` 指向 `$manualRoot\pi-config`：

1. 打开 Pi Fork sidebar，等待 package 列表加载完成。
2. 搜索一个明确的 package，记录其 npm 名称和版本。
3. 点击 Install，确认出现 Working/output，完成后进入 Installed 区域。
4. 在外部 PowerShell 执行 `& $piCmd list`，确认同一 package 出现在隔离配置中。
5. 点击 Uninstall，刷新后确认 Installed 区域和 `& $piCmd list` 都不再包含它。
6. 再启动一次安装并立即点击 Cancel；确认 loading overlay 能退出，界面仍可刷新。
7. 如果取消后 package 已完成安装，显式执行 Uninstall 清理。

通过条件：list/install/remove/cancel 都不冻结 Extension Host，输出不被当作 HTML 执行，日常
Pi 配置目录没有变化。本步骤会访问 npm registry，并只修改 `$manualRoot` 下的 Pi 配置。

## 9. 记录与收尾

在 `docs/history/2026-09-02-v0.1-foundation/result.md` 记录：

- commit、VSIX 文件名、Node/pnpm/VS Code/Pi 版本；
- F5、视觉、Explorer、TUI、session、Chat、Packages 各项 pass/fail/blocked；
- 失败步骤的 Extension Host 日志位置和复现动作；
- `$manualRoot` 的路径。

关闭隔离 VS Code 后，清除当前 PowerShell 的临时环境变量：

```powershell
Remove-Item Env:VSCODE_EXECUTABLE_PATH -ErrorAction SilentlyContinue
Remove-Item Env:PI_CODING_AGENT_DIR -ErrorAction SilentlyContinue
Remove-Item Env:PI_CODING_AGENT_SESSION_DIR -ErrorAction SilentlyContinue
```

先保留 `$manualRoot` 直至结果记录完成。确认不再需要日志、session 和 package 状态后，可删除该
单次验收目录；删除它不会影响日常 VS Code profile 或 `~/.pi/agent`。
