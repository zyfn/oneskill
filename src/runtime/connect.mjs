import fs from 'node:fs/promises'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { PROTOCOL_VERSION, WorkspaceError } from '../contracts/operations.mjs'
import { PROJECT_ROOT } from '../core.mjs'
import { workspaceLocation, readJson, processAlive } from './paths.mjs'
import { acquireLock } from './locks.mjs'

async function verify(location) {
  const descriptor = await readJson(path.join(location.directory, 'service.json'))
  if (!descriptor || !processAlive(descriptor.pid)) return null
  if (descriptor.protocol !== PROTOCOL_VERSION || descriptor.workspaceId !== location.workspaceId) throw new WorkspaceError('PROTOCOL_MISMATCH', 'Restart the oneskill service with the current version.', 409)
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(descriptor.endpoint)) throw new WorkspaceError('INVALID_ENDPOINT', 'Invalid local service endpoint.')
  try {
    const response = await fetch(`${descriptor.endpoint}/api/identity`, { headers: { authorization: `Bearer ${descriptor.token}` }, signal: AbortSignal.timeout(1000) })
    if (!response.ok) return null
    const identity = await response.json()
    return identity.sessionId === descriptor.sessionId && identity.workspaceId === location.workspaceId ? descriptor : null
  } catch { return null }
}

export async function connectWorkspace({ root, runtimeRoot, port, idleTimeout, start = true } = {}) {
  const location = await workspaceLocation(root, runtimeRoot)
  await fs.mkdir(location.directory, { recursive: true, mode: 0o700 })
  let descriptor = await verify(location)
  if (!descriptor && start) {
    const release = await acquireLock(path.join(location.directory, 'start.lock'))
    try {
      descriptor = await verify(location)
      if (!descriptor) {
        const log = await fs.open(path.join(location.directory, 'service.log'), 'a', 0o600)
        const child = spawn(process.execPath, [path.join(PROJECT_ROOT, 'src/cli.mjs'), '_runtime', '--workspace', location.root, '--runtime-dir', location.runtimeRoot, ...(port !== undefined ? ['--port', String(port)] : []), ...(idleTimeout !== undefined ? ['--idle-timeout', String(idleTimeout)] : [])], { cwd: location.directory, detached: true, windowsHide: true, stdio: ['ignore', log.fd, log.fd] })
        await log.close()
        let failure
        child.once('error', error => { failure = error })
        child.unref()
        const deadline = Date.now() + 15000
        while (!(descriptor = await verify(location))) {
          if (failure) throw failure
          if (Date.now() > deadline) throw new WorkspaceError('START_FAILED', `The local service did not start. See ${path.join(location.directory, 'service.log')}.`, 503)
          await new Promise(resolve => setTimeout(resolve, 60))
        }
      }
    } finally { await release() }
  }
  if (!descriptor) throw new WorkspaceError('SERVICE_UNAVAILABLE', 'The local workspace service is not running.', 503)
  async function reconnect(previous) {
    const next = await verify(location)
    if (!next || next.sessionId === previous.sessionId) return false
    descriptor = next
    return true
  }
  async function request(relative, init, timeout, retryNetworkFailure = true) {
    const previous = descriptor
    const send = () => fetch(`${descriptor.endpoint}${relative}`, {
      ...init, headers: { ...init.headers, authorization: `Bearer ${descriptor.token}` }, signal: AbortSignal.timeout(timeout),
    })
    let response
    try { response = await send() }
    catch (error) {
      if (!retryNetworkFailure || !await reconnect(previous)) throw error
      // Reuse the same mutation requestId so a completed write is not applied twice.
      return send()
    }
    if (response.status === 401 && await reconnect(previous)) {
      await response.body?.cancel()
      return send()
    }
    return response
  }
  async function call(name, input = {}) {
    const response = await request(`/api/operations/${name}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input),
    }, 60000, name !== 'openFolder')
    const result = await response.json()
    if (!response.ok) throw new WorkspaceError(result.error.code, result.error.message, response.status)
    return result
  }
  async function heartbeat() {
    const response = await request('/api/identity', {}, 1000)
    if (!response.ok) throw new WorkspaceError('SERVICE_UNAVAILABLE', 'The local workspace service is no longer available.', 503)
    return response.json()
  }
  return { location, get descriptor() { return descriptor }, call, heartbeat, get url() { return `${descriptor.endpoint}/?access=${encodeURIComponent(descriptor.token)}` } }
}
