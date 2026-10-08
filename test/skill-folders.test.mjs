import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { createWorkspace } from '../src/core.mjs'
import { skillCollections, belongsToCollection } from '../web/src/skill-folders.mjs'

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill-folders-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const agentDir = path.join(root, 'agent/skills')
  await fs.mkdir(agentDir, { recursive: true })
  await fs.mkdir(path.join(root, 'agent/plugins'), { recursive: true })
  await fs.writeFile(path.join(root, 'agents.catalog.json'), JSON.stringify([{ name: 'test-agent', dir: agentDir }]))
  const core = createWorkspace({ root: root })
  async function skill(relative) {
    const dir = path.join(root, relative)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(path.join(dir, 'SKILL.md'), '---\nname: review\ndescription: Review code\n---\n')
    return dir
  }
  return { root, agentDir, core, skill }
}

test('collections preserve directory identity and normalize Windows path separators', () => {
  const rows = [{ relative: 'review' }, { relative: 'design/review' }, { relative: 'engineering/backend/review' }, { relative: 'design\\prototype' }]
  const { folders, rootCount } = skillCollections(rows)
  assert.equal(rootCount, 1)
  assert.deepEqual(folders.map(({ path, count }) => [path, count]), [['design', 2], ['engineering', 1], ['engineering/backend', 1]])
})

test('collection navigation includes parent totals without merging sibling directories', () => {
  const skills = [{ relative: 'review' }, { relative: 'engineering/review' }, { relative: 'engineering/backend/review' }, { relative: 'engineering-tools/review' }, { relative: 'all/review' }]
  const tree = skillCollections(skills)
  assert.equal(tree.rootCount, 1)
  assert.deepEqual(tree.folders.find((entry) => entry.path === 'engineering'), { path: 'engineering', label: 'engineering', depth: 0, count: 2 })
  assert.deepEqual(tree.folders.find((entry) => entry.path === 'engineering/backend'), { path: 'engineering/backend', label: 'backend', depth: 1, count: 1 })
  assert.equal(skills.filter((skill) => belongsToCollection(skill, null)).length, 5)
  assert.equal(skills.filter((skill) => belongsToCollection(skill, '')).length, 1)
  assert.equal(skills.filter((skill) => belongsToCollection(skill, 'engineering')).length, 2)
  assert.equal(skills.filter((skill) => belongsToCollection(skill, 'all')).length, 1)
})

test('nested folders survive scan, link, import, and unlink; totals include local and linked packages', async (t) => {
  const f = await fixture(t)
  await f.skill('skills/engineering/backend/review')
  await f.skill('agent/skills/.system/builtin')
  const local = await f.skill('agent/skills/design/review')
  await f.core.setSkillLink('test-agent', 'engineering/backend/review', true)
  const data = await f.core.workspaceData()
  assert.equal(data.agents[0].totalSkills, 3)
  const shared = data.skills[0]
  assert.equal(shared.category, 'engineering/backend')
  assert.equal(shared.bindings[0].state, 'linked')
  assert.equal((await f.core.countAgentSkills(await f.core.loadAgents()))[0].totalSkills, 3)
  const localSkill = (await f.core.detectMigrations()).items.find((item) => item.path === local)
  assert.equal(localSkill.category, 'design')
  const imported = await f.core.importLocalSkills([{ agent: 'test-agent', path: local }])
  assert.equal(imported.results[0].ok, true)
  assert.equal(imported.results[0].relative, 'design/review')
  assert.equal((await f.core.detectSkills()).items.find((item) => item.relative === 'design/review').category, 'design')
  assert.equal((await f.core.countAgentSkills(await f.core.loadAgents()))[0].totalSkills, 3)
  await f.core.setSkillLink('test-agent', 'engineering/backend/review', false)
  assert.equal((await f.core.countAgentSkills(await f.core.loadAgents()))[0].totalSkills, 2)
  assert.equal((await fs.stat(path.join(f.root, 'skills/engineering/backend/review/SKILL.md'))).isFile(), true)
})

test('counting follows linked folders but terminates on cycles and skips broken links', async (t) => {
  const f = await fixture(t)
  await f.skill('agent/skills/local')
  await f.skill('external/tools/review')
  await fs.symlink(path.join(f.root, 'external'), path.join(f.agentDir, 'collection'), 'dir')
  await fs.symlink(f.agentDir, path.join(f.agentDir, 'cycle'), 'dir')
  await fs.symlink(path.join(f.root, 'missing'), path.join(f.agentDir, 'broken'), 'dir')
  const [agent] = await f.core.countAgentSkills(await f.core.loadAgents())
  assert.equal(agent.totalSkills, 2)
  assert.equal(agent.skillsTruncated, false)
})
