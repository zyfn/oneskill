import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// Demo and test workspaces run the same modules against their own data files.
export async function copyWorkspaceRuntime(root, { web = false } = {}) {
  await fs.mkdir(path.join(root, 'src'), { recursive: true })
  for (const file of await fs.readdir(path.join(repository, 'src'))) {
    if (file.endsWith('.mjs')) await fs.copyFile(path.join(repository, 'src', file), path.join(root, 'src', file))
  }
  const linkType = process.platform === 'win32' ? 'junction' : 'dir'
  await fs.symlink(path.join(repository, 'node_modules'), path.join(root, 'node_modules'), linkType)
  if (web) await fs.symlink(path.join(repository, 'web'), path.join(root, 'web'), linkType)
}
