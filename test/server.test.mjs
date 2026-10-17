import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { createWorkspace } from '../src/core.mjs'
import { startWorkspaceServer } from '../src/server.mjs'
import { ensureWebBuild } from '../src/web-assets.mjs'

test('first Web start installs and builds through the real npm runner', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill web & '))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const manifest = { name: 'oneskill-start-fixture', version: '1.0.0', private: true, scripts: { build: 'node build.cjs' } }
  await fs.writeFile(path.join(root, 'package.json'), JSON.stringify(manifest))
  await fs.writeFile(path.join(root, 'package-lock.json'), JSON.stringify({ name: manifest.name, version: manifest.version, lockfileVersion: 3, requires: true, packages: { '': { name: manifest.name, version: manifest.version } } }))
  await fs.writeFile(path.join(root, 'build.cjs'), "require('fs').mkdirSync('dist',{recursive:true});require('fs').writeFileSync('dist/index.html','<main>Ready</main>')")
  ensureWebBuild(root)
  assert.equal(await fs.readFile(path.join(root, 'dist/index.html'), 'utf8'), '<main>Ready</main>')
  ensureWebBuild(root, { run() { assert.fail('An unchanged build should be reused') } })
})

test('HTTP routes use the injected workspace and protect writes while serving shared Web assets', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill-http-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const config = path.join(root, 'agent')
  await fs.mkdir(path.join(root, 'skills/review'), { recursive: true })
  await fs.writeFile(path.join(root, 'skills/review/SKILL.md'), '---\nname: review\n---\nReview code\n')
  await fs.mkdir(path.join(config, 'skills'), { recursive: true })
  await fs.writeFile(path.join(root, 'agents.catalog.json'), JSON.stringify([{ name: 'fixture', probeInstallation: false, commands: ['fixture'], configDir: { macos: config, windows: config, linux: config }, skillDir: 'skills' }]))
  const webRoot = path.join(root, 'web')
  await fs.mkdir(path.join(webRoot, 'dist'), { recursive: true })
  await fs.writeFile(path.join(webRoot, 'dist/index.html'), '<main>oneskill</main>')
  const { server, url, token, close } = await startWorkspaceServer({ workspace: createWorkspace({ root }), webRoot, runtimeRoot: path.join(root, 'runtime'), port: 0 })
  t.after(close)
  const base = new URL(url).origin
  assert.equal(await (await fetch(base)).text(), '<main>oneskill</main>')
  const headers = { authorization: `Bearer ${token}` }
  const data = await (await fetch(`${base}/api/operations/getWorkspace`, { method: 'POST', body: '{}', headers })).json()
  assert.equal(data.source, root + path.sep + 'skills')
  assert.equal(data.skills[0].name, 'review')
  const body = JSON.stringify({ requestId: 'test-link', agentId: 'agent:fixture', skillId: 'managed:review', linked: true })
  assert.equal((await fetch(`${base}/api/operations/setSkillLink`, { method: 'POST', body })).status, 401)
  const response = await fetch(`${base}/api/operations/setSkillLink`, { method: 'POST', body, headers })
  assert.equal(response.status, 200)
  assert.equal((await response.json()).state, 'linked')
  assert.equal(await fs.realpath(path.join(config, 'skills/review')), await fs.realpath(path.join(root, 'skills/review')))
  assert.equal((await fetch(`${base}/%2e%2e%2foutside`)).status, 403)
})
