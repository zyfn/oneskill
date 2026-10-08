import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { displayPath, exists, readJson, walkBounded } from './filesystem.mjs'
import { configurationEntries, readConfiguration } from './configuration.mjs'

const CONFIG_NAMES = new Set(['.mcp.json', 'mcp.json', 'hooks.json', 'settings.json'])
const MANIFEST_NAMES = new Set(['plugin.json', 'package.json'])

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

export async function detectCapabilities(kind, agents) {
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
