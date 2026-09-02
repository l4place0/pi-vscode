# v0.1 foundation

- 状态：`in-progress`
- 启动日期：2026-09-02
- 兼容基线：Pi 0.84.4
- 发布边界：本地 VSIX 和 GitHub CI artifact；不包含 VS Code Marketplace/Open VSX 发布

## 目标

在不改变项目薄 adapter 架构的前提下，完成 fork 第一版长期维护基础：

1. 修复 Pi npm namespace、multi-root cwd 和 Windows process execution。
2. 改善 Explorer resource URI 与 `@pi` RPC 兼容性。
3. 建立跨平台开发、F5 调试、测试、CI 和本地 VSIX 验收流程。
4. 隔离本地 fork 的 VS Code contribution IDs，使其可以与官方插件进行 A/B 测试。

## 架构边界

- VS Code integrated terminal 继续运行 Pi CLI/TUI。
- `@pi` 继续使用 Pi RPC JSONL 协议。
- `bridge/pi-vscode-bridge.js` 继续作为 Pi extension，通过带随机 token 的 loopback HTTP bridge 调用 VS Code API。
- VS Code 插件只维护 editor、selection、diagnostics、symbols、references、code actions 和 workspace edits 等 glue/adapter 能力。
- 不引入 Pi SDK、Agent runtime、React/Vue、WebView Chat 或 checkpoint/session GUI。
- 不复制 Pi upstream 已经负责的 project resource discovery。

## 文档

- [audit.md](audit.md)：当前仓库事实与风险。
- [plan.md](plan.md)：修复设计、开发工作流和提交顺序。
- [acceptance.md](acceptance.md)：单元、集成、跨平台和 VSIX 验收标准。
- [result.md](result.md)：实施结果模板；开发完成后填写。

## 范围

### 必须完成

1. 迁移 Pi npm namespace。
2. 统一 workspace/cwd resolution。
3. 修复 Explorer `resourceUri` 和 multi-root。
4. 统一跨平台 Pi process execution。
5. 改善 RPC extension UI request。
6. 兼容 `agent_settled`。
7. 让标准测试命令真正运行单元测试。
8. 修复 Windows/macOS/Linux 开发构建和 F5。
9. 增加跨平台 CI、Pi smoke 和 VSIX 验证。
10. 隔离本地 fork 的 VS Code contribution IDs。

### 暂缓

- 不合并或重写 PR #25 的 `.pi/APPEND_SYSTEM.md` 逻辑；先修正 cwd，再验证当前 Pi 的原生 discovery。
- 不删除 Packages sidebar。
- 不把真实付费 API key 作为普通 PR 的必需条件。
- 不规划 VS Code Marketplace/Open VSX 发布。
- 不要求现在确定正式 Marketplace publisher。

## 状态清单

- [x] 完成初始代码审计。
- [x] 建立变更档案与实施方案。
- [x] 开始代码修改。
- [ ] 完成 P0 namespace/cwd/process 修复。
- [ ] 完成 RPC 与 Explorer 修复。
- [ ] 完成开发工作流和 CI。
- [ ] 完成本地 VSIX 验收。
