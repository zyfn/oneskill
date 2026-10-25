import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'

export const digest = value => createHash('sha256').update(value).digest('hex')
export const defaultWorkspaceRoot = () => path.join(os.homedir(), '.oneskill')
export const defaultRuntimeRoot = () => path.join(os.tmpdir(), `oneskill-${digest(os.homedir()).slice(0,16)}`)
export async function workspaceLocation(root = defaultWorkspaceRoot(), runtimeRoot = defaultRuntimeRoot()) {
  await fs.mkdir(runtimeRoot, { recursive: true, mode: 0o700 })
  const runtimeStat = await fs.lstat(runtimeRoot)
  if (!runtimeStat.isDirectory() || (process.getuid && runtimeStat.uid !== process.getuid())) throw new Error('The runtime directory must be owned by the current user.')
  if (process.platform !== 'win32') await fs.chmod(runtimeRoot, 0o700)
  await fs.mkdir(path.resolve(root), { recursive: true, mode: 0o700 })
  const canonical = await fs.realpath(path.resolve(root))
  const workspaceId = digest(canonical)
  return { root: canonical, workspaceId, runtimeRoot, directory: path.join(runtimeRoot, workspaceId) }
}
export async function atomicJson(file, value) {
  const temporary = `${file}.${process.pid}.${Math.random().toString(16).slice(2)}.tmp`
  try {
    await fs.writeFile(temporary, JSON.stringify(value), { mode: 0o600, flag: 'wx' })
    await fs.rename(temporary, file)
  } finally { await fs.rm(temporary, { force: true }) }
}
export async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
export function processAlive(pid) {
  if (!Number.isInteger(pid) || pid < 1) return false
  try { process.kill(pid, 0); return true } catch (error) { return error.code === 'EPERM' }
}
