import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { copyWorkspaceRuntime } from '../scripts/workspace-runtime.mjs'

test('native plugin scans follow Agent path overrides and deduplicate overlapping roots', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill-plugin-roots-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.mkdir(path.join(root, 'src'))
  await copyWorkspaceRuntime(root)
  const defaultCodex = path.join(root, 'default-codex')
  const customCodex = path.join(root, 'custom-codex')
  const claude = path.join(root, 'claude')
  await fs.writeFile(path.join(root, 'agents.catalog.json'), JSON.stringify([
    { name: 'codex', dir: path.join(defaultCodex, 'skills') },
    { name: 'claude', dir: path.join(claude, 'skills') },
  ]))
  await fs.writeFile(path.join(root, 'agents.registry'), `codex|${path.join(customCodex, 'skills')}\n`)
  async function plugin(base, relative, agent, name) {
    const directory = path.join(base, relative, `.${agent}-plugin`)
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, 'plugin.json'), JSON.stringify({ name, description: 'Test plugin', version: '1.0.0' }))
  }
  await plugin(defaultCodex, 'plugins/cache/stale', 'codex', 'stale')
  await plugin(customCodex, 'plugins/cache/custom', 'codex', 'custom')
  await plugin(claude, 'plugins/cache/cached', 'claude', 'cached')
  await plugin(claude, 'plugins/local', 'claude', 'local')
  const core = await import(pathToFileURL(path.join(root, 'src/core.mjs')).href)
  const { items, scan } = await core.detectPlugins()
  assert.deepEqual(items.map((item) => `${item.agent}:${item.name}`).sort(), ['claude:cached', 'claude:local', 'codex:custom'])
  assert.equal(scan.truncated, false)
  assert.ok(items.every((item) => item.path.startsWith(root)))
})
