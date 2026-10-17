import fs from 'node:fs/promises'
import http from 'node:http'
import path from 'node:path'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { WEB_ROOT, createWorkspace } from './core.mjs'
import { PROTOCOL_VERSION, errorResult, WorkspaceError } from './contracts/operations.mjs'
import { workspaceLocation, atomicJson, readJson } from './runtime/paths.mjs'
import { acquireLock } from './runtime/locks.mjs'
import { createWorkspaceService } from './runtime/workspace-service.mjs'

function cookieValue(request, name) {
  const part = (request.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${name}=`))
  try { return part ? decodeURIComponent(part.slice(name.length + 1)) : '' } catch { return '' }
}
function authorized(request, token, cookieName) {
  const value = request.headers.authorization?.replace(/^Bearer /, '') || cookieValue(request, cookieName)
  return typeof value === 'string' && Buffer.byteLength(value) === Buffer.byteLength(token) && timingSafeEqual(Buffer.from(value), Buffer.from(token))
}
function sendJson(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(value))
}
async function readBody(request) {
  const chunks = []; let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 1_000_000) throw new WorkspaceError('CONTENT_TOO_LARGE', 'Request body is too large.', 413)
    chunks.push(chunk)
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') }
  catch { throw new WorkspaceError('INVALID_INPUT', 'Request body must be valid JSON.') }
}
const mime = file => ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json' }[path.extname(file)] || 'application/octet-stream')

export async function startWorkspaceServer({ workspace = createWorkspace(), runtimeRoot, webRoot = WEB_ROOT, port = 0, idleTimeout = 120000, openFolder, onClose } = {}) {
  const location = await workspaceLocation(workspace.root, runtimeRoot)
  await fs.mkdir(location.directory, { recursive: true, mode: 0o700 })
  const release = await acquireLock(path.join(location.directory, 'owner.lock'), { timeout: 1000 })
  const service = createWorkspaceService({ workspace, location, openFolder })
  const token = randomBytes(24).toString('hex')
  const cookieName = `oneskill_access_${location.workspaceId}`
  const distRoot = path.join(webRoot, 'dist')
  let endpoint
  let lastActivity = Date.now()
  let active = 0
  const identity = { protocol: PROTOCOL_VERSION, workspaceId: location.workspaceId, sessionId: service.sessionId, pid: process.pid }
  const server = http.createServer(async (request, response) => {
    active++
    try {
      const url = new URL(request.url || '/', endpoint)
      const origin = request.headers.origin
      if ((origin && origin !== endpoint) || request.headers.host !== new URL(endpoint).host) throw new WorkspaceError('ORIGIN_REJECTED', 'This service accepts same-origin local requests only.', 403)
      if (url.searchParams.has('access')) {
        if (url.pathname !== '/' || request.method !== 'GET' || url.searchParams.get('access') !== token) throw new WorkspaceError('UNAUTHORIZED', 'Invalid workspace access.', 401)
        lastActivity = Date.now()
        response.writeHead(303, { location: `/${url.hash}`, 'set-cookie': `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict`, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
        response.end(); return
      }
      if (url.pathname.startsWith('/api/')) {
        if (!authorized(request, token, cookieName)) throw new WorkspaceError('UNAUTHORIZED', 'Open the current access link from the oneskill terminal.', 401)
        lastActivity = Date.now()
        if (request.method === 'GET' && url.pathname === '/api/identity') return sendJson(response, 200, identity)
        const operation = /^\/api\/operations\/([a-zA-Z]+)$/.exec(url.pathname)?.[1]
        if (request.method !== 'POST' || !operation) throw new WorkspaceError('UNKNOWN_OPERATION', 'Unknown workspace operation.', 404)
        return sendJson(response, 200, await service.call(operation, await readBody(request)))
      }
      if (request.method !== 'GET') throw new WorkspaceError('METHOD_NOT_ALLOWED', 'Only GET is supported for assets.', 405)
      let decoded
      try { decoded = decodeURIComponent(url.pathname) } catch { throw new WorkspaceError('INVALID_PATH', 'Invalid asset path.') }
      const file = path.resolve(distRoot, decoded.replace(/^\/+/, '') || 'index.html')
      if (!file.startsWith(`${distRoot}${path.sep}`)) throw new WorkspaceError('INVALID_PATH', 'Invalid asset path.', 403)
      const real = await fs.realpath(file).catch(() => null)
      if (!real || !real.startsWith(`${await fs.realpath(distRoot)}${path.sep}`)) throw new WorkspaceError('ASSET_NOT_FOUND', 'Build the Web interface with npm run build.', 404)
      response.writeHead(200, { 'content-type': mime(file), 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff' })
      response.end(await fs.readFile(real))
      if (authorized(request, token, cookieName)) lastActivity = Date.now()
    } catch (error) { if (!response.headersSent) sendJson(response, error.status || 500, errorResult(error)); else response.destroy() }
    finally { active-- }
  })
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
    endpoint = `http://127.0.0.1:${server.address().port}`
    await atomicJson(path.join(location.directory, 'service.json'), { ...identity, endpoint, token })
  } catch (error) { await release(); server.close(); throw error }
  let closing
  const close = () => closing ||= (async () => {
    clearInterval(timer)
    server.closeAllConnections()
    await new Promise(resolve => server.close(resolve))
    const current = await readJson(path.join(location.directory, 'service.json'))
    if (current?.sessionId === service.sessionId) await fs.rm(path.join(location.directory, 'service.json'), { force: true })
    await release(); onClose?.()
  })()
  const timer = setInterval(() => { if (!active && Date.now() - lastActivity > idleTimeout) close().catch(() => {}) }, Math.min(1000, idleTimeout)).unref()
  return { server, service, location, endpoint, token, identity, close, url: `${endpoint}/?access=${token}` }
}
