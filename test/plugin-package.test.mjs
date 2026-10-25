import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { PROJECT_ROOT } from '../src/core.mjs'
import { digest } from '../src/runtime/paths.mjs'
import { stopWorkspaceProcess } from './helpers/workspace-process.mjs'

for (const useDefault of [true, false]) {
  test(`generated plugin serves its UI and inventory from the ${useDefault ? 'default home' : 'explicit'} workspace without node_modules`, async t => {
    const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill-package-')))
    const home = path.join(root, 'home')
    const workspace = useDefault ? path.join(home, '.oneskill') : path.join(root, 'workspace')
    const runtimeRoot = path.join(os.tmpdir(), `oneskill-${digest(home).slice(0, 16)}`)
    const webRoot = path.join(root, 'web')
    const output = path.join(root, 'package')
    const config = path.join(workspace, 'agent')
    await fs.mkdir(config, { recursive: true })
    await fs.mkdir(home, { recursive: true })
    await fs.mkdir(path.join(workspace, 'skills/private-skill'), { recursive: true })
    await fs.writeFile(path.join(workspace, 'skills/private-skill/SKILL.md'), '---\nname: private-skill\n---\nLocal only.\n')
    await fs.writeFile(path.join(workspace, 'agents.catalog.json'), JSON.stringify([{ name: 'fixture', commands: ['fixture'], probeInstallation: false, configDir: { macos: config, windows: config, linux: config }, mcp: [{ file: 'settings.jsonc', format: 'jsonc', key: 'mcpServers' }] }]))
    await fs.writeFile(path.join(config, 'settings.jsonc'), '{/* bundled parser */"mcpServers":{"docs":{}},}')
    await fs.mkdir(path.join(webRoot, 'dist'), { recursive: true })
    await fs.mkdir(path.join(webRoot, 'public'), { recursive: true })
    await fs.writeFile(path.join(webRoot, 'dist/index.html'), '<main>Web</main>')
    await fs.writeFile(path.join(webRoot, 'dist/workspace.html'), '<main>Workspace</main>')
    await fs.copyFile(path.join(PROJECT_ROOT, 'logo.svg'), path.join(webRoot, 'public/logo.svg'))
    await promisify(execFile)(process.execPath, [path.join(PROJECT_ROOT, 'scripts/build-plugin.mjs'), ...(useDefault ? [] : ['--workspace', workspace]), '--web-root', webRoot, '--output', output])
    const pluginRoot = path.join(output, 'plugins/oneskill')
    await assert.rejects(fs.stat(path.join(pluginRoot, 'node_modules')), { code: 'ENOENT' })
    await assert.rejects(fs.stat(path.join(pluginRoot, 'skills')), { code: 'ENOENT' })
    const configMcp = JSON.parse(await fs.readFile(path.join(pluginRoot, 'mcp.json'), 'utf8')).mcpServers.oneskill
    // The host rejects absolute executable paths in portable Agent Plugins.
    assert.equal(configMcp.command, 'node')
    assert.deepEqual(configMcp.args, ['./src/cli.mjs', 'mcp', ...(useDefault ? [] : ['--workspace', workspace])])
    const transport = new StdioClientTransport({ command: configMcp.command, args: configMcp.args, cwd: path.resolve(pluginRoot, configMcp.cwd), env: { ...process.env, HOME: home, USERPROFILE: home }, stderr: 'pipe' })
    let errors = ''; transport.stderr.on('data', chunk => { errors += chunk })
    const client = new Client({ name: 'packaged-plugin-test', version: '1.0.0' })
    t.after(async () => {
      await client.close()
      await stopWorkspaceProcess({ root: workspace, runtimeRoot })
      await fs.rm(runtimeRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
      await fs.rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })
    })
    try { await client.connect(transport) } catch (error) { throw new Error(`${error.message}: ${errors}`) }
    const tool = (await client.listTools()).tools.find(item => item.name === 'oneskill_get_workspace')
    assert.equal(tool.title, 'oneskill')
    assert.equal(new URL(tool._meta.ui.resourceUri).pathname, `/workspace/${client.getServerVersion().version}.html`)
    assert.deepEqual(tool._meta['openai/ui'].entrypoints, [{ type: 'global' }])
    const data = await client.callTool({ name: tool.name, arguments: {} })
    assert.equal(data.isError, undefined)
    assert.equal(data.structuredContent.mcp[0].name, 'docs')
    assert.equal(data.structuredContent.stats.managedSkills, 1)
    assert.equal(data.structuredContent.skills.find(item => item.managed).name, 'private-skill')
    if (useDefault) assert.equal(data.structuredContent.source, '~/.oneskill/skills')
    assert.equal((await client.readResource({ uri: tool._meta.ui.resourceUri })).contents[0].text, '<main>Workspace</main>')
    assert.equal(errors, '')
  })
}
