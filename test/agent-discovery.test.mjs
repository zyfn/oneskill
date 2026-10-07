import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { resolveAgentPlatform } from '../src/agent-catalog.mjs'
import { createDiscoveryContext, prepareDiscoveryContext, prepareApplicationContext, configuredSkillDirectory, commandCandidates, discoverAgent, runVersionCommand } from '../src/agent-discovery.mjs'

const presets = new Map(JSON.parse(await fs.readFile(new URL('../agents.catalog.json', import.meta.url), 'utf8')).map((entry) => [entry.name, entry]))
const preset = (name, overrides = {}, platform = process.platform) => ({ ...resolveAgentPlatform(presets.get(name), platform === 'linux' ? 'darwin' : platform), ...overrides })

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'oneskill-discovery-'))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const bin = path.join(root, 'bin')
  await fs.mkdir(bin)
  // File fixtures use extensionless POSIX command policy on every host. Windows
  // PATH/PATHEXT behavior is covered by explicit Windows contexts below.
  const context = createDiscoveryContext({ platform: 'linux', home: root, env: { PATH: '' }, standardBinDirs: [], applicationRoots: [], extensionRoots: [] })
  context.paths = path
  context.binDirs = [bin]
  context.runVersionCommand = async () => ({ stdout: 'fixture-cli 1.2.3', stderr: '' })
  const config = path.join(root, '.claude')
  async function executable(file) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, '#!/bin/sh\necho should-not-run\n', { mode: 0o755 }); return file }
  return { root, bin, context, config, executable }
}

test('an installed CLI without a configuration directory is detected by its version without creating configuration files', async (t) => {
  const f = await fixture(t)
  const target = await f.executable(path.join(f.root, 'versions/claude'))
  await fs.symlink(target, path.join(f.bin, 'claude'))
  const result = await discoverAgent(preset('claude'), path.join(f.config, 'skills'), f.config, f.context)
  assert.equal(result.installed, true)
  assert.equal(result.detected, true)
  assert.equal(result.configured, false)
  assert.equal(result.skillsDirectoryExists, false)
  assert.equal(result.detection.kind, 'executable')
  assert.equal(result.version, '1.2.3')
  assert.equal(result.runnable, true)
  assert.equal(result.detection.evidence[0].realPath, await fs.realpath(target))
  await assert.rejects(fs.stat(f.config), { code: 'ENOENT' })
})

test('configuration leftovers are evidence of configuration, not a program installation', async (t) => {
  const f = await fixture(t)
  await fs.mkdir(f.config)
  const result = await discoverAgent(preset('claude'), path.join(f.config, 'skills'), f.config, f.context)
  assert.equal(result.installed, false)
  assert.equal(result.detected, false)
  assert.equal(result.configured, true)
  assert.equal(result.status, 'not-detected')
  assert.equal(result.detection.kind, 'configuration')
})

test('version probes use the resolved command and find stderr versions even when stdout contains a notice', async (t) => {
  const f = await fixture(t)
  const executable = await f.executable(path.join(f.bin, 'claude'))
  let calls = 0
  f.context.runVersionCommand = async (file, args, options) => {
    calls += 1
    assert.equal(file, executable)
    assert.deepEqual(args, ['--version'])
    assert.equal(options.cwd, f.root)
    assert.equal(options.timeout, 5000)
    return { stdout: 'startup notice\n', stderr: '\u001b[32mClaude Code 2.1.267\u001b[0m\n' }
  }
  const scan = () => discoverAgent(preset('claude'), path.join(f.config, 'skills'), f.config, f.context)
  const [first, second] = await Promise.all([scan(), scan()])
  assert.equal(first.version, '2.1.267')
  assert.equal(second.runnable, true)
  assert.equal(first.configured, false)
  assert.equal(calls, 1)
})

test('a broken PATH command is retained as unavailable instead of masked by a fallback installation', async (t) => {
  const f = await fixture(t)
  const active = await f.executable(path.join(f.bin, 'claude'))
  await f.executable(path.join(f.root, '.local/bin/claude'))
  const calls = []
  f.context.runVersionCommand = async (file) => { calls.push(file); throw Object.assign(new Error('failed'), { signal: 'SIGKILL' }) }
  const result = await discoverAgent(preset('claude'), path.join(f.config, 'skills'), f.config, f.context)
  assert.deepEqual(calls, [active])
  assert.equal(result.detected, false)
  assert.equal(result.installed, false)
  assert.equal(result.runnable, false)
  assert.equal(result.version, null)
  assert.equal(result.status, 'unavailable')
  assert.equal(result.detection.evidence[0].probe.error.code, 'SIGKILL')
})

test('an empty or unrecognizable version response is not treated as a successful runtime probe', async (t) => {
  const f = await fixture(t)
  await f.executable(path.join(f.bin, 'claude'))
  for (const stdout of ['', 'interactive login is required']) {
    f.context.versionCache.clear()
    f.context.runVersionCommand = async () => ({ stdout, stderr: '' })
    const result = await discoverAgent(preset('claude'), path.join(f.config, 'skills'), f.config, f.context)
    assert.equal(result.detected, false)
    assert.equal(result.installed, false)
    assert.equal(result.runnable, false)
    assert.equal(result.detection.evidence[0].probe.error.code, 'INVALID_VERSION')
  }
})

test('Windows npm command scripts run through the system interpreter with AutoRun disabled', async (t) => {
  const f = await fixture(t)
  const executable = await f.executable(path.join(f.bin, 'claude.cmd'))
  const context = { ...f.context, platform: 'win32', paths: path, env: { PATH: f.bin, SystemRoot: 'C:\\Windows', PATHEXT: '.CMD' } }
  context.runVersionCommand = async (file, args, options) => {
    assert.equal(file, 'C:\\Windows\\System32\\cmd.exe')
    assert.deepEqual(args, ['/d', '/v:off', '/s', '/c', `""${executable}" --version"`])
    assert.equal(options.windowsVerbatimArguments, true)
    return { stdout: 'Claude Code 2.1.267', stderr: '' }
  }
  const result = await discoverAgent(preset('claude'), path.join(f.config, 'skills'), f.config, context)
  assert.equal(result.runnable, true)
  assert.equal(result.version, '2.1.267')
})

test('version probes limit concurrency and share a result for duplicate requests', async (t) => {
  const f = await fixture(t)
  let active = 0
  let maximum = 0
  let calls = 0
  f.context.runVersionCommand = async () => {
    calls += 1
    active += 1
    maximum = Math.max(maximum, active)
    await new Promise((resolve) => setTimeout(resolve, 10))
    active -= 1
    return { stdout: 'fixture 1.2.3' }
  }
  const entries = await Promise.all(Array.from({ length: 9 }, async (_, index) => ({ name: `fixture-${index}`, executable: await f.executable(path.join(f.bin, `fixture-${index}`)) })))
  const result = await Promise.all([...entries, entries[0]].map((entry) => discoverAgent(entry, path.join(f.config, 'skills'), f.config, f.context)))
  assert.equal(result.every((agent) => agent.runnable), true)
  assert.equal(calls, 9)
  assert.equal(maximum, 4)
})

test('real version execution captures output, exit failures, and bounded output', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(t)
  const executable = path.join(f.bin, 'claude')
  f.context.runVersionCommand = runVersionCommand
  const scan = async (code) => {
    await fs.writeFile(executable, `#!${process.execPath}\n${code}\n`, { mode: 0o755 })
    f.context.versionCache.clear()
    return discoverAgent(preset('claude'), path.join(f.config, 'skills'), f.config, f.context)
  }
  const success = await scan("if(process.argv[2]!=='--version')process.exit(9); console.log('fixture-cli 3.4.5')")
  assert.equal(success.version, '3.4.5')
  assert.equal(success.configured, false)
  const failed = await scan("console.error('dependency missing');process.exit(17)")
  assert.equal(failed.detected, false)
  assert.equal(failed.runnable, false)
  assert.equal(failed.detection.evidence[0].probe.error.code, '17')
  const misleading = await scan("console.log('fixture-cli 3.4.5');process.exit(17)")
  assert.equal(misleading.detected, false)
  assert.equal(misleading.version, null)
  assert.equal(misleading.status, 'unavailable')
  const oversized = await scan("process.stdout.write('x'.repeat(1000000))")
  assert.equal(oversized.detected, false)
  assert.equal(oversized.detection.evidence[0].probe.error.code, 'OUTPUT_LIMIT')
})

test('a timed-out version probe kills descendants and finishes without configuration changes', { skip: process.platform === 'win32' }, async (t) => {
  const f = await fixture(t)
  const childPidFile = path.join(f.root, 'child.pid')
  const executable = path.join(f.bin, 'claude')
  const childSource = 'setInterval(()=>{},1000)'
  await fs.writeFile(executable, `#!${process.execPath}\nconst child=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(childSource)}],{stdio:'inherit'});require('node:fs').writeFileSync(${JSON.stringify(childPidFile)},String(child.pid));setInterval(()=>{},1000)\n`, { mode: 0o755 })
  f.context.runVersionCommand = runVersionCommand
  // Allow process startup under concurrent test load before exercising cleanup.
  f.context.versionTimeoutMs = 4000
  const start = Date.now()
  const result = await discoverAgent(preset('claude'), path.join(f.config, 'skills'), f.config, f.context)
  assert.equal(result.detection.evidence[0].probe.error.code, 'ETIMEDOUT')
  assert.equal(result.detected, false)
  assert.ok(Date.now() - start < 8000)
  const pid = Number(await fs.readFile(childPidFile, 'utf8'))
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try { process.kill(pid, 0) } catch (error) { if (error.code === 'ESRCH') break; throw error }
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
  await assert.rejects(fs.stat(f.config), { code: 'ENOENT' })
})

test('broken symlinks, ordinary files, and directories named after a CLI are not executable evidence', async (t) => {
  const f = await fixture(t)
  await fs.symlink(path.join(f.root, 'missing'), path.join(f.bin, 'claude'))
  let result = await discoverAgent(preset('claude'), path.join(f.config, 'skills'), f.config, f.context)
  assert.equal(result.detected, false)
  await fs.unlink(path.join(f.bin, 'claude'))
  await fs.mkdir(path.join(f.bin, 'claude'))
  result = await discoverAgent(preset('claude'), path.join(f.config, 'skills'), f.config, f.context)
  assert.equal(result.detected, false)
  await fs.rm(path.join(f.bin, 'claude'), { recursive: true })
  await fs.writeFile(path.join(f.bin, 'claude'), 'not executable', { mode: 0o644 })
  if (process.platform !== 'win32') {
    result = await discoverAgent(preset('claude'), path.join(f.config, 'skills'), f.config, f.context)
    assert.equal(result.installed, false)
  }
  await fs.writeFile(f.config, 'a file is not a configuration directory')
  result = await discoverAgent({ name: 'custom' }, path.join(f.config, 'skills'), f.config, f.context)
  assert.equal(result.configured, false)
})

test('documented native installation is found when not on PATH; sample workspaces can disable host probes', async (t) => {
  const f = await fixture(t)
  await f.executable(path.join(f.root, '.local/bin/claude'))
  const result = await discoverAgent(preset('claude'), path.join(f.config, 'skills'), f.config, f.context)
  assert.equal(result.installed, true)
  assert.equal(result.detection.evidence[0].source, 'native-location')
  const isolated = await discoverAgent(preset('claude', { probeInstallation: false }), path.join(f.config, 'skills'), f.config, f.context)
  assert.equal(isolated.detected, false)
})

test('ambiguous executable names require the actual npm package identity', async (t) => {
  const f = await fixture(t)
  const dir = path.join(f.root, 'packages/tool')
  const executable = await f.executable(path.join(dir, 'cli.js'))
  await fs.symlink(executable, path.join(f.bin, 'dsh'))
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: 'unrelated-distributed-shell' }))
  assert.equal((await discoverAgent(preset('deepseek'), path.join(f.root, '.dsh/skills'), path.join(f.root, '.dsh'), f.context)).installed, false)
  await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', bin: { dsh: 'cli.js' } }))
  assert.equal((await discoverAgent(preset('deepseek'), path.join(f.root, '.dsh/skills'), path.join(f.root, '.dsh'), f.context)).installed, true)
})

test('Kimi native installations are independent of npm and the configuration root', async (t) => {
  const f = await fixture(t)
  const installation = path.join(f.root, 'kimi-install')
  f.context.env.KIMI_INSTALL_DIR = installation
  f.context.env.KIMI_CODE_HOME = path.join(f.root, 'kimi-config')
  await f.executable(path.join(installation, 'bin/kimi'))
  const target = configuredSkillDirectory(preset('kimi-code', { dir: '~/.kimi-code/skills' }), undefined, f.context)
  assert.equal(target.path, path.join(f.root, 'kimi-config/skills'))
  const result = await discoverAgent(preset('kimi-code'), target.path, path.dirname(target.path), f.context)
  assert.equal(result.installed, true)
  assert.equal(result.configured, false)
  assert.equal(result.detection.evidence[0].source, 'native-location')
})

test('native configuration overrides preserve their documented root semantics and registry precedence', () => {
  const home = path.resolve('/tmp/oneskill-home')
  const context = createDiscoveryContext({ home, env: { CLAUDE_CONFIG_DIR: '/tmp/claude-profile', GEMINI_CLI_HOME: '/tmp/gemini-home', COPILOT_HOME: '/tmp/copilot-profile', QWEN_HOME: '/tmp/qwen-profile', DSH_HOME: '/tmp/dsh-profile' } })
  assert.deepEqual(configuredSkillDirectory(preset('claude', { dir: '~/.claude/skills' }), undefined, context), { path: path.resolve('/tmp/claude-profile/skills'), source: 'CLAUDE_CONFIG_DIR' })
  assert.equal(configuredSkillDirectory(preset('gemini', { dir: '~/.gemini/skills' }), undefined, context).path, path.resolve('/tmp/gemini-home/.gemini/skills'))
  assert.equal(configuredSkillDirectory(preset('github-copilot', { dir: '~/.copilot/skills' }), undefined, context).path, path.resolve('/tmp/copilot-profile/skills'))
  assert.equal(configuredSkillDirectory(preset('qwen-code', { dir: '~/.qwen/skills' }), undefined, context).path, path.resolve('/tmp/qwen-profile/skills'))
  assert.equal(configuredSkillDirectory(preset('deepseek', { dir: '~/.dsh/skills' }), undefined, context).path, path.resolve('/tmp/dsh-profile/skills'))
  assert.equal(configuredSkillDirectory(preset('claude', { dir: '~/.claude/skills' }), '/tmp/manual/skills', context).source, 'registry')
  assert.equal(configuredSkillDirectory(preset('claude', { dir: '/tmp/custom-catalog/skills' }), undefined, context).path, path.resolve('/tmp/custom-catalog/skills'))
})

test('Windows PATH and PATHEXT discovery skips implicit current-directory candidates', () => {
  const context = createDiscoveryContext({ platform: 'win32', home: 'C:\\Users\\demo', env: { Path: 'C:\\Tools;"C:\\Program Files\\nodejs";;relative', PATHEXT: '.EXE;.CMD' }, standardBinDirs: [], applicationRoots: [], extensionRoots: [] })
  assert.deepEqual(commandCandidates('claude', context), ['C:\\Tools\\claude.exe', 'C:\\Tools\\claude.cmd', 'C:\\Program Files\\nodejs\\claude.exe', 'C:\\Program Files\\nodejs\\claude.cmd'])
})

test('Windows discovery merges process, user, and machine PATH once with case-insensitive expansion', async () => {
  const context = createDiscoveryContext({
    platform: 'win32', home: 'C:\\Users\\demo',
    env: { pAtH: 'C:\\Runtime;C:\\Shared;relative;C:relative;\\root-relative', systemroot: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\demo\\AppData\\Local', pathext: '.EXE' },
    standardBinDirs: ['C:\\Fallback'],
  })
  let calls = 0
  const runner = async (executable, args, options) => {
    calls += 1
    assert.equal(executable, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    assert.ok(args.includes('-NoProfile'))
    assert.ok(args.includes('-NonInteractive'))
    assert.ok(args.at(-1).includes('DoNotExpandEnvironmentNames'))
    assert.ok(args.at(-1).includes('CurrentControlSet'))
    assert.equal(args.at(-1).includes('C:\\Users\\demo'), false)
    assert.ok(options.timeout > 0 && options.timeout <= 3000)
    assert.equal(options.windowsHide, true)
    assert.equal(options.encoding, 'utf8')
    assert.ok(options.maxBuffer <= 131072)
    return { stdout: '\uFEFF' + JSON.stringify({
      user: 'c:\\SHARED\\;"%localappdata%\\Programs\\claude";D:\\npm-global;%MISSING%\\bin',
      machine: 'd:\\NPM-GLOBAL;C:/Machine;C:\\Fallback',
    }) }
  }
  await Promise.all([prepareDiscoveryContext(context, { runCommand: runner }), prepareDiscoveryContext(context, { runCommand: runner })])
  await prepareDiscoveryContext(context, { runCommand: runner })
  assert.equal(calls, 1)
  assert.deepEqual(context.binDirs, ['C:\\Runtime', 'C:\\Shared', 'C:\\Users\\demo\\AppData\\Local\\Programs\\claude', 'D:\\npm-global', 'C:\\Machine', 'C:\\Fallback'])
  assert.equal(commandCandidates('claude', context)[0], 'C:\\Runtime\\claude.exe')
  assert.ok(commandCandidates('claude', context).includes('C:\\Users\\demo\\AppData\\Local\\Programs\\claude\\claude.exe'))
})

test('Windows App Execution Alias directories are excluded from inherited, registry, and fallback paths', async () => {
  const context = createDiscoveryContext({
    platform: 'win32', home: 'C:\\Users\\demo',
    env: { PATH: 'C:\\Users\\demo\\AppData\\Local\\Microsoft\\WindowsApps;C:\\Tools', SystemRoot: 'C:\\Windows' },
    standardBinDirs: ['C:\\Users\\demo\\AppData\\Local\\MICROSOFT\\WindowsApps\\'],
  })
  await prepareDiscoveryContext(context, { runCommand: async () => ({ stdout: JSON.stringify({ user: 'C:/Other/Microsoft/WindowsApps;D:\\RealBins', machine: '' }) }) })
  assert.deepEqual(context.binDirs, ['C:\\Tools', 'D:\\RealBins'])
})

test('Windows registry lookup failures and malformed output preserve the inherited search path', async () => {
  for (const response of [null, 'not JSON', JSON.stringify({ user: 'C:\\' + 'x'.repeat(32768), machine: [] }), 'x'.repeat(131073)]) {
    const context = createDiscoveryContext({ platform: 'win32', home: 'C:\\Users\\demo', env: { PATH: 'D:\\Existing', SystemRoot: 'C:\\Windows' }, standardBinDirs: ['C:\\Fallback'] })
    let calls = 0
    const runner = async () => { calls += 1; if (response === null) throw Object.assign(new Error('timed out'), { killed: true }); return { stdout: response } }
    await prepareDiscoveryContext(context, { runCommand: runner })
    await prepareDiscoveryContext(context, { runCommand: runner })
    assert.equal(calls, 1)
    assert.deepEqual(context.binDirs, ['D:\\Existing', 'C:\\Fallback'])
  }
})

test('registry probes never resolve PowerShell from PATH and require an absolute system root', async () => {
  let calls = 0
  const runner = async () => { calls += 1; return { stdout: '{}' } }
  for (const systemRoot of [undefined, 'relative', '\\Windows', 'C:Windows']) {
    const context = createDiscoveryContext({ platform: 'win32', home: 'C:\\Users\\demo', env: { PATH: 'D:\\Untrusted', SystemRoot: systemRoot }, standardBinDirs: [] })
    await prepareDiscoveryContext(context, { runCommand: runner })
    assert.deepEqual(context.binDirs, ['D:\\Untrusted'])
  }
  const context = createDiscoveryContext({ platform: 'linux', home: '/tmp/home', env: { PATH: '/usr/bin' }, standardBinDirs: [] })
  await prepareDiscoveryContext(context, { runCommand: runner })
  assert.equal(calls, 0)
  assert.deepEqual(context.binDirs, ['/usr/bin'])
})

test('Windows fallback directories include npm and Node without searching relative prefixes', () => {
  const context = createDiscoveryContext({ platform: 'win32', home: 'C:\\Users\\demo', env: { AppData: 'C:\\Users\\demo\\AppData\\Roaming', programfiles: 'C:\\Program Files', NPM_CONFIG_PREFIX: 'relative-prefix' } })
  assert.ok(context.binDirs.includes('C:\\Users\\demo\\AppData\\Roaming\\npm'))
  assert.ok(context.binDirs.includes('C:\\Program Files\\nodejs'))
  assert.equal(context.binDirs.some((directory) => directory.includes('relative-prefix')), false)
})

test('Windows Claude and Codex standalone installations are found outside PATH', async (t) => {
  const f = await fixture(t)
  const localData = path.join(f.root, 'LocalAppData')
  // Use host path operations to exercise Windows candidate policy with real fixture files.
  const context = { ...f.context, platform: 'win32', paths: path, env: { LocalAppData: localData, UserProfile: f.root } }
  for (const [name, candidate] of [['claude', path.join(f.root, '.local/bin/claude.exe')], ['codex', path.join(localData, 'Programs/OpenAI/Codex/bin/codex.exe')]]) {
    const executable = await f.executable(candidate)
    const root = path.join(f.root, '.' + name)
    const result = await discoverAgent(preset(name, {}, 'win32'), path.join(root, 'skills'), root, context)
    assert.equal(result.installed, true)
    assert.equal(result.configured, false)
    assert.equal(result.detection.evidence[0].path, executable)
    assert.equal(result.detection.evidence[0].source, 'native-location')
  }
})

test('Windows application registration requires an exact identity and an existing executable', async (t) => {
  const f = await fixture(t)
  const executable = await f.executable(path.join(f.root, 'Programs/Office/office.exe'))
  const context = { ...f.context, platform: 'win32', paths: path, registeredApplications: [{ name: 'Office', icon: `"${executable}",0` }] }
  const entry = { name: 'desktop-agent', discovery: { applications: ['Office'] } }
  const result = await discoverAgent(entry, null, null, context)
  assert.equal(result.detected, true)
  assert.equal(result.runnable, null)
  assert.equal(result.detection.evidence[0].source, 'application-registration')
  for (const registration of [
    { name: 'Office Copy', icon: executable },
    { name: 'Office', icon: 'relative/office.exe' },
    { name: 'Office', icon: path.join(f.root, 'missing.exe') },
    { name: 'Office', icon: `"${executable}" && echo fake` },
  ]) {
    assert.equal((await discoverAgent(entry, null, null, { ...context, registeredApplications: [registration] })).detected, false)
  }
})

test('Windows application registry metadata is bounded, shared by concurrent requests, and never launches apps', async () => {
  const context = createDiscoveryContext({ platform: 'win32', home: 'C:\\Users\\demo', env: { SystemRoot: 'C:\\Windows' }, standardBinDirs: [] })
  let calls = 0
  const runner = async (file, args, options) => {
    calls += 1
    assert.equal(file, 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe')
    assert.ok(args.includes('-NoProfile'))
    assert.match(args.at(-1), /DisplayName/)
    assert.equal(options.timeout, 2500)
    await new Promise(resolve => setTimeout(resolve, 10))
    return { stdout: JSON.stringify([{ name: 'Office', icon: 'C:\\Office\\office.exe' }, { name: 'invalid' }]) }
  }
  await Promise.all([prepareApplicationContext(context, { runCommand: runner }), prepareApplicationContext(context, { runCommand: runner })])
  assert.equal(calls, 1)
  assert.equal(context.registeredApplications.length, 1)
  const unavailable = createDiscoveryContext({ platform: 'win32', home: 'C:\\Users\\demo', env: {}, standardBinDirs: [] })
  await prepareApplicationContext(unavailable, { runCommand: runner })
  assert.deepEqual(unavailable.registeredApplications, [])
  assert.equal(calls, 1)
})

test('Windows npm shims must reference the declared package executable, not a leftover package', async (t) => {
  const f = await fixture(t)
  const context = { ...f.context, platform: 'win32', paths: path, env: { ...f.context.env, PATHEXT: '.CMD', SystemRoot: 'C:\\Windows' } }
  const directory = path.join(f.bin, 'node_modules/@deepseek-ai/dsh')
  await f.executable(path.join(directory, 'lib/bin.js'))
  await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', bin: { dsh: 'lib/bin.js' } }))
  const shim = path.join(f.bin, 'dsh.cmd')
  await fs.writeFile(shim, '@ECHO off\n"%dp0%\\node_modules\\other-shell\\cli.js" %*\n')
  const scan = () => discoverAgent(preset('deepseek'), path.join(f.root, '.dsh/skills'), path.join(f.root, '.dsh'), context)
  assert.equal((await scan()).installed, false)
  await fs.writeFile(shim, '@ECHO off\n"%dp0%\\node_modules\\@deepseek-ai\\dsh\\lib\\bin.js" %*\n')
  assert.equal((await scan()).installed, true)
  await fs.unlink(path.join(directory, 'lib/bin.js'))
  assert.equal((await scan()).installed, false)
})

test('editor extensions require publisher.name and ignore obsolete uninstall remnants', async (t) => {
  const f = await fixture(t)
  const extensions = path.join(f.root, 'extensions')
  const name = 'saoudrizwan.claude-dev-1.0.0'
  const directory = path.join(extensions, name)
  await fs.mkdir(directory, { recursive: true })
  f.context.extensionRoots = [extensions]
  const extension = { name: 'cline-editor', discovery: { extensions: ['saoudrizwan.claude-dev'] } }
  const scan = () => discoverAgent(extension, path.join(f.root, '.cline/skills'), path.join(f.root, '.cline'), f.context)
  await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ publisher: 'someone-else', name: 'claude-dev' }))
  assert.equal((await scan()).installed, false)
  await fs.writeFile(path.join(directory, 'package.json'), JSON.stringify({ publisher: 'saoudrizwan', name: 'claude-dev' }))
  assert.equal((await scan()).detection.kind, 'extension')
  await fs.writeFile(path.join(extensions, '.obsolete'), JSON.stringify({ [name]: true }))
  assert.equal((await scan()).installed, false)
})

test('macOS application evidence requires a valid bundle manifest and executable', { skip: process.platform !== 'darwin' }, async (t) => {
  const f = await fixture(t)
  f.context.platform = 'darwin'
  const applications = path.join(f.root, 'Applications')
  const app = path.join(applications, 'Cursor.app')
  await fs.mkdir(path.join(app, 'Contents'), { recursive: true })
  f.context.applicationRoots = [applications]
  const desktop = { name: 'cursor-desktop', discovery: { applications: ['Cursor.app'] } }
  const scan = () => { f.context.executableCache.clear(); return discoverAgent(desktop, path.join(f.root, '.cursor/skills'), path.join(f.root, '.cursor'), f.context) }
  assert.equal((await scan()).installed, false)
  await fs.writeFile(path.join(app, 'Contents/Info.plist'), '<?xml version="1.0" encoding="UTF-8"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>example.oneskill.fixture</string><key>CFBundleExecutable</key><string>Cursor</string></dict></plist>')
  assert.equal((await scan()).installed, false)
  await f.executable(path.join(app, 'Contents/MacOS/Cursor'))
  const result = await scan()
  assert.equal(result.installed, true)
  assert.equal(result.detection.kind, 'application')
  assert.equal(result.detection.evidence[0].identifier, 'example.oneskill.fixture')
  const cli = { name: 'cursor-cli', discovery: { commands: ['cursor-agent'], applications: ['Cursor.app'] } }
  assert.equal((await discoverAgent(cli, null, null, f.context)).detected, false)
  await f.executable(path.join(f.bin, 'cursor-agent'))
  f.context.executableCache.clear()
  f.context.runVersionCommand = async () => { throw Object.assign(new Error('failed'), { signal: 'SIGKILL' }) }
  const unavailable = await discoverAgent(cli, null, null, f.context)
  assert.equal(unavailable.detected, false)
  assert.equal(unavailable.status, 'unavailable')
  assert.equal(unavailable.detection.kind, 'executable')
})

test('Qoder desktop and CLI presets are separate and a failed CLI does not hide the installed desktop', { skip: process.platform !== 'darwin' }, async t => {
  const f = await fixture(t)
  f.context.platform = 'darwin'
  const applications = path.join(f.root, 'Applications')
  const app = path.join(applications, 'Qoder.app')
  await fs.mkdir(path.join(app, 'Contents'), { recursive: true })
  f.context.applicationRoots = [applications]
  await fs.writeFile(path.join(app, 'Contents/Info.plist'), '<?xml version="1.0"?><plist version="1.0"><dict><key>CFBundleIdentifier</key><string>example.qoder</string><key>CFBundleExecutable</key><string>Qoder</string></dict></plist>')
  await f.executable(path.join(app, 'Contents/MacOS/Qoder'))
  await f.executable(path.join(f.bin, 'qodercli'))
  const desktop = preset('qoder')
  const cli = preset('qoder-cli')
  assert.equal(desktop.discovery.commands, undefined)
  assert.equal(cli.discovery.applications, undefined)
  assert.equal((await discoverAgent(cli, null, null, f.context)).runnable, true)
  const installed = await discoverAgent(desktop, null, null, f.context)
  assert.equal(installed.detected, true)
  assert.equal(installed.runnable, null)
  f.context.versionCache.clear()
  f.context.runVersionCommand = async () => { throw Object.assign(new Error('failed'), { signal: 'SIGKILL' }) }
  assert.equal((await discoverAgent(cli, null, null, f.context)).detected, false)
  assert.equal((await discoverAgent(desktop, null, null, f.context)).detected, true)
})
