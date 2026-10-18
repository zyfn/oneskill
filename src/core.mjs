import path from 'node:path'
import fs from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { createDiscoveryContext, prepareDiscoveryContext, configuredAgentLocations, discoverAgent } from './agent-discovery.mjs'
import { readAgentDefinitions } from './agent-catalog.mjs'
import { displayPath, exists } from './filesystem.mjs'
import { detectPlugins as scanPlugins, detectCapabilities as scanCapabilities } from './inventory.mjs'
import { createSkillService } from './skills.mjs'
import { defaultWorkspaceRoot, digest } from './runtime/paths.mjs'

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const WEB_ROOT = path.join(PROJECT_ROOT, 'web')
export { displayPath, expandHome } from './filesystem.mjs'
const scanSummary = scan => ({ ...scan, complete: !scan.truncated && !(scan.diagnostics || []).length })

async function agentLogo(logo) {
  if (!logo?.startsWith('/agent-logos/')) return logo || ''
  const file = path.resolve(WEB_ROOT, 'public', logo.slice(1))
  if (!file.startsWith(path.join(WEB_ROOT, 'public', 'agent-logos') + path.sep)) return ''
  const mime = { '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' }[path.extname(file).toLowerCase()]
  if (!mime) return ''
  try { return `data:${mime};base64,${(await fs.readFile(file)).toString('base64')}` } catch { return '' }
}

export function publicAgent(agent) {
  const { detected: _detected, absoluteDir: _absoluteDir, absoluteRoot: _absoluteRoot, absoluteSkillRoots: roots, resourceRules: _resourceRules, configurationHome: _configurationHome, ...safe } = agent
  safe.skillDirectories = roots?.map((root) => ({ ...root, path: displayPath(root.path) }))
  return safe
}

// Runtime modules are shared; only the workspace's data locations vary.
export function createWorkspace({ root = defaultWorkspaceRoot(), discoveryContext: defaultDiscoveryContext } = {}) {
  const workspaceRoot = path.resolve(root)
  const SOURCE_ROOT = path.join(workspaceRoot, 'skills')
  const localCatalog = path.join(workspaceRoot, 'agents.catalog.json')
  async function loadAgents({ discoveryContext = defaultDiscoveryContext } = {}) {
    const catalogFile = exists(localCatalog) ? localCatalog : path.join(PROJECT_ROOT, 'agents.catalog.json')
    const entries = await readAgentDefinitions(workspaceRoot, { platform: discoveryContext?.platform || process.platform, catalogFile })
    const context = await prepareDiscoveryContext(discoveryContext || createDiscoveryContext())
    return Promise.all(entries.map(async (entry) => {
      const { target, configRoot: root, configSource, roots, definition } = configuredAgentLocations(entry, context)
      const skillDir = target.path
      const discovery = await discoverAgent(entry, skillDir, root, context)
      return {
        name: entry.name,
        dir: displayPath(skillDir),
        absoluteDir: skillDir,
        root: displayPath(root),
        absoluteRoot: root,
        absoluteSkillRoots: roots,
        skillTargetId: skillDir ? digest(await fs.realpath(skillDir).catch(() => skillDir)) : null,
        resourceRules: definition.resources,
        support: { skills: roots.length > 0, plugins: Boolean(root && (!definition.resources || definition.resources.plugins?.length)), mcp: Boolean(!definition.resources || definition.resources.mcp?.files?.length) },
        configurationSource: configSource,
        configurationHome: context.home,
        logo: await agentLogo(entry.logo),
        ...discovery,
        directorySource: target.source,
        detection: { ...discovery.detection, evidence: discovery.detection.evidence.map((item) => ({ ...item, path: displayPath(item.path), ...(item.realPath ? { realPath: displayPath(item.realPath) } : {}), ...(item.executablePath ? { executablePath: displayPath(item.executablePath) } : {}) })) },
        preset: entry.preset,
      }
    }))
  }

  const skills = createSkillService({ sourceRoot: SOURCE_ROOT, ignoreFile: path.join(workspaceRoot, 'skills.ignore.json'), loadAgents })
  const { detectSkills, detectUnmanagedSkills, countAgentSkills } = skills
  const detectPlugins = async (agents = null) => scanPlugins(agents || await loadAgents())
  const detectCapabilities = async (kind, agents = null, plugins = null) => {
    agents ||= await loadAgents()
    if (kind === 'mcp') plugins ||= await detectPlugins(agents)
    const result = await scanCapabilities(kind, agents, { plugins: plugins?.items || [] })
    if (plugins?.scan.truncated) result.scan.truncated = true
    return result
  }

  async function workspaceData() {
    const agents = await loadAgents()
    const pluginScan = detectPlugins(agents)
    const [skills, plugins, mcp, hooks, localSkills, countedAgents] = await Promise.all([
      detectSkills(agents),
      pluginScan,
      pluginScan.then(plugins => detectCapabilities('mcp', agents, plugins)),
      detectCapabilities('hook', agents),
      detectUnmanagedSkills(agents),
      countAgentSkills(agents),
    ])
    const installedAgents = agents.filter((agent) => agent.installed).length
    const attention = skills.items.filter((item) => item.status === 'attention').length

    const managed = skills.items.map(item => ({ ...item, id: `managed:${item.relative}`, ignored: false, bindings: item.bindings.map(binding => ({ ...binding, agentId: `agent:${binding.agent}`, skillId: `managed:${item.relative}` })) }))
    const unmanaged = [...localSkills.items, ...localSkills.ignoredItems].map(item => ({ ...item, id: `local:${item.agent}:${item.relative}`, agentId: `agent:${item.agent}`, ignored: Boolean(item.ignored) }))
    const collections = new Map()
    for (const skill of managed) {
      const parts = skill.category.split('/').filter(Boolean)
      for (let depth = 1; depth <= parts.length; depth++) {
        const location = parts.slice(0, depth).join('/')
        const existing = collections.get(location)
        if (existing) existing.count++
        else collections.set(location, { id: `collection:${location}`, path: location, name: parts[depth - 1], parentId: depth === 1 ? null : `collection:${parts.slice(0, depth - 1).join('/')}`, count: 1 })
      }
    }
    const inventory = (kind, items) => items.map(item => ({ ...item, id: `${kind}:${item.agent}:${item.pluginId || item.path || item.source}:${item.name}`, kind }))
    return {
      checkedAt: new Date().toISOString(),
      source: displayPath(SOURCE_ROOT),
      agents: countedAgents.map((agent) => ({ ...publicAgent(agent), id: `agent:${agent.name}` })),
      skills: [...managed, ...unmanaged],
      collections: [...collections.values()],
      plugins: inventory('plugin', plugins.items),
      mcp: inventory('mcp', mcp.items),
      hooks: inventory('hook', hooks.items),
      stats: {
        agents: agents.length,
        installedAgents,
        skills: managed.length + unmanaged.length,
        managedSkills: managed.length,
        unmanagedSkills: localSkills.items.length,
        plugins: plugins.items.length,
        mcp: mcp.items.length,
        hooks: hooks.items.length,
        ignoredSkills: localSkills.ignoredItems.length,
        attention,
      },
      scan: {
        skills: scanSummary({ ...skills.scan, truncated: skills.scan.truncated || localSkills.scan.truncated, library: scanSummary(skills.scan), unmanaged: scanSummary(localSkills.scan) }),
        plugins: scanSummary(plugins.scan),
        mcp: scanSummary(mcp.scan),
        hooks: scanSummary(hooks.scan),
      },
    }
  }

  return { root: workspaceRoot, sourceRoot: SOURCE_ROOT, loadAgents, detectPlugins, detectCapabilities, workspaceData, ...skills }
}
