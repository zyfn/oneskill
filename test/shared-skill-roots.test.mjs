import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createWorkspace } from '../src/core.mjs'

test('a shared Skill directory is inventoried once, keeps old ignore choices, and imports from its own root', async t => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill-shared-skills-'))
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }))
  const sharedRoot = path.join(workspaceRoot, 'user/skills')
  const skillPath = path.join(sharedRoot, 'review')
  const firstConfig = path.join(workspaceRoot, 'first')
  const secondConfig = path.join(workspaceRoot, 'second')
  await fs.mkdir(skillPath, { recursive: true })
  await fs.mkdir(firstConfig)
  await fs.mkdir(secondConfig)
  await fs.writeFile(path.join(skillPath, 'SKILL.md'), '---\nname: review\ndescription: Review code\n---\n')
  await fs.writeFile(path.join(workspaceRoot, 'agents.catalog.json'), JSON.stringify([
    { name: 'first', commands: ['first'], probeInstallation: false, configDir: { macos: firstConfig, windows: firstConfig, linux: firstConfig }, skillDir: sharedRoot },
    { name: 'second', commands: ['second'], probeInstallation: false, configDir: { macos: secondConfig, windows: secondConfig, linux: secondConfig }, skillDir: 'skills', extraSkillDirs: [{ id: 'shared', scope: 'user', path: sharedRoot }] },
  ]))
  const workspace = createWorkspace({ root: workspaceRoot })
  const initial = (await workspace.detectUnmanagedSkills()).items
  assert.equal(initial.length, 1)
  assert.equal(initial[0].sourceKind, 'shared')
  assert.deepEqual(initial[0].sourceAgents, ['first', 'second'])

  await fs.writeFile(path.join(workspaceRoot, 'skills.ignore.json'), JSON.stringify([{ agent: 'second', relative: '@shared/review', ignored: true }]))
  const ignored = await workspace.detectUnmanagedSkills()
  assert.equal(ignored.items.length, 0)
  assert.equal(ignored.ignoredItems.length, 1)
  await workspace.setSkillIgnored('first', skillPath, false)

  const imported = await workspace.importSkills([{ agent: 'first', path: skillPath }])
  assert.equal(imported.results[0].ok, true)
  assert.ok(imported.results[0].backup.startsWith(path.join(workspaceRoot, 'user/.oneskill-backups')))
  const managed = (await workspace.detectSkills()).items[0]
  assert.equal(managed.name, 'review')
  assert.deepEqual(managed.bindings.map(binding => binding.state), ['not-linked', 'not-linked'])
  await assert.rejects(fs.lstat(skillPath), { code: 'ENOENT' })
  assert.equal((await workspace.detectUnmanagedSkills()).items.length, 0)

  await workspace.setSkillLink('second', 'review', true)
  const linked = (await workspace.detectSkills()).items[0]
  assert.deepEqual(linked.bindings.map(binding => binding.state), ['not-linked', 'linked'])
  assert.equal(await fs.realpath(path.join(secondConfig, 'skills/review')), await fs.realpath(path.join(workspaceRoot, 'skills/review')))
  await assert.rejects(fs.lstat(skillPath), { code: 'ENOENT' })

  // A real package outside the library stays unmanaged even with identical contents.
  await fs.cp(path.join(workspaceRoot, 'skills/review'), skillPath, { recursive: true })
  const outside = (await workspace.detectUnmanagedSkills()).items
  assert.equal(outside.length, 1)
  assert.equal(outside[0].path, skillPath)
  assert.equal(outside[0].managed, false)
})
