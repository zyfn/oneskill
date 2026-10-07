import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveFolder, openFolder } from '../src/local-folder.mjs'

test('folder targets support files, directories, spaces and home shorthand', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'oneskill folder '))
  try {
    const file = path.join(root, 'skill.md'); fs.writeFileSync(file, '')
    assert.equal(resolveFolder(file), root)
    assert.equal(resolveFolder(root), root)
    assert.equal(resolveFolder('~'), os.homedir())
    assert.throws(() => resolveFolder(path.join(root, 'missing')), { code: 'PATH_NOT_FOUND' })
    assert.throws(() => resolveFolder(''), { code: 'INVALID_PATH' })
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})
test('system opener waits for completion and propagates failures', async () => {
  for (const [platform, command] of [['darwin','open'],['win32','explorer.exe'],['linux','xdg-open']]) {
    const result = await openFolder(os.tmpdir(), { platform, run: (cmd, args, options, callback) => {
      assert.equal(cmd, command); assert.deepEqual(args, [os.tmpdir()]); assert.equal(options.timeout, 10000)
      queueMicrotask(() => callback(null))
    } })
    assert.equal(result, os.tmpdir())
  }
  await assert.rejects(openFolder(os.tmpdir(), { run: (_cmd, _args, _opts, callback) => callback(new Error('not available')) }), { code: 'OPEN_FAILED' })
})
