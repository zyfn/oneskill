import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { adoptLocalSkill } from './migration.mjs'
import { createDiscoveryContext, prepareDiscoveryContext, configuredAgentLocations, discoverAgent } from './agent-discovery.mjs'
import { configurationEntries, readConfiguration } from './configuration.mjs'
import { readAgentDefinitions } from './agent-catalog.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
export const PROJECT_ROOT = path.resolve(here, '..')
export const WEB_ROOT = path.join(PROJECT_ROOT, 'web')
export const SOURCE_ROOT = path.join(PROJECT_ROOT, 'skills')

const IGNORE_FILE = path.join(PROJECT_ROOT, 'migrate.ignore')

const PRUNED_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'coverage', '__pycache__',
  'logs', 'log', 'tmp', 'temp', 'sessions', 'archived_sessions',
  'projects', 'worktrees', 'workspace', 'history', 'shell_snapshots',
  'generated_images', 'visualizations', 'sqlite', 'telemetry',
])

const CONFIG_NAMES = new Set(['.mcp.json', 'mcp.json', 'hooks.json', 'settings.json'])
const MANIFEST_NAMES = new Set(['plugin.json', 'package.json'])

export function expandHome(value) {
  if (!value) return value
  if (value === '~') return os.homedir()
  return value.startsWith('~/') || value.startsWith('~\\') ? path.join(os.homedir(), value.slice(2)) : path.resolve(value)
}

export function displayPath(value) {
  if (!value) return ''
  const home = os.homedir()
  return value === home ? '~' : value.startsWith(`${home}${path.sep}`) ? `~${value.slice(home.length)}` : value
}

function exists(value) {
  try {
    fs.accessSync(value)
    return true
  } catch {
    return false
  }
}

async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.promises.readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

async function readText(file, fallback = '') {
  try {
    return await fs.promises.readFile(file, 'utf8')
  } catch {
    return fallback
  }
}

export async function loadAgents({ discoveryContext } = {}) {
  const entries = await readAgentDefinitions(PROJECT_ROOT, { platform: discoveryContext?.platform || process.platform })
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

async function walkBounded(root, options = {}) {
  const {
    maxDepth = 7,
    maxEntries = 5000,
    shouldCollect = () => false,
    stopAtMatch = false,
    prune = PRUNED_DIRS,
    followLinks = false,
  } = options
  const matches = []
  let visited = 0
  let truncated = false

  async function visit(current, depth, ancestors = new Set()) {
    if (followLinks) {
      const real = await fs.promises.realpath(current).catch(() => null)
      if (!real || ancestors.has(real)) return
      ancestors = new Set([...ancestors, real])
    }
    if (visited >= maxEntries) {
      truncated = true
      return
    }
    let entries
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    let matchedHere = false
    for (const entry of entries) {
      if (visited >= maxEntries) {
        truncated = true
        break
      }
      visited += 1
      const fullPath = path.join(current, entry.name)
      if (shouldCollect(fullPath, entry, depth)) {
        matches.push(fullPath)
        matchedHere = true
      }
    }
    if (stopAtMatch && matchedHere) return
    if (depth >= maxDepth) {
      if (entries.some((entry) => !prune.has(entry.name) && !entry.name.startsWith('.oneskill-') && (entry.isDirectory() || (followLinks && entry.isSymbolicLink())))) truncated = true
      return
    }
    for (const entry of entries) {
      if (visited >= maxEntries) break
      if (prune.has(entry.name) || entry.name.startsWith('.oneskill-')) continue
      if (!entry.isDirectory() && !(followLinks && entry.isSymbolicLink())) continue
      await visit(path.join(current, entry.name), depth + 1, ancestors)
    }
  }

  if (exists(root)) await visit(root, 0)
  return { matches, visited, truncated }
}

function parseFrontmatter(text) {
  const result = {}
  if (!text.startsWith('---')) return result
  const end = text.indexOf('\n---', 3)
  if (end < 0) return result
  const lines = text.slice(3, end).split(/\r?\n/)
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const match = line.match(/^([\w-]+):\s*(.*)$/)
    if (!match) continue
    const key = match[1]
    const value = match[2].trim()
    if (value === '>' || value === '|') {
      const parts = []
      while (index + 1 < lines.length && /^\s+/.test(lines[index + 1])) {
        index += 1
        parts.push(lines[index].trim())
      }
      result[key] = value === '|' ? parts.join('\n').trim() : parts.join(' ').replace(/\s+/g, ' ').trim()
    } else {
      result[key] = value.replace(/^['"]|['"]$/g, '')
    }
  }
  return result
}

async function describeSkill(manifest) {
  const text = await readText(manifest)
  const metadata = parseFrontmatter(text)
  const body = text.replace(/^---[\s\S]*?---\s*/, '')
  const firstParagraph = body
    .split(/\n\s*\n/)
    .map((part) => part.replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').trim())
    .find(Boolean)
  return {
    declaredName: metadata.name || '',
    description: metadata.description || firstParagraph || 'No description provided.',
  }
}

async function findSkillPackages(root, followLinks = false) {
  const scan = await walkBounded(root, {
    followLinks,
    maxDepth: 8,
    maxEntries: 6000,
    stopAtMatch: true,
    shouldCollect: (_file, entry) => entry.isFile() && entry.name === 'SKILL.md',
  })
  const packages = []
  for (const manifest of scan.matches) {
    const dir = path.dirname(manifest)
    const info = await describeSkill(manifest)
    packages.push({ manifest, dir, ...info })
  }
  return { packages, scan }
}

async function bindingState(sourceDir, destination) {
  try {
    const stat = await fs.promises.lstat(destination)
    if (!stat.isSymbolicLink()) return 'conflict'
    try {
      const [sourceReal, destinationReal] = await Promise.all([
        fs.promises.realpath(sourceDir),
        fs.promises.realpath(destination),
      ])
      return sourceReal === destinationReal ? 'linked' : 'conflict'
    } catch {
      return 'broken'
    }
  } catch (error) {
    return error?.code === 'ENOENT' ? 'not-linked' : 'conflict'
  }
}

export async function detectSkills(agents = null) {
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

function pluginDirectory(manifest) {
  const parent = path.basename(path.dirname(manifest))
  return parent === '.codex-plugin' || parent === '.claude-plugin'
    ? path.dirname(path.dirname(manifest))
    : path.dirname(manifest)
}

function capabilityList(manifest, pluginDir) {
  const capabilities = []
  const add = (value) => {
    if (!capabilities.includes(value)) capabilities.push(value)
  }
  if (manifest.skills || exists(path.join(pluginDir, 'skills'))) add('Skills')
  if (manifest.mcpServers || manifest.mcp_servers || exists(path.join(pluginDir, '.mcp.json'))) add('MCP')
  if (manifest.hooks || exists(path.join(pluginDir, 'hooks'))) add('Hooks')
  if (manifest.apps || exists(path.join(pluginDir, 'apps'))) add('Apps')
  if (manifest.commands || exists(path.join(pluginDir, 'commands'))) add('Commands')
  return capabilities
}

function isPluginManifest(file, manifest) {
  if (path.basename(path.dirname(file)) === '.codex-plugin') return true
  if (path.basename(path.dirname(file)) === '.claude-plugin') return true
  if (path.basename(file) === 'plugin.json') return true
  const keywords = Array.isArray(manifest?.keywords) ? manifest.keywords.join(' ').toLowerCase() : ''
  return Boolean(
    manifest?.plugin || manifest?.skills || manifest?.mcpServers || manifest?.hooks ||
    /(?:agent|claude|codex|qwen|cursor)[- ]?plugin/.test(keywords)
  )
}

function pluginSource(pluginDir, root) {
  const relative = path.relative(root, pluginDir)
  const parts = relative.split(path.sep).filter(Boolean)
  if (!parts.length) return 'local'
  return parts.length > 2 ? parts.slice(0, -2).join('/') || 'local' : parts[0]
}

async function pluginIcon(pluginDir, manifest) {
  const value = manifest?.logo || manifest?.icon || manifest?.interface?.logo || manifest?.interface?.icon
  if (typeof value !== 'string' || !value.trim()) return ''
  const source = value.trim()
  if (/^data:image\//i.test(source) || /^https?:\/\//i.test(source)) return source
  const candidate = path.resolve(pluginDir, source)
  const root = path.resolve(pluginDir)
  if (candidate !== root && !candidate.startsWith(`${root}${path.sep}`)) return ''
  try {
    const info = await fs.promises.stat(candidate)
    if (!info.isFile() || info.size > 512 * 1024) return ''
    const mime = {
      '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
      '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    }[path.extname(candidate).toLowerCase()]
    if (!mime) return ''
    return `data:${mime};base64,${(await fs.promises.readFile(candidate)).toString('base64')}`
  } catch {
    return ''
  }
}

export async function detectPlugins(agents = null) {
  agents ||= await loadAgents()
  const items = []
  const scans = []
  const seen = new Set()
  const seenDirectories = new Set()

  for (const agent of agents.filter((entry) => entry.absoluteRoot && (entry.detected || entry.configured))) {
    const configuredRoots = agent.resourceRules ? agent.resourceRules.plugins || [] : ['plugins']
    for (const configuredRoot of configuredRoots) {
      const root = path.resolve(agent.absoluteRoot, configuredRoot)
      if (!exists(root)) continue
      const scan = await walkBounded(root, {
        maxDepth: 8,
        maxEntries: 8000,
        shouldCollect: (_file, entry) => entry.isFile() && MANIFEST_NAMES.has(entry.name),
      })
      scans.push({ agent: agent.name, root: displayPath(root), visited: scan.visited, truncated: scan.truncated })
      const manifests = [...scan.matches].sort((left, right) => {
        const leftPreferred = /\/(?:\.codex-plugin|\.claude-plugin)\/plugin\.json$/.test(left)
        const rightPreferred = /\/(?:\.codex-plugin|\.claude-plugin)\/plugin\.json$/.test(right)
        return Number(rightPreferred) - Number(leftPreferred)
      })
      for (const manifestPath of manifests) {
        const manifest = await readJson(manifestPath)
        if (!manifest || !isPluginManifest(manifestPath, manifest)) continue
        const pluginDir = pluginDirectory(manifestPath)
        const directoryKey = `${agent.name}\0${pluginDir}`
        if (seenDirectories.has(directoryKey)) continue
        const name = manifest.interface?.displayName || manifest.displayName || manifest.name || path.basename(pluginDir)
        const version = String(manifest.version || path.basename(pluginDir).match(/^\d+\.\d+/)?.[0] || '')
        const key = `${agent.name}\0${name}\0${version}`
        if (seen.has(key)) continue
        seen.add(key)
        seenDirectories.add(directoryKey)
        const capabilities = capabilityList(manifest, pluginDir)
        items.push({
          name,
          agent: agent.name,
          description: manifest.interface?.shortDescription || manifest.description || '',
          source: pluginSource(pluginDir, root),
          path: displayPath(pluginDir),
          manifest: displayPath(manifestPath),
          version,
          capabilities,
          icon: await pluginIcon(pluginDir, manifest),
        })
      }
    }
  }
  items.sort((a, b) => a.agent.localeCompare(b.agent) || a.name.localeCompare(b.name))
  return {
    items,
    scan: {
      visited: scans.reduce((total, scan) => total + scan.visited, 0),
      truncated: scans.some((scan) => scan.truncated),
      roots: scans,
    },
  }
}

export async function detectCapabilities(kind, agents = null) {
  agents ||= await loadAgents()
  const items = []
  const byCapability = new Map()
  let visited = 0
  let truncated = false
  const diagnostics = []
  for (const agent of agents) {
    const specifications = kind === 'mcp' && agent.resourceRules
      ? agent.resourceRules.mcp?.files || []
      : [...CONFIG_NAMES].filter((name) => kind === 'mcp' ? name.includes('mcp') || name === 'settings.json' : name === 'hooks.json' || name === 'settings.json')
        .map((name) => ({ base: 'config', path: name, key: kind === 'mcp' ? 'mcpServers' : 'hooks', recursive: true }))
    const seenFiles = new Set()
    const recursiveNames = new Map()
    const baseFor = (specification) => specification.base === 'home' ? agent.configurationHome || os.homedir() : agent.absoluteRoot
    for (const specification of specifications.filter((entry) => entry.recursive)) {
      const base = baseFor(specification)
      if (!base) continue
      if (!recursiveNames.has(base)) recursiveNames.set(base, new Set())
      recursiveNames.get(base).add(specification.path)
    }
    const recursiveFiles = new Map()
    for (const [base, names] of recursiveNames) {
      const scan = await walkBounded(base, { maxDepth: 4, maxEntries: 2500, shouldCollect: (_file, entry) => entry.isFile() && names.has(entry.name) })
      visited += scan.visited
      truncated ||= scan.truncated
      recursiveFiles.set(base, scan.matches)
    }
    for (const specification of specifications) {
      const base = baseFor(specification)
      if (!base) continue
      let files = [path.resolve(base, specification.path)]
      if (specification.recursive) {
        files = recursiveFiles.get(base).filter((file) => path.basename(file) === specification.path)
      }
      for (const file of files) {
        const identity = `${file}\0${specification.key}`
        if (seenFiles.has(identity)) continue
        seenFiles.add(identity)
        const format = specification.format || (file.endsWith('.toml') ? 'toml' : file.endsWith('.jsonc') ? 'jsonc' : 'json')
        const result = await readConfiguration(file, format)
        if (result.missing) continue
        if (result.error) { diagnostics.push({ agent: agent.name, path: displayPath(file), code: result.error, format }); continue }
        visited += 1
        const basename = path.basename(file)
        for (const { name, enabled } of configurationEntries(result.data, specification.key)) {
          const key = `${agent.name}\0${name}`
          const pathValue = displayPath(file)
          const existing = byCapability.get(key)
          if (existing) {
            if (!existing.paths.includes(pathValue)) existing.paths.push(pathValue)
            if (!existing.sources.includes(basename)) existing.sources.push(basename)
            continue
          }
          const item = {
            name,
            agent: agent.name,
            path: pathValue,
            source: basename,
            paths: [pathValue],
            sources: [basename],
            ...(enabled === undefined ? {} : { enabled }),
          }
          byCapability.set(key, item)
          items.push(item)
        }
      }
    }
  }
  items.sort((a, b) => a.agent.localeCompare(b.agent) || a.name.localeCompare(b.name))
  return { items, scan: { visited, truncated, diagnostics } }
}

function agentSkillRoots(agent) {
  return agent.absoluteSkillRoots || (agent.absoluteDir ? [{ id: 'target', path: agent.absoluteDir, target: true }] : [])
}

async function findAgentSkills(agent, followLinks = false) {
  const packages = []
  const seen = new Map()
  const scan = { visited: 0, truncated: false }
  for (const root of agentSkillRoots(agent)) {
    const result = await findSkillPackages(root.path, followLinks)
    scan.visited += result.scan.visited
    scan.truncated ||= result.scan.truncated
    for (const item of result.packages) {
      const real = await fs.promises.realpath(item.dir).catch(() => item.dir)
      const existing = seen.get(real)
      if (existing) { existing.aliases.push({ root, dir: item.dir }); continue }
      const discovered = { ...item, root, aliases: [] }
      seen.set(real, discovered)
      packages.push(discovered)
    }
  }
  return { packages, scan }
}

async function migrationIgnoreRules() {
  let text = ''
  try { text = await fs.promises.readFile(IGNORE_FILE, 'utf8') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const legacy = new Set()
  const paths = new Map()
  const lines = text.split(/\r?\n/)
  const records = lines.map((line, index) => {
    const clean = line.trim()
    if (!clean || clean.startsWith('#')) return null
    if (!clean.startsWith('{')) { legacy.add(clean); return null }
    let rule
    try { rule = JSON.parse(clean) } catch { throw new Error(`Invalid ignore rule at migrate.ignore:${index + 1}`) }
    if (typeof rule.agent !== 'string' || typeof rule.relative !== 'string' || typeof rule.ignored !== 'boolean') {
      throw new Error(`Invalid ignore rule at migrate.ignore:${index + 1}`)
    }
    const key = JSON.stringify([rule.agent, rule.relative])
    paths.set(key, rule.ignored)
    return key
  })
  return { text, lines, records, legacy, paths }
}

function migrationIsIgnored(item, rules) {
  const key = JSON.stringify([item.agent, item.relative])
  if (rules.paths.has(key)) return rules.paths.get(key)
  for (const alias of item.ignoreAliases || []) {
    const aliasKey = JSON.stringify([item.agent, alias])
    if (rules.paths.has(aliasKey)) return rules.paths.get(aliasKey)
  }
  return rules.legacy.has(`${item.agent}:${item.name}`)
}

export async function detectMigrations(agents = null) {
  agents ||= await loadAgents()
  const rules = await migrationIgnoreRules()
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
      if (migrationIsIgnored(candidate, rules)) ignoredItems.push({ ...candidate, ignored: true })
      else items.push(candidate)
    }
  }
  return { items, ignoredItems, scan: { visited, truncated } }
}

let ignoreUpdates = Promise.resolve()
export function setSkillIgnored(agentName, value, ignored) {
  const operation = ignoreUpdates.then(async () => {
    if (typeof ignored !== 'boolean') throw new Error('Ignored must be true or false.')
    const agents = await loadAgents()
    if (!agents.some((agent) => agent.name === agentName)) throw new Error(`Unknown agent: ${agentName}`)
    const discovered = await detectMigrations(agents)
    const candidate = [...discovered.items, ...discovered.ignoredItems].find((item) => item.agent === agentName && item.path === value)
    if (!candidate) throw new Error('This local skill is no longer available. Scan again.')
    const rules = await migrationIgnoreRules()
    const key = JSON.stringify([candidate.agent, candidate.relative])
    const before = migrationIsIgnored(candidate, rules)
    if (before === ignored) return { ok: true, changed: false, ignored }
    const lines = rules.lines.filter((_line, index) => rules.records[index] !== key)
    // A false path rule restores this item without unprotecting same-name siblings.
    const inheritedPathRule = (candidate.ignoreAliases || []).some((alias) => rules.paths.get(JSON.stringify([candidate.agent, alias])) === true)
    if (ignored || inheritedPathRule || rules.legacy.has(`${candidate.agent}:${candidate.name}`)) {
      lines.push(JSON.stringify({ agent: candidate.agent, relative: candidate.relative, ignored }))
    }
    const next = lines.filter((line, index) => line.trim() || index < lines.length - 1).join('\n').replace(/\n+$/, '') + '\n'
    const temporary = `${IGNORE_FILE}.${randomUUID()}.tmp`
    const mode = await fs.promises.stat(IGNORE_FILE).then((stat) => stat.mode & 0o777).catch((error) => { if (error.code === 'ENOENT') return 0o600; throw error })
    try {
      await fs.promises.writeFile(temporary, next, { flag: 'wx', mode })
      await fs.promises.rename(temporary, IGNORE_FILE)
    } finally { await fs.promises.unlink(temporary).catch(() => {}) }
    return { ok: true, changed: true, ignored }
  })
  ignoreUpdates = operation.catch(() => {})
  return operation
}

export function publicAgent(agent) {
  const { absoluteDir: _absoluteDir, absoluteRoot: _absoluteRoot, absoluteSkillRoots: roots, resourceRules: _resourceRules, configurationHome: _configurationHome, ...safe } = agent
  safe.skillDirectories = roots?.map((root) => ({ ...root, path: displayPath(root.path) }))
  return safe
}

export async function countAgentSkills(agents) {
  return Promise.all(agents.map(async (agent) => {
    if (agent.support?.skills === false) return { ...agent, totalSkills: null, skillsTruncated: false }
    if (!agent.detected && !agent.configured) return { ...agent, totalSkills: 0, skillsTruncated: false }
    const result = await findAgentSkills(agent, true)
    return { ...agent, totalSkills: result.packages.length, skillsTruncated: result.scan.truncated }
  }))
}

export async function workspaceData() {
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

export async function setSkillLink(agentName, skillRelative, linked) {
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

let importInProgress = false
export async function importLocalSkills(requested) {
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
