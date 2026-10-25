import fs from 'node:fs'
import path from 'node:path'
import { adoptLocalSkill } from './migration.mjs'
import { displayPath, expandHome, exists } from './filesystem.mjs'
import { agentSkillRoots, bindingState, findAgentSkills, findSkillPackages } from './skill-scan.mjs'
import { createIgnoreStore, isSkillIgnored } from './skill-ignore.mjs'
import { WorkspaceError } from './contracts/operations.mjs'
import { managedSource, skillDestination, inspectSkillLinks } from './skill-links.mjs'

export function createSkillService({ sourceRoot: SOURCE_ROOT, ignoreFile, loadAgents }) {
  const ignoreStore = createIgnoreStore(ignoreFile)
  let importInProgress = false
  async function detectSkills(agents = null, linkScan = null) {
    agents ||= await loadAgents()
    linkScan ||= await inspectSkillLinks(SOURCE_ROOT, agents)
    const { packages, scan } = await findSkillPackages(SOURCE_ROOT)
    const skills = []
    for (const item of packages) {
      let sourceReal
      try { sourceReal = await fs.promises.realpath(item.dir) }
      catch (error) { scan.diagnostics.push({ path: displayPath(item.dir), code: error.code || 'READ_FAILED' }); continue }
      const relative = path.relative(SOURCE_ROOT, item.dir).split(path.sep).join('/')
      const name = item.declaredName || path.basename(item.dir)
      const bindings = []
      for (const agent of agents.filter((entry) => (entry.detected || entry.configured) && agentSkillRoots(entry).length)) {
        const roots = agentSkillRoots(agent)
        if (!roots.some(root => root.target)) continue
        const candidates = await Promise.all(roots.map(async (root) => {
          const destination = path.join(root.path, relative)
          return { destination, target: Boolean(root.target), scope: root.scope, state: await bindingState(item.dir, destination) }
        }))
        const target = candidates.find((entry) => entry.target)
        const inherited = [
          ...candidates.filter((entry) => !entry.target && entry.scope !== 'user' && entry.state === 'linked'),
          ...linkScan.links.filter(entry => entry.agent === agent.name && entry.scope !== 'user' && entry.source === sourceReal && !candidates.some(candidate => candidate.destination === entry.destination)),
        ]
        bindings.push({
          agent: agent.name,
          state: target.state === 'not-linked' && inherited.length ? 'inherited' : target.state,
          destination: displayPath(target.destination),
          destinations: [...new Set([...candidates.filter((entry) => entry.scope !== 'user' && entry.state === 'linked'), ...inherited].map((entry) => displayPath(entry.destination)))],
          inheritedDestinations: inherited.map((entry) => displayPath(entry.destination)),
        })
      }
      const linked = bindings.filter((binding) => ['linked', 'inherited'].includes(binding.state)).length
      const attention = bindings.filter((binding) => ['broken', 'conflict'].includes(binding.state)).length
      skills.push({
        name,
        relative,
        category: path.dirname(relative) === '.' ? '' : path.dirname(relative).split(path.sep).join('/'),
        description: item.description,
        path: displayPath(item.dir),
        managed: true,
        origin: 'shared-library',
        bindings,
        linked,
        agentCount: bindings.length,
        status: attention ? 'attention' : linked ? 'linked' : 'not-linked',
      })
    }
    skills.sort((a, b) => a.relative.localeCompare(b.relative))
    return { items: skills, scan: { visited: scan.visited, truncated: scan.truncated, diagnostics: scan.diagnostics } }
  }

  async function detectUnmanagedSkills(agents = null) {
    agents ||= await loadAgents()
    const rules = await ignoreStore.read()
    const sourceReal = exists(SOURCE_ROOT) ? await fs.promises.realpath(SOURCE_ROOT) : SOURCE_ROOT
    const rootOwners = new Map()
    for (const agent of agents) {
      for (const root of agentSkillRoots(agent)) {
        const location = await fs.promises.realpath(root.path).catch(() => path.resolve(root.path))
        const owner = rootOwners.get(location) || { agents: new Set(), shared: false }
        owner.agents.add(agent.name)
        owner.shared ||= root.scope === 'user'
        rootOwners.set(location, owner)
      }
    }
    const discovered = new Map()
    let visited = 0
    let truncated = false
    const diagnostics = []
    for (const agent of agents.filter((entry) => entry.detected || entry.configured)) {
      const result = await findAgentSkills(agent)
      visited += result.scan.visited
      truncated ||= result.scan.truncated
      diagnostics.push(...result.scan.diagnostics.map(item => ({ ...item, agent: agent.name })))
      for (const item of result.packages) {
        let real
        try {
          real = await fs.promises.realpath(item.dir)
        } catch (error) {
          diagnostics.push({ path: displayPath(item.dir), agent: agent.name, code: error.code || 'READ_FAILED' })
          continue
        }
        if (real === sourceReal || real.startsWith(`${sourceReal}${path.sep}`)) continue
        const rootLocation = await fs.promises.realpath(item.root.path).catch(() => path.resolve(item.root.path))
        const owner = rootOwners.get(rootLocation)
        const sourceAgents = [...new Set([...(owner?.agents || []), agent.name])]
        const name = item.declaredName || path.basename(item.dir)
        const candidate = {
          name,
          agent: agent.name,
          sourceAgents,
          sourceKind: owner?.shared || sourceAgents.length > 1 ? 'shared' : 'agent',
          description: item.description,
          path: displayPath(item.dir),
          relative: `${item.root.ignorePrefix ?? (item.root.target ? '' : `@${item.root.id}/`)}${path.relative(item.root.path, item.dir).split(path.sep).join('/')}`,
          ignoreAliases: item.aliases.map((alias) => `${alias.root.ignorePrefix ?? (alias.root.target ? '' : `@${alias.root.id}/`)}${path.relative(alias.root.path, alias.dir).split(path.sep).join('/')}`),
          ignoreSources: [],
          root: displayPath(item.root.path),
          category: path.dirname(path.relative(item.root.path, item.dir)) === '.' ? '' : path.dirname(path.relative(item.root.path, item.dir)).split(path.sep).join('/'),
          managed: false,
          origin: owner?.shared || sourceAgents.length > 1 ? 'shared-folder' : 'agent-folder',
        }
        const previous = discovered.get(real)
        if (previous) {
          previous.sourceAgents = [...new Set([...previous.sourceAgents, ...sourceAgents])]
          if (candidate.sourceKind === 'shared' || previous.sourceAgents.length > 1) {
            previous.sourceKind = 'shared'
            previous.origin = 'shared-folder'
          }
          previous.ignoreSources.push(...[candidate.relative, ...candidate.ignoreAliases].map(relative => ({ agent: candidate.agent, relative })))
        } else discovered.set(real, candidate)
      }
    }
    const items = []
    const ignoredItems = []
    for (const candidate of discovered.values()) {
      if (isSkillIgnored(candidate, rules)) ignoredItems.push({ ...candidate, ignored: true })
      else items.push(candidate)
    }
    return { items, ignoredItems, scan: { visited, truncated, diagnostics } }
  }

  async function countAgentSkills(agents) {
    return Promise.all(agents.map(async (agent) => {
      if (agent.support?.skills === false) return { ...agent, totalSkills: null, skillsTruncated: false }
      if (!agent.detected && !agent.configured) return { ...agent, totalSkills: 0, skillsTruncated: false }
      const result = await findAgentSkills(agent, true)
      return { ...agent, totalSkills: result.packages.length, skillsTruncated: result.scan.truncated || result.scan.diagnostics.length > 0 }
    }))
  }

  async function setSkillLink(agentName, skillRelative, linked, agents = null) {
    agents ||= await loadAgents()
    const agent = agents.find((entry) => entry.name === agentName)
    if (!agent) throw new WorkspaceError('AGENT_NOT_FOUND', `Unknown agent: ${agentName}`, 404)
    if (!agent.detected && !agent.configured) throw new Error(`${agentName} was not detected`)
    if (!agent.absoluteDir) throw new Error(`${agentName} has no skill target configured`)
    const source = await managedSource(SOURCE_ROOT, skillRelative)
    const destination = await skillDestination(agent.absoluteDir, skillRelative, { create: linked })
    let stat = null
    try {
      stat = await fs.promises.lstat(destination)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }

    if (linked) {
      if (stat) {
        const current = await bindingState(source, destination)
        if (current === 'linked') return { changed: false, state: 'linked' }
        throw new WorkspaceError('TARGET_CONFLICT', `Destination already exists: ${displayPath(destination)}`, 409)
      }
      await fs.promises.mkdir(path.dirname(destination), { recursive: true })
      await fs.promises.symlink(source, destination, 'dir')
      return { changed: true, state: 'linked' }
    }

    if (stat && await bindingState(source, destination) === 'linked') {
      await fs.promises.unlink(destination)
      return { changed: true, state: 'not-linked' }
    }
    if (!stat) return { changed: false, state: 'not-linked' }
    if (!stat.isSymbolicLink()) throw new WorkspaceError('TARGET_CONFLICT', `Refusing to remove a real directory: ${displayPath(destination)}`, 409)
    throw new WorkspaceError('TARGET_CONFLICT', `Destination links to a different source: ${displayPath(destination)}`, 409)
  }

  async function importSkills(requested, knownAgents = null) {
    if (!Array.isArray(requested) || !requested.length || requested.length > 100) throw new Error('Select between 1 and 100 local skills.')
    if (importInProgress) throw new Error('Another import is running. Please wait.')
    importInProgress = true
    try {
      const agents = knownAgents || await loadAgents()
      const candidates = (await detectUnmanagedSkills(agents)).items
      const results = []
      for (const request of requested) {
        const candidate = candidates.find((item) => item.agent === request?.agent && item.path === request?.path)
        if (!candidate) {
          results.push({ agent: request?.agent, path: request?.path, ok: false, error: 'This skill is no longer available for import. Scan again.' })
          continue
        }
        const agent = agents.find((entry) => entry.name === candidate.agent)
        try {
          const root = expandHome(candidate.root || agent.dir)
          const backupRoot = candidate.sourceKind === 'shared' ? path.join(path.dirname(root), '.oneskill-backups') : path.join(agent.absoluteRoot || root, '.oneskill-backups')
          const result = await adoptLocalSkill({ source: expandHome(candidate.path), agentDir: root, sharedRoot: SOURCE_ROOT, backupRoot })
          results.push({ ...candidate, ok: true, relative: result.relative, reused: result.reused, backup: displayPath(result.backup) })
        } catch (error) {
          results.push({ ...candidate, ok: false, error: error.message })
        }
      }
      return { results }
    } finally { importInProgress = false }
  }
  function setSkillIgnored(agentName, value, ignored) {
    return ignoreStore.update(async () => {
      const agents = await loadAgents()
      if (!agents.some((agent) => agent.name === agentName)) throw new Error(`Unknown agent: ${agentName}`)
      const discovered = await detectUnmanagedSkills(agents)
      const candidate = [...discovered.items, ...discovered.ignoredItems].find((item) => item.agent === agentName && item.path === value)
      if (!candidate) throw new Error('This local skill is no longer available. Scan again.')
      return candidate
    }, ignored)
  }
  function setSkillsIgnored(requested, ignored, knownAgents = null) {
    return ignoreStore.updateMany(async () => {
      const agents = knownAgents || await loadAgents()
      const discovered = await detectUnmanagedSkills(agents)
      return requested.map(request => {
        const candidate = [...discovered.items, ...discovered.ignoredItems].find(item => item.agent === request.agent && item.path === request.path)
        if (!candidate) throw new WorkspaceError('SOURCE_CHANGED', 'A selected Skill changed. Rescan before continuing.', 409)
        return candidate
      })
    }, ignored)
  }

  return { detectSkills, detectUnmanagedSkills, countAgentSkills, setSkillLink, importSkills, setSkillIgnored, setSkillsIgnored }
}
