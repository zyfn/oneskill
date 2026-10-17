import fs from 'node:fs/promises'
import path from 'node:path'
import { PROJECT_ROOT, WEB_ROOT } from '../src/core.mjs'
import { runNpm } from '../src/npm-runtime.mjs'

runNpm(['run', 'build'], { cwd: WEB_ROOT })
runNpm(['run', 'build', '--', '--mode', 'embedded'], { cwd: WEB_ROOT })
const root = path.join(WEB_ROOT, 'dist/embed')
let html = await fs.readFile(path.join(root, 'embedded.html'), 'utf8')
for (const match of [...html.matchAll(/<script[^>]*src="([^"]+)"[^>]*>\s*<\/script>/g)]) {
  const script = await fs.readFile(path.resolve(root, match[1]), 'utf8')
  html = html.replace(match[0], () => `<script type="module">${script.replace(/<\/script/gi, '<\\/script')}</script>`)
}
for (const match of [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)]) {
  const style = await fs.readFile(path.resolve(root, match[1]), 'utf8')
  html = html.replace(match[0], () => `<style>${style}</style>`)
}
await fs.writeFile(path.join(WEB_ROOT, 'dist/workspace.html'), html)
process.stdout.write(`Built standalone Web and self-contained MCP App from ${path.relative(PROJECT_ROOT, WEB_ROOT)}.\n`)
