import fs from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { canonicalPath, displayPath, walkBounded } from './filesystem.mjs'
import { agentSkillRoots } from './skill-scan.mjs'
import { digest } from './runtime/paths.mjs'
import { WorkspaceError } from './contracts/operations.mjs'

const within = (root, value) => value.startsWith(`${root}${path.sep}`)

// A configured root may itself be an alias. Nested aliases must not redirect a
// write into another collection or Agent directory.
export async function skillDestination(root, relative, { create = false } = {}) {
  const destination = path.resolve(root, relative)
  if (!within(path.resolve(root), destination)) throw new WorkspaceError('INVALID_PATH', 'Invalid Skill destination.')
  const parents = path.relative(root, path.dirname(destination)).split(path.sep).filter(Boolean)
  let current = root
  if (create) await fs.mkdir(root, { recursive: true })
  for (const part of parents) {
    current = path.join(current, part)
    let info = await fs.lstat(current).catch(error => { if (error.code === 'ENOENT') return null; throw error })
    if (!info && create) { await fs.mkdir(current); info = await fs.lstat(current) }
    if (info && (!info.isDirectory() || info.isSymbolicLink())) throw new WorkspaceError('UNSAFE_TARGET', 'A parent folder redirects this link. Open the Agent folder and resolve it first.', 409)
  }
  return destination
}

export async function managedSource(root, relative) {
  const source = path.resolve(root, relative)
  const [base, real] = await Promise.all([fs.realpath(root), fs.realpath(source)]).catch(() => { throw new WorkspaceError('SOURCE_CHANGED', 'The Skill has moved or is no longer readable. Rescan.', 409) })
  const manifest = await fs.stat(path.join(real, 'SKILL.md')).catch(() => null)
  if (!within(base, real) || !manifest?.isFile()) throw new WorkspaceError('SOURCE_CHANGED', 'The Skill is outside this library or its manifest is missing.', 409)
  return real
}

export async function inspectSkillLinks(sourceRoot, agents) {
  const roots = [...new Set([path.resolve(sourceRoot), await fs.realpath(sourceRoot).catch(() => path.resolve(sourceRoot))])]
  const found = new Map(), diagnostics = [], links = []
  let truncated = false
  for (const agent of agents) for (const root of agentSkillRoots(agent)) {
    const scan = await walkBounded(root.path, { maxDepth: 8, maxEntries: 6000, shouldCollect: (_file, entry) => entry.isSymbolicLink() })
    diagnostics.push(...scan.diagnostics.map(item => ({ ...item, agent: agent.name }))); truncated ||= scan.truncated
    for (const destination of scan.matches) {
      let target
      try {
        target = path.resolve(path.dirname(destination), await fs.readlink(destination))
        const canonicalTarget = await canonicalPath(target)
        if (!roots.some(base => within(base, canonicalTarget))) continue
        const source = await fs.realpath(destination)
        links.push({ agent: agent.name, destination, source, scope: root.scope })
        continue
      } catch (error) { if (error.code !== 'ENOENT') continue }
      if (!target) continue
      const canonical = path.join(await fs.realpath(path.dirname(destination)), path.basename(destination))
      const existing = found.get(canonical)
      if (existing) { if (!existing.agents.includes(agent.name)) existing.agents.push(agent.name); continue }
      found.set(canonical, { id: `link:${digest(canonical)}`, agents: [agent.name], path: displayPath(destination), source: displayPath(target), state: 'broken', root: root.path, destination, target })
    }
  }
  return { items: [...found.values()], links, scan: { diagnostics, truncated } }
}

export async function resolveSkillLink({ sourceRoot, agents, issueId, skillRelative }) {
  const { items } = await inspectSkillLinks(sourceRoot, agents)
  const issue = items.find(item => item.id === issueId)
  if (!issue) throw new WorkspaceError('SOURCE_CHANGED', 'This broken link changed. Rescan before continuing.', 409)
  const destination = await skillDestination(issue.root, path.relative(issue.root, issue.destination))
  const source = skillRelative === undefined ? null : await managedSource(sourceRoot, skillRelative)
  // Re-check immediately before the replacement. Only broken library links are
  // eligible; real folders and links owned by another tool are never replaced.
  const previous = await fs.readlink(destination)
  if (path.resolve(path.dirname(destination), previous) !== issue.target || await fs.realpath(destination).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error })) throw new WorkspaceError('SOURCE_CHANGED', 'This link changed. Rescan before continuing.', 409)
  if (!source) { await fs.unlink(destination); return { changed: true, state: 'removed' } }
  const temporary = path.join(path.dirname(destination), `.oneskill-link-${randomUUID()}`)
  try {
    // Check link-creation permissions before changing the old reference.
    await fs.symlink(source, temporary, 'dir')
    if (process.platform === 'win32') {
      // Windows cannot rename over an existing directory link. Creating the
      // replacement directly also refuses a path occupied after the unlink.
      await fs.unlink(destination)
      try { await fs.symlink(source, destination, 'dir') }
      catch (error) {
        try { await fs.symlink(previous, destination, 'dir') }
        catch (restoreError) { error.message += ` Previous link to ${displayPath(issue.target)} could not be restored: ${restoreError.message}` }
        throw error
      }
    } else await fs.rename(temporary, destination)
  }
  finally { await fs.rm(temporary, { force: true }) }
  return { changed: true, state: 'linked' }
}
