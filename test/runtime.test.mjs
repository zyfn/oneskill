import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import { execFile } from 'node:child_process'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createWorkspace, PROJECT_ROOT } from '../src/core.mjs'
import { startWorkspaceServer } from '../src/server.mjs'
import { connectWorkspace } from '../src/runtime/connect.mjs'
import { createMcpServer, WORKSPACE_UI } from '../src/adapters/mcp.mjs'
import { digest, atomicJson } from '../src/runtime/paths.mjs'
import { parseOperation } from '../src/contracts/operations.mjs'

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill-runtime-'))
  const runtimeRoot = path.join(root, 'runtime')
  const config = path.join(root, 'agent')
  for (const [relative, name] of [['skills/review','Review'],['agent/skills/local','Local']]) {
    await fs.mkdir(path.join(root, relative), { recursive: true })
    await fs.writeFile(path.join(root, relative, 'SKILL.md'), `---\nname: ${name}\ndescription: Fixture Skill\n---\nRead this package\n`)
  }
  await fs.writeFile(path.join(root, 'agents.catalog.json'), JSON.stringify([{ name: 'fixture', commands: ['fixture'], probeInstallation: false, configDir: { macos: config, windows: config, linux: config }, skillDir: 'skills' }]))
  const runtime = await startWorkspaceServer({ workspace: createWorkspace({ root }), runtimeRoot, openFolder: async value => value })
  const client = await connectWorkspace({ root, runtimeRoot })
  t.after(async () => { await runtime.close(); await fs.rm(root, { recursive: true, force: true }) })
  return { root, runtimeRoot, runtime, client }
}

test('HTTP, CLI and MCP share entity identifiers, snapshots, errors and link changes', async t => {
  const f = await fixture(t)
  const uiFile = path.join(f.root, 'ui.html')
  await fs.writeFile(uiFile, '<main>oneskill</main>')
  const server = createMcpServer(f.client, { uiFile })
  const mcp = new Client({ name: 'integration-test', version: '1.0.0' })
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport); await mcp.connect(clientTransport)
  t.after(async () => { await mcp.close(); await server.close() })
  const http = await f.client.call('getWorkspace')
  const viaMcp = await mcp.callTool({ name: 'oneskill_get_workspace', arguments: {} })
  assert.deepEqual(viaMcp.structuredContent, http)
  const { stdout } = await promisify(execFile)(process.execPath, [path.join(PROJECT_ROOT, 'src/cli.mjs'), 'workspace', '--workspace', f.root, '--runtime-dir', f.runtimeRoot])
  assert.deepEqual(JSON.parse(stdout), http)
  assert.deepEqual(http.skills.map(item => [item.id, item.managed, item.ignored]), [['managed:review',true,false],['local:fixture:local',false,false]])
  assert.equal(Object.hasOwn(http, 'migrations'), false)
  const tools = (await mcp.listTools()).tools
  assert.deepEqual(tools.find(item => item.name === 'oneskill_get_workspace')._meta['openai/ui'].entrypoints, [{ type: 'global' }])
  assert.equal((await mcp.readResource({ uri: WORKSPACE_UI })).contents[0].mimeType, 'text/html;profile=mcp-app')
  const linked = await mcp.callTool({ name: 'oneskill_set_skill_link', arguments: { requestId: randomUUID(), expectedRevision: http.revision, skillId: 'managed:review', agentId: 'agent:fixture', linked: true } })
  assert.equal(linked.isError, undefined)
  assert.equal(await fs.realpath(path.join(f.root, 'agent/skills/review')), await fs.realpath(path.join(f.root, 'skills/review')))
  assert.equal((await f.client.call('getWorkspace')).skills.find(item => item.managed).bindings[0].state, 'linked')
  const bad = await mcp.callTool({ name: 'oneskill_set_skill_link', arguments: { requestId: randomUUID(), skillId: 'managed:review', agentId: 'agent:fixture', linked: 'true' } })
  assert.equal(bad.structuredContent.error.code, 'INVALID_INPUT')
  await assert.rejects(f.client.call('setSkillLink', { requestId: randomUUID(), skillId: 'managed:review', agentId: 'agent:fixture', linked: 'true' }), { code: 'INVALID_INPUT' })
})

test('mutations reject stale revisions, deduplicate retries and persist ignores in the unified model', async t => {
  const f = await fixture(t)
  const initial = await f.client.call('getWorkspace')
  const request = { requestId: randomUUID(), expectedRevision: initial.revision, skillId: 'local:fixture:local', ignored: true }
  const first = await f.client.call('setSkillIgnored', request)
  assert.deepEqual(await f.client.call('setSkillIgnored', request), first)
  const data = await f.client.call('getWorkspace')
  assert.equal(data.skills.find(item => !item.managed).ignored, true)
  assert.equal(data.skills.find(item => !item.managed).name, 'Local')
  await assert.rejects(f.client.call('setSkillIgnored', { ...request, ignored: false }), { code: 'REQUEST_CONFLICT' })
  await assert.rejects(f.client.call('setSkillLink', { requestId: randomUUID(), expectedRevision: initial.revision, skillId: 'managed:review', agentId: 'agent:fixture', linked: true }), { code: 'WORKSPACE_CHANGED' })
  await f.client.call('setSkillIgnored', { requestId: randomUUID(), skillId: 'local:fixture:local', ignored: false })
  const imported = await f.client.call('importSkills', { requestId: randomUUID(), skillIds: ['local:fixture:local'] })
  assert.equal(imported.results[0].ok, true)
  assert.equal(imported.results[0].id, 'local:fixture:local')
  assert.match(await fs.readFile(path.join(f.root, 'skills/local/SKILL.md'), 'utf8'), /Read this package/)
  assert.equal((await f.client.call('getWorkspace')).skills.filter(item => !item.managed).length, 0)
})

test('interrupted requests are not replayed; conflicting real directories remain intact', async t => {
  const f = await fixture(t)
  const args = parseOperation('setSkillLink', { requestId: 'interrupted', agentId: 'agent:fixture', skillId: 'managed:review', linked: true })
  const receipts = path.join(f.client.location.directory, 'requests')
  await fs.mkdir(receipts, { recursive: true })
  await atomicJson(path.join(receipts, `${digest(args.requestId)}.json`), { fingerprint: digest(JSON.stringify({ name: 'setSkillLink', args })), state: 'pending' })
  await assert.rejects(f.client.call('setSkillLink', args), { code: 'OPERATION_INTERRUPTED' })
  await fs.mkdir(path.join(f.root, 'agent/skills/review'))
  await fs.writeFile(path.join(f.root, 'agent/skills/review/private.txt'), 'keep')
  await assert.rejects(f.client.call('setSkillLink', { ...args, requestId: 'conflict' }), { code: 'TARGET_CONFLICT' })
  assert.equal(await fs.readFile(path.join(f.root, 'agent/skills/review/private.txt'), 'utf8'), 'keep')
})

test('concurrent clients attach to one owner, aliases resolve together and idle owners exit', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill-owner-'))
  const runtimeRoot = path.join(root, 'runtime')
  await fs.writeFile(path.join(root, 'agents.catalog.json'), '[]')
  t.after(async () => { await fs.rm(root, { recursive: true, force: true }) })
  const clients = await Promise.all(Array.from({ length: 3 }, () => connectWorkspace({ root, runtimeRoot, idleTimeout: 800 })))
  assert.equal(new Set(clients.map(client => client.descriptor.pid)).size, 1)
  const client = clients[0]
  const linkedRoot = path.join(os.tmpdir(), `oneskill-alias-${randomUUID()}`)
  await fs.symlink(root, linkedRoot, process.platform === 'win32' ? 'junction' : 'dir')
  t.after(() => fs.unlink(linkedRoot))
  const alias = await connectWorkspace({ root: linkedRoot, runtimeRoot })
  assert.equal(alias.descriptor.sessionId, client.descriptor.sessionId)
  await new Promise(resolve => setTimeout(resolve, 1800))
  await assert.rejects(connectWorkspace({ root, runtimeRoot, start: false }), { code: 'SERVICE_UNAVAILABLE' })
})

test('existing clients reconnect after service replacement and preserve mutation receipts', async t => {
  const f = await fixture(t)
  const initial = await f.client.call('getWorkspace')
  const args = { requestId: randomUUID(), expectedRevision: initial.revision, skillId: 'local:fixture:local', ignored: true }
  const result = await f.client.call('setSkillIgnored', args)
  const previous = f.client.descriptor.sessionId
  await f.runtime.close()
  const replacement = await startWorkspaceServer({ workspace: createWorkspace({ root: f.root }), runtimeRoot: f.runtimeRoot })
  let samePort
  t.after(async () => { await replacement.close(); await samePort?.close() })
  assert.deepEqual(await f.client.call('setSkillIgnored', args), result)
  assert.notEqual(f.client.descriptor.sessionId, previous)
  assert.equal((await f.client.call('getWorkspace')).skills.find(item => !item.managed).ignored, true)
  const port = Number(new URL(replacement.endpoint).port)
  await replacement.close()
  samePort = await startWorkspaceServer({ workspace: createWorkspace({ root: f.root }), runtimeRoot: f.runtimeRoot, port })
  assert.equal((await f.client.heartbeat()).sessionId, samePort.identity.sessionId)
  assert.equal(f.client.descriptor.token, samePort.token)
})
