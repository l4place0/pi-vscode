# Bridge response protocol v2 消融实验

## 目标

在已经完成 v2 实现和全参数实验后，逐项移除关键机制，回答两类问题：

1. 哪些机制直接维持分页、兼容、事件消费或修改安全不变量？
2. 哪些机制主要降低输出字节、默认噪声或事件数量，其收益有多大？

本实验不再搜索参数值，而以已实施默认值为固定基线。

## 消融项

| 类别   | 基线机制                           | 消融方式                      | 观察指标                       |
| ------ | ---------------------------------- | ----------------------------- | ------------------------------ |
| 输出   | compact 按文件分组                 | 每条结果重复 filePath/URI     | UTF-8 bytes、倍率              |
| 过滤   | active + error/warning diagnostics | workspace 全量且不筛 severity | 当前任务召回、额外噪声         |
| 分页   | 冻结 snapshot                      | 第二页重新调用已变化 provider | duplicate、missing             |
| 预算   | 32 KiB 完整条目分页                | 一次返回全部结果              | 最大页 bytes、50 KiB 越界      |
| 通知   | sequence cursor                    | 毫秒 timestamp cursor         | 同毫秒事件丢失                 |
| 通知   | semantic coalescing                | 不合并                        | 事件/字节数量、saved 保留      |
| editor | compact 默认                       | full 默认                     | 输出倍率、selection text 暴露  |
| 修改   | edit-text preflight                | apply 后才检查预算            | 是否发生不安全修改、硬上限越界 |
| 兼容   | 显式 responseVersion gate          | 根据 detail 猜测 v2           | legacy 路由是否改变            |

## 方法与 gate

- 使用确定性 canonical fixture，一次仅移除一个机制。
- 字节统一按最终 JSON 的 UTF-8 bytes 计算。
- 效率项要求基线输出/事件严格小于消融结果，同时保持目标语义。
- 正确性项要求基线保持不变量，并证明消融后出现预期反例。
- 所有 row gate 通过且两次执行完全相同，实验才标记 PASS。

## 边界

- 不测真实 LSP/provider 延迟、模型 token 或 Agent task success。
- 不把消融结果用于重新选择默认参数；调参仍以全参数实验为准。
- 不修改生产实现开关，所有消融只发生在独立 replay harness 中。
