import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { atomicJson, processAlive, readJson, digest } from './paths.mjs'
import { WorkspaceError } from '../contracts/operations.mjs'

const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
export async function acquireLock(directory, { timeout = 15000 } = {}) {
  await fs.mkdir(path.dirname(directory), { recursive: true, mode: 0o700 })
  const identity = { pid: process.pid, nonce: randomUUID(), createdAt: Date.now() }
  const deadline = Date.now() + timeout
  while (true) {
    try {
      await fs.mkdir(directory, { mode: 0o700 })
      await atomicJson(path.join(directory, 'owner.json'), identity)
      return async () => {
        const owner = await readJson(path.join(directory, 'owner.json'))
        if (owner?.nonce === identity.nonce) await fs.rm(directory, { recursive: true, force: true })
      }
    } catch (error) {
      if (error.code !== 'EEXIST') throw error
      const owner = await readJson(path.join(directory, 'owner.json')).catch(() => null)
      const age = Date.now() - (await fs.stat(directory)).mtimeMs
      if ((owner && !processAlive(owner.pid)) || (!owner && age > 10000)) {
        // Rename first: an old owner must never remove a replacement owner's lock.
        const retired = `${directory}.stale-${randomUUID()}`
        try { await fs.rename(directory, retired); await fs.rm(retired, { recursive: true, force: true }) }
        catch (retireError) { if (!['ENOENT','EEXIST','ENOTEMPTY'].includes(retireError.code)) throw retireError }
        continue
      }
      if (Date.now() > deadline) throw new WorkspaceError('WORKSPACE_BUSY', 'Another process is managing this location. Retry shortly.', 409)
      await pause(40)
    }
  }
}
export async function lockTargets(runtimeRoot, targets, action) {
  const releases = []
  const canonical = await Promise.all(targets.map(async target => {
    let ancestor = target
    while (true) {
      try { return path.resolve(await fs.realpath(ancestor), path.relative(ancestor, target)) }
      catch (error) { if (error.code !== 'ENOENT') throw error; const parent = path.dirname(ancestor); if (parent === ancestor) throw error; ancestor = parent }
    }
  }))
  try {
    for (const target of [...new Set(canonical)].sort()) releases.push(await acquireLock(path.join(runtimeRoot, 'targets', digest(target))))
    return await action()
  } finally { for (const release of releases.reverse()) await release() }
}
