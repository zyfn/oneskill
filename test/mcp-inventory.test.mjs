import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createWorkspace } from '../src/core.mjs'

async function fixture(t, names = ['alpha']) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill-mcp-inventory-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const write = async (relative, data) => {
    const file = path.join(root, relative)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, typeof data === 'string' ? data : JSON.stringify(data))
    return file
  }
  await write('agents.catalog.json', names.map(name => ({ name, commands: [name], probeInstallation: false, configDir: { macos: path.join(root, name), windows: path.join(root, name), linux: path.join(root, name) }, pluginDirs: ['plugins'], mcp: [{ file: 'settings.json', key: 'mcpServers' }] })))
  return { root, write, core: createWorkspace({ root }) }
}

test('MCP inventory includes scoped plugin declarations and merges cached versions for every Agent', async t => {
  const f = await fixture(t, ['alpha', 'beta'])
  for (const agent of ['alpha', 'beta']) {
    await f.write(`${agent}/settings.json`, { mcpServers: { docs: { env: { SECRET: 'hidden-main-token' } } } })
    const portable = `${agent}/plugins/store/portable/1.0.0`
    await f.write(`${portable}/plugin.json`, { $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'portable', version: '1.0.0' })
    await f.write(`${portable}/.codex-plugin/plugin.json`, { name: 'overlay', version: '1.0.0', mcpServers: './shadow.json' })
    await f.write(`${portable}/shadow.json`, { mcpServers: { ignoredOverlay: {} } })
    await f.write(`${portable}/mcp.json`, { mcpServers: { docs: { type: 'stdio', command: 'hidden-command' } } })
    for (const version of ['1.0.0', '2.0.0']) {
      const legacy = `${agent}/plugins/store/legacy/${version}`
      await f.write(`${legacy}/.claude-plugin/plugin.json`, { name: 'legacy', version, mcpServers: './config/servers.json' })
      await f.write(`${legacy}/config/servers.json`, { mcpServers: { docs: { enabled: version === '2.0.0', url: 'https://example.com/private?token=hidden-plugin-token' } } })
    }
  }
  const data = await f.core.workspaceData()
  for (const agent of ['alpha', 'beta']) {
    const entries = data.mcp.filter(item => item.agent === agent)
    assert.equal(entries.length, 3)
    assert.equal(new Set(entries.map(item => item.id)).size, 3)
    assert.deepEqual(entries.map(item => item.name), ['docs', 'docs', 'docs'])
    assert.equal(entries.find(item => item.plugin === 'legacy').paths.length, 2)
    assert.equal(entries.find(item => item.plugin === 'legacy').enabled, undefined)
    assert.ok(entries.find(item => item.plugin === 'portable').path.endsWith('mcp.json'))
  }
  assert.equal(data.scan.mcp.complete, true)
  assert.equal(JSON.stringify(data.mcp).includes('hidden-'), false)
})

test('same-name plugins in different marketplaces keep independent MCP identities', async t => {
  const f = await fixture(t)
  for (const store of ['first', 'second']) {
    const base = `alpha/plugins/${store}/same/1.0.0`
    await f.write(`${base}/plugin.json`, { name: 'same', version: '1.0.0' })
    await f.write(`${base}/.mcp.json`, { mcpServers: { docs: {} } })
  }
  assert.equal((await f.core.detectPlugins()).items.length, 2)
  const items = (await f.core.workspaceData()).mcp
  assert.equal(items.length, 2)
  assert.notEqual(items[0].id, items[1].id)
})

test('inline and repeated file declarations use the same sanitized configuration model', async t => {
  const f = await fixture(t)
  await f.write('alpha/plugins/store/inline/1.0.0/.codex-plugin/plugin.json', { name: 'inline', version: '1.0.0', mcpServers: { docs: { enabled: false, env: { TOKEN: 'hidden-inline-token' } } } })
  await f.write('alpha/plugins/store/files/1.0.0/.codex-plugin/plugin.json', { name: 'files', version: '1.0.0', mcpServers: ['./.mcp.json', './config/../.mcp.json'] })
  await f.write('alpha/plugins/store/files/1.0.0/.mcp.json', { mcpServers: { docs: {} } })
  const items = (await f.core.workspaceData()).mcp
  assert.equal(items.length, 2)
  assert.equal(items.find(item => item.plugin === 'inline').enabled, false)
  assert.equal(items.find(item => item.plugin === 'files').paths.length, 1)
  assert.equal(JSON.stringify(items).includes('hidden-inline-token'), false)
})

test('plugin package boundaries exclude nested examples without skipping non-plugin container folders', async t => {
  const f = await fixture(t)
  await f.write('alpha/plugins/package.json', { name: 'container', version: '1.0.0' })
  const base = 'alpha/plugins/store/real/1.0.0'
  await f.write(`${base}/.codex-plugin/plugin.json`, { name: 'real', version: '1.0.0' })
  await f.write(`${base}/.mcp.json`, { mcpServers: { docs: {} } })
  await f.write(`${base}/skills/example/a/b/c/d/e/f/plugin.json`, { name: 'example-only', version: '1.0.0' })
  await f.write(`${base}/skills/example/a/b/c/d/e/f/mcp.json`, { mcpServers: { notInstalled: {} } })
  const data = await f.core.workspaceData()
  assert.equal(data.plugins.length, 1)
  assert.deepEqual(data.mcp.map(item => item.name), ['docs'])
  assert.equal(data.scan.plugins.truncated, false)
  assert.equal(data.scan.mcp.complete, true)
})

test('plugin MCP parse failures and escaping paths report incomplete scans without reading unrelated files', async t => {
  const f = await fixture(t)
  await f.write('alpha/plugins/store/broken/1.0.0/plugin.json', { name: 'broken', version: '1.0.0' })
  await f.write('alpha/plugins/store/broken/1.0.0/mcp.json', '{ invalid')
  await f.write('alpha/plugins/store/escape/1.0.0/.codex-plugin/plugin.json', { name: 'escape', version: '1.0.0', mcpServers: '../../../../outside.json' })
  await f.write('alpha/outside.json', { mcpServers: { doNotRead: {} } })
  const data = await f.core.workspaceData()
  assert.deepEqual(data.mcp, [])
  assert.equal(data.scan.mcp.complete, false)
  assert.deepEqual(data.scan.mcp.diagnostics.map(item => item.code).sort(), ['CONFIG_PARSE_FAILED', 'INVALID_PLUGIN_CONFIG_PATH'])
})
