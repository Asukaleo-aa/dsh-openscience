---
name: evolve-agent
description: 自演化循环机制：每周期复盘、提取可复用教训、把反复验证的教训晋升为原则，实现持久记忆与持续改进。任务收尾复盘时使用。
---

# Evolve Agent（自演化循环）

## 记忆分层（三层文件，位于 workspace 的 `.dsh/evolve/`）

- `principles.md`：原则（反复验证的教训），最多 20 条，每条 ≤50 词
- `knowledge.md`：当前事实（目标、进度、关键状态）
- `notes/YYYY-MM-DD.md`：日志（按日期追加，旧条目不改）

## 启动（任务开始时）

1. 读 `principles.md`（若存在）
2. 读 `knowledge.md`（若存在）
3. 读最近 2-3 天的 `notes/`

## 复盘（每个工作周期结束时）

1. 问自己：这次工作有什么能更好？
2. 提取一条可复用教训，追加到今天的 `notes/YYYY-MM-DD.md`
3. 晋升：如果同一教训在 notes 里已出现 ≥2 次，把它晋升为原则，写进 `principles.md`
4. 原则约束：最多 20 条；每条 ≤50 词；每周期通常最多改一条

## 规则

- 只晋升反复验证（≥2 次）的教训，单次经验留在 notes，不进 principles
- 事实变化时更新 `knowledge.md`
- 复盘不编造：没有可复用教训就写「无新教训」，不硬凑
