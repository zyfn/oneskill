import fs from 'node:fs/promises'
import path from 'node:path'
import { build } from 'esbuild'
import { PROJECT_ROOT, WEB_ROOT } from '../src/core.mjs'

const option = name => { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
const output = path.resolve(option('--output') || path.join(PROJECT_ROOT, 'dist/marketplace'))
const webRoot = path.resolve(option('--web-root') || WEB_ROOT)
const version = JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, 'package.json'), 'utf8')).version
const pluginRoot = path.join(output, 'plugins/oneskill')
const workspaceIndex = process.argv.indexOf('--workspace')
const workspace = workspaceIndex < 0 ? null : process.argv[workspaceIndex + 1]
if (workspaceIndex >= 0 && (!workspace || workspace.startsWith('--'))) throw new Error('--workspace requires a directory.')
const existing = await fs.readdir(output).catch(error => { if (error.code === 'ENOENT') return []; throw error })
if (existing.length && !existing.includes('.oneskill-plugin-package')) throw new Error('Refusing to replace a directory that is not a generated oneskill package.')
await fs.rm(output, { recursive: true, force: true })
await fs.mkdir(path.join(pluginRoot, 'src'), { recursive: true })
await build({ entryPoints: [path.join(PROJECT_ROOT, 'src/cli.mjs')], outfile: path.join(pluginRoot, 'src/cli.mjs'), bundle: true, platform: 'node', mainFields: ['module', 'main'], target: 'node20', format: 'esm', banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" } })
await fs.copyFile(path.join(PROJECT_ROOT, 'agents.catalog.json'), path.join(pluginRoot, 'agents.catalog.json'))
await fs.mkdir(path.join(pluginRoot, 'web'), { recursive: true })
await fs.cp(path.join(webRoot, 'dist'), path.join(pluginRoot, 'web/dist'), { recursive: true })
await fs.cp(path.join(webRoot, 'public'), path.join(pluginRoot, 'web/public'), { recursive: true })
await fs.mkdir(path.join(pluginRoot, 'assets'), { recursive: true })
await fs.copyFile(path.join(webRoot, 'public/logo.svg'), path.join(pluginRoot, 'assets/logo.svg'))
const write = (file, value) => fs.writeFile(file, JSON.stringify(value, null, 2) + '\n')
await write(path.join(pluginRoot, 'package.json'), { name: 'oneskill', version, type: 'module', engines: { node: '>=20' } })
await write(path.join(pluginRoot, 'plugin.json'), {
  $schema: 'https://agent-plugins.org/schemas/1.0.0/plugin.schema.json', name: 'oneskill', version, description: 'Manage one local Skill library across your coding Agents.', license: 'MIT',
  extensions: { 'com.openai': { interface: { displayName: 'oneskill', shortDescription: 'One Skill library for all your Agents', developerName: 'oneskill', category: 'Productivity', capabilities: ['Read','Write'], brandColor: '#365e92', logo: './assets/logo.svg', composerIcon: './assets/logo.svg' } } },
})
await write(path.join(pluginRoot, 'mcp.json'), {
  $schema: 'https://agent-plugins.org/schemas/1.0.0/mcp.schema.json',
  mcpServers: { oneskill: { type: 'stdio', command: 'node', args: ['./src/cli.mjs', 'mcp', ...(workspace ? ['--workspace', path.resolve(workspace)] : [])], cwd: './' } },
})
await fs.mkdir(path.join(output, '.agents/plugins'), { recursive: true })
await write(path.join(output, '.agents/plugins/marketplace.json'), { name: 'oneskill-local', interface: { displayName: 'oneskill' }, plugins: [{ name: 'oneskill', source: { source: 'local', path: './plugins/oneskill' }, policy: { installation: 'AVAILABLE', authentication: 'ON_INSTALL' }, category: 'Productivity' }] })
await fs.writeFile(path.join(output, '.oneskill-plugin-package'), '')
process.stdout.write(`Plugin marketplace: ${output}\n`)
