import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { spawn } from 'node:child_process'
import { WEB_ROOT, createWorkspace } from './core.mjs'
import { runNpm } from './npm-runtime.mjs'

import { openFolder } from './local-folder.mjs'

function newestMtime(root) {
  let newest = 0
  try {
    const rootStat = fs.statSync(root)
    if (!rootStat.isDirectory()) return rootStat.mtimeMs
    newest = rootStat.mtimeMs
  } catch {
    return 0
  }
  const pending = [root]
  while (pending.length) {
    const current = pending.pop()
    let entries = []
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) pending.push(fullPath)
      else {
        try {
          newest = Math.max(newest, fs.statSync(fullPath).mtimeMs)
        } catch {}
      }
    }
  }
  return newest
}

export function ensureWebBuild(webRoot = WEB_ROOT, { run = runNpm } = {}) {
  const index = path.join(webRoot, 'dist/index.html')
  const buildInputs = [
    path.join(webRoot, 'src'),
    path.join(webRoot, 'public'),
    path.join(webRoot, 'index.html'),
    path.join(webRoot, 'package.json'),
    path.join(webRoot, 'package-lock.json'),
    path.join(webRoot, 'vite.config.js'),
  ]
  const newestInput = Math.max(...buildInputs.map(newestMtime))
  const stale = !fs.existsSync(index) || newestInput > fs.statSync(index).mtimeMs
  if (!stale) return
  if (!fs.existsSync(path.join(webRoot, 'node_modules'))) {
    const installCommand = fs.existsSync(path.join(webRoot, 'package-lock.json')) ? 'ci' : 'install'
    run([installCommand], { cwd: webRoot })
  }
  run(['run', 'build'], { cwd: webRoot })
}

function mimeType(file) {
  const extension = path.extname(file).toLowerCase()
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.ico': 'image/x-icon',
  }[extension] || 'application/octet-stream'
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  })
  response.end(JSON.stringify(body))
}

function readCookie(request, name) {
  const source = request.headers.cookie || ''
  for (const part of source.split(';')) {
    const separator = part.indexOf('=')
    if (separator < 0 || part.slice(0, separator).trim() !== name) continue
    return decodeURIComponent(part.slice(separator + 1).trim())
  }
  return ''
}

export function requestWriteToken(request, url) {
  return request.headers['x-oneskill-token'] || url.searchParams.get('t') || readCookie(request, 'oneskill_token')
}

export function sessionCookieHeader(token) {
  return `oneskill_token=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict`
}

async function readBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 1_000_000) throw new Error('Request body is too large')
    chunks.push(chunk)
  }
  if (!chunks.length) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function safeStaticPath(urlPath, distRoot) {
  const decoded = decodeURIComponent(urlPath)
  const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '')
  const resolved = path.resolve(distRoot, relative)
  if (resolved !== distRoot && !resolved.startsWith(`${distRoot}${path.sep}`)) return null
  return resolved
}

async function getPort(start = 8787) {
  for (let port = start; port < start + 30; port += 1) {
    const available = await new Promise((resolve) => {
      const tester = http.createServer()
      tester.once('error', () => resolve(false))
      tester.listen(port, '127.0.0.1', () => tester.close(() => resolve(true)))
    })
    if (available) return port
  }
  throw new Error('No available local port found')
}

function openBrowser(url) {
  const command = process.platform === 'darwin'
    ? ['open', [url]]
    : process.platform === 'win32'
      ? ['cmd', ['/c', 'start', '', url]]
      : ['xdg-open', [url]]
  const child = spawn(command[0], command[1], { detached: true, stdio: 'ignore' })
  child.unref()
}

export async function startServer({ open = false, port: requestedPort, workspace = createWorkspace(), webRoot = WEB_ROOT } = {}) {
  ensureWebBuild(webRoot)
  const distRoot = path.join(webRoot, 'dist')
  const { workspaceData, importLocalSkills, setSkillIgnored, setSkillLink } = workspace
  const token = randomBytes(18).toString('hex')
  const port = requestedPort ?? await getPort()
  let cache = null
  let cacheTime = 0

  async function getWorkspace(force = false) {
    if (!force && cache && Date.now() - cacheTime < 1500) return cache
    cache = await workspaceData()
    cacheTime = Date.now()
    return cache
  }

  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`)
      const sessionCookie = sessionCookieHeader(token)
      const suppliedToken = () => requestWriteToken(request, url)
      if (url.pathname.startsWith('/api/')) {
        if (request.method === 'GET' && url.pathname === '/api/session') {
          return sendJson(response, 200, { ok: true }, { 'Set-Cookie': sessionCookie })
        }
        if (request.method === 'GET' && ['/api/workspace', '/api/detect', '/api/scan'].includes(url.pathname)) {
          return sendJson(response, 200, await getWorkspace(url.pathname !== '/api/workspace'))
        }
        if (request.method === 'GET' && url.pathname === '/api/health') {
          return sendJson(response, 200, { ok: true, runtime: 'node', now: new Date().toISOString() })
        }
        if (request.method === 'GET' && ['/api/skills', '/api/plugins', '/api/agents', '/api/migrations'].includes(url.pathname)) {
          const data = await getWorkspace()
          return sendJson(response, 200, data[url.pathname.slice(5)])
        }
        if (request.method === 'GET' && url.pathname === '/api/capabilities') {
          const data = await getWorkspace()
          const kind = url.searchParams.get('kind')
          return sendJson(response, 200, kind === 'hook' ? data.hooks : data.mcp)
        }
        if (request.method === 'POST' && url.pathname === '/api/open-folder') {
          if (suppliedToken() !== token) return sendJson(response, 403, { error: 'Invalid write token' })
          const body = await readBody(request)
          const folder = await openFolder(body.path)
          return sendJson(response, 200, { ok: true, folder })
        }
        if (request.method === 'POST' && url.pathname === '/api/import') {
          if (suppliedToken() !== token) return sendJson(response, 403, { error: 'Invalid write token' })
          const body = await readBody(request)
          const result = await importLocalSkills(body.items)
          cache = null
          return sendJson(response, 200, result)
        }
        if (request.method === 'POST' && url.pathname === '/api/ignore-skill') {
          if (suppliedToken() !== token) return sendJson(response, 403, { error: 'Invalid write token' })
          const body = await readBody(request)
          const result = await setSkillIgnored(body.agent, body.path, body.ignored)
          cache = null
          return sendJson(response, 200, result)
        }
        if (request.method === 'POST' && url.pathname === '/api/link') {
          if (suppliedToken() !== token) return sendJson(response, 403, { error: 'Invalid write token' })
          const body = await readBody(request)
          const result = await setSkillLink(body.agent, body.skill, Boolean(body.linked))
          cache = null
          return sendJson(response, 200, result)
        }
        return sendJson(response, 404, { error: 'API route not found' })
      }

      let file = safeStaticPath(url.pathname, distRoot)
      if (!file) {
        response.writeHead(403)
        return response.end('Forbidden')
      }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(distRoot, 'index.html')
      response.writeHead(200, {
        'Content-Type': mimeType(file),
        'Cache-Control': 'no-store',
        'Set-Cookie': sessionCookie,
      })
      fs.createReadStream(file).pipe(response)
    } catch (error) {
      sendJson(response, 500, { error: error instanceof Error ? error.message : String(error), code: error.code })
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', resolve)
  })
  const actualPort = server.address().port
  const url = `http://127.0.0.1:${actualPort}/?t=${token}`
  process.stdout.write(`oneskill is running at ${url}\n`)
  if (open) openBrowser(url)
  return { server, url, token, port: actualPort }
}
