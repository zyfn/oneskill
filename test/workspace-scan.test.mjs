import test from 'node:test'
import assert from 'node:assert/strict'
import { workspaceScanStatus } from '../web/src/workspace-scan.mjs'

const complete = () => ({ complete: true, truncated: false, diagnostics: [] })
const data = () => ({ scan: { skills: complete(), plugins: complete(), mcp: complete(), hooks: { complete: false, truncated: true, diagnostics: [] } } })

test('hidden Hooks scan limits do not mark healthy visible inventories as unreadable', () => {
  for (const route of ['skills', 'agents', 'plugins', 'mcp']) assert.equal(workspaceScanStatus(data(), route).reason, null)
})

test('a visible source read error remains visible within its scope and the Agents overview', () => {
  const snapshot = data()
  const error = { path: '/fixture/plugin.json', code: 'CONFIG_PARSE_FAILED' }
  snapshot.scan.plugins = { complete: false, truncated: false, diagnostics: [error] }
  assert.equal(workspaceScanStatus(snapshot, 'skills').reason, null)
  assert.equal(workspaceScanStatus(snapshot, 'mcp').reason, null)
  for (const route of ['plugins', 'agents']) {
    assert.equal(workspaceScanStatus(snapshot, route).reason, 'unreadable')
    assert.deepEqual(workspaceScanStatus(snapshot, route).diagnostics, [error])
  }
})

test('a bounded visible scan is identified as limited, not a read failure', () => {
  const snapshot = data()
  snapshot.scan.skills = { complete: false, truncated: true, diagnostics: [] }
  assert.equal(workspaceScanStatus(snapshot, 'skills').reason, 'limited')
  snapshot.scan.skills.diagnostics.push({ path: '/fixture/skills', code: 'EACCES' })
  assert.equal(workspaceScanStatus(snapshot, 'skills').reason, 'unreadable')
})

test('stale snapshots remain a warning for every view and duplicate diagnostics are merged', () => {
  const snapshot = { ...data(), stale: true }
  for (const route of ['skills', 'agents', 'plugins', 'mcp']) assert.equal(workspaceScanStatus(snapshot, route).reason, 'stale')
  const error = { path: '/fixture/shared.json', code: 'CONFIG_UNREADABLE' }
  snapshot.scan.plugins.diagnostics.push(error)
  snapshot.scan.mcp.diagnostics.push(error)
  assert.equal(workspaceScanStatus(snapshot, 'agents').diagnostics.length, 1)
})
