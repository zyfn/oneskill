import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { createWorkspace, PROJECT_ROOT } from '../src/core.mjs'

test('the default library follows the user home, independent of the checkout or current directory', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill-default-home-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const script = `import { createWorkspace } from ${JSON.stringify(new URL('../src/core.mjs', import.meta.url).href)}; const workspace = createWorkspace(); console.log(JSON.stringify({ root: workspace.root, skills: workspace.sourceRoot }));`
  const { stdout } = await promisify(execFile)(process.execPath, ['--input-type=module', '-e', script], {
    cwd: root, env: { ...process.env, HOME: root, USERPROFILE: root },
  })
  assert.deepEqual(JSON.parse(stdout), { root: path.join(root, '.oneskill'), skills: path.join(root, '.oneskill', 'skills') })
  assert.deepEqual(await fs.readdir(root), [])
})

test('Agent logos retain their image formats when embedded for Web and MCP Apps', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill-logos-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const names = ['antigravity.png', 'gemini.png', 'github-copilot.png', 'kimi-code.png', 'trae.png', 'claude.svg']
  await fs.writeFile(path.join(root, 'agents.catalog.json'), JSON.stringify(names.map((file, i) => ({ name: `image-${i}`, commands: ['fixture'], probeInstallation: false, logo: `/agent-logos/${file}` }))))
  const agents = await createWorkspace({ root }).loadAgents()
  for (const [i, file] of names.entries()) {
    const mime = file.endsWith('.png') ? 'image/png' : 'image/svg+xml'
    const bytes = await fs.readFile(path.join(PROJECT_ROOT, 'web/public/agent-logos', file))
    assert.equal(agents[i].logo, `data:${mime};base64,${bytes.toString('base64')}`)
  }
})
import { createDiscoveryContext } from '../src/agent-discovery.mjs'
import { stopWorkspaceProcess } from './helpers/workspace-process.mjs'

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
  const candidate = (await first.detectUnmanagedSkills()).items[0]
  await first.setSkillIgnored('fixture', candidate.path, true)
  assert.equal((await first.workspaceData()).skills.filter(item => item.ignored).length, 1)
  assert.equal((await second.workspaceData()).skills.filter(item => item.ignored).length, 0)
  assert.deepEqual((await first.detectSkills()).items.map(item => item.name), ['first'])
  assert.deepEqual((await second.detectSkills()).items.map(item => item.name), ['second'])
  await first.setSkillLink('fixture', 'shared', true)
  assert.equal((await first.detectSkills()).items[0].bindings[0].state, 'linked')
  assert.equal((await second.detectSkills()).items[0].bindings[0].state, 'not-linked')
  assert.deepEqual((await fs.readdir(first.root)).sort(), ['agent', 'agents.catalog.json', 'skills', 'skills.ignore.json'])
})

test('CLI workspace selection uses application presets without copying source or Web assets', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill-cli-workspace-'))
  t.after(async () => {
    await stopWorkspaceProcess({ root, runtimeRoot: path.join(root, 'runtime') })
    await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
  })
  await fs.writeFile(path.join(root, 'agents.local.json'), JSON.stringify([{ name: 'fixture', commands: ['fixture'], probeInstallation: false }]))
  await fs.writeFile(path.join(root, 'agents.catalog.json'), '[]')
  const run = promisify(execFile)
  const { stdout } = await run(process.execPath, [path.join(PROJECT_ROOT, 'src/cli.mjs'), 'agents', '--workspace', root, '--runtime-dir', path.join(root, 'runtime'), '--idle-timeout', '1000'])
  assert.deepEqual(JSON.parse(stdout).map(agent => agent.name), ['fixture'])
  assert.deepEqual((await fs.readdir(root)).filter(name => name !== 'runtime').sort(), ['agents.catalog.json', 'agents.local.json', 'skills'])
  assert.ok((await fs.stat(path.join(root, 'skills'))).isDirectory())
  await assert.rejects(run(process.execPath, [path.join(PROJECT_ROOT, 'src/cli.mjs'), 'agents', '--workspace']), error => /requires a value/.test(error.stderr))
  await fs.unlink(path.join(root, 'agents.catalog.json'))
  const discoveryContext = createDiscoveryContext({ home: root, env: { APPDATA: path.join(root, 'roaming'), LOCALAPPDATA: path.join(root, 'local') }, standardBinDirs: [], applicationRoots: [], extensionRoots: [] })
  assert.ok((await createWorkspace({ root, discoveryContext }).loadAgents()).some(agent => agent.name === 'fixture'))
})
