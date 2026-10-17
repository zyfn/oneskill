#!/usr/bin/env node
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createWorkspace } from './core.mjs'
import { connectWorkspace } from './runtime/connect.mjs'
import { startWorkspaceServer } from './server.mjs'
import { operations, errorResult, WorkspaceError } from './contracts/operations.mjs'

const args = process.argv.slice(2)
function option(name) {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} requires a value.`)
  return args[index + 1]
}
function numberOption(name) {
  const value = option(name)
  if (value === undefined) return undefined
  if (!/^\d+$/.test(value)) throw new Error(`${name} requires a nonnegative integer.`)
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || (name === '--port' && parsed > 65535) || (name === '--idle-timeout' && parsed < 500)) throw new WorkspaceError('INVALID_INPUT', `${name} is outside its supported range.`)
  return parsed
}
const print = value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
function openBrowser(url) {
  const [command, commandArgs] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['rundll32.exe', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]]
  const child = spawn(command, commandArgs, { detached: true, stdio: 'ignore', windowsHide: true })
  child.on('error', error => process.stderr.write(`${error.message}\n`)); child.unref()
}
async function main() {
  const command = args[0] || 'help'
  if (command === 'help' || args.includes('--help')) {
    process.stdout.write(`oneskill — one local Workspace, shared by Web, CLI and Codex\n\nUsage:\n  oneskill web [--open]\n  oneskill mcp\n  oneskill workspace [--refresh]\n  oneskill skills | agents | plugins | mcp-inventory\n  oneskill call <operation> '<JSON input>'\n\nAll commands accept --workspace <directory>. Default: ~/.oneskill.\nOperations: ${Object.keys(operations).join(', ')}\n`)
    return
  }
  if (!['web','mcp','workspace','skills','agents','plugins','mcp-inventory','call','_runtime'].includes(command)) throw new WorkspaceError('UNKNOWN_OPERATION', `Unknown command: ${command}`, 404)
  const valueOptions = new Set(['--workspace','--runtime-dir','--port','--idle-timeout'])
  const flags = new Set(['--open','--refresh'])
  for (let index = 1; index < args.length; index++) {
    if (valueOptions.has(args[index])) { index++; continue }
    if (args[index].startsWith('--') && !flags.has(args[index])) throw new WorkspaceError('INVALID_INPUT', `Unknown option: ${args[index]}`)
  }
  const options = { root: option('--workspace'), runtimeRoot: option('--runtime-dir'), port: numberOption('--port'), idleTimeout: numberOption('--idle-timeout') }
  if (command === '_runtime') {
    const runtime = await startWorkspaceServer({ workspace: createWorkspace({ root: options.root }), ...options })
    for (const signal of ['SIGTERM','SIGINT']) process.once(signal, () => runtime.close().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }))
    return
  }
  if (command === 'web') {
    const { ensureWebBuild } = await import('./web-assets.mjs')
    ensureWebBuild()
    const client = await connectWorkspace(options)
    process.stdout.write(`oneskill is running at ${client.url}\n`)
    if (args.includes('--open')) openBrowser(client.url)
    return
  }
  const client = await connectWorkspace(options)
  if (command === 'mcp') {
    const { runMcp } = await import('./adapters/mcp.mjs')
    await runMcp(client); return
  }
  if (command === 'call') {
    const name = args[1]
    const input = JSON.parse(args[2] || '{}')
    if (operations[name]?.write && !input.requestId) input.requestId = randomUUID()
    print(await client.call(name, input)); return
  }
  const data = await client.call(args.includes('--refresh') ? 'refreshWorkspace' : 'getWorkspace')
  if (command === 'workspace') print(data)
  else if (['skills','agents','plugins','mcp-inventory'].includes(command)) print(data[command === 'mcp-inventory' ? 'mcp' : command])
  else throw new Error(`Unknown command: ${command}`)
}
main().catch(error => { process.stderr.write(`${JSON.stringify(errorResult(error))}\n`); process.exitCode = 1 })
