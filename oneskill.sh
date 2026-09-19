#!/usr/bin/env bash
# oneskill.sh — skill 符号链接管理工具
#
# 通过符号链接（symlink）将集中的 skill 源目录分发给多个 Agent，
# 使同一份 skill 可被多个 Agent 共享，且只需维护源目录中的单一副本。
#
# 文件布局（均位于本脚本所在目录）：
#   skills/          skill 源目录，存放各 skill 的真实内容
#   agents.registry  已知 Agent 及其标准 skill 目录（detect 与路径解析的唯一数据源）
#
# 用法：
#   oneskill.sh detect                      探测本机已安装的 Agent
#   oneskill.sh list                        列出源目录中的 skill 及各 Agent 的链接状态
#   oneskill.sh link   <agent> <skill>      为指定 Agent 创建 skill 符号链接
#   oneskill.sh unlink <agent> <skill>      移除指定 Agent 的 skill 符号链接（不影响源目录）
#   oneskill.sh link-all   <agent>          为指定 Agent 链接源目录中的全部 skill
#   oneskill.sh unlink-all <agent> --yes    移除指定 Agent 的全部 skill 符号链接（需确认）
#   oneskill.sh validate [agent]            校验并修复失效的符号链接
#   oneskill.sh agent add <name> <dir>      向 registry 添加一个 Agent
#   oneskill.sh agent update <name> <dir>   修改 registry 中已有 Agent
#
# 安全性：本工具仅创建或删除符号链接，不会修改或删除源目录中的任何真实内容。

set -euo pipefail

# 定位：以脚本自身所在目录为基准，不依赖任何绝对用户路径，便于跨机器分发。
SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)/$(basename "${BASH_SOURCE[0]}")"
BASE_DIR="$(dirname "$SCRIPT_PATH")"
SOURCE_DIR="$BASE_DIR/skills"
REGISTRY="$BASE_DIR/agents.registry"

die()  { echo "✗ $*" >&2; exit 1; }
info() { echo "$*"; }

# ── 表格渲染（按字符宽度对齐的边框表格）──────────────────────
_pad() { local n=$(( $2 - ${#1} )); if [ "$n" -lt 0 ]; then n=0; fi; printf '%s%*s' "$1" "$n" ""; }
_rep() { local out="" i; for ((i=0;i<$1;i++)); do out+="$2"; done; printf '%s' "$out"; }

_table() {   # 参数为若干 TAB 分隔的行，第一行作表头
  [ $# -gt 0 ] || return 0
  local rows=("$@") r cells i w n=0 out d
  local W=() top="┌" mid="├" bot="└"
  for r in "${rows[@]}"; do
    IFS=$'\t' read -ra cells <<< "$r"
    for i in "${!cells[@]}"; do
      w=${#cells[$i]}
      if [ "$w" -gt "${W[$i]:-0}" ]; then W[$i]=$w; fi
    done
  done
  local last=$(( ${#W[@]} - 1 ))
  for i in "${!W[@]}"; do
    d="$(_rep $(( ${W[$i]} + 2 )) "─")"
    top+="$d"; mid+="$d"; bot+="$d"
    if [ "$i" -lt "$last" ]; then top+="┬"; mid+="┼"; bot+="┴"; fi
  done
  top+="┐"; mid+="┤"; bot+="┘"
  for r in "${rows[@]}"; do
    if [ "$n" -eq 0 ]; then printf '%s\n' "$top"; elif [ "$n" -eq 1 ]; then printf '%s\n' "$mid"; fi
    IFS=$'\t' read -ra cells <<< "$r"
    out="│"
    for i in "${!W[@]}"; do out+=" $(_pad "${cells[$i]-}" "${W[$i]}") │"; done
    printf '%s\n' "$out"
    n=$(( n + 1 ))
  done
  printf '%s\n' "$bot"
}

# 展开路径中的 ~ 前缀（仅 ~ 与 ~/，不支持 ~user）
expand_path() {
  local p="$1"
  case "$p" in
    "~")    echo "$HOME" ;;
    "~/"*)  echo "$HOME/${p#\~/}" ;;
    *)      echo "$p" ;;
  esac
}

# 取 registry 中指定名称的原始行（不存在则输出空）
registry_line() {
  grep -E "^[[:space:]]*$1[[:space:]]*\|" "$REGISTRY" 2>/dev/null | head -1 || true
}

# 解析指定 Agent 的 skill 目录：直接取 agents.registry 中的标准路径。
agent_dir() {
  local agent="$1" line raw
  line=$(registry_line "$agent")
  [ -n "$line" ] || die "unknown agent '${agent}' (add with: agent add ${agent} <skill-dir>)"
  raw="$(printf '%s' "$line" | awk -F'|' '{ gsub(/^[ \t]+|[ \t]+$/, "", $2); print $2 }')"
  expand_path "$raw"
}

# 已知 Agent 注册表：从 $REGISTRY 读取（<name> | <path>），不做任何文件系统猜测。
# 输出规范化为每行  name<TAB>path。
known_agents() {
  [ -f "$REGISTRY" ] || die "agent registry not found: $REGISTRY"
  grep -vE '^[[:space:]]*(#|$)' "$REGISTRY" \
    | awk -F'|' '{
        name=$1; path=$2;
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", name);
        gsub(/^[[:space:]]+|[[:space:]]+$/, "", path);
        if (name != "" && path != "") printf "%s\t%s\n", name, path;
      }'
}

# 活跃 Agent：skill 目录已存在者（list 列与 validate 默认范围）
active_agents() {
  local a rest
  while IFS=$'\t' read -r a rest; do
    [ -n "$a" ] || continue
    if [ -d "$(agent_dir "$a")" ]; then echo "$a"; fi
  done < <(known_agents)
  return 0
}

# Agent 是否已安装：配置根目录存在，或同名命令在 PATH 中（CLI 已装但尚未初始化配置目录的情况）
agent_present() {
  local name="$1" root="$2"
  [ -d "$root" ] && return 0
  command -v "$name" >/dev/null 2>&1 && return 0
  return 1
}

list_skills() {
  [ -d "$SOURCE_DIR" ] || die "source directory not found: $SOURCE_DIR"
  find "$SOURCE_DIR" -maxdepth 1 -mindepth 1 -type d -exec basename {} \; | sort
}

cmd_detect() {
  local rows=() name rel root
  while IFS=$'\t' read -r name rel; do
    [ -n "$name" ] || continue
    root="$(dirname "$(expand_path "$rel")")"
    if agent_present "$name" "$root"; then
      rows+=("${name}"$'\t'"${rel}"$'\t'"✓ installed")
    else
      rows+=("${name}"$'\t'"${rel}"$'\t'"✗ not installed")
    fi
  done < <(known_agents)
  if [ "${#rows[@]}" -eq 0 ]; then
    info "no agents in $REGISTRY (add one with: agent add <name> <dir>)"
    return 0
  fi
  _table "AGENT"$'\t'"SKILL DIR"$'\t'"STATUS" "${rows[@]}"
}

cmd_list() {
  local agents=() skills=() rows=() a s dir mark row hdr="SKILL"
  while read -r a; do [ -n "$a" ] && agents+=("$a"); done < <(active_agents)
  while read -r s; do [ -n "$s" ] && skills+=("$s"); done < <(list_skills)
  if [ "${#skills[@]}" -eq 0 ]; then
    info "source directory is empty: $SOURCE_DIR"
    return 0
  fi
  if [ "${#agents[@]}" -eq 0 ]; then
    info "no installed agents found; nothing linked yet (see: detect)"
    return 0
  fi
  for a in ${agents[@]+"${agents[@]}"}; do hdr+=$'\t'"$a"; done
  for s in ${skills[@]+"${skills[@]}"}; do
    row="$s"
    for a in ${agents[@]+"${agents[@]}"}; do
      dir="$(agent_dir "$a")"
      if [ -L "$dir/$s" ]; then
        if [ -e "$dir/$s" ]; then mark="✓"; else mark="!"; fi
      else
        mark="✗"
      fi
      row+=$'\t'"$mark"
    done
    rows+=("$row")
  done
  _table "$hdr" ${rows[@]+"${rows[@]}"}
  echo
  echo "✓ linked   ! broken   ✗ not linked"
}

do_link() {
  local agent="$1" skill="$2" src="$SOURCE_DIR/$2" target root
  [ -d "$src" ] || die "skill not found in source directory: $skill"
  target="$(agent_dir "$agent")"
  if [ ! -d "$target" ]; then
    root="$(dirname "$target")"
    agent_present "$agent" "$root" || die "agent '${agent}' does not appear installed (missing ${root} and no '${agent}' command in PATH); install it first"
    mkdir -p "$target"
  fi
  if [ -L "$target/$skill" ]; then
    info "○ skipped (already linked): $agent/$skill"
  elif [ -e "$target/$skill" ]; then
    die "$target/$skill exists and is not a symlink; refusing to overwrite. Resolve it manually."
  else
    ln -s "$src" "$target/$skill"
    info "✓ linked: $agent/$skill -> $src"
  fi
}

do_unlink() {
  local agent="$1" skill="$2" target
  target="$(agent_dir "$agent")"
  if [ -L "$target/$skill" ]; then
    rm "$target/$skill"   # 仅删除符号链接，源目录不受影响
    info "✓ unlinked: $agent/$skill"
  elif [ -e "$target/$skill" ]; then
    die "$target/$skill exists and is not a symlink; refusing to delete. Resolve it manually."
  else
    info "○ skipped (not linked): $agent/$skill"
  fi
}

cmd_link()     { [ $# -eq 2 ] || die "usage: link <agent> <skill>"; do_link "$1" "$2"; }
cmd_unlink()   { [ $# -eq 2 ] || die "usage: unlink <agent> <skill>"; do_unlink "$1" "$2"; }
cmd_link_all() { [ $# -eq 1 ] || die "usage: link-all <agent>"; local s; for s in $(list_skills); do do_link "$1" "$s"; done; }

# 列出某 Agent 目录下指向源目录的符号链接 basename
source_links() {
  local target="$1" l
  while IFS= read -r l; do
    [ -z "$l" ] && continue
    case "$(readlink "$l" 2>/dev/null || true)" in
      "$SOURCE_DIR"/*) basename "$l" ;;
    esac
  done < <(find "$target" -maxdepth 1 -type l 2>/dev/null)
  return 0
}

cmd_unlink_all() {
  [ $# -ge 1 ] || die "usage: unlink-all <agent> --yes"
  local agent="$1" flag="${2:-}" target n=0 b
  target="$(agent_dir "$agent")"
  while read -r b; do [ -n "$b" ] && n=$(( n + 1 )); done < <(source_links "$target")
  if [ "$flag" != "--yes" ]; then
    die "unlink-all would remove ${n} symlink(s) under ${target}; re-run with --yes to confirm"
  fi
  while read -r b; do [ -n "$b" ] && do_unlink "$agent" "$b"; done < <(source_links "$target")
}

cmd_validate() {
  local agents agent dir l tgt base fixed
  if [ $# -ge 1 ]; then agents="$1"; else agents="$(active_agents)"; fi
  for agent in $agents; do
    dir="$(agent_dir "$agent")"
    fixed=0
    info "$agent ($dir):"
    if [ ! -d "$dir" ]; then info "  ○ skipped (skill dir missing)"; continue; fi
    while IFS= read -r l; do
      [ -z "$l" ] && continue
      tgt=$(readlink "$l" 2>/dev/null || true)
      base=$(basename "$l")
      if [ ! -e "$l" ]; then
        if [ -d "$SOURCE_DIR/$base" ]; then
          rm -f "$l"
          ln -s "$SOURCE_DIR/$base" "$l"
          info "  ✓ repaired: $base (was broken -> $tgt)"
          fixed=$(( fixed + 1 ))
        else
          info "  ! broken, source missing (kept): $base -> $tgt"
        fi
      fi
    done < <(find "$dir" -maxdepth 1 -type l 2>/dev/null)
    info "  done ($fixed repaired)"
  done
}

cmd_agent() {
  local op="${1:-}" name="${2:-}" dir="${3:-}" tmp
  case "$op" in
    add)
      [ -n "$name" ] && [ -n "$dir" ] || die "usage: agent add <name> <dir>"
      [ -z "$(registry_line "$name")" ] || die "agent '${name}' already exists in $REGISTRY (use 'agent update')"
      printf '%s | %s\n' "$name" "$dir" >> "$REGISTRY"
      info "✓ added: $name | $dir"
      ;;
    update)
      [ -n "$name" ] && [ -n "$dir" ] || die "usage: agent update <name> <dir>"
      [ -n "$(registry_line "$name")" ] || die "agent '${name}' not found in $REGISTRY (use 'agent add')"
      tmp="$(mktemp)"
      awk -v n="$name" -v d="$dir" -F'|' '
        {
          name=$1; gsub(/^[ \t]+|[ \t]+$/, "", name);
          if (name == n) { printf "%s | %s\n", n, d }
          else           { print $0 }
        }' "$REGISTRY" > "$tmp"
      mv "$tmp" "$REGISTRY"
      info "✓ updated: $name | $dir"
      ;;
    *)
      die "usage: agent add|update <name> <dir>"
      ;;
  esac
}

usage() {
  cat <<EOF
oneskill.sh — skill symlink manager

  detect                   Report whether each known agent is installed
  list                     Show skills in the source dir and per-agent link status
  link   <agent> <skill>   Create a symlink for one skill
  unlink <agent> <skill>   Remove a skill symlink (source dir unaffected)
  link-all   <agent>       Link all skills in the source dir to an agent
  unlink-all <agent> --yes Remove all skill symlinks of an agent (confirmation required)
  validate [agent]         Validate and repair broken symlinks
  agent add    <name> <dir>   Add an agent to the registry
  agent update <name> <dir>   Change an existing registry entry

Files (located next to this script):
  skills/          skill source directory
  agents.registry  known agents and their standard skill dirs
EOF
}

main() {
  local sub="${1:-}"; shift || true
  case "$sub" in
    list)        cmd_list ;;
    detect)      cmd_detect ;;
    link)        cmd_link "$@" ;;
    unlink)      cmd_unlink "$@" ;;
    link-all)    cmd_link_all "$@" ;;
    unlink-all)  cmd_unlink_all "$@" ;;
    validate)    cmd_validate "$@" ;;
    agent)       cmd_agent "$@" ;;
    ""|-h|--help|help) usage ;;
    *)           die "unknown command: $sub (run with --help for usage)" ;;
  esac
}

main "$@"
