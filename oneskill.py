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
DIST = os.path.join(BASE, "web", "dist")
WEB = os.path.join(BASE, "web")
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

def skill_desc(name):
    p = os.path.join(SOURCE, name, "SKILL.md")
    if not os.path.isfile(p):
        return ""
    try:
        with open(p, encoding="utf-8") as f:
            lines = f.readlines()
    except OSError:
        return ""
    if not lines or lines[0].strip() != "---":
        return ""
    for i, line in enumerate(lines[1:], start=1):
        s = line.strip()
        if s == "---":
            break
        if s.lower().startswith("description:"):
            v = s.split(":", 1)[1].strip()
            if v in (">", "|", ">-", "|-", ">+", "|+"):
                parts = []
                for nxt in lines[i + 1:]:
                    if nxt.strip() and (nxt[0] == " " or nxt[0] == "\t"):
                        parts.append(nxt.strip())
                    else:
                        break
                v = " ".join(parts)
            elif len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
                v = v[1:-1]
            return v
    return ""

def list_data():
    agents = active_agents()
    return [{"skill": s, "desc": skill_desc(s),
             "links": {a: link_mark(a, s) for a in agents}} for s in source_skills()]

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

# ── web build ───────────────────────────────────────────────────────────

def _dist_stale():
    idx = os.path.join(DIST, "index.html")
    if not os.path.isfile(idx):
        return True
    dm = os.path.getmtime(idx)
    files = [os.path.join(WEB, f) for f in
             ("index.html", "package.json", "tailwind.config.js", "postcss.config.js", "vite.config.js")]
    for root, _, names in os.walk(os.path.join(WEB, "src")):
        files += [os.path.join(root, n) for n in names]
    return any(os.path.isfile(f) and os.path.getmtime(f) > dm for f in files)

def _npm():
    if shutil.which("npm"):
        return ["npm"]
    if shutil.which("mise"):
        return ["mise", "exec", "--", "npm"]
    return None

def ensure_dist():
    if not _dist_stale():
        return True
    npm = _npm()
    if npm is None:
        print("web/dist is missing or stale and no npm was found (PATH or mise).", flush=True)
        print("install node, then:  cd web && npm install && npm run build", flush=True)
        return False
    if not os.path.isdir(os.path.join(WEB, "node_modules")):
        print("installing web dependencies…", flush=True)
        if subprocess.run(npm + ["install", "--no-audit", "--no-fund"], cwd=WEB).returncode:
            return False
    print("building web ui…", flush=True)
    return subprocess.run(npm + ["run", "build"], cwd=WEB).returncode == 0

# ── web ─────────────────────────────────────────────────────────────────


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
        if p.startswith("/api/"):
            if not self._ok(None):
                self._send(403, json.dumps({"error": "bad token"})); return
            if p == "/api/detect": self._send(200, json.dumps(detect_data())); return
            if p == "/api/list":   self._send(200, json.dumps(list_data())); return
            if p == "/api/scan":   self._send(200, json.dumps(scan_data())); return
            self._send(404, json.dumps({"error": "not found"})); return
        # static files from web/dist (no token: the page itself is public,
        # every /api call still requires the session token)
        rel = "index.html" if p in ("/", "/index.html") else p.lstrip("/")
        full = os.path.normpath(os.path.join(DIST, rel))
        if not full.startswith(DIST + os.sep) or not os.path.isfile(full):
            self._send(404, json.dumps({"error": "not found"})); return
        ctype = "text/html" if full.endswith(".html") else \
                "text/css" if full.endswith(".css") else \
                "application/javascript" if full.endswith(".js") else "application/octet-stream"
        with open(full, "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)
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
    if not ensure_dist():
        sys.exit(1)
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
