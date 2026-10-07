#!/usr/bin/env node

import { detectCapabilities, detectPlugins, detectSkills, loadAgents, publicAgent, setSkillLink, workspaceData } from './core.mjs'
import { startServer } from './server.mjs'

const args = process.argv.slice(2)
const command = args[0] || 'help'
const json = args.includes('--json')

function print(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
}

function help() {
  process.stdout.write(`oneskill — local Agent capability workspace

Usage:
  npm start                         Start and open the Web workspace
  npm run cli -- detect --json     Scan configured capability folders
  npm run cli -- skills --json     List canonical skills and Agent links
  npm run cli -- plugins --json    List detected Agent plugin manifests
  npm run cli -- mcp --json        List detected MCP servers
  npm run cli -- hooks --json      List detected hooks
  npm run cli -- agents --json     List Agents and installation/configuration evidence
  npm run cli -- link <agent> <skill>
  npm run cli -- unlink <agent> <skill>
  npm run cli -- validate

The CLI and Web UI share installation discovery and bounded capability scans.
CLI discovery executes --version; JSON records version, runnable, and errors.
Configuration directories locate resources and do not establish installation.
`)
}

function table(items, columns) {
  if (!items.length) {
    process.stdout.write('No items detected.\n')
    return
  }
  const widths = columns.map(({ key, label }) => Math.max(label.length, ...items.map((item) => String(item[key] ?? '').length)))
  process.stdout.write(`${columns.map(({ label }, index) => label.padEnd(widths[index])).join('  ')}\n`)
  process.stdout.write(`${widths.map((width) => '─'.repeat(width)).join('  ')}\n`)
  for (const item of items) {
    process.stdout.write(`${columns.map(({ key }, index) => String(item[key] ?? '').padEnd(widths[index])).join('  ')}\n`)
  }
}

async function main() {
  if (command === 'serve') {
    await startServer({ open: args.includes('--open') })
    return
  }
  if (command === 'detect' || command === 'scan' || command === 'overview') {
    const data = await workspaceData()
    if (json) print(data)
    else print({ checkedAt: data.checkedAt, source: data.source, stats: data.stats, scan: data.scan })
    return
  }
  if (command === 'skills' || command === 'list') {
    const data = await detectSkills()
    if (json) print(data.items)
    else table(data.items.map((item) => ({ name: item.name, path: item.path, linked: `${item.linked}/${item.agentCount}`, status: item.status })), [
      { key: 'name', label: 'Skill' }, { key: 'linked', label: 'Links' }, { key: 'status', label: 'Status' }, { key: 'path', label: 'Source' },
    ])
    return
  }
  if (command === 'plugins') {
    const data = await detectPlugins()
    if (json) print(data.items)
    else table(data.items, [
      { key: 'name', label: 'Plugin' }, { key: 'agent', label: 'Agent' }, { key: 'version', label: 'Version' }, { key: 'source', label: 'Source' },
    ])
    return
  }
  if (command === 'mcp' || command === 'hooks') {
    const data = await detectCapabilities(command === 'mcp' ? 'mcp' : 'hook')
    if (json) print(data.items)
    else table(data.items, [
      { key: 'name', label: command === 'mcp' ? 'MCP server' : 'Hook' }, { key: 'agent', label: 'Agent' }, { key: 'path', label: 'Config' },
    ])
    return
  }
  if (command === 'agents') {
    const agents = await loadAgents()
    const safe = agents.map(publicAgent)
    if (json) print(safe)
    else table(safe, [
      { key: 'name', label: 'Agent' }, { key: 'status', label: 'Status' }, { key: 'dir', label: 'Skill directory' },
    ])
    return
  }
  if (command === 'link' || command === 'unlink') {
    const [agent, skill] = args.slice(1).filter((argument) => !argument.startsWith('--'))
    if (!agent || !skill) throw new Error(`Usage: oneskill ${command} <agent> <skill>`)
    print(await setSkillLink(agent, skill, command === 'link'))
    return
  }
  if (command === 'validate') {
    const data = await workspaceData()
    const broken = data.skills.flatMap((skill) => skill.bindings
      .filter((binding) => ['broken', 'conflict'].includes(binding.state))
      .map((binding) => ({ skill: skill.relative, agent: binding.agent, state: binding.state, destination: binding.destination })))
    print({ ok: broken.length === 0, broken, scanTruncated: Object.values(data.scan).some((scan) => scan.truncated) })
    if (broken.length) process.exitCode = 1
    return
  }
  help()
}

main().catch((error) => {
  process.stderr.write(`oneskill: ${error instanceof Error ? error.message : String(error)}\n`)
  process.exitCode = 1
})
