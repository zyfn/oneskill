import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { operations, parseOperation, WorkspaceError } from '../contracts/operations.mjs'
import { expandHome } from '../filesystem.mjs'
import { openFolder as revealFolder } from '../local-folder.mjs'
import { atomicJson, readJson, digest } from './paths.mjs'
import { lockTargets } from './locks.mjs'

export function createWorkspaceService({ workspace, location, openFolder = revealFolder, snapshotTtlMs = 30000, now = Date.now }) {
  const sessionId = randomUUID()
  let revision = 0
  let snapshot = null
  let signature = null
  let expiresAt = 0
  let accepting = true
  let queue = Promise.resolve()
  const receipts = path.join(location.directory, 'requests')
  const serialize = action => {
    const task = queue.then(action)
    queue = task.catch(() => {})
    return task
  }
  async function readSnapshot(refresh = false) {
    if (!snapshot || refresh || now() >= expiresAt) {
      let next
      try { next = await workspace.workspaceData() }
      catch (error) {
        if (!snapshot) throw error
        expiresAt = now() + snapshotTtlMs
        snapshot = { ...snapshot, stale: true, scanError: { code: error.code || 'SCAN_FAILED', message: error.message } }
        return snapshot
      }
      const { checkedAt: _checkedAt, ...contents } = next
      const nextSignature = digest(JSON.stringify(contents))
      if (signature !== nextSignature && (signature !== null || revision === 0)) revision++
      signature = nextSignature
      expiresAt = now() + snapshotTtlMs
      snapshot = { ...next, workspaceId: location.workspaceId, revision: `${sessionId}:${revision}`, stale: false }
    }
    return snapshot
  }
  function skillById(data, id) {
    const skill = data.skills.find(item => item.id === id)
    if (!skill) throw new WorkspaceError('SOURCE_CHANGED', 'This Skill is no longer available. Rescan the workspace.', 409)
    return skill
  }
  async function execute(name, input) {
    const args = parseOperation(name, input)
    if (name === 'getWorkspace' || name === 'refreshWorkspace') return readSnapshot(name === 'refreshWorkspace')
    let receiptFile, fingerprint
    if (operations[name].write) {
      await fs.mkdir(receipts, { recursive: true, mode: 0o700 })
      receiptFile = path.join(receipts, `${digest(args.requestId)}.json`)
      fingerprint = digest(JSON.stringify({ name, args }))
      const previous = await readJson(receiptFile)
      if (previous) {
        if (previous.fingerprint !== fingerprint) throw new WorkspaceError('REQUEST_CONFLICT', 'This request identifier was already used for a different operation.', 409)
        if (previous.state !== 'complete') throw new WorkspaceError('OPERATION_INTERRUPTED', 'A previous attempt was interrupted. Rescan and review files before issuing a new request.', 409)
        return previous.result
      }
    }
    const data = await readSnapshot()
    if (name === 'getSkill') {
      const skill = skillById(data, args.skillId)
      const content = await fs.readFile(path.join(expandHome(skill.path), 'SKILL.md'), 'utf8').catch(() => { throw new WorkspaceError('SOURCE_CHANGED', 'The Skill file is no longer readable. Rescan.', 409) })
      if (Buffer.byteLength(content) > 1_000_000) throw new WorkspaceError('CONTENT_TOO_LARGE', 'The Skill file is too large to display.')
      return { skill, content, workspaceId: data.workspaceId, revision: data.revision }
    }
    if (name === 'openFolder') {
      const resources = [
        { id: 'library', path: data.source },
        ...data.agents.map(agent => ({ id: agent.id, path: agent.root || agent.dir })),
        ...data.skills, ...data.plugins, ...data.mcp, ...data.hooks,
      ]
      const resource = resources.find(item => item.id === args.resourceId)
      if (!resource?.path) throw new WorkspaceError('RESOURCE_NOT_FOUND', 'This resource has no available folder.', 404)
      return { folder: await openFolder(resource.path), workspaceId: data.workspaceId, revision: data.revision }
    }
    if (data.stale) throw new WorkspaceError('SCAN_FAILED', 'The latest scan failed. Rescan successfully before changing files.', 409)
    if (args.expectedRevision && args.expectedRevision !== data.revision) throw new WorkspaceError('WORKSPACE_CHANGED', 'The workspace changed. Refresh before retrying.', 409)
    const agents = await workspace.loadAgents()
    const targets = [workspace.sourceRoot, ...agents.flatMap(agent => [agent.absoluteDir, agent.absoluteRoot, ...(agent.absoluteSkillRoots || []).map(root => root.path)])].filter(Boolean).map(value => path.resolve(value))
    return lockTargets(location.runtimeRoot, targets, async () => {
      await atomicJson(receiptFile, { fingerprint, state: 'pending', operation: name, createdAt: Date.now() })
      let result
      try {
        if (name === 'setSkillLink') {
          const skill = skillById(data, args.skillId)
          if (!skill.managed) throw new WorkspaceError('NOT_MANAGED', 'Adopt the Skill into the library before linking it.')
          const agent = data.agents.find(item => item.id === args.agentId)
          if (!agent) throw new WorkspaceError('AGENT_NOT_FOUND', 'The Agent was not found.', 404)
          result = await workspace.setSkillLink(agent.name, skill.relative, args.linked, agents)
        } else if (name === 'importSkills') {
          const requested = args.skillIds.map(id => {
            const skill = skillById(data, id)
            if (skill.managed || skill.ignored) throw new WorkspaceError('NOT_IMPORTABLE', 'Select unmanaged Skills that are not ignored.')
            return { agent: skill.agent, path: skill.path }
          })
          result = await workspace.importSkills(requested, agents)
          result.results = result.results.map((item, index) => ({ ...item, id: args.skillIds[index] }))
        } else if (name === 'setSkillIgnored' || name === 'setSkillsIgnored') {
          const selected = (args.skillIds || [args.skillId]).map(id => skillById(data, id))
          if (selected.some(skill => skill.managed)) throw new WorkspaceError('ALREADY_MANAGED', 'Only unmanaged Skill sources can be ignored.')
          const results = (await workspace.setSkillsIgnored(selected, args.ignored, agents)).map((entry, index) => ({ ...entry, id: selected[index].id }))
          result = name === 'setSkillIgnored' ? results[0] : { results }
        } else if (name === 'resolveSkillLink') {
          const skill = args.skillId ? skillById(data, args.skillId) : null
          if (skill && !skill.managed) throw new WorkspaceError('NOT_MANAGED', 'Choose a Skill from the library.')
          result = await workspace.resolveSkillLink(args.issueId, skill?.relative, agents)
        }
      } catch (error) {
        // A rejected request can be issued again. Interrupted requests remain pending.
        await fs.rm(receiptFile, { force: true })
        snapshot = null
        throw error
      }
      snapshot = null
      signature = null
      const response = { ...result, workspaceId: location.workspaceId, revision: `${sessionId}:${++revision}` }
      // Record the committed result before any unrelated scan. A failed refresh
      // must never turn a completed filesystem operation into a failed receipt.
      await atomicJson(receiptFile, { fingerprint, state: 'complete', result: response, createdAt: Date.now() })
      return response
    })
  }
  return {
    sessionId,
    call(name, input = {}) {
      if (!accepting) return Promise.reject(new WorkspaceError('SERVICE_RESTARTING', 'oneskill is updating. Reopen the workspace shortly.', 503))
      if (!operations[name]) return Promise.reject(new WorkspaceError('UNKNOWN_OPERATION', `Unknown operation: ${name}`, 404))
      return serialize(() => execute(name, input))
    },
    async drain() { accepting = false; await queue },
  }
}
