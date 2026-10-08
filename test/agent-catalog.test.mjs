import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { readAgentDefinitions, resolveAgentPlatform } from '../src/agent-catalog.mjs'
import { createDiscoveryContext } from '../src/agent-discovery.mjs'
import { createWorkspace } from '../src/core.mjs'

async function fixture(t, presets = []) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill-agents-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.writeFile(path.join(root, 'agents.catalog.json'), JSON.stringify(presets))
  const core = createWorkspace({ root: root })
  const bin = path.join(root, 'bin')
  await fs.mkdir(bin)
  async function local(records) { await fs.writeFile(path.join(root, 'agents.local.json'), JSON.stringify(records)) }
  const context = () => createDiscoveryContext({ home: root, env: { PATH: bin, SystemRoot: process.env.SystemRoot }, standardBinDirs: [], applicationRoots: [], extensionRoots: [], versionTimeoutMs: 15000 })
  const scan = () => core.loadAgents({ discoveryContext: context() })
  async function executable(command, version = '1.7.0') {
    const source = path.join(bin, command + '.cjs')
    await fs.writeFile(source, `if(process.argv[2]!=='--version')process.exit(3);console.log('fixture-agent ${version}')\n`)
    const launcher = path.join(bin, command + (process.platform === 'win32' ? '.cmd' : ''))
    const code = process.platform === 'win32' ? `@echo off\r\n"${process.execPath}" "${source}" %*\r\n` : `#!${process.execPath}\nif(process.argv[2]!=='--version')process.exit(3);console.log('fixture-agent ${version}')\n`
    await fs.writeFile(launcher, code, { mode: 0o755 })
    return launcher
  }
  return { root, bin, core, local, scan, executable }
}

test('a new command-only Agent is detected after registration without configuration directories or a restart', async t => {
  const f = await fixture(t)
  await f.executable('new-agent-cli')
  assert.deepEqual(await f.scan(), [])
  await f.local([{ name: 'new-agent', commands: ['new-agent-cli'] }])
  const [agent] = await f.scan()
  assert.equal(agent.preset, false)
  assert.equal(agent.runnable, true)
  assert.equal(agent.version, '1.7.0')
  assert.equal(agent.configured, false)
  assert.equal(agent.absoluteDir, null)
  assert.equal((await f.core.countAgentSkills([agent]))[0].totalSkills, null)
  assert.deepEqual(agent.support, { skills: false, plugins: false, mcp: false })
  assert.deepEqual((await f.core.detectPlugins([agent])).items, [])
  await assert.rejects(fs.stat(path.join(f.root, '.new-agent')), { code: 'ENOENT' })
})

test('custom paths and file formats use the common scanner and disappear on removal', async t => {
  const f = await fixture(t)
  const executable = await f.executable('some-cli')
  const root = path.join(f.root, 'settings'), skills = path.join(f.root, 'packages')
  await fs.mkdir(root)
  await fs.mkdir(path.join(skills, 'review'), { recursive: true })
  await fs.writeFile(path.join(skills, 'review/SKILL.md'), '---\nname: review\ndescription: Review\n---\n')
  await fs.writeFile(path.join(root, 'settings.toml'), '[servers.docs]\nurl="https://example.com"\n')
  await f.local([{ name: 'custom-agent', commands: ['some-cli'], executable, configDir: { macos: root, windows: root, linux: root }, skillDir: skills, mcp: [{ file: 'settings.toml', key: 'servers' }] }])
  const agents = await f.scan()
  assert.equal(agents[0].absoluteRoot, root)
  assert.equal((await f.core.countAgentSkills(agents))[0].totalSkills, 1)
  assert.deepEqual((await f.core.detectCapabilities('mcp', agents)).items.map(item => item.name), ['docs'])
  await f.local([])
  assert.deepEqual(await f.scan(), [])
})

test('explicit local roots and Skill targets take precedence without modifying the preset file', async t => {
  const preset = { name: 'known', commands: ['known'], configDir: { macos: '/preset/config', windows: '/preset/config', linux: '/preset/config' }, configDirEnv: 'KNOWN_CONFIG', skillDir: 'skills', pluginDirs: ['plugins'] }
  const f = await fixture(t, [preset])
  await fs.writeFile(path.join(f.root, 'agents.registry'), 'known|/legacy/skills\nlegacy-agent|/legacy-agent/skills\n')
  await f.local([{ name: 'known', commands: ['known-cli'], configDir: { macos: '/local/config', windows: '/local/config', linux: '/local/config' }, skillDir: '/local/skills' }])
  const records = await readAgentDefinitions(f.root)
  const known = records.find(entry => entry.name === 'known')
  assert.equal(known.preset, true)
  assert.equal(known.targetOverride, '/local/skills')
  assert.deepEqual(known.discovery.commands, ['known-cli'])
  assert.equal(known.configuration.env, undefined)
  assert.deepEqual(known.resources.plugins, ['plugins'])
  assert.deepEqual(records.find(entry => entry.name === 'legacy-agent').discovery.commands, ['legacy-agent'])
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(f.root, 'agents.catalog.json'), 'utf8')), [preset])
})

test('invalid, ambiguous, and duplicate local definitions fail explicitly', async t => {
  const f = await fixture(t)
  for (const records of [
    [{ name: 'x', commands: ['x'] }, { name: 'x', commands: ['x'] }],
    [{ name: 'x', skillDirectory: '/typo' }],
    [{ name: 'x', commands: ['x; echo bad'] }],
    [{ name: 'x', commands: ['x'], configDir: { macos: '~/.x' } }],
    [{ name: 'x', commands: ['x'], configDir: { macos: {}, windows: '~/.x' } }],
    [{ name: 'x', commands: ['x'], common: {} }],
    [{ name: 'x', commands: ['x'], mcp: [{ file: 'x.yaml', format: 'yaml', key: 'servers' }] }],
    [{ name: 'x', commands: ['x'], mcp: [{ file: 'config.json', key: 'servers' }] }],
  ]) {
    await f.local(records)
    await assert.rejects(f.scan(), /Agent definition/)
  }
  await fs.writeFile(path.join(f.root, 'agents.local.json'), '{invalid')
  await assert.rejects(f.scan(), /agents.local.json contains invalid JSON/)
  await f.local([])
  await fs.writeFile(path.join(f.root, 'agents.catalog.json'), 'broken')
  await assert.rejects(f.scan(), /agents.catalog.json contains invalid JSON/)
})

test('shared subdirectories follow a selected root and its documented environment override', () => {
  const record = { name: 'example', logo: '/example.svg', commands: ['example'], configDir: { macos: '~/.example', windows: '${APPDATA}/Example' }, configDirEnv: 'EXAMPLE_HOME', skillDir: 'skills', pluginDirs: ['plugins/cache'], mcp: [{ file: 'settings.toml', key: 'servers' }] }
  const windows = resolveAgentPlatform(record, 'win32')
  assert.equal(windows.configuration.dir, '${APPDATA}/Example')
  assert.equal(windows.configuration.env, 'EXAMPLE_HOME')
  assert.equal(windows.dir, '${APPDATA}/Example/skills')
  assert.deepEqual(windows.resources.plugins, ['plugins/cache'])
  assert.equal(windows.resources.mcp.files[0].path, 'settings.toml')
  assert.equal(windows.logo, '/example.svg')
  assert.equal(record.skillDir, 'skills')
  assert.equal(resolveAgentPlatform(record, 'darwin').dir, '~/.example/skills')
})

test('a one-platform local path edit preserves the other platform and shared rules', async t => {
  const f = await fixture(t, [{ name: 'known', commands: ['known'], configDir: { macos: '~/.known', windows: '${APPDATA}/Known' }, configDirEnv: 'KNOWN_HOME', skillDir: 'skills', pluginDirs: ['plugins'] }])
  await f.local([{ name: 'known', configDir: { windows: 'D:/Known' } }])
  const [windows] = await readAgentDefinitions(f.root, { platform: 'win32' })
  assert.equal(windows.configuration.dir, 'D:/Known')
  assert.equal(windows.configuration.env, undefined)
  assert.equal(windows.dir, 'D:/Known/skills')
  assert.deepEqual(windows.resources.plugins, ['plugins'])
  const [mac] = await readAgentDefinitions(f.root, { platform: 'darwin' })
  assert.equal(mac.configuration.dir, '~/.known')
  assert.equal(mac.configuration.env, 'KNOWN_HOME')
  await f.local([{ name: 'known', pluginDirs: [] }])
  assert.deepEqual((await readAgentDefinitions(f.root, { platform: 'darwin' }))[0].resources.plugins, [])
})

test('a null platform root stays disabled despite legacy targets and can be explicitly configured', async t => {
  const f = await fixture(t, [{ name: 'desktop', commands: ['desktop'], configDir: { macos: '~/.desktop', windows: null }, skillDir: 'skills' }])
  await fs.writeFile(path.join(f.root, 'agents.registry'), 'desktop|/legacy/skills\n')
  assert.deepEqual(await readAgentDefinitions(f.root, { platform: 'win32' }), [])
  await f.local([{ name: 'desktop', configDir: { windows: '${APPDATA}/Desktop' } }])
  const [windows] = await readAgentDefinitions(f.root, { platform: 'win32' })
  assert.equal(windows.preset, true)
  assert.deepEqual(windows.discovery.commands, ['desktop'])
  assert.equal(windows.targetOverride, '/legacy/skills')
})

test('platform paths are selected before expanding foreign environment variables or scanning', async t => {
  const f = await fixture(t, [{ name: 'platform-agent', commands: ['platform-cli'], configDir: { macos: '~/.mac', windows: '${APPDATA}/WindowsAgent' }, skillDir: 'skills', appNames: { macos: [], windows: ['WindowsAgent'] } }])
  await f.executable('platform-cli')
  const context = createDiscoveryContext({ platform: 'darwin', home: f.root, env: { PATH: f.bin }, standardBinDirs: [], applicationRoots: [], extensionRoots: [] })
  const [mac] = await f.core.loadAgents({ discoveryContext: context })
  assert.equal(mac.runnable, true)
  assert.equal(mac.absoluteRoot, path.join(f.root, '.mac'))
  assert.equal(mac.absoluteDir, path.join(f.root, '.mac/skills'))
  assert.deepEqual(await readAgentDefinitions(f.root, { platform: 'linux' }), [])
})
