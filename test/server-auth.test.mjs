import assert from 'node:assert/strict'
import test from 'node:test'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createWorkspace } from '../src/core.mjs'
import { startWorkspaceServer } from '../src/server.mjs'

test('all workspace reads and writes require authorization; cross-origin requests cannot mint access', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill-auth-'))
  await fs.writeFile(path.join(root, 'agents.catalog.json'), '[]')
  const runtime = await startWorkspaceServer({ workspace: createWorkspace({ root }), runtimeRoot: path.join(root, 'runtime') })
  t.after(async () => { await runtime.close(); await fs.rm(root, { recursive: true, force: true }) })
  const call = headers => fetch(`${runtime.endpoint}/api/operations/getWorkspace`, { method: 'POST', body: '{}', headers })
  assert.equal((await call({})).status, 401)
  assert.equal((await call({ authorization: `Bearer ${'é'.repeat(48)}` })).status, 401)
  assert.equal((await call({ authorization: `Bearer ${runtime.token}`, origin: 'https://example.com' })).status, 403)
  assert.equal((await fetch(`${runtime.endpoint}/api/session`)).headers.has('set-cookie'), false)
  const bootstrap = await fetch(runtime.url, { redirect: 'manual' })
  assert.equal(bootstrap.status, 303)
  assert.equal(bootstrap.headers.get('location'), '/')
  const cookie = bootstrap.headers.get('set-cookie')
  assert.match(cookie, /HttpOnly; SameSite=Strict/)
  assert.equal((await call({ cookie: cookie.split(';')[0] })).status, 200)
})

test('browser cookies for different workspaces coexist on the loopback host', async t => {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill-cookies-'))
  const runtimes = []
  t.after(async () => { for (const runtime of runtimes) await runtime.close(); await fs.rm(base, { recursive: true, force: true }) })
  for (const name of ['first', 'second']) {
    const root = path.join(base, name)
    await fs.mkdir(root)
    await fs.writeFile(path.join(root, 'agents.catalog.json'), '[]')
    runtimes.push(await startWorkspaceServer({ workspace: createWorkspace({ root }), runtimeRoot: path.join(base, 'runtime') }))
  }
  const cookies = await Promise.all(runtimes.map(async runtime => (await fetch(runtime.url, { redirect: 'manual' })).headers.get('set-cookie').split(';')[0]))
  assert.notEqual(cookies[0].split('=')[0], cookies[1].split('=')[0])
  for (const [i, runtime] of runtimes.entries()) {
    const call = cookie => fetch(`${runtime.endpoint}/api/operations/getWorkspace`, { method: 'POST', headers: { cookie }, body: '{}' })
    assert.equal((await call(cookies.join('; '))).status, 200)
    assert.equal((await call(cookies[1 - i])).status, 401)
  }
})
