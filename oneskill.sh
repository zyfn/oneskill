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

# JSON 字符串转义（反斜杠与双引号）
_json_str() { printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }

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
  local as_json=0
  [ "${1:-}" = "--json" ] && as_json=1
  local rows=() name rel root present
  while IFS=$'\t' read -r name rel; do
    [ -n "$name" ] || continue
    root="$(dirname "$(expand_path "$rel")")"
    if agent_present "$name" "$root"; then
      present=1
      rows+=("${name}"$'\t'"${rel}"$'\t'"✓ installed")
    else
      present=0
      rows+=("${name}"$'\t'"${rel}"$'\t'"✗ not installed")
    fi
    [ "$as_json" = "1" ] && printf '%s\n' "{\"name\":\"$(_json_str "$name")\",\"dir\":\"$(_json_str "$rel")\",\"installed\":$present}"
  done < <(known_agents)
  if [ "$as_json" = "1" ]; then return 0; fi
  if [ "${#rows[@]}" -eq 0 ]; then
    info "no agents in $REGISTRY (add one with: agent add <name> <dir>)"
    return 0
  fi
  _table "AGENT"$'\t'"SKILL DIR"$'\t'"STATUS" "${rows[@]}"
}

cmd_list() {
  local as_json=0
  [ "${1:-}" = "--json" ] && as_json=1
  local agents=() skills=() rows=() a s dir mark row hdr="SKILL"
  while read -r a; do [ -n "$a" ] && agents+=("$a"); done < <(active_agents)
  while read -r s; do [ -n "$s" ] && skills+=("$s"); done < <(list_skills)
  if [ "${#skills[@]}" -eq 0 ]; then
    [ "$as_json" = "1" ] && { echo "[]"; return 0; }
    info "source directory is empty: $SOURCE_DIR"
    return 0
  fi
  if [ "${#agents[@]}" -eq 0 ]; then
    [ "$as_json" = "1" ] && { echo "[]"; return 0; }
    info "no installed agents found; nothing linked yet (see: detect)"
    return 0
  fi
  for a in ${agents[@]+"${agents[@]}"}; do hdr+=$'\t'"$a"; done
  for s in ${skills[@]+"${skills[@]}"}; do
    row="$s"
    if [ "$as_json" = "1" ]; then printf '%s' "{\"skill\":\"$(_json_str "$s")\",\"links\":{"; fi
    local first=1
    for a in ${agents[@]+"${agents[@]}"}; do
      dir="$(agent_dir "$a")"
      if [ -L "$dir/$s" ]; then
        if [ -e "$dir/$s" ]; then mark="✓"; else mark="!"; fi
      else
        mark="✗"
      fi
      row+=$'\t'"$mark"
      if [ "$as_json" = "1" ]; then
        [ "$first" = "1" ] || printf ','
        printf '"%s":"%s"' "$(_json_str "$a")" "$mark"
        first=0
      fi
    done
    [ "$as_json" = "1" ] && printf '%s\n' '}}'
    rows+=("$row")
  done
  [ "$as_json" = "1" ] && return 0
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

cmd_serve() {
  local port="${1:-8787}"
  command -v python3 >/dev/null 2>&1 || die "serve requires python3"
  local token
  token="$(openssl rand -hex 16 2>/dev/null || python3 -c 'import secrets;print(secrets.token_hex(16))')"
  info "serving on http://127.0.0.1:${port}/?t=${token}"
  info "ctrl-c to stop; the token is valid for this session only"
  ONESKILL_CLI="$SCRIPT_PATH" ONESKILL_TOKEN="$token" ONESKILL_PORT="$port" python3 - <<'PYEOF'
import json, os, subprocess, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

CLI = os.environ["ONESKILL_CLI"]
TOKEN = os.environ["ONESKILL_TOKEN"]
PORT = int(os.environ["ONESKILL_PORT"])
ALLOWED = {"link", "unlink", "link-all", "unlink-all", "validate", "agent"}

PAGE = """<!doctype html><html><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>oneskill</title>
<style>
:root{--bg:#f5f5f7;--card:#fff;--text:#1d1d1f;--text2:#86868b;--hair:rgba(0,0,0,.08);--side:rgba(246,246,248,.8);--accent:#0071e3;--green:#34c759;--red:#ff3b30;--orange:#ff9500;--green-t:rgba(52,199,89,.13);--red-t:rgba(255,59,48,.11);--track:#e9e9ea;--console:#f2f2f4;--shadow:0 1px 2px rgba(0,0,0,.05),0 6px 20px rgba(0,0,0,.05)}
@media (prefers-color-scheme:dark){:root{--bg:#000;--card:#1c1c1e;--text:#f5f5f7;--text2:#98989d;--hair:rgba(255,255,255,.12);--side:rgba(28,28,30,.8);--track:#39393d;--console:#141416;--shadow:0 1px 2px rgba(0,0,0,.5)}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"SF Pro Text","SF Pro Display","Helvetica Neue",Helvetica,Arial,sans-serif;font-size:14px;line-height:1.47;-webkit-font-smoothing:antialiased}
.app{display:flex;min-height:100vh}
aside{width:232px;flex:none;position:sticky;top:0;height:100vh;padding:20px 12px;background:var(--side);backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px);border-right:1px solid var(--hair);display:flex;flex-direction:column}
.brand{display:flex;gap:10px;align-items:center;padding:2px 10px 16px}
.logo{width:34px;height:34px;border-radius:9px;background:linear-gradient(135deg,#0a84ff,#5e5ce6);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;font-size:14px;box-shadow:0 2px 6px rgba(10,132,255,.35)}
.brand-name{font-size:15px;font-weight:600;letter-spacing:-.01em}
.brand-sub{font-size:11px;color:var(--text2)}
.nav-group{font-size:11px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.06em;padding:14px 12px 6px}
.nav-item{display:flex;align-items:center;gap:9px;padding:6px 10px;margin:1px 0;border-radius:7px;color:var(--text);text-decoration:none;cursor:pointer;font-size:13.5px;font-weight:500}
.nav-item svg{width:15px;height:15px;flex:none;opacity:.85}
.nav-item:hover{background:rgba(120,120,128,.14)}
.nav-item.active{background:var(--accent);color:#fff}
.nav-item.active svg{opacity:1}
.side-foot{margin-top:auto;padding:10px 12px;font-size:11px;color:var(--text2)}
main{flex:1;padding:34px 40px 60px;max-width:1060px}
.topbar h1{font-size:28px;font-weight:700;letter-spacing:-.02em;margin:0}
.topbar .sub{color:var(--text2);font-size:13px;margin:4px 0 24px}
.view{display:none}.view.active{display:block}
.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:22px}
.stat{background:var(--card);border-radius:14px;box-shadow:var(--shadow);padding:16px 18px}
.stat .n{font-size:26px;font-weight:700;letter-spacing:-.02em}
.stat .l{font-size:12px;color:var(--text2);margin-top:2px}
.stat .n.g{color:var(--green)}.stat .n.o{color:var(--orange)}
.card{background:var(--card);border-radius:14px;box-shadow:var(--shadow);padding:6px 20px 14px;margin-bottom:18px}
.card h3{font-size:12px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.05em;margin:14px 0 4px}
table{width:100%;border-collapse:collapse}
td,th{padding:11px 10px;text-align:left;border-bottom:1px solid var(--hair);font-size:13.5px}
tr:last-child td{border-bottom:0}
th{font-size:11.5px;font-weight:600;color:var(--text2);text-transform:uppercase;letter-spacing:.04em}
td.c,th.c{text-align:center}
.dim{color:var(--text2)}
.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.pill{display:inline-flex;align-items:center;padding:2px 10px;border-radius:980px;font-size:12px;font-weight:500}
.pill.ok{background:var(--green-t);color:var(--green)}
.pill.bad{background:var(--red-t);color:var(--red)}
.sw{position:relative;display:inline-block;width:42px;height:25px;vertical-align:middle}
.sw input{position:absolute;inset:0;opacity:0;margin:0;cursor:pointer}
.sw .tr{position:absolute;inset:0;background:var(--track);border-radius:13px;transition:background .18s;pointer-events:none}
.sw .tr:before{content:"";position:absolute;width:21px;height:21px;left:2px;top:2px;background:#fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .18s}
.sw input:checked+.tr{background:var(--green)}
.sw input:checked+.tr:before{transform:translateX(17px)}
.sw.warn input:checked+.tr{background:var(--orange)}
.btn{border:0;border-radius:980px;padding:7px 17px;font:inherit;font-size:13.5px;font-weight:500;cursor:pointer;background:var(--accent);color:#fff}
.btn:active{opacity:.8}
.btn.ghost{background:transparent;color:var(--accent);box-shadow:inset 0 0 0 1px var(--accent)}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:10px 0}
select,input{font:inherit;font-size:13.5px;color:var(--text);background:var(--card);border:1px solid var(--hair);border-radius:8px;padding:6px 10px;outline:none}
input:focus,select:focus{box-shadow:0 0 0 3px rgba(0,113,227,.25);border-color:var(--accent)}
pre#out{background:var(--console);border-radius:10px;padding:12px 14px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;line-height:1.6;min-height:44px;max-height:260px;overflow:auto;white-space:pre-wrap;margin:0;width:100%}
.empty{color:var(--text2);padding:16px 0;font-size:13px}
.note{font-size:12px;color:var(--text2);padding:8px 0 4px}
</style></head><body>
<div class=app>
<aside>
 <div class=brand><div class=logo>os</div><div><div class=brand-name>oneskill</div><div class=brand-sub>symlink manager</div></div></div>
 <div class=nav-group>Manage</div>
 <a class="nav-item active" data-view=overview data-title=Overview><svg viewBox="0 0 16 16" fill=none stroke=currentColor stroke-width=1.4><rect x=2 y=2 width=5 height=5 rx=1.3/><rect x=9 y=2 width=5 height=5 rx=1.3/><rect x=2 y=9 width=5 height=5 rx=1.3/><rect x=9 y=9 width=5 height=5 rx=1.3/></svg>Overview</a>
 <a class=nav-item data-view=links data-title=Links><svg viewBox="0 0 16 16" fill=none stroke=currentColor stroke-width=1.4><circle cx=4 cy=8 r=2.3/><circle cx=12 cy=8 r=2.3/><path d="M6.3 8h3.4"/></svg>Links</a>
 <a class=nav-item data-view=agents data-title=Agents><svg viewBox="0 0 16 16" fill=none stroke=currentColor stroke-width=1.4><rect x=2 y=3 width=12 height=10 rx=2/><path d="M5 7l2 2-2 2M9.5 11H11"/></svg>Agents</a>
 <div class=nav-group>Tools</div>
 <a class=nav-item data-view=actions data-title=Actions><svg viewBox="0 0 16 16" fill=none stroke=currentColor stroke-width=1.4><path d="M2.5 5h11M2.5 11h11"/><circle cx=6 cy=5 r=1.7/><circle cx=10 cy=11 r=1.7/></svg>Actions</a>
 <div class=side-foot>127.0.0.1 · session token</div>
</aside>
<main>
 <div class=topbar><h1 id=vtitle>Overview</h1><div class=sub>one source, linked everywhere</div></div>
 <section id=view-overview class="view active">
  <div class=stats id=stats></div>
  <div class=card><h3>Agents</h3><table id=ov-agents></table></div>
 </section>
 <section id=view-links class=view>
  <div class=card><h3>Link matrix</h3><table id=matrix></table>
   <div class=note>Toggle to link or unlink. An orange switch means the link exists but its source is missing — run Validate in Actions to repair.</div></div>
 </section>
 <section id=view-agents class=view>
  <div class=card><h3>Known agents</h3><table id=ag-table></table></div>
  <div class=card><h3>Add agent</h3><div class=row><input id=add-name placeholder=name><input id=add-dir placeholder="~/path/to/skills" style="width:280px"><button class=btn onclick=addAgent()>Add</button></div></div>
 </section>
 <section id=view-actions class=view>
  <div class=card><h3>Maintenance</h3><div class=row>
   <button class=btn onclick="run(['validate'])">Validate &amp; repair</button>
   <button class="btn ghost" onclick=load()>Refresh</button>
   <select id=ag-sel></select>
   <button class=btn onclick=runAll()>Link all to selected</button>
  </div></div>
  <div class=card><h3>Output</h3><div class=row><pre id=out></pre></div></div>
 </section>
</main>
</div>
<script>
const tok=new URLSearchParams(location.search).get('t')||'';
const api=p=>fetch(p+(p.includes('?')?'&':'?')+'t='+encodeURIComponent(tok));
let state={agents:[],rows:[]};
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const inst=()=>state.agents.filter(a=>a.installed);
async function load(){
  const [d,l]=await Promise.all([api('/api/detect'),api('/api/list')]);
  state.agents=await d.json(); state.rows=await l.json();
  draw();
}
const pill=ok=>ok?'<span class="pill ok">Installed</span>':'<span class="pill bad">Not installed</span>';
function draw(){
  const A=inst(); let links=0,broken=0;
  state.rows.forEach(r=>A.forEach(a=>{const m=r.links[a.name]; if(m==='✓')links++; if(m==='!')broken++;}));
  $('stats').innerHTML=[[state.rows.length,'Skills in source',''],[A.length,'Agents installed',''],[links,'Active links','g'],[broken,'Broken links',broken?'o':'']]
    .map(s=>'<div class=stat><div class="n '+s[2]+'">'+s[0]+'</div><div class=l>'+s[1]+'</div></div>').join('');
  const agRows=state.agents.map(a=>'<tr><td>'+esc(a.name)+'</td><td class="dim mono">'+esc(a.dir)+'</td><td>'+pill(a.installed)+'</td></tr>').join('');
  const head='<tr><th>Agent</th><th>Skill dir</th><th>Status</th></tr>';
  $('ov-agents').innerHTML=head+agRows;
  $('ag-table').innerHTML=head+agRows;
  $('matrix').innerHTML=A.length
    ? '<tr><th>Skill</th>'+A.map(a=>'<th class=c>'+esc(a.name)+'</th>').join('')+'</tr>'+
      state.rows.map(r=>'<tr><td class=mono>'+esc(r.skill)+'</td>'+A.map(a=>{
        const m=r.links[a.name]; const on=(m==='✓'||m==='!');
        return '<td class=c><label class="sw'+(m==='!'?' warn':'')+'"><input type=checkbox '+(on?'checked':'')+
          " onchange=\"toggle('"+esc(r.skill)+"','"+esc(a.name)+"')\"><span class=tr></span></label></td>";
      }).join('')+'</tr>').join('')
    : '<tr><td class=empty>No installed agents yet.</td></tr>';
  $('ag-sel').innerHTML=A.map(a=>'<option value="'+esc(a.name)+'">'+esc(a.name)+'</option>').join('');
}
function say(t){$('out').textContent=t}
async function run(args){
  say('$ oneskill.sh '+args.join(' ')+'\\n…');
  const r=await fetch('/api/action?t='+encodeURIComponent(tok),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({args})});
  const j=await r.json();
  say('$ oneskill.sh '+args.join(' ')+'\\n'+j.output);
  await load();
}
function toggle(skill,agent){
  const row=state.rows.find(r=>r.skill===skill);
  const m=row.links[agent];
  run([(m==='✓'||m==='!')?'unlink':'link',agent,skill]);
}
function runAll(){const s=$('ag-sel').value; if(s) run(['link-all',s]);}
function addAgent(){run(['agent','add',$('add-name').value.trim(),$('add-dir').value.trim()]);$('add-name').value='';$('add-dir').value='';}
document.querySelectorAll('.nav-item').forEach(el=>el.addEventListener('click',()=>{
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.view').forEach(s=>s.classList.toggle('active',s.id==='view-'+el.dataset.view));
  $('vtitle').textContent=el.dataset.title;
}));
load();
</script></body></html>"""

class H(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _authed(self):
        q = parse_qs(urlparse(self.path).query)
        return q.get("t", [""])[0] == TOKEN

    def _send(self, code, body, ctype="application/json"):
        b = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b)

    def _cli(self, args):
        p = subprocess.run([CLI] + args, capture_output=True, text=True)
        return p.returncode == 0, (p.stdout + p.stderr).strip()

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            self._send(200, PAGE, "text/html"); return
        if not self._authed():
            self._send(403, json.dumps({"error": "bad token"})); return
        if path == "/api/detect":
            ok, out = self._cli(["detect", "--json"])
            lines = [l for l in out.splitlines() if l.strip()]
            self._send(200, "[" + ",".join(lines) + "]" if lines else "[]"); return
        if path == "/api/list":
            ok, out = self._cli(["list", "--json"])
            lines = [l for l in out.splitlines() if l.strip()]
            self._send(200, "[" + ",".join(lines) + "]" if lines else "[]"); return
        self._send(404, json.dumps({"error": "not found"}))

    def do_POST(self):
        if not self._authed():
            self._send(403, json.dumps({"error": "bad token"})); return
        if urlparse(self.path).path != "/api/action":
            self._send(404, json.dumps({"error": "not found"})); return
        try:
            n = int(self.headers.get("Content-Length", 0))
            if n > 4096: raise ValueError
            args = json.loads(self.rfile.read(n)).get("args", [])
        except Exception:
            self._send(400, json.dumps({"error": "bad body"})); return
        if not isinstance(args, list) or not args or not all(isinstance(a, str) for a in args):
            self._send(400, json.dumps({"error": "args must be a list of strings"})); return
        if args[0] not in ALLOWED or len(args) > 5 or any("\n" in a for a in args):
            self._send(400, json.dumps({"error": "command not allowed"})); return
        if args[0] == "unlink-all" and "--yes" not in args:
            args.append("--yes")
        ok, out = self._cli(args)
        self._send(200, json.dumps({"ok": ok, "output": out}))

ThreadingHTTPServer(("127.0.0.1", PORT), H).serve_forever()
PYEOF
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
  serve [port]             Local web UI on 127.0.0.1 (random token per session)
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
    list)        cmd_list "$@" ;;
    detect)      cmd_detect "$@" ;;
    link)        cmd_link "$@" ;;
    unlink)      cmd_unlink "$@" ;;
    link-all)    cmd_link_all "$@" ;;
    unlink-all)  cmd_unlink_all "$@" ;;
    validate)    cmd_validate "$@" ;;
    serve)       cmd_serve "${1:-}" ;;
    agent)       cmd_agent "$@" ;;
    ""|-h|--help|help) usage ;;
    *)           die "unknown command: $sub (run with --help for usage)" ;;
  esac
}

main "$@"
