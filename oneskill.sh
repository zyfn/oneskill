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

PAGE = """<!doctype html><meta charset=utf-8><title>oneskill</title>
<style>
 body{font:14px/1.5 ui-monospace,Menlo,monospace;margin:0;background:#111417;color:#d8dee4}
 main{max-width:860px;margin:0 auto;padding:28px 20px}
 h1{font-size:17px;font-weight:600;margin:0 0 4px} h1 span{color:#7d8590;font-weight:400}
 h2{font-size:13px;color:#7d8590;font-weight:600;margin:26px 0 8px;text-transform:uppercase;letter-spacing:.06em}
 table{border-collapse:collapse;width:100%} td,th{border:1px solid #2d3339;padding:6px 10px;text-align:left}
 th{color:#7d8590;font-weight:600;font-size:12px}
 td.c,th.c{text-align:center;width:90px}
 button{font:inherit;background:#1c2126;color:#d8dee4;border:1px solid #2d3339;padding:3px 10px;cursor:pointer;border-radius:4px}
 button:hover{border-color:#444c56}
 .ok{color:#57ab5a}.bad{color:#e5534b}.warn{color:#c69026}.dim{color:#7d8590}
 pre{background:#1c2126;border:1px solid #2d3339;border-radius:6px;padding:10px;min-height:18px;white-space:pre-wrap;font-size:12px}
 form{display:flex;gap:8px;flex-wrap:wrap} input{font:inherit;background:#1c2126;color:#d8dee4;border:1px solid #2d3339;border-radius:4px;padding:4px 8px}
</style><main>
<h1>oneskill <span>— one source, linked everywhere</span></h1>
<h2>agents</h2><table id=agents></table>
<h2>link matrix</h2><table id=matrix></table>
<p class=dim>click a cell to link / unlink</p>
<h2>actions</h2>
<form onsubmit="return false">
 <button onclick=run(['validate'])>validate</button>
 <button onclick=runAll()>link-all first agent</button>
</form>
<h2>add agent</h2>
<form id=addform>
 <input name=name placeholder=name required><input name=dir placeholder="~/path/to/skills" required style=width:260px>
 <button onclick=addAgent()>add</button>
</form>
<h2>output</h2><pre id=out></pre>
<script>
const tok = new URLSearchParams(location.search).get('t') || '';
const api = (p) => fetch(p + (p.includes('?')?'&':'?') + 't=' + encodeURIComponent(tok));
let state = {agents:[], rows:[]};
function esc(s){return s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
async function load(){
  const [d,l] = await Promise.all([api('/api/detect'), api('/api/list')]);
  state.agents = await d.json(); state.rows = await l.json();
  draw();
}
function draw(){
  const inst = state.agents.filter(a=>a.installed);
  document.getElementById('agents').innerHTML =
    '<tr><th>agent</th><th>skill dir</th><th class=c>installed</th></tr>' +
    state.agents.map(a=>`<tr><td>${esc(a.name)}</td><td class=dim>${esc(a.dir)}</td><td class=c>${a.installed?'<span class=ok>✓</span>':'<span class=bad>✗</span>'}</td></tr>`).join('');
  document.getElementById('matrix').innerHTML =
    '<tr><th>skill</th>'+inst.map(a=>`<th class=c>${esc(a.name)}</th>`).join('')+'</tr>' +
    state.rows.map(r=>'<tr><td>'+esc(r.skill)+'</td>'+inst.map(a=>{
      const m=r.links[a.name]; const cls=m==='✓'?'ok':m==='!'?'warn':'bad';
      return `<td class=c><a href=# onclick="toggle('${esc(r.skill)}','${esc(a.name)}');return false" class=${cls}>${m}</a></td>`;
    }).join('')+'</tr>').join('');
}
function say(t){document.getElementById('out').textContent=t}
async function run(args){
  say('$ oneskill.sh ' + args.join(' ') + '\\n…');
  const r = await fetch('/api/action?t='+encodeURIComponent(tok), {method:'POST',
    headers:{'Content-Type':'application/json'}, body:JSON.stringify({args})});
  const j = await r.json();
  say('$ oneskill.sh ' + args.join(' ') + '\\n' + j.output);
  await load();
}
function toggle(skill,agent){
  const row = state.rows.find(r=>r.skill===skill);
  run([row.links[agent]==='✓' ? 'unlink' : 'link', agent, skill]);
}
function runAll(){ if(state.agents.length) run(['link-all', state.agents.find(a=>a.installed).name]); }
function addAgent(){
  const f=document.getElementById('addform');
  run(['agent','add',f.name.value.trim(),f.dir.value.trim()]);
  f.reset();
}
load();
</script></main>"""

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
