import test from 'node:test'
import assert from 'node:assert/strict'
import { skillTargets } from '../web/src/skill-targets.mjs'

test('one matrix control represents Agents sharing a canonical target, but not other readers', () => {
  const groups = skillTargets([
    { name: 'desktop', installed: true, dir: '/shared', skillTargetId: 'same' },
    { name: 'cli', installed: true, dir: '/alias', skillTargetId: 'same' },
    { name: 'reader', installed: true, dir: '/private', skillTargetId: 'other' },
    { name: 'absent', installed: false, dir: '/absent' },
  ])
  assert.equal(groups.length, 2)
  assert.equal(groups[0].label, 'desktop / cli')
  assert.equal(groups[0].agent.name, 'desktop')
  assert.deepEqual(groups[1].names, ['reader'])
})
