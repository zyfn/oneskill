import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

// Execute npm's JavaScript entrypoint with Node, including on Windows.
// This avoids shell quoting and the platform-specific npm.cmd wrapper.
export function npmInvocation({ env = process.env, executable = process.execPath, platform = process.platform } = {}) {
  const directories = new Set([path.dirname(executable), path.dirname(fs.realpathSync(executable))])
  const candidates = [env.npm_execpath]
  for (const directory of directories) {
    candidates.push(path.join(directory, 'node_modules/npm/bin/npm-cli.js'), path.resolve(directory, '../lib/node_modules/npm/bin/npm-cli.js'))
  }
  const searchPath = Object.entries(env).find(([key]) => key.toLowerCase() === 'path')?.[1] || ''
  for (const directory of searchPath.split(platform === 'win32' ? ';' : ':').filter(Boolean)) {
    candidates.push(path.join(directory, 'node_modules/npm/bin/npm-cli.js'))
    for (const name of ['npm', 'npm.cmd']) {
      try { candidates.push(fs.realpathSync(path.join(directory, name))) } catch {}
    }
  }
  const cli = candidates.find((file) => typeof file === 'string' && /\.(?:c?js|mjs)$/.test(file) && fs.existsSync(file))
  if (!cli) throw new Error('Could not locate npm. Install Node.js with npm, or start oneskill with npm start.')
  return { command: executable, args: [cli] }
}

export function runNpm(args, { cwd, env = process.env, run = spawnSync } = {}) {
  const invocation = npmInvocation({ env })
  const result = run(invocation.command, [...invocation.args, ...args], { cwd, env, stdio: 'inherit', windowsHide: true })
  if (result.error) throw result.error
  if (result.status !== 0) throw new Error(`npm ${args.join(' ')} failed (${result.signal || result.status}).`)
}
