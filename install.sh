#!/usr/bin/env bash
set -euo pipefail

# dsh-openscience 一键安装脚本
# 把 9 个 skill 软链到 dsh home，安装 research preset（科研模式），
# provenance 插件通过 preset 的 artifact-provenance 行挂载（src 路径）。

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"

echo "==> 安装 dsh-openscience"
echo "    项目目录: $SCRIPT_DIR"
echo "    dsh home:  $DSH_HOME"
echo ""

# 1. skills → ~/.dsh/skills/
echo "==> [1/3] 软链 9 个 skill 到 $DSH_HOME/skills/"
mkdir -p "$DSH_HOME/skills"
for skill in "$SCRIPT_DIR"/skills/*/; do
  [ -d "$skill" ] || continue
  name="$(basename "$skill")"
  ln -sfn "$skill" "$DSH_HOME/skills/$name"
  echo "    linked $name"
done

# 2. research preset → ~/.dsh/.agent-presets/research/
echo "==> [2/3] 安装 research preset 到 $DSH_HOME/.agent-presets/research/"
mkdir -p "$DSH_HOME/.agent-presets/research"
cp "$SCRIPT_DIR/preset/agent.cordis.yml" "$DSH_HOME/.agent-presets/research/agent.cordis.yml"
cp "$SCRIPT_DIR/preset/preset.yml" "$DSH_HOME/.agent-presets/research/preset.yml"
# 把 artifact-provenance 的路径占位符替换成实际项目目录
if sed --version >/dev/null 2>&1; then
  sed -i "s|__DSH_OPENSCIENCE_PLUGIN__|$SCRIPT_DIR|g" "$DSH_HOME/.agent-presets/research/agent.cordis.yml"
else
  sed -i '' "s|__DSH_OPENSCIENCE_PLUGIN__|$SCRIPT_DIR|g" "$DSH_HOME/.agent-presets/research/agent.cordis.yml"
fi
echo "    preset installed（科研模式）"

# 3. provenance 插件依赖 → 指向 dsh 安装自带的依赖
echo "==> [3/3] provenance 插件依赖"
# 插件以 src/*.ts 路径挂载，其 import（@deepseek-ai/cordis、@deepseek-ai/dsh-tools）
# 按 Node 规则从插件目录向上解析，而插件目录本身没有 node_modules ——
# 挂载必然失败（"Cannot find package '@deepseek-ai/cordis'"），
# 进而导致 research preset 挂载失败、所有新建会话失败（GUI 里表现为
# 切换/添加工作区时弹窗选完文件夹后无法完成）。
# 修复：把 dsh 安装自带的 node_modules 软链为插件的 node_modules，
# 让插件与宿主解析到同一套运行时包。
DSH_NODE_MODULES="$(node -e "const p=require.resolve('@deepseek-ai/dsh/package.json',{paths:[require('node:path').dirname(process.argv[1])]});console.log(require('node:path').dirname(p))" 2>/dev/null || true)"
if [ -z "$DSH_NODE_MODULES" ]; then
  DSH_NODE_MODULES="$(npm root -g 2>/dev/null || true)"
fi
if [ -n "$DSH_NODE_MODULES" ]; then
  ln -sfn "$DSH_NODE_MODULES/@deepseek-ai/dsh/node_modules" "$SCRIPT_DIR/plugin/artifact-provenance/node_modules"
  echo "    linked $SCRIPT_DIR/plugin/artifact-provenance/node_modules -> $DSH_NODE_MODULES/@deepseek-ai/dsh/node_modules"
else
  echo "    WARN: 找不到 dsh 安装目录，请手动执行:"
  echo "      ln -s <dsh安装目录>/node_modules $SCRIPT_DIR/plugin/artifact-provenance/node_modules"
fi

echo ""
echo "安装完成 ✅"
echo ""
echo "使用："
echo "  1. 重启 dsh web（重新执行 dsh web）"
echo "  2. 新建会话时选择「科研模式」"
echo "  3. 即可使用研究循环 skill + 溯源工具 provenance_last_write"
echo ""
echo "注意：provenance 插件以 src 路径挂载，依赖 dsh 自带包；"
echo "若 dsh 升级后插件报依赖错误，重新执行本脚本刷新 node_modules 软链即可。"
echo "如需 headless 使用，编辑 ~/.dsh/profiles/headless/cordis.patch.yml 加入："
echo "  - insert:"
echo "      - id: artifact-provenance"
echo "        name: '$SCRIPT_DIR/plugin/artifact-provenance/src/index.ts'"
