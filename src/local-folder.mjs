import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'

export function resolveFolder(value) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) {
    throw Object.assign(new Error('A valid path is required'), { code: 'INVALID_PATH' })
  }
  const trimmed = value.trim()
  const expanded = trimmed === '~' ? os.homedir() : trimmed.startsWith('~/') ? path.join(os.homedir(), trimmed.slice(2)) : trimmed
  const resolved = path.resolve(expanded)
  let stat
  try { stat = fs.statSync(resolved) }
  catch { throw Object.assign(new Error('This location no longer exists. Rescan the workspace.'), { code: 'PATH_NOT_FOUND' }) }
  return stat.isDirectory() ? resolved : path.dirname(resolved)
}

export async function openFolder(value, { platform = process.platform, run = execFile } = {}) {
  const folder = resolveFolder(value)
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'explorer.exe' : 'xdg-open'
  await new Promise((resolve, reject) => {
    run(command, [folder], { timeout: 10000, windowsHide: true }, (error) => {
      // Explorer may return 1 even when it successfully hands off to an existing window.
      if (!error || (platform === 'win32' && error.code === 1)) return resolve()
      reject(Object.assign(new Error('The system could not open this folder.'), { code: 'OPEN_FAILED' }))
    })
  })
  return folder
}
