import fs from 'node:fs'
import path from 'node:path'
import { PROJECT_ROOT, WEB_ROOT } from './core.mjs'
import { runNpm } from './npm-runtime.mjs'

function newestMtime(root) {
  let newest = 0
  try {
    const rootStat = fs.statSync(root)
    if (!rootStat.isDirectory()) return rootStat.mtimeMs
    newest = rootStat.mtimeMs
  } catch {
    return 0
  }
  const pending = [root]
  while (pending.length) {
    const current = pending.pop()
    let entries = []
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules') continue
      const fullPath = path.join(current, entry.name)
      if (entry.isDirectory()) pending.push(fullPath)
      else {
        try {
          newest = Math.max(newest, fs.statSync(fullPath).mtimeMs)
        } catch {}
      }
    }
  }
  return newest
}

export function ensureWebBuild(webRoot = WEB_ROOT, { run = runNpm } = {}) {
  const index = path.join(webRoot, 'dist/index.html')
  if (fs.existsSync(index) && !fs.existsSync(path.join(webRoot, 'package.json'))) return
  const buildInputs = [
    path.join(webRoot, 'src'),
    path.join(webRoot, 'public'),
    path.join(webRoot, 'index.html'),
    path.join(webRoot, 'package.json'),
    path.join(webRoot, 'package-lock.json'),
    path.join(webRoot, 'vite.config.js'),
    ...(webRoot === WEB_ROOT ? [path.join(PROJECT_ROOT, 'src/contracts'), path.join(PROJECT_ROOT, 'package.json'), path.join(PROJECT_ROOT, 'scripts/build.mjs')] : []),
  ]
  const newestInput = Math.max(...buildInputs.map(newestMtime))
  const stale = !fs.existsSync(index) || newestInput > fs.statSync(index).mtimeMs
  if (!stale) return
  if (!fs.existsSync(path.join(webRoot, 'node_modules'))) {
    const installCommand = fs.existsSync(path.join(webRoot, 'package-lock.json')) ? 'ci' : 'install'
    run([installCommand], { cwd: webRoot })
  }
  run(['run', 'build'], { cwd: webRoot === WEB_ROOT ? PROJECT_ROOT : webRoot })
}
