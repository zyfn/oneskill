import fs from 'node:fs'
import path from 'node:path'
import { adoptLocalSkill } from './migration.mjs'
import { displayPath, expandHome, exists } from './filesystem.mjs'
import { agentSkillRoots, bindingState, findAgentSkills, findSkillPackages } from './skill-scan.mjs'
import { createIgnoreStore, isSkillIgnored } from './skill-ignore.mjs'

export function createSkillService({ sourceRoot: SOURCE_ROOT, ignoreFile, loadAgents }) {
  const ignoreStore = createIgnoreStore(ignoreFile)
  let importInProgress = false
  async function detectSkills(agents = null) {
    agents ||= await loadAgents()
    const { packages, scan } = await findSkillPackages(SOURCE_ROOT)
    const skills = []
    for (const item of packages) {
      const relative = path.relative(SOURCE_ROOT, item.dir)
      const name = item.declaredName || path.basename(item.dir)
      const bindings = []
      for (const agent of agents.filter((entry) => (entry.detected || entry.configured) && agentSkillRoots(entry).length)) {
        const candidates = await Promise.all(agentSkillRoots(agent).map(async (root) => {
          const destination = path.join(root.path, relative)
          return { destination, state: await bindingState(item.dir, destination) }
        }))
        const chosen = candidates.find((entry) => entry.state === 'linked') || candidates.find((entry) => entry.state === 'conflict') || candidates.find((entry) => entry.state === 'broken') || candidates[0]
        bindings.push({
          agent: agent.name,
          state: chosen.state,
          destination: displayPath(chosen.destination),
          destinations: candidates.filter((entry) => entry.state === 'linked').map((entry) => displayPath(entry.destination)),
        })
      }
      const linked = bindings.filter((binding) => binding.state === 'linked').length
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
    return { items: skills, scan: { visited: scan.visited, truncated: scan.truncated } }
  }

  async function detectMigrations(agents = null) {
    agents ||= await loadAgents()
    const rules = await ignoreStore.read()
    const sourceReal = exists(SOURCE_ROOT) ? await fs.promises.realpath(SOURCE_ROOT) : SOURCE_ROOT
    const items = []
    const ignoredItems = []
    let visited = 0
    let truncated = false
    for (const agent of agents.filter((entry) => entry.detected || entry.configured)) {
      const result = await findAgentSkills(agent)
      visited += result.scan.visited
      truncated ||= result.scan.truncated
      for (const item of result.packages) {
        let real
        try {
          real = await fs.promises.realpath(item.dir)
        } catch {
          continue
        }
        if (real === sourceReal || real.startsWith(`${sourceReal}${path.sep}`)) continue
        const name = item.declaredName || path.basename(item.dir)
        const candidate = {
          name,
          agent: agent.name,
          description: item.description,
          path: displayPath(item.dir),
          relative: `${item.root.ignorePrefix ?? (item.root.target ? '' : `@${item.root.id}/`)}${path.relative(item.root.path, item.dir).split(path.sep).join('/')}`,
          ignoreAliases: item.aliases.map((alias) => `${alias.root.ignorePrefix ?? (alias.root.target ? '' : `@${alias.root.id}/`)}${path.relative(alias.root.path, alias.dir).split(path.sep).join('/')}`),
          root: displayPath(item.root.path),
          category: path.dirname(path.relative(item.root.path, item.dir)) === '.' ? '' : path.dirname(path.relative(item.root.path, item.dir)).split(path.sep).join('/'),
          managed: false,
          origin: 'agent-folder',
        }
        if (isSkillIgnored(candidate, rules)) ignoredItems.push({ ...candidate, ignored: true })
        else items.push(candidate)
      }
    }
    return { items, ignoredItems, scan: { visited, truncated } }
  }

  async function countAgentSkills(agents) {
    return Promise.all(agents.map(async (agent) => {
      if (agent.support?.skills === false) return { ...agent, totalSkills: null, skillsTruncated: false }
      if (!agent.detected && !agent.configured) return { ...agent, totalSkills: 0, skillsTruncated: false }
      const result = await findAgentSkills(agent, true)
      return { ...agent, totalSkills: result.packages.length, skillsTruncated: result.scan.truncated }
    }))
  }

  async function setSkillLink(agentName, skillRelative, linked) {
    const agents = await loadAgents()
    const agent = agents.find((entry) => entry.name === agentName)
    if (!agent) throw new Error(`Unknown agent: ${agentName}`)
    if (!agent.detected && !agent.configured) throw new Error(`${agentName} was not detected`)
    if (!agent.absoluteDir) throw new Error(`${agentName} has no skill target configured`)
    const source = path.resolve(SOURCE_ROOT, skillRelative)
    if (!(source === SOURCE_ROOT || source.startsWith(`${SOURCE_ROOT}${path.sep}`)) || !exists(path.join(source, 'SKILL.md'))) {
      throw new Error(`Unknown skill: ${skillRelative}`)
    }
    const destination = path.resolve(agent.absoluteDir, skillRelative)
    if (!(destination === agent.absoluteDir || destination.startsWith(`${agent.absoluteDir}${path.sep}`))) {
      throw new Error('Invalid skill destination')
    }
    let stat = null
    try {
      stat = await fs.promises.lstat(destination)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }

    const linkedDestinations = []
    for (const root of agentSkillRoots(agent)) {
      const candidate = path.resolve(root.path, skillRelative)
      if (!(candidate.startsWith(`${path.resolve(root.path)}${path.sep}`))) throw new Error('Invalid skill destination')
      if (await bindingState(source, candidate) === 'linked') linkedDestinations.push(candidate)
    }

    if (linked) {
      if (linkedDestinations.length) return { changed: false, state: 'linked' }
      if (stat) {
        const current = await bindingState(source, destination)
        if (current === 'linked') return { changed: false, state: 'linked' }
        throw new Error(`Destination already exists: ${displayPath(destination)}`)
      }
      await fs.promises.mkdir(path.dirname(destination), { recursive: true })
      await fs.promises.symlink(source, destination, 'dir')
      return { changed: true, state: 'linked' }
    }

    if (linkedDestinations.length) {
      for (const candidate of linkedDestinations) await fs.promises.unlink(candidate)
      return { changed: true, state: 'not-linked' }
    }
    if (!stat) return { changed: false, state: 'not-linked' }
    if (!stat.isSymbolicLink()) throw new Error(`Refusing to remove a real directory: ${displayPath(destination)}`)
    throw new Error(`Destination links to a different source: ${displayPath(destination)}`)
  }

  async function importLocalSkills(requested) {
    if (!Array.isArray(requested) || !requested.length || requested.length > 100) throw new Error('Select between 1 and 100 local skills.')
    if (importInProgress) throw new Error('Another import is running. Please wait.')
    importInProgress = true
    try {
      const agents = await loadAgents()
      const candidates = (await detectMigrations(agents)).items
      const results = []
      for (const request of requested) {
        const candidate = candidates.find((item) => item.agent === request?.agent && item.path === request?.path)
        if (!candidate) {
          results.push({ agent: request?.agent, path: request?.path, ok: false, error: 'This skill is no longer available for import. Scan again.' })
          continue
        }
        const agent = agents.find((entry) => entry.name === candidate.agent)
        try {
          const result = await adoptLocalSkill({ source: expandHome(candidate.path), agentDir: expandHome(candidate.root || agent.dir), sharedRoot: SOURCE_ROOT, backupRoot: path.join(agent.absoluteRoot, '.oneskill-backups') })
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
      const discovered = await detectMigrations(agents)
      const candidate = [...discovered.items, ...discovered.ignoredItems].find((item) => item.agent === agentName && item.path === value)
      if (!candidate) throw new Error('This local skill is no longer available. Scan again.')
      return candidate
    }, ignored)
  }

  return { detectSkills, detectMigrations, countAgentSkills, setSkillLink, importLocalSkills, setSkillIgnored }
}
