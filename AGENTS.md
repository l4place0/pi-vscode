本项目不在 VS Code 中重做 Pi，而是通过最薄的 CLI、RPC 与 IDE bridge 适配层，让 VS Code 成为 Pi 的编辑器接口，并把 Agent 能力留给 Pi upstream。

## Project map

- `src/extension.ts` — VS Code activation 与功能装配入口
- `src/pi.ts` — Pi binary resolution、启动参数与环境
- `src/terminal.ts` — Integrated terminal 生命周期
- `src/chat.ts` — `@pi` RPC chat adapter
- `src/sessions.ts` — Terminal session 持久化与恢复
- `src/packages.ts` — Pi package sidebar
- `src/bridge/` — VS Code 侧 bridge server、handlers 与状态
- `bridge/pi-vscode-bridge.js` — 加载到 Pi 进程中的 extension
- `test/` — 单元和兼容性测试
- `docs/` — 设计文档与变更历史
- `package.json` — Extension contributions、命令与构建入口
