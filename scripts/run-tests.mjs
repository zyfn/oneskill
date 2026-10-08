import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const files = (await fs.readdir(path.join(root, 'test')))
  .filter(file => file.endsWith('.test.mjs')).sort()
  .map(file => path.join(root, 'test', file))
// Explicit paths avoid shell wildcard differences on Windows and Node 20.
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=4', ...files], { stdio: 'inherit' })
if (result.error) throw result.error
process.exit(result.status ?? 1)
