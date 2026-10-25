import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { findSkillPackages } from '../src/skill-scan.mjs'

test('Skill descriptions display multiline text instead of YAML block markers', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill-metadata-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const cases = [
    ['folded', '>-', 'Find local capabilities.\n  Connect the selected Agent.', 'Find local capabilities. Connect the selected Agent.'],
    ['folded-keep', '>+', 'Find local capabilities.\n\n  Connect the selected Agent.', 'Find local capabilities. Connect the selected Agent.'],
    ['literal', '|-', 'First line.\n\n  Second paragraph.', 'First line.\n\nSecond paragraph.'],
    ['literal-keep', '|+', 'First line.\n  Second line.', 'First line.\nSecond line.'],
    ['indented', '>2-', 'First line.\n  Second line.', 'First line. Second line.'],
  ]
  for (const [name, marker, body] of cases) {
    const dir = path.join(root, name)
    await fs.mkdir(dir)
    await fs.writeFile(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: ${marker}\n  ${body}\nversion: 1\n---\n# Instructions\nBody text must not replace the description.\n`)
  }
  const { packages } = await findSkillPackages(root)
  assert.equal(packages.length, cases.length)
  for (const [name, , , expected] of cases) assert.equal(packages.find(item => item.declaredName === name).description, expected)
})
