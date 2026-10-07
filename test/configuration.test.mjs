import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import { copyWorkspaceRuntime } from '../scripts/workspace-runtime.mjs'
import { configurationEntries, parseConfiguration, readConfiguration } from '../src/configuration.mjs'
import { configuredAgentLocations, createDiscoveryContext } from '../src/agent-discovery.mjs'
import { resolveAgentPlatform } from '../src/agent-catalog.mjs'

async function fixture(t, definitions) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill-config-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.mkdir(path.join(root, 'src'))
  await copyWorkspaceRuntime(root)
  await fs.writeFile(path.join(root, 'agents.catalog.json'), JSON.stringify(definitions(root)))
  const core = await import(pathToFileURL(path.join(root, 'src/core.mjs')).href)
  async function write(relative, text) {
    const file = path.join(root, relative)
    await fs.mkdir(path.dirname(file), { recursive: true })
    await fs.writeFile(file, text)
    return file
  }
  return { root, core, write }
}

test('JSON, JSONC and TOML use the same configuration entry model without exposing transport secrets', () => {
  const samples = [
    ['json', 'mcpServers', '\uFEFF{"mcpServers":{"docs":{"env":{"TOKEN":"private"}},"internal.dev":{"enabled":false}}}'],
    ['jsonc', 'mcp', '\uFEFF{ // comment\n"mcp":{"docs":{"url":"https://example.com"},"internal.dev":{"enabled":false},},}'],
    ['toml', 'mcp_servers', '\uFEFF[mcp_servers.docs.env]\nTOKEN="private"\n[mcp_servers."internal.dev"]\nenabled=false\n'],
  ]
  const expected = [{ name: 'docs', enabled: undefined }, { name: 'internal.dev', enabled: false }]
  for (const [format, key, text] of samples) assert.deepEqual(configurationEntries(parseConfiguration(text, format), key), expected)
  assert.throws(() => parseConfiguration('{"invalid":}', 'jsonc'))
  assert.throws(() => parseConfiguration('[broken', 'toml'))
})

test('configuration roots are independent of skill target overrides and honor declared environment variables', () => {
  const home = path.resolve(os.tmpdir(), 'oneskill-profile')
  const profile = { name: 'example', dir: path.join(home, 'personal/skills'), configuration: { dir: path.join(home, 'configuration'), env: 'ONESKILL_CONFIG_TEST' } }
  const context = createDiscoveryContext({ home, env: { ONESKILL_CONFIG_TEST: path.join(home, 'environment') } })
  const locations = configuredAgentLocations(profile, path.join(home, 'override/skills'), context)
  assert.equal(locations.target.path, path.join(home, 'override/skills'))
  assert.equal(locations.configRoot, path.join(home, 'environment'))
  assert.equal(locations.configSource, 'ONESKILL_CONFIG_TEST')
})

test('declared Windows paths expand user environment locations without storing a username', () => {
  const context = createDiscoveryContext({ platform: 'win32', home: 'C:\\Users\\demo', env: { APPDATA: 'C:\\Users\\demo\\AppData\\Roaming' } })
  const definition = { name: 'example', dir: '${APPDATA}/Example/skills', configuration: { dir: '${APPDATA}/Example' } }
  const locations = configuredAgentLocations(definition, undefined, context)
  assert.equal(locations.target.path, 'C:\\Users\\demo\\AppData\\Roaming\\Example\\skills')
  assert.equal(locations.configRoot, 'C:\\Users\\demo\\AppData\\Roaming\\Example')
  assert.throws(() => configuredAgentLocations({ ...definition, dir: '${MISSING_PATH}/skills' }, undefined, context), /Path requires environment variable/)
})

test('resource paths and file environment overrides resolve inside the selected host profile', () => {
  const context = createDiscoveryContext({ platform: 'darwin', home: '/tmp/user', env: { FILE_OVERRIDE: '/tmp/custom/settings.json' } })
  const definition = { name: 'example', configuration: { dir: '~/.example' }, resources: { plugins: ['plugins', '~/.external/plugins'], mcp: { files: [{ base: 'config', path: 'settings/mcp.json', key: 'servers', env: 'FILE_OVERRIDE' }] } } }
  const resolved = configuredAgentLocations(definition, undefined, context)
  assert.deepEqual(resolved.definition.resources.plugins, ['/tmp/user/.example/plugins', '/tmp/user/.external/plugins'])
  assert.equal(resolved.definition.resources.mcp.files[0].path, '/tmp/custom/settings.json')
  assert.equal(definition.resources.mcp.files[0].path, 'settings/mcp.json')
  const windows = createDiscoveryContext({ platform: 'win32', home: 'C:\\Users\\demo', env: {} })
  assert.equal(configuredAgentLocations({ name: 'example', configuration: { dir: '${USERPROFILE}/.example' } }, undefined, windows).configRoot, 'C:\\Users\\demo\\.example')
})

test('directory templates use literal fallbacks and shared children follow an overridden root', () => {
  const definition = { name: 'example', commands: ['example'], configDir: { macos: '${XDG_CONFIG_HOME:-~/.config}/example', windows: '${APPDATA}/example' }, skillDir: 'skills', pluginDirs: ['plugins'], mcp: [{ file: 'settings.toml', key: 'servers' }] }
  const source = resolveAgentPlatform(definition, 'darwin')
  const defaults = configuredAgentLocations(source, undefined, createDiscoveryContext({ platform: 'darwin', home: '/tmp/user', env: {} }))
  assert.equal(defaults.configRoot, '/tmp/user/.config/example')
  assert.equal(defaults.target.path, '/tmp/user/.config/example/skills')
  const redirected = configuredAgentLocations(source, undefined, createDiscoveryContext({ platform: 'darwin', home: '/tmp/user', env: { XDG_CONFIG_HOME: '/tmp/custom' } }))
  assert.equal(redirected.configRoot, '/tmp/custom/example')
  assert.equal(redirected.target.path, '/tmp/custom/example/skills')
  assert.deepEqual(redirected.definition.resources.plugins, ['/tmp/custom/example/plugins'])
  const parentOverride = resolveAgentPlatform({ ...definition, configDir: { macos: '~/.example', windows: '~/.example' }, configDirEnv: 'EXAMPLE_PARENT', configDirEnvSuffix: '.example' }, 'darwin')
  const parent = configuredAgentLocations(parentOverride, undefined, createDiscoveryContext({ platform: 'darwin', home: '/tmp/user', env: { EXAMPLE_PARENT: '/tmp/parent' } }))
  assert.equal(parent.configRoot, '/tmp/parent/.example')
  assert.equal(parent.target.path, '/tmp/parent/.example/skills')
})

test('all Agent names use the same declared configuration-file scanner', async (t) => {
  const f = await fixture(t, (root) => ['codex', 'custom-agent'].map((name) => ({ name, probeInstallation: false, dir: path.join(root, name, 'skills'), configuration: { dir: path.join(root, name, 'config') }, resources: { mcp: { files: [{ base: 'config', path: 'servers.toml', format: 'toml', key: 'servers' }] } } })))
  for (const name of ['codex', 'custom-agent']) {
    await f.write(`${name}/config/servers.toml`, '[servers.docs]\ncommand="private-command"\n[servers.docs.env]\nTOKEN="do-not-return"\n')
    await f.write(`${name}/skills/servers.toml`, '[servers.wrong_location]\ncommand="wrong"\n')
  }
  const { items, scan } = await f.core.detectCapabilities('mcp')
  assert.deepEqual(items.map((item) => `${item.agent}:${item.name}`), ['codex:docs', 'custom-agent:docs'])
  assert.deepEqual(scan.diagnostics, [])
  assert.equal(JSON.stringify(items).includes('do-not-return'), false)
  assert.equal(JSON.stringify(items).includes('private-command'), false)
})

test('malformed configurations report diagnostics while valid files remain discoverable', async (t) => {
  const f = await fixture(t, (root) => [{ name: 'example', probeInstallation: false, dir: path.join(root, 'skills'), configuration: { dir: path.join(root, 'config') }, resources: { mcp: { files: [{ base: 'config', path: 'broken.json', key: 'mcpServers' }, { base: 'config', path: 'good.jsonc', key: 'mcp', format: 'jsonc' }] } } }])
  await f.write('config/broken.json', '{"TOKEN":"private", broken')
  await f.write('config/good.jsonc', '{"mcp":{"docs":{}},}')
  const result = await f.core.detectCapabilities('mcp')
  assert.deepEqual(result.items.map((item) => item.name), ['docs'])
  assert.equal(result.scan.diagnostics[0].code, 'CONFIG_PARSE_FAILED')
  assert.equal(JSON.stringify(result.scan).includes('private'), false)
  assert.equal((await readConfiguration(path.join(f.root, 'absent.json'), 'json')).missing, true)
})

test('multiple skill roots preserve existing links without relocating packages, and unlink only library references', async (t) => {
  const f = await fixture(t, (root) => [{ name: 'example', probeInstallation: false, dir: path.join(root, 'shared'), configuration: { dir: path.join(root, 'config') }, resources: { targetIgnorePrefix: '@shared/', skills: [{ id: 'legacy', base: 'config', path: 'skills', ignorePrefix: '' }] } }])
  const source = path.dirname(await f.write('skills/review/SKILL.md', '---\nname: review\ndescription: Test\n---\n'))
  await fs.mkdir(path.join(f.root, 'config/skills'), { recursive: true })
  await fs.symlink(source, path.join(f.root, 'config/skills/review'), 'dir')
  assert.equal((await f.core.detectSkills()).items[0].bindings[0].state, 'linked')
  assert.equal((await f.core.setSkillLink('example', 'review', true)).changed, false)
  await assert.rejects(fs.stat(path.join(f.root, 'shared/review')), { code: 'ENOENT' })
  assert.equal((await f.core.countAgentSkills(await f.core.loadAgents()))[0].totalSkills, 1)
  await f.core.setSkillLink('example', 'review', false)
  assert.equal((await fs.stat(source)).isDirectory(), true)
  await f.core.setSkillLink('example', 'review', true)
  assert.equal((await fs.lstat(path.join(f.root, 'shared/review'))).isSymbolicLink(), true)
})

test('aliases of a skill root count once and preserve pre-existing ignore preferences', async (t) => {
  const f = await fixture(t, (root) => [{ name: 'example', probeInstallation: false, dir: path.join(root, 'shared'), configuration: { dir: path.join(root, 'config') }, resources: { targetIgnorePrefix: '@shared/', skills: [{ id: 'legacy', base: 'config', path: 'skills', ignorePrefix: '' }] } }])
  await f.write('config/skills/.system/review/SKILL.md', '---\nname: review\ndescription: Test\n---\n')
  await fs.symlink(path.join(f.root, 'config/skills'), path.join(f.root, 'shared'), process.platform === 'win32' ? 'junction' : 'dir')
  const original = '# Existing rule\n' + JSON.stringify({ agent: 'example', relative: '.system/review', ignored: true }) + '\n'
  await f.write('migrate.ignore', original)
  const migrations = await f.core.detectMigrations()
  assert.equal(migrations.items.length, 0)
  assert.equal(migrations.ignoredItems.length, 1)
  assert.equal((await f.core.countAgentSkills(await f.core.loadAgents()))[0].totalSkills, 1)
  assert.equal(await fs.readFile(path.join(f.root, 'migrate.ignore'), 'utf8'), original)
  await f.core.setSkillIgnored('example', migrations.ignoredItems[0].path, false)
  assert.equal((await f.core.detectMigrations()).items.length, 1)
})

test('preset rules live in one catalog with references and no Agent-specific inventory commands', async () => {
  const catalog = JSON.parse(await fs.readFile(new URL('../agents.catalog.json', import.meta.url), 'utf8'))
  assert.equal(new Set(catalog.map((entry) => entry.name)).size, catalog.length)
  for (const entry of catalog) {
    assert.deepEqual(Object.keys(entry.configDir), ['macos', 'windows'])
    assert.equal(Object.hasOwn(entry, 'common'), false)
    for (const key of ['dir', 'discovery', 'configuration', 'resources', 'platforms']) assert.equal(Object.hasOwn(entry, key), false)
    assert.ok(entry.references.urls.length)
    for (const platform of ['darwin', 'win32']) {
      const profile = resolveAgentPlatform(entry, platform)
      assert.ok(profile.discovery)
      assert.ok(profile.configuration.dir)
      assert.equal(profile.resources.mcp.native, undefined)
      for (const file of profile.resources.mcp.files) assert.ok(['json', 'jsonc', 'toml'].includes(file.format || 'json'))
    }
  }
})
