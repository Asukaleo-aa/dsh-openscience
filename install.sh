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

# 3. provenance 插件说明
echo "==> [3/3] provenance 插件"
echo "    已通过 research preset 的 artifact-provenance 行挂载（src 路径），无需额外操作。"

echo ""
echo "安装完成 ✅"
echo ""
echo "使用："
echo "  1. 重启 dsh web（重新执行 dsh web）"
echo "  2. 新建会话时选择「科研模式」"
echo "  3. 即可使用研究循环 skill + 溯源工具 provenance_last_write"
echo ""
echo "如需 headless 使用，编辑 ~/.dsh/profiles/headless/cordis.patch.yml 加入："
echo "  - insert:"
echo "      - id: artifact-provenance"
echo "        name: '$SCRIPT_DIR/plugin/artifact-provenance/src/index.ts'"
