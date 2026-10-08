import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

const PRUNED_DIRS = new Set([
  '.git', 'node_modules', 'dist', 'build', 'coverage', '__pycache__',
  'logs', 'log', 'tmp', 'temp', 'sessions', 'archived_sessions',
  'projects', 'worktrees', 'workspace', 'history', 'shell_snapshots',
  'generated_images', 'visualizations', 'sqlite', 'telemetry',
])

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

export function exists(value) {
  try {
    fs.accessSync(value)
    return true
  } catch {
    return false
  }
}

export async function readJson(file, fallback = null) {
  try {
    return JSON.parse(await fs.promises.readFile(file, 'utf8'))
  } catch {
    return fallback
  }
}

export async function readText(file, fallback = '') {
  try {
    return await fs.promises.readFile(file, 'utf8')
  } catch {
    return fallback
  }
}

export async function walkBounded(root, options = {}) {
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
