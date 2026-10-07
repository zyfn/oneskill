import fs from 'node:fs/promises'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'

const inside = (root, value) => value.startsWith(`${root}${path.sep}`)
const stat = async (value) => fs.lstat(value).catch((error) => { if (error.code === 'ENOENT') return null; throw error })

// Symlinks inside packages are intentionally not copied across trust boundaries.
async function fingerprint(root) {
  const hash = createHash('sha256')
  async function visit(directory, relative = '') {
    const entries = (await fs.readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const file = path.join(directory, entry.name)
      const key = path.join(relative, entry.name)
      const info = await fs.lstat(file)
      if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw new Error('This skill contains a link or special file and needs manual import.')
      hash.update(JSON.stringify([key, info.isDirectory() ? 'dir' : 'file', info.mode & 0o777]))
      if (info.isDirectory()) await visit(file, key)
      else { hash.update(String(info.size)); hash.update(await fs.readFile(file)) }
    }
  }
  await visit(root)
  return hash.digest('hex')
}

async function safeParents(root, relative) {
  let current = root
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    if (await stat(path.join(current, 'SKILL.md'))) throw new Error('A parent destination is already a skill package. Nothing was changed.')
    current = path.join(current, segment)
    try { await fs.mkdir(current) } catch (error) { if (error.code !== 'EEXIST') throw error }
    const info = await fs.lstat(current)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('An import destination contains a symbolic link or file.')
  }
  if (await stat(path.join(current, 'SKILL.md'))) throw new Error('A parent destination is already a skill package. Nothing was changed.')
  return current
}

// The caller supplies only a freshly scanned candidate. Originals are retained in
// a separate backup directory; no existing shared package is ever overwritten.
export async function adoptLocalSkill({ source, agentDir, sharedRoot, backupRoot }) {
  const agentReal = await fs.realpath(agentDir)
  const sourceReal = await fs.realpath(source)
  const relative = path.relative(agentDir, source)
  if (!inside(path.resolve(agentDir), path.resolve(source)) || !inside(agentReal, sourceReal)) throw new Error('Skill is outside this Agent directory.')
  if ((await fs.lstat(source)).isSymbolicLink()) throw new Error('This skill is already a link. Scan again.')
  if (!(await stat(path.join(source, 'SKILL.md')))?.isFile()) throw new Error('SKILL.md is missing. Scan again.')
  await fs.mkdir(sharedRoot, { recursive: true })
  const sharedReal = await fs.realpath(sharedRoot)
  if (sourceReal === sharedReal || inside(sharedReal, sourceReal) || inside(sourceReal, sharedReal)) throw new Error('Source and shared library must be separate.')
  const target = path.join(sharedReal, relative)
  const sourceHash = await fingerprint(source)
  const parent = await safeParents(sharedReal, path.dirname(relative) === '.' ? '' : path.dirname(relative))
  const existing = await stat(target)
  if (existing && (!existing.isDirectory() || existing.isSymbolicLink() || await fingerprint(target) !== sourceHash)) {
    throw new Error(`Different content already exists at ${relative}. Nothing was changed.`)
  }

  await fs.mkdir(backupRoot, { recursive: true })
  if ((await fs.lstat(backupRoot)).isSymbolicLink()) throw new Error('Backup directory must not be a symbolic link.')
  const backup = await fs.mkdtemp(path.join(backupRoot, 'import-'))
  const original = path.join(backup, 'original')
  const stage = path.join(parent, `.oneskill-import-${randomUUID()}`)
  let created = false
  let moved = false
  let linked = false
  try {
    if (!existing) {
      await fs.cp(source, stage, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true })
      if (await fingerprint(stage) !== sourceHash) throw new Error('Skill changed while copying. Scan again and retry.')
      if (await stat(target)) throw new Error('Shared destination changed during import. Scan again.')
      await fs.rename(stage, target)
      created = true
    }
    if (await fingerprint(source) !== sourceHash) throw new Error('Skill changed while importing. Scan again and retry.')
    await fs.writeFile(path.join(backup, 'restore.json'), JSON.stringify({ source, target, original, importedAt: new Date().toISOString() }, null, 2), { flag: 'wx' })
    await fs.rename(source, original)
    moved = true
    await fs.symlink(target, source, 'dir')
    linked = true
    return { relative, target, backup, reused: Boolean(existing) }
  } catch (error) {
    if (moved && !linked) {
      if (await stat(source)) throw new Error(`${error.message} Original is safe at ${original}; restore it after clearing the occupied source path.`)
      await fs.rename(original, source)
    }
    // A complete shared copy is left available after a later failure. It is safe
    // to retry, and deleting it could disrupt another concurrently linked Agent.
    if (!moved) await fs.rm(backup, { recursive: true, force: true })
    if (created) error.message += ` Shared copy is available at ${target}.`
    throw error
  } finally {
    await fs.rm(stage, { recursive: true, force: true })
  }
}
