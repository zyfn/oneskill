#!/usr/bin/env python3
"""oneskill — one source of truth for agent skills, symlinked everywhere.

Web UI:   python3 oneskill.py serve [--open]      (or double-click oneskill.command)
CLI:      python3 oneskill.py <command> ...

Commands:
  detect [--json]            report whether each known agent is installed
  list [--json]              skill x agent link matrix
  scan [--json]              real (unmanaged) skill dirs found inside agent dirs
  link <agent> <skill>       create one symlink
  unlink <agent> <skill>     remove one symlink
  link-all <agent>           link every source skill into an agent
  unlink-all <agent> --yes   remove every oneskill symlink of an agent
  migrate <agent> <skill>    move a stray skill dir into the source, symlink back
  validate [agent]           repair broken symlinks (missing source: report only)
  agent add <name> <dir>     add an agent to the registry
  agent update <name> <dir>  change a registry entry
"""
import json, os, secrets, shutil, subprocess, sys, threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

BASE = os.path.dirname(os.path.abspath(__file__))
SOURCE = os.path.join(BASE, "skills")
REGISTRY = os.path.join(BASE, "agents.registry")
PORT0 = 8787

# ── core ────────────────────────────────────────────────────────────────

def expand(p):
    if p == "~": return os.path.expanduser("~")
    if p.startswith("~/"): return os.path.join(os.path.expanduser("~"), p[2:])
    return p

def registry():
    out = []
    if not os.path.isfile(REGISTRY):
        return out
    for line in open(REGISTRY, encoding="utf-8"):
        line = line.strip()
        if not line or line.startswith("#") or "|" not in line:
            continue
        name, path = [x.strip() for x in line.split("|", 1)[:2]]
        if name and path:
            out.append((name, path))
    return out

def agent_dir(name):
    for n, p in registry():
        if n == name:
            return expand(p)
    raise SystemExit("unknown agent '%s' (add with: agent add %s <skill-dir>)" % (name, name))

def agent_present(name, root):
    return os.path.isdir(root) or shutil.which(name) is not None

def source_skills():
    if not os.path.isdir(SOURCE):
        return []
    return sorted(e for e in os.listdir(SOURCE)
                  if os.path.isdir(os.path.join(SOURCE, e)) and not e.startswith("."))

def detect_data():
    out = []
    for name, rel in registry():
        root = os.path.dirname(expand(rel))
        out.append({"name": name, "dir": rel, "installed": bool(agent_present(name, root))})
    return out

def active_agents():
    return [d["name"] for d in detect_data()
            if d["installed"] and os.path.isdir(agent_dir(d["name"]))]

def link_mark(agent, skill):
    p = os.path.join(agent_dir(agent), skill)
    if os.path.islink(p):
        return "✓" if os.path.exists(p) else "!"
    return "✗"

def list_data():
    agents = active_agents()
    return [{"skill": s, "links": {a: link_mark(a, s) for a in agents}} for s in source_skills()]

def ignore_set():
    path = os.path.join(BASE, "migrate.ignore")
    out = set()
    if os.path.isfile(path):
        for line in open(path, encoding="utf-8"):
            line = line.strip()
            if line and not line.startswith("#") and ":" in line:
                out.add(line)
    return out

def scan_data():
    out = []
    ign = ignore_set()
    for d in detect_data():
        if not d["installed"]:
            continue
        adir = agent_dir(d["name"])
        if not os.path.isdir(adir):
            continue
        items, hidden = [], 0
        for e in sorted(os.listdir(adir)):
            if e.startswith("."):
                continue
            full = os.path.join(adir, e)
            if os.path.islink(full):
                kind = "symlink"
            elif os.path.isdir(full):
                kind = "dir"
            else:
                continue
            if "%s:%s" % (d["name"], e) in ign:
                hidden += 1
                continue
            items.append({"name": e, "kind": kind,
                          "in_source": os.path.isdir(os.path.join(SOURCE, e))})
        out.append({"agent": d["name"], "dir": adir, "items": items, "hidden": hidden})
    return out

def do_link(agent, skill):
    src = os.path.join(SOURCE, skill)
    if not os.path.isdir(src):
        return False, "skill not found in source directory: %s" % skill
    target = os.path.join(agent_dir(agent), skill)
    if not os.path.isdir(os.path.dirname(target)):
        root = os.path.dirname(target)
        if not agent_present(agent, root):
            return False, "agent '%s' does not appear installed (missing %s); install it first" % (agent, root)
        os.makedirs(os.path.dirname(target), exist_ok=True)
    if os.path.islink(target):
        return True, "○ skipped (already linked): %s/%s" % (agent, skill)
    if os.path.exists(target):
        return False, "%s exists and is not a symlink; refusing to overwrite" % target
    os.symlink(src, target)
    return True, "✓ linked: %s/%s -> %s" % (agent, skill, src)

def do_unlink(agent, skill):
    target = os.path.join(agent_dir(agent), skill)
    if os.path.islink(target):
        os.remove(target)
        return True, "✓ unlinked: %s/%s" % (agent, skill)
    if os.path.exists(target):
        return False, "%s exists and is not a symlink; refusing to delete" % target
    return True, "○ skipped (not linked): %s/%s" % (agent, skill)

def do_migrate(agent, name):
    adir = agent_dir(agent)
    orig = os.path.join(adir, name)
    dest = os.path.join(SOURCE, name)
    if os.path.islink(orig):
        return False, "%s/%s is already a symlink; nothing to migrate" % (agent, name)
    if not os.path.isdir(orig):
        return False, "%s is not a directory" % orig
    if os.path.exists(dest):
        return False, "source already has '%s'; resolve the name clash first" % name
    os.makedirs(SOURCE, exist_ok=True)
    try:
        os.rename(orig, dest)
    except OSError:
        shutil.move(orig, dest)
    os.symlink(dest, orig)
    if not (os.path.islink(orig) and os.path.isdir(orig)):
        return False, "migrate failed verification for %s/%s" % (agent, name)
    return True, "✓ migrated: %s/%s -> source, symlinked back" % (agent, name)

def do_validate(agent=None):
    agents = [agent] if agent else active_agents()
    lines, fixed = [], 0
    for a in agents:
        d = agent_dir(a)
        lines.append("%s (%s):" % (a, d))
        if not os.path.isdir(d):
            lines.append("  ○ skipped (skill dir missing)")
            continue
        n = 0
        for e in sorted(os.listdir(d)):
            full = os.path.join(d, e)
            if not os.path.islink(full) or os.path.exists(full):
                continue
            tgt = os.readlink(full)
            if os.path.isdir(os.path.join(SOURCE, e)):
                os.remove(full)
                os.symlink(os.path.join(SOURCE, e), full)
                lines.append("  ✓ repaired: %s (was broken -> %s)" % (e, tgt))
                n += 1
            else:
                lines.append("  ! broken, source missing (kept): %s -> %s" % (e, tgt))
        fixed += n
        lines.append("  done (%d repaired)" % n)
    return True, "\n".join(lines)

def agent_add(name, d):
    for n, _ in registry():
        if n == name:
            return False, "agent '%s' already exists (use 'agent update')" % name
    with open(REGISTRY, "a", encoding="utf-8") as f:
        f.write("%s | %s\n" % (name, d))
    return True, "✓ added: %s | %s" % (name, d)

def agent_update(name, d):
    if not any(n == name for n, _ in registry()):
        return False, "agent '%s' not found (use 'agent add')" % name
    tmp = REGISTRY + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        for line in open(REGISTRY, encoding="utf-8"):
            s = line.strip()
            if s and not s.startswith("#") and "|" in s and s.split("|", 1)[0].strip() == name:
                f.write("%s | %s\n" % (name, d))
            else:
                f.write(line)
    os.replace(tmp, REGISTRY)
    return True, "✓ updated: %s | %s" % (name, d)

def run_action(args):
    if not args:
        return False, "no action"
    c = args[0]
    try:
        if c == "link":        return do_link(args[1], args[2])
        if c == "unlink":      return do_unlink(args[1], args[2])
        if c == "migrate":     return do_migrate(args[1], args[2])
        if c == "link-all":
            out = [do_link(args[1], s) for s in source_skills()]
            return all(o for o, _ in out), "\n".join(m for _, m in out)
        if c == "unlink-all":
            if "--yes" not in args[2:]:
                return False, "unlink-all requires --yes"
            d = agent_dir(args[1])
            out = []
            for e in sorted(os.listdir(d)):
                full = os.path.join(d, e)
                if os.path.islink(full) and os.readlink(full).startswith(SOURCE + os.sep):
                    out.append(do_unlink(args[1], e))
            return all(o for o, _ in out), "\n".join(m for _, m in out) or "○ nothing linked"
        if c == "validate":    return do_validate(args[1] if len(args) > 1 else None)
        if c == "agent":
            return agent_add(args[2], args[3]) if args[1] == "add" else agent_update(args[2], args[3])
    except (IndexError, SystemExit) as e:
        return False, "usage error: %s" % e
    return False, "command not allowed: %s" % c

# ── web ─────────────────────────────────────────────────────────────────

PAGE = r"""<!doctype html><html><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>oneskill</title>
<style>
:root{
 --win:#f5f5f7;--side:rgba(244,244,246,.82);--card:#ffffff;
 --text:#1d1d1f;--text2:#86868b;--hair:rgba(0,0,0,.08);
 --field:rgba(0,0,0,.055);--hover:rgba(0,0,0,.04);
 --accent:#0071e3;--accent-hi:#0077ed;--sel:#0a66ff;
 --green:#34c759;--red:#ff3b30;--orange:#ff9500;
 --green-t:rgba(52,199,89,.14);--red-t:rgba(255,59,48,.12);
 --track:#e9e9ea;--btn2:#e9e9eb;--btn2-hi:#dedee0;
 --edge:0 0 0 .5px rgba(0,0,0,.07);
 --ease:cubic-bezier(.25,.46,.45,.94);
}
@media (prefers-color-scheme:dark){:root{
 --win:#000;--side:rgba(28,28,30,.82);--card:#1c1c1e;
 --text:#f5f5f7;--text2:#98989d;--hair:rgba(255,255,255,.10);
 --field:rgba(255,255,255,.08);--hover:rgba(255,255,255,.06);
 --sel:#0a84ff;--track:#39393d;--btn2:#323236;--btn2-hi:#3a3a3e;
 --edge:0 0 0 .5px rgba(255,255,255,.09);
}}
*{box-sizing:border-box}
html{background:var(--win)}
body{margin:0;color:var(--text);font:13px/18px -apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
::selection{background:rgba(10,102,255,.3)}
.app{display:flex;min-height:100vh}
aside{width:236px;flex:none;position:sticky;top:0;height:100vh;padding:16px 10px 12px;
 background:var(--side);backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px);
 border-right:1px solid var(--hair);display:flex;flex-direction:column;user-select:none}
.brandrow{display:flex;align-items:center;gap:8px;padding:0 8px 14px}
.mark{flex:none;border-radius:6px;box-shadow:inset 0 .5px 0 rgba(255,255,255,.28),0 1px 2px rgba(0,0,0,.25)}
.bname{font-size:14px;font-weight:600;letter-spacing:-.01em}
.nav-item{display:flex;align-items:center;gap:10px;height:32px;padding:0 9px;margin:1px 0;border-radius:7px;cursor:default;font-size:13px;font-weight:400;color:var(--text);transition:background .12s var(--ease)}
.nav-item svg{width:18px;height:18px;flex:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;opacity:.85}
.nav-item:hover{background:var(--hover)}
.nav-item.active{background:var(--sel);color:#fff;font-weight:500}
.nav-item.active svg{opacity:1}
.badge{margin-left:auto;min-width:18px;height:17px;padding:0 5px;border-radius:9px;background:rgba(0,0,0,.08);color:var(--text2);font-size:10.5px;font-weight:600;line-height:17px;text-align:center}
.badge.red{background:var(--red);color:#fff}
.nav-item.active .badge{background:rgba(255,255,255,.25);color:#fff}
.content{flex:1;min-width:0;display:flex;flex-direction:column}
.toolbar{position:sticky;top:0;z-index:6;display:flex;align-items:center;justify-content:flex-end;gap:8px;height:44px;padding:0 22px;
 background:var(--side);backdrop-filter:saturate(180%) blur(20px);-webkit-backdrop-filter:saturate(180%) blur(20px);
 border-bottom:1px solid var(--hair)}
.iconbtn{width:26px;height:26px;border:0;border-radius:6px;background:transparent;color:var(--text);display:flex;align-items:center;justify-content:center;cursor:pointer}
.iconbtn:hover{background:var(--hover)}
.iconbtn svg{width:14px;height:14px;stroke-width:1.6}
main{flex:1;padding:22px 26px 64px;max-width:920px;width:100%;margin:0 auto}
#errbar{display:none;background:var(--red-t);color:var(--red);border-radius:9px;padding:9px 13px;margin:0 0 18px;font-size:12.5px;font-weight:500}
.glabel{font-size:11px;color:var(--text2);margin:0 2px 5px}
.group{background:var(--card);border-radius:10px;box-shadow:var(--edge);overflow:hidden}
.group.pad{padding:10px 12px}
.group+.glabel{margin-top:22px}
table{width:100%;border-collapse:collapse}
th{font-size:11px;font-weight:400;color:var(--text2);text-align:left;padding:8px 14px 5px}
td{padding:0 14px;height:42px;text-align:left;font-size:13px}
td.c,th.c{text-align:center}
tbody tr+tr{background-image:linear-gradient(var(--hair),var(--hair));background-size:calc(100% - 14px) .5px;background-position:14px 0;background-repeat:no-repeat}
tbody tr:hover{background-color:var(--hover)}
.dim{color:var(--text2)}
.mono{font-family:"SF Mono",ui-monospace,Menlo,monospace;font-size:12px}
.pill{display:inline-flex;align-items:center;height:19px;padding:0 9px;border-radius:980px;font-size:11px;font-weight:500}
.pill.ok{background:var(--green-t);color:var(--green)}
.pill.bad{background:var(--red-t);color:var(--red)}
.sw{position:relative;display:inline-block;width:42px;height:26px;vertical-align:middle}
.sw input{position:absolute;inset:0;opacity:0;margin:0;cursor:pointer}
.sw .tr{position:absolute;inset:0;background:var(--track);border-radius:13px;transition:background .16s var(--ease);pointer-events:none}
.sw .tr:before{content:"";position:absolute;width:22px;height:22px;left:2px;top:2px;background:#fff;border-radius:50%;box-shadow:0 1px 2px rgba(0,0,0,.22),0 0 0 .5px rgba(0,0,0,.04);transition:transform .16s var(--ease)}
.sw input:checked+.tr{background:var(--green)}
.sw input:checked+.tr:before{transform:translateX(16px)}
.sw.warn input:checked+.tr{background:var(--orange)}
.btn{border:0;border-radius:8px;height:29px;padding:0 13px;font:inherit;font-size:12.5px;font-weight:500;cursor:pointer;background:var(--accent);color:#fff;transition:background .12s var(--ease),transform .1s ease-out}
.btn:hover{background:var(--accent-hi)}
.btn:active{transform:scale(.97)}
.btn.ghost{background:var(--btn2);color:var(--text)}
.btn.ghost:hover{background:var(--btn2-hi)}
.btn:disabled{opacity:.45;cursor:default}
.row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:2px 0}
select,input.txt{font:inherit;font-size:12.5px;color:var(--text);background:var(--btn2);border:0;border-radius:7px;height:28px;padding:0 9px;outline:0}
select:hover,input.txt:hover{background:var(--btn2-hi)}
input.txt:focus{box-shadow:0 0 0 3px rgba(10,102,255,.35)}
input[type=checkbox].ck{width:16px;height:16px;accent-color:var(--accent);cursor:pointer}
.empty{color:var(--text2);padding:14px;font-size:12.5px}
.note{font-size:11px;color:var(--text2);padding:7px 2px 0}
.view{display:none}.view.active{display:block}
#toast{position:fixed;left:50%;bottom:24px;transform:translate(-50%,10px);opacity:0;pointer-events:none;
 background:rgba(30,30,32,.92);color:#f5f5f7;border-radius:12px;padding:10px 14px;max-width:560px;
 font:11.5px/1.55 "SF Mono",ui-monospace,Menlo,monospace;white-space:pre-wrap;
 box-shadow:0 6px 24px rgba(0,0,0,.35);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px);
 transition:opacity .18s var(--ease),transform .18s var(--ease);z-index:20}
#toast.show{opacity:1;transform:translate(-50%,0);pointer-events:auto;cursor:pointer}
@media (prefers-reduced-transparency:reduce){aside,.toolbar{backdrop-filter:none;-webkit-backdrop-filter:none;background:var(--win)}}
</style></head><body>
<div class=app>
<aside>
 <div class=brandrow><svg class=mark width=22 height=22 viewBox="0 0 32 32"><defs><linearGradient id=lg x1=0 y1=0 x2=1 y2=1><stop offset=0 stop-color="#3d9bff"/><stop offset=1 stop-color="#0055d6"/></linearGradient></defs><rect width=32 height=32 rx=7.5 fill="url(#lg)"/><g fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round"><path d="M13 19l6-6"/><path d="M14.6 10.6l2.2-2.2a4.4 4.4 0 0 1 6.2 6.2l-2.2 2.2"/><path d="M17.4 21.4l-2.2 2.2a4.4 4.4 0 0 1-6.2-6.2l2.2-2.2"/></g></svg><span class=bname>oneskill</span></div>
 <a class="nav-item active" data-view=agents data-title=Agents><svg viewBox="0 0 16 16" fill=none stroke=currentColor><rect x=2 y=3 width=12 height=10 rx=2/><path d="M5 7l2 2-2 2M9.5 11H11"/></svg>Agents<span class=badge id=b-agents></span></a>
 <a class=nav-item data-view=skills data-title=Skills><svg viewBox="0 0 16 16" fill=none stroke=currentColor><rect x=2 y=3 width=12 height=10 rx=1.5"/><path d="M7 3v10M2 8h12"/></svg>Skills<span class=badge id=b-skills></span></a>
 <a class=nav-item data-view=migrate data-title=Migrate><svg viewBox="0 0 16 16" fill=none stroke=currentColor><path d="M2.5 8h8"/><path d="M8 5.2 10.8 8 8 10.8"/><path d="M13.5 3v10"/></svg>Migrate<span class=badge id=b-migrate></span></a>
</aside>
<div class=content>
 <div class=toolbar>
  <button class=iconbtn onclick="run(['validate'])" title="Validate & repair"><svg viewBox="0 0 16 16" fill=none stroke=currentColor><path d="M9.6 2.6a3.6 3.6 0 0 0-4.5 4.6L2.4 9.9a1.5 1.5 0 0 0 2.1 2.1l2.7-2.7a3.6 3.6 0 0 0 4.6-4.5L9.7 6.9 8.4 6.6l-.3-1.3z"/><path d="M10.8 10.8l2.6 2.6"/></svg></button>
  <button class=iconbtn onclick=load() title=Refresh><svg viewBox="0 0 16 16" fill=none stroke=currentColor><path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.8"/><path d="M13.4 2.6v2.8h-2.8"/></svg></button>
 </div>
 <main>
  <div id=errbar></div>
  <section id=view-agents class="view active">
   <div class=glabel>Known agents</div>
   <div class=group><table id=ag-table></table></div>
   <div class=glabel>Add agent</div>
   <div class="group pad"><div class=row><input class=txt id=add-name placeholder=name><input class=txt id=add-dir placeholder="~/path/to/skills" style="width:260px"><button class=btn onclick=addAgent()>Add</button></div></div>
  </section>
  <section id=view-skills class=view>
   <div class=glabel>Link matrix</div>
   <div class=group><table id=matrix></table></div>
   <div class=note>Orange = link exists but its source is missing; repair with the wrench.</div>
  </section>
  <section id=view-migrate class=view>
   <div class=glabel>Unmanaged skills found in agent directories</div>
   <div class=group><table id=mig-table></table></div>
   <div class=note id=mig-note>Selected dirs move into the source; a symlink is left where they were, so that agent keeps working.</div>
   <div class="group pad" style="margin-top:10px"><div class=row>
    <button class=btn id=mig-btn onclick=migrateSel() disabled>Migrate selected</button>
    <span class=dim id=mig-count></span>
   </div></div>
  </section>
 </main>
</div>
<div id=toast onclick="this.classList.remove('show')"></div>
</div>
<script>
const tok=new URLSearchParams(location.search).get('t')||'';
const api=p=>fetch(p+(p.includes('?')?'&':'?')+'t='+encodeURIComponent(tok));
let state={agents:[],rows:[],scan:[]};
const $=id=>document.getElementById(id);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const inst=()=>state.agents.filter(a=>a.installed);
async function load(){
  const [d,l,s]=await Promise.all([api('/api/detect'),api('/api/list'),api('/api/scan')]);
  if(!d.ok||!l.ok||!s.ok){
    $('errbar').style.display='block';
    $('errbar').textContent='Session token 已失效（服务重启过）。回终端看启动时打印的链接，用新地址重开本页。';
    return;
  }
  const a=await d.json(), r=await l.json(), sc=await s.json();
  if(!Array.isArray(a)||!Array.isArray(r)||!Array.isArray(sc)){
    $('errbar').style.display='block';
    $('errbar').textContent='接口返回了意外数据，刷新重试。';
    return;
  }
  $('errbar').style.display='none';
  state.agents=a; state.rows=r; state.scan=sc;
  draw();
}
const pill=ok=>ok?'<span class="pill ok">Installed</span>':'<span class="pill bad">Not installed</span>';
function draw(){
  const A=inst(); let links=0,broken=0;
  state.rows.forEach(r=>A.forEach(a=>{const m=r.links[a.name]; if(m==='✓')links++; if(m==='!')broken++;}));
  const bl=$('b-skills'); bl.textContent=links; bl.className='badge'+(broken?' red':'');
  $('b-agents').textContent=A.length;
  const head='<thead><tr><th>Agent</th><th>Skill dir</th><th>Status</th></tr></thead>';
  $('ag-table').innerHTML=head+'<tbody>'+state.agents.map(a=>'<tr><td>'+esc(a.name)+'</td><td class="dim mono">'+esc(a.dir)+'</td><td>'+pill(a.installed)+'</td></tr>').join('')+'</tbody>';
  $('matrix').innerHTML=A.length
    ? '<thead><tr><th>Skill</th>'+A.map(a=>'<th class=c>'+esc(a.name)+'</th>').join('')+'</tr></thead><tbody>'+
      state.rows.map(r=>'<tr><td class=mono>'+esc(r.skill)+'</td>'+A.map(a=>{
        const m=r.links[a.name]; const on=(m==='✓'||m==='!');
        return '<td class=c><label class="sw'+(m==='!'?' warn':'')+'"><input type=checkbox '+(on?'checked':'')+
          ' data-skill="'+esc(r.skill)+'" data-agent="'+esc(a.name)+'"><span class=tr></span></label></td>';
      }).join('')+'</tr>').join('')+'</tbody>'
    : '<tbody><tr><td class=empty>No installed agents yet.</td></tr></tbody>';
  const stray=state.scan.map(g=>({agent:g.agent,hidden:g.hidden||0,items:g.items.filter(i=>i.kind==='dir')})).filter(g=>g.items.length||g.hidden);
  let hid=0; stray.forEach(g=>hid+=g.hidden);
  let n=0; stray.forEach(g=>n+=g.items.length);
  $('b-migrate').textContent=n; $('b-migrate').className='badge'+(n?' red':'');
  $('mig-note').textContent='Selected dirs move into the source; a symlink is left where they were, so that agent keeps working.'+(hid?' '+hid+' protected entries hidden (migrate.ignore).':'');
  $('mig-table').innerHTML=stray.length
    ? '<thead><tr><th style="width:34px"></th><th>Agent</th><th>Skill dir</th></tr></thead><tbody>'+
      stray.map(g=>g.items.map(i=>'<tr><td class=c><input type=checkbox class=ck data-agent="'+esc(g.agent)+'" data-name="'+esc(i.name)+'" '+(i.in_source?'disabled title="name already in source"':'')+' onchange=migCount()></td><td>'+esc(g.agent)+'</td><td class=mono>'+esc(i.name)+(i.in_source?' <span class=dim>(name clash)</span>':'')+'</td></tr>').join('')).join('')+'</tbody>'
    : '<tbody><tr><td class=empty>Nothing to migrate — every skill dir is already managed.</td></tr></tbody>';
  migCount();
}
function migCount(){
  const c=document.querySelectorAll('#mig-table .ck:checked').length;
  $('mig-count').textContent=c?c+' selected':'';
  $('mig-btn').disabled=!c;
}
async function migrateSel(){
  const boxes=[...document.querySelectorAll('#mig-table .ck:checked')];
  for(const b of boxes){
    await run(['migrate',b.dataset.agent,b.dataset.name],true);
  }
  await load();
}
let toastTimer=0;
function say(t,quiet){
  if(quiet) return;
  const el=$('toast');
  el.textContent=t;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>el.classList.remove('show'),6000);
}
async function run(args,quiet){
  say('$ oneskill '+args.join(' ')+'\\n…');
  const r=await fetch('/api/action?t='+encodeURIComponent(tok),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({args})});
  if(!r.ok){
    say('$ oneskill '+args.join(' ')+'\\n✗ 请求失败（HTTP '+r.status+'）。403 表示 token 失效，用终端打印的新链接重开本页。');
    return;
  }
  const j=await r.json();
  say('$ oneskill '+args.join(' ')+'\\n'+j.output,quiet);
  if(!quiet) await load();
}
function toggle(skill,agent){
  const row=state.rows.find(r=>r.skill===skill);
  const m=row.links[agent];
  run([(m==='✓'||m==='!')?'unlink':'link',agent,skill]);
}
$('matrix').addEventListener('change',e=>{
  const t=e.target;
  if(t.dataset && t.dataset.skill) toggle(t.dataset.skill,t.dataset.agent);
});
function addAgent(){run(['agent','add',$('add-name').value.trim(),$('add-dir').value.trim()]);$('add-name').value='';$('add-dir').value='';}
document.querySelectorAll('.nav-item').forEach(el=>el.addEventListener('click',()=>{
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  el.classList.add('active');
  document.querySelectorAll('.view').forEach(s=>s.classList.toggle('active',s.id==='view-'+el.dataset.view));
  document.title='oneskill — '+el.dataset.title;
}));
(function(){
  const h=location.hash.replace('#','');
  const el=h&&document.querySelector('.nav-item[data-view="'+h+'"]');
  if(el) el.click();
})();
load();
</script></body></html>
"""

class H(BaseHTTPRequestHandler):
    token = ""
    def log_message(self, *a): pass
    def _ok(self, q): return parse_qs(urlparse(self.path).query).get("t", [""])[0] == self.token
    def _send(self, code, body, ctype="application/json"):
        b = body.encode()
        self.send_response(code)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(b)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(b)
    def do_GET(self):
        p = urlparse(self.path).path
        if p in ("/", "/index.html"):
            self._send(200, PAGE, "text/html"); return
        if not self._ok(None):
            self._send(403, json.dumps({"error": "bad token"})); return
        if p == "/api/detect": self._send(200, json.dumps(detect_data())); return
        if p == "/api/list":   self._send(200, json.dumps(list_data())); return
        if p == "/api/scan":   self._send(200, json.dumps(scan_data())); return
        self._send(404, json.dumps({"error": "not found"}))
    def do_POST(self):
        if not self._ok(None) or urlparse(self.path).path != "/api/action":
            self._send(403 if not self._ok(None) else 404, json.dumps({"error": "denied"})); return
        try:
            n = int(self.headers.get("Content-Length", 0))
            if n > 4096: raise ValueError
            args = json.loads(self.rfile.read(n)).get("args", [])
            if not isinstance(args, list) or not args or not all(isinstance(a, str) for a in args):
                raise ValueError
            if len(args) > 5 or any("\n" in a for a in args):
                raise ValueError
        except Exception:
            self._send(400, json.dumps({"error": "bad body"})); return
        ok, out = run_action(args)
        self._send(200, json.dumps({"ok": ok, "output": out}))

def serve(open_browser=False):
    token = secrets.token_hex(16)
    H.token = token
    port = PORT0
    srv = None
    for cand in range(PORT0, PORT0 + 10):
        try:
            srv = ThreadingHTTPServer(("127.0.0.1", cand), H)
            port = cand
            break
        except OSError:
            continue
    if srv is None:
        sys.exit("no free port in %d-%d" % (PORT0, PORT0 + 9))
    url = "http://127.0.0.1:%d/?t=%s" % (port, token)
    print("serving on %s" % url, flush=True)
    print("ctrl-c to stop; the token is valid for this session only", flush=True)
    if open_browser and sys.platform == "darwin":
        threading.Timer(0.4, lambda: subprocess.Popen(["open", url])).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass

# ── cli ─────────────────────────────────────────────────────────────────

def main(argv):
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__.strip()); return 0
    if argv[0] == "serve":
        serve("--open" in argv[1:]); return 0
    if argv[0] == "detect":
        data = detect_data()
        if "--json" in argv:
            for d in data: print(json.dumps(d, ensure_ascii=False))
        else:
            w = max([len(d["name"]) for d in data] + [5])
            w2 = max([len(d["dir"]) for d in data] + [9])
            print("%-*s  %-*s  %s" % (w, "AGENT", w2, "SKILL DIR", "STATUS"))
            for d in data:
                print("%-*s  %-*s  %s" % (w, d["name"], w2, d["dir"],
                      "✓ installed" if d["installed"] else "✗ not installed"))
        return 0
    if argv[0] == "list":
        data = list_data()
        agents = active_agents()
        if "--json" in argv:
            for r in data: print(json.dumps(r, ensure_ascii=False))
        else:
            w = max([len(r["skill"]) for r in data] + [5])
            print("%-*s  %s" % (w, "SKILL", "  ".join(agents)))
            for r in data:
                print("%-*s  %s" % (w, r["skill"], "  ".join(r["links"][a] for a in agents)))
            print("\n✓ linked   ! broken   ✗ not linked")
        return 0
    if argv[0] == "scan":
        data = scan_data()
        if "--json" in argv:
            for g in data: print(json.dumps(g, ensure_ascii=False))
        else:
            for g in data:
                stray = [i for i in g["items"] if i["kind"] == "dir"]
                hid = ("  [%d protected, hidden]" % g["hidden"]) if g.get("hidden") else ""
                print("%s (%s): %d unmanaged dir(s)%s" % (g["agent"], g["dir"], len(stray), hid))
                for i in stray:
                    tag = "  (name already in source)" if i["in_source"] else ""
                    print("  - %s%s" % (i["name"], tag))
        return 0
    ok, out = run_action(argv)
    print(out)
    return 0 if ok else 1

if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
