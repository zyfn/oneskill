import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { npmInvocation, runNpm } from '../src/npm-runtime.mjs'

test('npm runs with Node and argument arrays even when paths contain spaces or shell characters', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill npm & '))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const cli = path.join(root, 'npm-cli.js')
  await fs.writeFile(cli, '')
  for (const platform of ['darwin', 'win32', 'linux']) {
    assert.deepEqual(npmInvocation({ env: { npm_execpath: cli }, platform }), { command: process.execPath, args: [cli] })
  }
  let called = false
  runNpm(['run', 'build'], { cwd: root, env: { npm_execpath: cli }, run(command, args, options) {
    called = true
    assert.equal(command, process.execPath)
    assert.deepEqual(args, [cli, 'run', 'build'])
    assert.equal(options.cwd, root)
    assert.equal(options.shell, undefined)
    return { status: 0 }
  } })
  assert.equal(called, true)
  assert.throws(() => runNpm(['ci'], { env: { npm_execpath: cli }, run: () => ({ status: 1 }) }), /failed/)
  const error = Object.assign(new Error('cannot spawn'), { code: 'ENOENT' })
  assert.throws(() => runNpm(['ci'], { env: { npm_execpath: cli }, run: () => ({ error }) }), { code: 'ENOENT' })
})

test('Windows standalone Node locates npm-cli.js beside Node without invoking npm.cmd', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill-node-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const executable = path.join(root, 'node.exe')
  const cli = path.join(root, 'node_modules/npm/bin/npm-cli.js')
  await fs.writeFile(executable, '')
  await fs.mkdir(path.dirname(cli), { recursive: true })
  await fs.writeFile(cli, '')
  assert.deepEqual(npmInvocation({ executable, platform: 'win32', env: {} }), { command: executable, args: [cli] })
})
