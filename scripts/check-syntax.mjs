import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pending = ['src', 'scripts', 'test'].map(directory => path.join(root, directory))
while (pending.length) {
  const directory = pending.pop()
  for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name)
    if (entry.isDirectory()) { pending.push(file); continue }
    if (!entry.name.endsWith('.mjs')) continue
    const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) process.exit(result.status || 1)
  }
}
