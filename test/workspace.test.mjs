import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { createWorkspace, PROJECT_ROOT } from '../src/core.mjs'
import { createDiscoveryContext } from '../src/agent-discovery.mjs'

test('independent workspace instances isolate libraries and persistent ignore preferences', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill-workspaces-'))
  t.after(() => fs.rm(base, { recursive: true, force: true }))
  const instances = []
  for (const name of ['first', 'second']) {
    const root = path.join(base, name)
    const config = path.join(root, 'agent')
    await fs.mkdir(path.join(config, 'skills/local'), { recursive: true })
    await fs.writeFile(path.join(config, 'skills/local/SKILL.md'), '---\nname: local\n---\nLocal package\n')
    await fs.mkdir(path.join(root, 'skills/shared'), { recursive: true })
    await fs.writeFile(path.join(root, 'skills/shared/SKILL.md'), `---\nname: ${name}\n---\nShared package\n`)
    await fs.writeFile(path.join(root, 'agents.catalog.json'), JSON.stringify([{ name: 'fixture', commands: ['fixture'], probeInstallation: false, configDir: { macos: config, windows: config, linux: config }, skillDir: 'skills' }]))
    instances.push(createWorkspace({ root }))
  }
  const [first, second] = instances
  const candidate = (await first.detectMigrations()).items[0]
  await first.setSkillIgnored('fixture', candidate.path, true)
  assert.equal((await first.workspaceData()).ignoredSkills.length, 1)
  assert.equal((await second.workspaceData()).ignoredSkills.length, 0)
  assert.deepEqual((await first.detectSkills()).items.map(item => item.name), ['first'])
  assert.deepEqual((await second.detectSkills()).items.map(item => item.name), ['second'])
  await first.setSkillLink('fixture', 'shared', true)
  assert.equal((await first.detectSkills()).items[0].bindings[0].state, 'linked')
  assert.equal((await second.detectSkills()).items[0].bindings[0].state, 'not-linked')
  assert.deepEqual((await fs.readdir(first.root)).sort(), ['agent', 'agents.catalog.json', 'migrate.ignore', 'skills'])
})

test('CLI workspace selection uses application presets without copying source or Web assets', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill-cli-workspace-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.writeFile(path.join(root, 'agents.local.json'), JSON.stringify([{ name: 'fixture', commands: ['fixture'], probeInstallation: false }]))
  await fs.writeFile(path.join(root, 'agents.catalog.json'), '[]')
  const run = promisify(execFile)
  const { stdout } = await run(process.execPath, [path.join(PROJECT_ROOT, 'src/cli.mjs'), 'agents', '--workspace', root, '--json'])
  assert.deepEqual(JSON.parse(stdout).map(agent => agent.name), ['fixture'])
  assert.deepEqual((await fs.readdir(root)).sort(), ['agents.catalog.json', 'agents.local.json'])
  await assert.rejects(run(process.execPath, [path.join(PROJECT_ROOT, 'src/cli.mjs'), 'agents', '--workspace']), error => /requires a directory/.test(error.stderr))
  await fs.unlink(path.join(root, 'agents.catalog.json'))
  const discoveryContext = createDiscoveryContext({ home: root, env: { APPDATA: path.join(root, 'roaming'), LOCALAPPDATA: path.join(root, 'local') }, standardBinDirs: [], applicationRoots: [], extensionRoots: [] })
  assert.ok((await createWorkspace({ root, discoveryContext }).loadAgents()).some(agent => agent.name === 'fixture'))
})
