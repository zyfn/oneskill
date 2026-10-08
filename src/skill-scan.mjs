import fs from 'node:fs'
import path from 'node:path'
import { readText, walkBounded } from './filesystem.mjs'

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

export async function findSkillPackages(root, followLinks = false) {
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

export async function bindingState(sourceDir, destination) {
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

export function agentSkillRoots(agent) {
  return agent.absoluteSkillRoots || (agent.absoluteDir ? [{ id: 'target', path: agent.absoluteDir, target: true }] : [])
}

export async function findAgentSkills(agent, followLinks = false) {
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
