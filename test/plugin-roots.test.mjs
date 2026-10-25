import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createWorkspace } from '../src/core.mjs'

test('malformed native plugin manifests report incomplete inventories instead of empty success', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill-invalid-plugin-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const config = path.join(root, 'agent')
  await fs.mkdir(path.join(config, 'plugins', 'broken'), { recursive: true })
  await fs.writeFile(path.join(config, 'plugins', 'broken', 'plugin.json'), '{ invalid')
  await fs.writeFile(path.join(root, 'agents.catalog.json'), JSON.stringify([{ name: 'fixture', probeInstallation: false, commands: ['fixture'], configDir: { macos: config, windows: config, linux: config }, pluginDirs: ['plugins'] }]))
  const data = await createWorkspace({ root }).workspaceData()
  assert.equal(data.plugins.length, 0)
  assert.equal(data.scan.plugins.complete, false)
  assert.ok(data.scan.plugins.diagnostics.some(item => item.path.endsWith('plugin.json')))
  assert.equal(data.scan.mcp.complete, false)
})

test('native plugin scans follow Agent path overrides and deduplicate overlapping roots', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill-plugin-roots-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const defaultCodex = path.join(root, 'default-codex')
  const customCodex = path.join(root, 'custom-codex')
  const claude = path.join(root, 'claude')
  await fs.writeFile(path.join(root, 'agents.catalog.json'), JSON.stringify([
    { name: 'codex', commands: ['codex-fixture'], probeInstallation: false, configDir: { macos: defaultCodex, windows: defaultCodex, linux: defaultCodex }, skillDir: 'skills', pluginDirs: ['plugins/cache'] },
    { name: 'claude', commands: ['claude-fixture'], probeInstallation: false, configDir: { macos: claude, windows: claude, linux: claude }, skillDir: 'skills', pluginDirs: ['plugins/cache', 'plugins'] },
  ]))
  await fs.writeFile(path.join(root, 'agents.local.json'), JSON.stringify([{ name: 'codex', configDir: { macos: customCodex, windows: customCodex, linux: customCodex } }]))
  async function plugin(base, relative, agent, name) {
    const directory = path.join(base, relative, `.${agent}-plugin`)
    await fs.mkdir(directory, { recursive: true })
    await fs.writeFile(path.join(directory, 'plugin.json'), JSON.stringify({ name, description: 'Test plugin', version: '1.0.0' }))
  }
  await plugin(defaultCodex, 'plugins/cache/stale', 'codex', 'stale')
  await plugin(customCodex, 'plugins/cache/custom', 'codex', 'custom')
  await plugin(claude, 'plugins/cache/cached', 'claude', 'cached')
  await plugin(claude, 'plugins/local', 'claude', 'local')
  const core = createWorkspace({ root: root })
  const { items, scan } = await core.detectPlugins()
  assert.deepEqual(items.map((item) => `${item.agent}:${item.name}`).sort(), ['claude:cached', 'claude:local', 'codex:custom'])
  assert.equal(scan.truncated, false)
  assert.ok(items.every((item) => item.path.startsWith(root)))
})

test('Qoder plugin packages stop at their manifests and one shared root serves desktop and CLI', async t => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill-qoder-plugins-'))
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }))
  const configRoot = path.join(workspaceRoot, 'qoder')
  const pluginRoot = path.join(configRoot, 'plugins/cache/store/review/1.0.0')
  await fs.mkdir(path.join(pluginRoot, '.qoder-plugin'), { recursive: true })
  await fs.mkdir(path.join(pluginRoot, 'skills/examples/templates/react/app/src/deep'), { recursive: true })
  await fs.writeFile(path.join(pluginRoot, '.qoder-plugin/plugin.json'), JSON.stringify({ name: 'review', version: '1.0.0', mcpServers: 'mcp.json' }))
  await fs.writeFile(path.join(pluginRoot, 'mcp.json'), JSON.stringify({ mcpServers: { docs: {} } }))
  await fs.writeFile(path.join(workspaceRoot, 'agents.catalog.json'), JSON.stringify(['qoder', 'qoder-cli'].map(name => ({ name, commands: [name], probeInstallation: false, configDir: { macos: configRoot, windows: configRoot, linux: configRoot }, pluginDirs: ['plugins'], mcp: [{ file: 'settings.json', key: 'mcpServers' }] }))))

  const data = await createWorkspace({ root: workspaceRoot }).workspaceData()
  assert.equal(data.plugins.length, 1)
  assert.equal(data.plugins[0].path, pluginRoot)
  assert.deepEqual(data.plugins[0].agents, ['qoder', 'qoder-cli'])
  assert.equal(data.scan.plugins.complete, true)
  assert.equal(data.mcp.length, 1)
  assert.equal(data.mcp[0].name, 'docs')
  assert.deepEqual(data.mcp[0].agents, ['qoder', 'qoder-cli'])
  assert.equal(data.scan.mcp.complete, true)
})

test('a bundled QwenWork plugin and its MCP file are found without counting the file twice', async t => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill-qwenwork-plugin-'))
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }))
  const configRoot = path.join(workspaceRoot, 'qwenwork')
  const pluginRoot = path.join(configRoot, 'bin/computer-use')
  await fs.mkdir(path.join(pluginRoot, '.qoder-plugin'), { recursive: true })
  await fs.mkdir(path.join(configRoot, 'plugins/cache'), { recursive: true })
  await fs.writeFile(path.join(pluginRoot, '.qoder-plugin/plugin.json'), JSON.stringify({ name: 'computer-use', version: '0.1.28' }))
  await fs.writeFile(path.join(pluginRoot, 'mcp.json'), JSON.stringify({ mcpServers: { 'computer-use': {} } }))
  await fs.writeFile(path.join(workspaceRoot, 'agents.catalog.json'), JSON.stringify([{ name: 'qwenwork', commands: ['qwenwork'], probeInstallation: false, configDir: { macos: configRoot, windows: configRoot, linux: configRoot }, pluginDirs: ['plugins', 'bin/computer-use'], mcp: [{ file: 'bin/computer-use/mcp.json', key: 'mcpServers' }] }]))

  const data = await createWorkspace({ root: workspaceRoot }).workspaceData()
  assert.equal(data.plugins.length, 1)
  assert.equal(data.plugins[0].path, pluginRoot)
  assert.equal(data.mcp.length, 1)
  assert.equal(data.mcp[0].name, 'computer-use')
  assert.deepEqual(data.mcp[0].paths, [path.join(pluginRoot, 'mcp.json')])
  assert.equal(data.scan.plugins.complete, true)
  assert.equal(data.scan.mcp.complete, true)
})
