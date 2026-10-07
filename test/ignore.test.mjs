import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { copyWorkspaceRuntime } from '../scripts/workspace-runtime.mjs'

async function fixture(t, ignoreText = '# Existing preferences\n') {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill-ignore-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  await fs.mkdir(path.join(root, 'src'))
  await copyWorkspaceRuntime(root)
  const agents = ['first', 'second'].map((name) => ({ name, dir: path.join(root, name, 'skills') }))
  for (const agent of agents) await fs.mkdir(agent.dir, { recursive: true })
  await fs.writeFile(path.join(root, 'agents.catalog.json'), JSON.stringify(agents))
  const ignoreFile = path.join(root, 'migrate.ignore')
  await fs.writeFile(ignoreFile, ignoreText)
  const moduleUrl = pathToFileURL(path.join(root, 'src/core.mjs')).href
  const core = await import(moduleUrl)
  async function skill(agent, relative, name = 'same-name') {
    const dir = path.join(root, agent, 'skills', relative)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: Test skill\n---\nOriginal content\n`)
    return dir
  }
  return { root, ignoreFile, core, moduleUrl, skill }
}

test('ignore persists by Agent and directory without hiding same-name siblings or touching packages', async (t) => {
  const f = await fixture(t)
  const target = await f.skill('first', '.system/review')
  const sibling = await f.skill('first', 'team/review')
  const otherAgent = await f.skill('second', '.system/review')
  const original = await fs.readFile(path.join(target, 'SKILL.md'), 'utf8')
  await f.core.setSkillIgnored('first', target, true)
  const fresh = await import(`${f.moduleUrl}?fresh`)
  const data = await fresh.workspaceData()
  assert.deepEqual(data.migrations.map((item) => item.path).sort(), [sibling, otherAgent].sort())
  assert.equal(data.ignoredSkills[0].path, target)
  assert.equal(data.stats.ignoredSkills, 1)
  assert.equal(data.agents.find((agent) => agent.name === 'first').totalSkills, 2)
  assert.equal(await fs.readFile(path.join(target, 'SKILL.md'), 'utf8'), original)
  assert.equal((await fs.lstat(target)).isDirectory(), true)
  assert.match(await fs.readFile(f.ignoreFile, 'utf8'), /# Existing preferences/)
  assert.equal((await fresh.setSkillIgnored('first', target, true)).changed, false)
  assert.equal((await fresh.importLocalSkills([{ agent: 'first', path: target }])).results[0].ok, false)
  await fresh.setSkillIgnored('first', target, false)
  assert.equal((await fresh.detectMigrations()).items.length, 3)
  assert.equal((await fresh.detectMigrations()).ignoredItems.length, 0)
})

test('restoring an item under a legacy name rule preserves protection for its siblings', async (t) => {
  const f = await fixture(t, '# Keep this protection\nfirst:same-name\n')
  const target = await f.skill('first', 'team/review')
  const sibling = await f.skill('first', '.system/review')
  assert.equal((await f.core.detectMigrations()).ignoredItems.length, 2)
  await f.core.setSkillIgnored('first', target, false)
  const restored = await f.core.detectMigrations()
  assert.deepEqual(restored.items.map((item) => item.path), [target])
  assert.deepEqual(restored.ignoredItems.map((item) => item.path), [sibling])
  assert.match(await fs.readFile(f.ignoreFile, 'utf8'), /^first:same-name$/m)
  await f.core.setSkillIgnored('first', target, true)
  assert.equal((await f.core.detectMigrations()).items.length, 0)
})

test('parallel updates survive together, including paths with spaces and Unicode', async (t) => {
  const f = await fixture(t)
  const first = await f.skill('first', '设计/my skill')
  const second = await f.skill('second', 'tools/review')
  await Promise.all([f.core.setSkillIgnored('first', first, true), f.core.setSkillIgnored('second', second, true)])
  assert.equal((await f.core.detectMigrations()).ignoredItems.length, 2)
  await Promise.all([f.core.setSkillIgnored('first', first, false), f.core.setSkillIgnored('second', second, false)])
  assert.equal((await f.core.detectMigrations()).items.length, 2)
})

test('invalid requests and malformed preferences cannot rewrite the ignore file', async (t) => {
  const f = await fixture(t)
  const target = await f.skill('first', 'review')
  const before = await fs.readFile(f.ignoreFile, 'utf8')
  await assert.rejects(f.core.setSkillIgnored('missing', target, true), /Unknown agent/)
  await assert.rejects(f.core.setSkillIgnored('second', target, true), /no longer available/)
  await assert.rejects(f.core.setSkillIgnored('first', '/etc', true), /no longer available/)
  await assert.rejects(f.core.setSkillIgnored('first', target, 'true'), /true or false/)
  assert.equal(await fs.readFile(f.ignoreFile, 'utf8'), before)
  await fs.writeFile(f.ignoreFile, '{broken json}\n')
  await assert.rejects(f.core.setSkillIgnored('first', target, true), /Invalid ignore rule/)
  assert.equal(await fs.readFile(f.ignoreFile, 'utf8'), '{broken json}\n')
})

test('a failed atomic save preserves old rules, cleans temporary files, and permits retry', async (t) => {
  const f = await fixture(t)
  const target = await f.skill('first', 'review')
  const before = await fs.readFile(f.ignoreFile, 'utf8')
  const mocked = t.mock.method(fs, 'rename', async () => { throw new Error('simulated save failure') })
  await assert.rejects(f.core.setSkillIgnored('first', target, true), /simulated save failure/)
  mocked.mock.restore()
  assert.equal(await fs.readFile(f.ignoreFile, 'utf8'), before)
  assert.equal((await fs.readdir(f.root)).some((name) => name.startsWith('migrate.ignore.')), false)
  await f.core.setSkillIgnored('first', target, true)
  assert.equal((await f.core.detectMigrations()).ignoredItems.length, 1)
})
