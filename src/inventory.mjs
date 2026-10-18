import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { displayPath, expandHome, exists, readJson, walkBounded } from './filesystem.mjs'
import { configurationEntries, readConfiguration } from './configuration.mjs'

const CONFIG_NAMES = new Set(['.mcp.json', 'mcp.json', 'hooks.json', 'settings.json'])
const MANIFEST_NAMES = new Set(['plugin.json', 'package.json'])
const MANIFEST_DIRS = new Set(['.codex-plugin', '.claude-plugin'])

function pluginManifestCandidate(file, entry) {
  if (entry.isDirectory()) return MANIFEST_DIRS.has(entry.name) && exists(path.join(file, 'plugin.json'))
  if (!entry.isFile() || !MANIFEST_NAMES.has(entry.name)) return false
  if (entry.name === 'plugin.json') return true
  try {
    if (fs.statSync(file).size > 1048576) return false
    return isPluginManifest(file, JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')))
  } catch { return false }
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
  if (manifest.mcpServers || manifest.mcp_servers || exists(path.join(pluginDir, '.mcp.json')) || exists(path.join(pluginDir, 'mcp.json'))) add('MCP')
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

export async function detectPlugins(agents) {
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
        shouldCollect: pluginManifestCandidate,
        stopAtMatch: true,
      })
      scans.push({ agent: agent.name, root: displayPath(root), visited: scan.visited, truncated: scan.truncated })
      const manifests = scan.matches.map(file => MANIFEST_DIRS.has(path.basename(file)) ? path.join(file, 'plugin.json') : file).sort((left, right) => {
        const leftPreferred = /\/(?:\.codex-plugin|\.claude-plugin)\/plugin\.json$/.test(left.split(path.sep).join('/'))
        const rightPreferred = /\/(?:\.codex-plugin|\.claude-plugin)\/plugin\.json$/.test(right.split(path.sep).join('/'))
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
        const source = pluginSource(pluginDir, root)
        const key = `${agent.name}\0${source}\0${name}\0${version}`
        if (seen.has(key)) continue
        seen.add(key)
        seenDirectories.add(directoryKey)
        const capabilities = capabilityList(manifest, pluginDir)
        items.push({
          name,
          agent: agent.name,
          description: manifest.interface?.shortDescription || manifest.description || '',
          source,
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

async function pluginMcpSpecifications(plugin, diagnostics) {
  const root = path.resolve(expandHome(plugin.path))
  const portable = await readJson(path.join(root, 'plugin.json'))
  const manifest = await readJson(expandHome(plugin.manifest))
  const isPortable = typeof portable?.$schema === 'string' && portable.$schema.startsWith('https://agent-plugins.org/')
  const declaration = manifest?.mcpServers
  const metadata = { plugin: portable?.name || manifest?.name || plugin.name, pluginId: JSON.stringify([plugin.source, portable?.name || manifest?.name || plugin.name]), pluginRoot: root }
  if (!isPortable && declaration && typeof declaration === 'object' && !Array.isArray(declaration)) {
    return [{ ...metadata, path: expandHome(plugin.manifest), key: 'mcpServers', format: 'json' }]
  }
  const locations = isPortable ? ['mcp.json'] : typeof declaration === 'string' ? [declaration] : Array.isArray(declaration) ? declaration.filter(value => typeof value === 'string') : ['.mcp.json', 'mcp.json']
  return locations.flatMap(location => {
    const file = path.resolve(root, location)
    if (!file.startsWith(`${root}${path.sep}`)) {
      diagnostics.push({ agent: plugin.agent, path: plugin.path, code: 'INVALID_PLUGIN_CONFIG_PATH', format: 'json' })
      return []
    }
    return [{ ...metadata, path: file, key: 'mcpServers', format: 'json' }]
  })
}

export async function detectCapabilities(kind, agents, { plugins = [] } = {}) {
  const items = []
  const byCapability = new Map()
  let visited = 0
  let truncated = false
  const diagnostics = []
  for (const agent of agents) {
    const agentSpecifications = kind === 'mcp' && agent.resourceRules
      ? agent.resourceRules.mcp?.files || []
      : [...CONFIG_NAMES].filter((name) => kind === 'mcp' ? name.includes('mcp') || name === 'settings.json' : name === 'hooks.json' || name === 'settings.json')
        .map((name) => ({ base: 'config', path: name, key: kind === 'mcp' ? 'mcpServers' : 'hooks', recursive: true }))
    const pluginSpecifications = kind === 'mcp' ? (await Promise.all(plugins.filter(plugin => plugin.agent === agent.name).map(plugin => pluginMcpSpecifications(plugin, diagnostics)))).flat() : []
    const specifications = [...pluginSpecifications, ...agentSpecifications]
    const seenFiles = new Set()
    const recursiveNames = new Map()
    const baseFor = (specification) => specification.pluginRoot || (specification.base === 'home' ? agent.configurationHome || os.homedir() : agent.absoluteRoot)
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
          const key = JSON.stringify([agent.name, specification.pluginId || null, name])
          const pathValue = displayPath(file)
          const existing = byCapability.get(key)
          if (existing) {
            if (!existing.paths.includes(pathValue)) existing.paths.push(pathValue)
            if (!existing.sources.includes(basename)) existing.sources.push(basename)
            if (existing.enabled !== enabled) delete existing.enabled
            continue
          }
          const item = {
            name,
            agent: agent.name,
            path: pathValue,
            source: basename,
            paths: [pathValue],
            sources: [basename],
            ...(specification.plugin ? { plugin: specification.plugin, pluginId: specification.pluginId } : {}),
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
