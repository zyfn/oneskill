import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createDiscoveryContext, prepareDiscoveryContext, configuredAgentLocations, discoverAgent } from './agent-discovery.mjs'
import { readAgentDefinitions } from './agent-catalog.mjs'
import { displayPath, exists } from './filesystem.mjs'
import { detectPlugins as scanPlugins, detectCapabilities as scanCapabilities } from './inventory.mjs'
import { createSkillService } from './skills.mjs'

export const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const WEB_ROOT = path.join(PROJECT_ROOT, 'web')
export const SOURCE_ROOT = path.join(PROJECT_ROOT, 'skills')
export { displayPath, expandHome } from './filesystem.mjs'

export function publicAgent(agent) {
  const { absoluteDir: _absoluteDir, absoluteRoot: _absoluteRoot, absoluteSkillRoots: roots, resourceRules: _resourceRules, configurationHome: _configurationHome, ...safe } = agent
  safe.skillDirectories = roots?.map((root) => ({ ...root, path: displayPath(root.path) }))
  return safe
}

// Runtime modules are shared; only the workspace's data locations vary.
export function createWorkspace({ root = PROJECT_ROOT, discoveryContext: defaultDiscoveryContext } = {}) {
  const workspaceRoot = path.resolve(root)
  const SOURCE_ROOT = path.join(workspaceRoot, 'skills')
  const localCatalog = path.join(workspaceRoot, 'agents.catalog.json')
  async function loadAgents({ discoveryContext = defaultDiscoveryContext } = {}) {
    const catalogFile = exists(localCatalog) ? localCatalog : path.join(PROJECT_ROOT, 'agents.catalog.json')
    const entries = await readAgentDefinitions(workspaceRoot, { platform: discoveryContext?.platform || process.platform, catalogFile })
    const context = await prepareDiscoveryContext(discoveryContext || createDiscoveryContext())
    return Promise.all(entries.map(async (entry) => {
      const { target, configRoot: root, configSource, roots, definition } = configuredAgentLocations(entry, entry.targetOverride, context)
      const skillDir = target.path
      const discovery = await discoverAgent(entry, skillDir, root, context)
      return {
        name: entry.name,
        dir: displayPath(skillDir),
        absoluteDir: skillDir,
        root: displayPath(root),
        absoluteRoot: root,
        absoluteSkillRoots: roots,
        resourceRules: definition.resources,
        support: { skills: roots.length > 0, plugins: Boolean(root && (!definition.resources || definition.resources.plugins?.length)), mcp: Boolean(!definition.resources || definition.resources.mcp?.files?.length) },
        configurationSource: configSource,
        configurationHome: context.home,
        logo: entry.logo || '',
        ...discovery,
        directorySource: target.source,
        detection: { ...discovery.detection, evidence: discovery.detection.evidence.map((item) => ({ ...item, path: displayPath(item.path), ...(item.realPath ? { realPath: displayPath(item.realPath) } : {}), ...(item.executablePath ? { executablePath: displayPath(item.executablePath) } : {}) })) },
        preset: entry.preset,
      }
    }))
  }

  const skills = createSkillService({ sourceRoot: SOURCE_ROOT, ignoreFile: path.join(workspaceRoot, 'migrate.ignore'), loadAgents })
  const { detectSkills, detectMigrations, countAgentSkills, setSkillLink, importLocalSkills, setSkillIgnored } = skills
  const detectPlugins = async (agents = null) => scanPlugins(agents || await loadAgents())
  const detectCapabilities = async (kind, agents = null) => scanCapabilities(kind, agents || await loadAgents())

  async function workspaceData() {
    const agents = await loadAgents()
    const [skills, plugins, mcp, hooks, migrations, countedAgents] = await Promise.all([
      detectSkills(agents),
      detectPlugins(agents),
      detectCapabilities('mcp', agents),
      detectCapabilities('hook', agents),
      detectMigrations(agents),
      countAgentSkills(agents),
    ])
    const installedAgents = agents.filter((agent) => agent.installed).length
    const detectedAgents = agents.filter((agent) => agent.detected).length
    const attention = skills.items.filter((item) => item.status === 'attention').length

    return {
      checkedAt: new Date().toISOString(),
      source: displayPath(SOURCE_ROOT),
      agents: countedAgents.map((agent) => publicAgent(agent)),
      skills: skills.items,
      plugins: plugins.items,
      mcp: mcp.items,
      hooks: hooks.items,
      migrations: migrations.items,
      ignoredSkills: migrations.ignoredItems,
      stats: {
        agents: agents.length,
        installedAgents,
        detectedAgents,
        skills: skills.items.length,
        plugins: plugins.items.length,
        mcp: mcp.items.length,
        hooks: hooks.items.length,
        migrations: migrations.items.length,
        ignoredSkills: migrations.ignoredItems.length,
        attention,
      },
      scan: {
        skills: skills.scan,
        plugins: plugins.scan,
        mcp: mcp.scan,
        hooks: hooks.scan,
        migrations: migrations.scan,
      },
    }
  }

  return { root: workspaceRoot, sourceRoot: SOURCE_ROOT, loadAgents, detectPlugins, detectCapabilities, workspaceData, ...skills }
}

export const { loadAgents, detectSkills, detectPlugins, detectCapabilities, detectMigrations, countAgentSkills, setSkillLink, importLocalSkills, setSkillIgnored, workspaceData } = createWorkspace()
