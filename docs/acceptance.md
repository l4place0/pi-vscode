# 验收流程

本文件是当前项目的长期验收入口。历史版本的具体证据和当时差异保存在对应
`docs/history/` 档案中。

## 完整自动验收

发布候选在仓库根目录运行：

```text
pnpm install --frozen-lockfile
pnpm acceptance
```

`pnpm acceptance` 顺序执行：

| 阶段            | 命令                           | 验证内容                                             |
| --------------- | ------------------------------ | ---------------------------------------------------- |
| 静态与单元测试  | `pnpm test`                    | lint、format check、typecheck、Vitest                |
| 构建            | `pnpm build`                   | extension bundle                                     |
| Pi 兼容性       | `pnpm test:pi -- 0.84.4`       | CLI、offline RPC、bundled bridge、loopback request   |
| Extension Host  | `pnpm test:integration`        | 激活、commands、contributions、bridge 生命周期       |
| VSIX            | `pnpm package`                 | 本地可安装制品                                       |
| VSIX 内容       | `node scripts/verify-vsix.mjs` | manifest、bundle、bridge、assets、README、license    |
| 隔离 VSIX smoke | `pnpm test:vsix`               | 安装、版本、激活、Open、终端存活、卸载和临时目录清理 |

`test:integration` 和 `test:vsix` 默认使用 VS Code 1.110。设置
`VSCODE_EXECUTABLE_PATH` 可以复用指定的本地 VS Code executable；设置
`VSCODE_TEST_VERSION` 可以覆盖下载版本。

`test:vsix` 不使用日常 VS Code profile，也不依赖真实 Pi 或 API key。脚本在仓库
`.tmp/` 下创建 run-owned user-data、extensions 和假 Pi executable，成功或失败后均清理。
假 Pi 只保持终端进程存活，用于验证 VSIX 和跨平台 terminal launcher；真实 Pi 协议兼容由
`test:pi` 独立负责。

## CI 门禁

`.github/workflows/ci.yml` 持久化以下任务：

- Windows、macOS、Linux：frozen install、lint、typecheck、unit tests、build、Pi 0.84.4 smoke。
- Ubuntu Extension Host：固定 VS Code 1.110 的开发扩展集成测试及隔离 VSIX smoke。
- Ubuntu VSIX：打包、内容验证和 artifact 上传。
- Ubuntu Pi latest：定时兼容性报告，失败不阻断普通提交。

本地通过不能替代远端三平台结果。发布候选必须记录对应 GitHub Actions run URL 和各 job
状态；不得只记录 workflow 文件已经存在。

## 仍需手工验收

自动化覆盖结构、协议和进程生命周期，但下列交互或视觉结果仍需人工判断：

1. F5 打开的 Extension Development Host 中 fork 图标、状态栏和 Packages view 正常显示。
2. 使用真实 Pi 打开 TUI，输入、输出、窗口 resize、退出和再次打开行为正常。
3. multi-root workspace 中 active editor、Explorer 文件和 Explorer 目录分别选择正确 cwd/context。
4. terminal session 在窗口重载后恢复原 cwd 和 session file。
5. `@pi-fork` 产生真实 text delta；confirm、select、input 和取消使用 VS Code 原生 UI。
6. Packages 在隔离的 Pi 配置目录中完成 list/install/remove，并检查失败和取消提示。
7. 官方扩展与 fork 同时安装时，commands、chat participant、sidebar、settings 和 session
   storage 不冲突。
8. Windows、macOS、Linux 至少各完成一次真实 Pi TUI smoke；无法取得的平台应作为已知缺口
   记录，不能默认为通过。

## 发布候选记录

每次准备本地 VSIX 或 CI artifact 时，在对应 `result.md` 或 release 记录中写明：

- commit 和 VSIX 版本；
- Node、pnpm、VS Code 与 Pi 版本；
- `pnpm acceptance` 结果；
- GitHub Actions run URL 及各 job 结果；
- 已完成的手工项目、执行平台和未完成原因；
- 制品路径、内容验证结果和回滚方式。

本流程只生成本地 VSIX 和 GitHub artifact，不包含 Marketplace/Open VSX 发布。
