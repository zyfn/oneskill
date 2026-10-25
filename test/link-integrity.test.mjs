import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createWorkspace } from '../src/core.mjs'

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill-integrity-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const config = path.join(root, 'agent')
  await fs.mkdir(path.join(config, 'skills'), { recursive: true })
  await fs.mkdir(path.join(root, 'skills', 'alpha'), { recursive: true })
  await fs.writeFile(path.join(root, 'skills', 'alpha', 'SKILL.md'), '---\nname: alpha\n---\nReview code.')
  await fs.writeFile(path.join(root, 'agents.catalog.json'), JSON.stringify([{ name: 'fixture', probeInstallation: false, commands: ['fixture'], configDir: { macos: config, windows: config, linux: config }, skillDir: 'skills' }]))
  return { root, target: path.join(config, 'skills'), workspace: createWorkspace({ root }) }
}

test('moving a library package exposes the old broken link and allows explicit repair', async t => {
  const f = await fixture(t)
  await f.workspace.setSkillLink('fixture', 'alpha', true)
  await fs.mkdir(path.join(f.root, 'skills', 'group'))
  await fs.rename(path.join(f.root, 'skills', 'alpha'), path.join(f.root, 'skills', 'group', 'alpha'))
  const data = await f.workspace.workspaceData()
  assert.equal(data.linkIssues.length, 1)
  assert.equal(data.linkIssues[0].path, path.join(f.target, 'alpha'))
  assert.equal(data.skills[0].relative, 'group/alpha')
  await f.workspace.resolveSkillLink(data.linkIssues[0].id, 'group/alpha')
  assert.equal(await fs.realpath(path.join(f.target, 'alpha')), await fs.realpath(path.join(f.root, 'skills', 'group', 'alpha')))
  assert.equal((await f.workspace.workspaceData()).linkIssues.length, 0)
  assert.equal((await f.workspace.workspaceData()).skills[0].bindings[0].state, 'inherited')
})

test('only broken links into this library can be removed; changed links remain intact', async t => {
  const f = await fixture(t)
  await f.workspace.setSkillLink('fixture', 'alpha', true)
  await fs.rename(path.join(f.root, 'skills', 'alpha'), path.join(f.root, 'skills', 'beta'))
  const issue = (await f.workspace.workspaceData()).linkIssues[0]
  await fs.unlink(path.join(f.target, 'alpha'))
  await fs.mkdir(path.join(f.target, 'alpha'))
  await assert.rejects(f.workspace.resolveSkillLink(issue.id), { code: 'SOURCE_CHANGED' })
  assert.equal((await fs.stat(path.join(f.target, 'alpha'))).isDirectory(), true)
  await fs.symlink(path.join(f.root, 'skills', 'missing'), path.join(f.target, 'owned'), 'dir')
  await fs.symlink(path.join(f.root, 'external-missing'), path.join(f.target, 'external'), 'dir')
  const issues = (await f.workspace.workspaceData()).linkIssues
  assert.equal(issues.length, 1)
  await f.workspace.resolveSkillLink(issues[0].id)
  await assert.rejects(fs.lstat(path.join(f.target, 'owned')), { code: 'ENOENT' })
  assert.equal((await fs.lstat(path.join(f.target, 'external'))).isSymbolicLink(), true)
})

test('a failed link repair preserves its old reference and the library package for a later retry', async t => {
  const f = await fixture(t)
  await f.workspace.setSkillLink('fixture', 'alpha', true)
  await fs.rename(path.join(f.root, 'skills/alpha'), path.join(f.root, 'skills/beta'))
  const issue = (await f.workspace.workspaceData()).linkIssues[0]
  const destination = path.join(f.target, 'alpha')
  const previous = await fs.readlink(destination)
  const symlink = fs.symlink, rename = fs.rename
  let rejected = false
  const rejectOnce = target => {
    if (target !== destination || rejected) return
    rejected = true
    throw Object.assign(new Error('simulated replacement failure'), { code: 'EACCES' })
  }
  const create = t.mock.method(fs, 'symlink', async (target, file, type) => { rejectOnce(file); return symlink(target, file, type) })
  const replace = t.mock.method(fs, 'rename', async (source, target) => { rejectOnce(target); return rename(source, target) })
  await assert.rejects(f.workspace.resolveSkillLink(issue.id, 'beta'), { code: 'EACCES' })
  assert.equal(rejected, true)
  assert.equal(await fs.readlink(destination), previous)
  await assert.rejects(fs.realpath(destination), { code: 'ENOENT' })
  assert.match(await fs.readFile(path.join(f.root, 'skills/beta/SKILL.md'), 'utf8'), /Review code/)
  assert.deepEqual(await fs.readdir(f.target), ['alpha'])
  create.mock.restore()
  replace.mock.restore()
  await f.workspace.resolveSkillLink(issue.id, 'beta')
  assert.equal(await fs.realpath(destination), await fs.realpath(path.join(f.root, 'skills/beta')))
})

test('nested destination aliases cannot redirect link creation or removal', async t => {
  const f = await fixture(t)
  await fs.mkdir(path.join(f.root, 'skills', 'group'))
  await fs.rename(path.join(f.root, 'skills', 'alpha'), path.join(f.root, 'skills', 'group', 'alpha'))
  const elsewhere = path.join(f.root, 'other-agent')
  await fs.mkdir(elsewhere)
  await fs.symlink(elsewhere, path.join(f.target, 'group'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(f.workspace.setSkillLink('fixture', 'group/alpha', true), { code: 'UNSAFE_TARGET' })
  await fs.symlink(path.join(f.root, 'skills', 'group', 'alpha'), path.join(elsewhere, 'alpha'), 'dir')
  await assert.rejects(f.workspace.setSkillLink('fixture', 'group/alpha', false), { code: 'UNSAFE_TARGET' })
  assert.equal((await fs.lstat(path.join(elsewhere, 'alpha'))).isSymbolicLink(), true)
})

test('a missing source under an aliased library parent is still attributed to this workspace', async t => {
  const f = await fixture(t)
  const alias = path.join(f.root, 'library-alias')
  await fs.symlink(path.join(f.root, 'skills'), alias, process.platform === 'win32' ? 'junction' : 'dir')
  await fs.symlink(path.join(alias, 'missing'), path.join(f.target, 'missing'), 'dir')
  const data = await f.workspace.workspaceData()
  assert.equal(data.linkIssues.length, 1)
  await f.workspace.resolveSkillLink(data.linkIssues[0].id, 'alpha')
  assert.equal(await fs.realpath(path.join(f.target, 'missing')), await fs.realpath(path.join(f.root, 'skills', 'alpha')))
})

test('Agents share a canonical target identity before the target folder is created', async t => {
  const f = await fixture(t)
  const real = path.join(f.root, 'uninitialized-agent')
  const alias = path.join(f.root, 'agent-alias')
  await fs.mkdir(real)
  await fs.symlink(real, alias, process.platform === 'win32' ? 'junction' : 'dir')
  await fs.writeFile(path.join(f.root, 'agents.catalog.json'), JSON.stringify([real, alias].map((location, index) => ({ name: `fixture-${index}`, commands: ['fixture'], probeInstallation: false, configDir: { macos: location, windows: location, linux: location }, skillDir: 'skills' }))))
  const agents = await f.workspace.loadAgents()
  assert.equal(agents[0].skillTargetId, agents[1].skillTargetId)
  assert.equal(agents[0].skillsDirectoryExists, false)
})
