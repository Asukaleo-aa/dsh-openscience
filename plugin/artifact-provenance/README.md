# @deepseek-ai/dsh-artifact-provenance

Artifact provenance 投影：从会话日志折叠出每个文件最后一次写入的记录，替代 openscience 的 `.openscience/provenance.jsonl` 约定层。

## 设计

- **纯折叠投影**：`foldArtifactManifest(events)` 从 `tool/result` 的 `meta.diffs` 提取覆盖写入，从 `tool/call` 的 `arguments.file_path` 兜底新建文件（write 的 create 不产 diff），最后写入胜出。
- **架构级替代**：数据源是 session log（运行时强制、model-visible means logged），不是靠 skill 约定去写的文件。
- **无状态**：manifest 按需折叠，可恢复 / fork / 压缩后原样重放。

## ctx 接口

- `ctx.provenance.manifest(session)` → `Map<path, { seq, time }>`
- `ctx.provenance.lastWrite(session, path)` → `{ seq, time } | undefined`

## 模型工具

- `provenance_last_write`：查询某文件最后写入的 seq/time，供 traceability-review 等 skill 做图↔代码一致性检查。

## 配置

```yaml
- id: artifact-provenance
  name: '@deepseek-ai/dsh-artifact-provenance'
```
