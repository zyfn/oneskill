import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
for (const directory of ['src', 'scripts', 'test']) {
  for (const file of await fs.readdir(path.join(root, directory))) {
    if (!file.endsWith('.mjs')) continue
    const result = spawnSync(process.execPath, ['--check', path.join(root, directory, file)], { stdio: 'inherit' })
    if (result.error) throw result.error
    if (result.status !== 0) process.exit(result.status || 1)
  }
}
