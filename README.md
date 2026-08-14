# dsh-openscience

把 [Open Science Desktop](https://github.com/ai4s-research/open-science) 的研究自动化思路完整移植到 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（dsh）上。

openscience 的护城河不在它的运行时（那是 bundled OpenCode），而在「研究循环 + 溯源 + 审查 + 自演化」这一套组织思路。本项目把这套思路落到 dsh 的架构上：skill 走 dsh 的 skill 系统，provenance 从「靠 skill 约定去写的文件」升级为「session log 的架构级投影」。

## 包含什么

**9 个 skill**（`skills/`）：

| skill | 作用 |
|---|---|
| `ai4s-agent` | 元 skill，串起研究循环四段 |
| `research-explorer` | 把宽泛方向变成具体课题 |
| `literature-survey` | 文献综述（60+ 引用 PDF） |
| `experiment-suite` | 实验包（代码 + results.json + 图） |
| `paper-writer` | 研究论文（200+ 引用 PDF） |
| `traceability-review` | 溯源审查（引用/数字/图↔代码一致性） |
| `integrity-auditor` | 论文完整性审计（4 级证据分级） |
| `mindmap-render` | 思维导图渲染 |
| `evolve-agent` | 自演化复盘（教训晋升原则） |

**provenance 插件**（`plugin/artifact-provenance/`）：

`@deepseek-ai/dsh-artifact-provenance`，从 session log 折叠出每个文件最后写入的 seq/time，替代 openscience 的 `.openscience/provenance.jsonl` 约定层。核心是 `foldArtifactManifest` 纯函数 + `provenance_last_write` 工具，供 traceability-review 做图↔代码一致性检查。

**research preset**（`preset/`）：

「科研模式」agent 预设，在标准编码 Agent 的完整工具集上叠加研究循环 skill + provenance 工具。

## 安装

```bash
./install.sh
```

脚本会：

1. 把 9 个 skill 软链到 `~/.dsh/skills/`
2. 把 research preset 装到 `~/.dsh/.agent-presets/research/`（并把 provenance 插件的 src 路径替换成你的实际安装路径）
3. 说明 headless 挂载方式

## 使用

1. 重启 `dsh web`
2. 新建会话时选择「科研模式」
3. 直接说「研究 XXX」触发 research-explorer，「审查这份报告」触发 traceability-review，「复盘」触发 evolve-agent

## 发布

### provenance 插件 → npm

provenance 插件依赖 dsh 的内部包（已发布 `0.0.1-rc.1`）和 `@deepseek-ai/cordis`（`4.0.1`），peerDependencies 已配好。发布前需要 build 生成 `lib/`（build 依赖 dsh 的 monorepo 配置，建议在 dsh 仓库里 build 后把 `lib/` 拷过来）：

```bash
cd plugin/artifact-provenance
npm publish --access public
```

### 整个项目 → GitHub

```bash
git init
git add .
git commit -m "openscience research automation ported to dsh"
git remote add origin git@github.com:YOUR_USERNAME/dsh-openscience.git
git push -u origin main
```

## 架构

provenance 从 openscience 的「约定层」（靠 skill 约定写 `.openscience/provenance.jsonl`）升级为 dsh 的「架构层」（session log 单一事实源，运行时强制记录）：

- `foldArtifactManifest(events)`：从 `tool/result` 的 `meta.diffs` 提取覆盖写入，从 `tool/call` 的 `arguments.file_path` 兜底新建文件（dsh 的 write 工具 create 时不产 diff），最后写入胜出
- `mergeWorkspaceManifest`：把 session manifest 合并进 workspace 的 `.dsh/provenance.json`（time 大者胜出，跨 session 的 seq 不可比），让 fork 出的审查子 agent 能查到父会话的写入

## License

MIT
