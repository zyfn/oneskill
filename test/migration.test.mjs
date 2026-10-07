import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { copyWorkspaceRuntime } from '../scripts/workspace-runtime.mjs'
import { adoptLocalSkill } from '../src/migration.mjs'

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill-import-test-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const sharedRoot = path.join(root, 'shared')
  async function skill(agent, relative = 'writing', text = 'Original content') {
    const agentDir = path.join(root, agent, 'skills')
    const source = path.join(agentDir, relative)
    await fs.mkdir(path.join(source, 'scripts'), { recursive: true })
    await fs.writeFile(path.join(source, 'SKILL.md'), `---\nname: writing\n---\n${text}`)
    await fs.writeFile(path.join(source, 'scripts/run.sh'), '#!/bin/sh\necho writing\n', { mode: 0o755 })
    return { source, agentDir, sharedRoot, backupRoot: path.join(root, agent, '.oneskill-backups') }
  }
  return { root, sharedRoot, skill }
}

test('imports a nested package, preserves executable assets, backs up original and links source', async (t) => {
  const f = await fixture(t)
  const input = await f.skill('first', 'team/writing')
  const result = await adoptLocalSkill(input)
  assert.equal(result.relative, 'team/writing')
  assert.equal(await fs.realpath(input.source), result.target)
  assert.equal((await fs.lstat(input.source)).isSymbolicLink(), true)
  assert.equal((await fs.stat(path.join(result.target, 'scripts/run.sh'))).mode & 0o777, 0o755)
  assert.match(await fs.readFile(path.join(result.backup, 'original/SKILL.md'), 'utf8'), /Original content/)
  assert.equal(JSON.parse(await fs.readFile(path.join(result.backup, 'restore.json'), 'utf8')).source, input.source)
})

test('reuses identical packages across agents, refuses different content without touching original', async (t) => {
  const f = await fixture(t)
  const first = await adoptLocalSkill(await f.skill('first'))
  const second = await adoptLocalSkill(await f.skill('second'))
  assert.equal(second.reused, true)
  assert.equal(second.target, first.target)
  const conflict = await f.skill('third', 'writing', 'Different content')
  await assert.rejects(adoptLocalSkill(conflict), /Different content already exists/)
  assert.equal((await fs.lstat(conflict.source)).isDirectory(), true)
  assert.match(await fs.readFile(path.join(conflict.source, 'SKILL.md'), 'utf8'), /Different content/)
  assert.match(await fs.readFile(path.join(first.target, 'SKILL.md'), 'utf8'), /Original content/)
})

test('rejects source traversal, linked package assets, and escaping destination parents', async (t) => {
  const f = await fixture(t)
  const input = await f.skill('first', 'nested/writing')
  await assert.rejects(adoptLocalSkill({ ...input, agentDir: path.join(f.root, 'first/skills/nested/writing') }), /outside this Agent/)
  await fs.symlink('/etc/hosts', path.join(input.source, 'outside'))
  await assert.rejects(adoptLocalSkill(input), /contains a link/)
  await fs.unlink(path.join(input.source, 'outside'))
  await fs.mkdir(f.sharedRoot, { recursive: true })
  await fs.symlink(os.tmpdir(), path.join(f.sharedRoot, 'nested'), 'dir')
  await assert.rejects(adoptLocalSkill(input), /destination contains a symbolic link/)
  assert.equal((await fs.lstat(input.source)).isDirectory(), true)
})

test('restores original folder when link creation fails; complete copy can be safely retried', async (t) => {
  const f = await fixture(t)
  const input = await f.skill('first')
  const mocked = t.mock.method(fs, 'symlink', async () => { throw new Error('simulated link failure') })
  await assert.rejects(adoptLocalSkill(input), /simulated link failure/)
  assert.equal((await fs.lstat(input.source)).isDirectory(), true)
  assert.match(await fs.readFile(path.join(input.source, 'SKILL.md'), 'utf8'), /Original content/)
  mocked.mock.restore()
  const retry = await adoptLocalSkill(input)
  assert.equal(retry.reused, true)
  assert.equal((await fs.lstat(input.source)).isSymbolicLink(), true)
})

test('API core revalidates candidates, respects ignore list and omits backups on later scans', async (t) => {
  const f = await fixture(t)
  const repo = path.join(f.root, 'repository')
  await fs.mkdir(path.join(repo, 'src'), { recursive: true })
  await copyWorkspaceRuntime(repo)
  const input = await f.skill('first')
  const ignored = await f.skill('first', 'protected')
  await fs.writeFile(path.join(repo, 'agents.catalog.json'), JSON.stringify([{ name: 'first', dir: input.agentDir }]))
  await fs.writeFile(path.join(repo, 'migrate.ignore'), 'first:writing')
  const core = await import(pathToFileURL(path.join(repo, 'src/core.mjs')).href)
  assert.equal((await core.detectMigrations()).items.length, 0)
  await fs.writeFile(path.join(repo, 'migrate.ignore'), '')
  const result = await core.importLocalSkills([{ agent: 'first', path: input.source }, { agent: 'first', path: '/etc' }])
  assert.deepEqual(result.results.map((item) => item.ok), [true, false])
  const remaining = (await core.detectMigrations()).items
  assert.equal(remaining.length, 1)
  assert.equal(remaining[0].path, ignored.source)
  assert.equal((await core.detectSkills()).items[0].bindings[0].state, 'linked')
})

test('rejects nesting an imported skill inside an existing shared package', async (t) => {
  const f = await fixture(t)
  await adoptLocalSkill(await f.skill('first', 'writing'))
  const nested = await f.skill('second', 'writing/extra')
  await assert.rejects(adoptLocalSkill(nested), /parent destination is already a skill package/)
  assert.equal((await fs.lstat(nested.source)).isDirectory(), true)
})
