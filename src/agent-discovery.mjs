import fs from 'node:fs/promises'
import { constants } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'

const runFile = promisify(execFile)

// Vendor definitions are supplied by the catalog loader on each scan.
// The engine has no catalog I/O or Agent-name branches.

function expand(value, home, paths = path, env = process.env) {
  value = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^{}]*))?\}/g, (_match, name, fallback) => {
    const replacement = environmentValue(env, name) || (paths === path.win32 && name.toUpperCase() === 'USERPROFILE' ? home : undefined)
    if (!replacement && fallback === undefined) throw new Error(`Path requires environment variable ${name}`)
    return replacement || fallback
  })
  if (value === '~') return home
  if (value.startsWith('~/') || value.startsWith('~\\')) return paths.join(home, value.slice(2))
  return paths.resolve(value)
}

function environmentValue(env, name) {
  const key = Object.keys(env).find((key) => key.toLowerCase() === name.toLowerCase())
  return key === undefined ? undefined : env[key]
}

function windowsPathDirectories(values, env) {
  const seen = new Set()
  const directories = []
  for (const raw of values.filter((value) => typeof value === 'string')) {
    const value = raw.replace(/%([\w]+)%/g, (match, name) => environmentValue(env, name) ?? match)
    for (const segment of value.split(';')) {
      const expanded = segment.trim().replace(/^"(.*)"$/, '$1')
      // Root-relative and drive-relative paths depend on the working directory.
      if (!/^(?:[a-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/i.test(expanded) || /%[\w]+%/.test(expanded) || expanded.includes('\0')) continue
      const directory = path.win32.normalize(expanded)
      const identity = directory.replace(/[\\/]+$/, '').toLowerCase()
      if (/(?:^|\\)microsoft\\windowsapps(?:\\|$)/i.test(directory) || seen.has(identity)) continue
      seen.add(identity)
      directories.push(directory)
    }
  }
  return directories
}

// Fixed read-only registry access: no environment values are interpolated into
// executable PowerShell source, and no shell profiles or Agent programs run.
const WINDOWS_REGISTRY_PATH_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
function Read-RegistryPath($base, $subkey) {
  $key = $null
  try {
    $key = $base.OpenSubKey($subkey, $false)
    if ($null -eq $key) { return '' }
    $value = $key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
    if ($value -is [string] -and $value.Length -le 32768) { return $value }
    return ''
  } catch { return '' } finally { if ($null -ne $key) { $key.Dispose() } }
}
[ordered]@{
  user = Read-RegistryPath ([Microsoft.Win32.Registry]::CurrentUser) 'Environment'
  machine = Read-RegistryPath ([Microsoft.Win32.Registry]::LocalMachine) 'SYSTEM\CurrentControlSet\Control\Session Manager\Environment'
} | ConvertTo-Json -Compress
`

export async function prepareDiscoveryContext(context, { runCommand = runFile } = {}) {
  if (context.platform !== 'win32') return context
  if (!context.pathPreparation) context.pathPreparation = (async () => {
    const systemRoot = environmentValue(context.env, 'SystemRoot') || environmentValue(context.env, 'WINDIR')
    if (typeof systemRoot !== 'string' || !/^[a-z]:[\\/]/i.test(systemRoot) || systemRoot.includes('\0')) return
    const powershell = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
    try {
      const { stdout } = await runCommand(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_REGISTRY_PATH_SCRIPT], { timeout: 2500, maxBuffer: 131072, encoding: 'utf8', windowsHide: true })
      if (typeof stdout !== 'string' || stdout.length > 131072) return
      const result = JSON.parse(stdout.replace(/^\uFEFF/, ''))
      const registryPaths = ['user', 'machine'].map((key) => typeof result?.[key] === 'string' && result[key].length <= 32768 ? result[key] : '')
      context.binDirs = windowsPathDirectories([...context.inheritedBinDirs, ...registryPaths, ...context.fallbackBinDirs], context.env)
    } catch { /* Inherited PATH remains usable when registry access is unavailable. */ }
  })()
  await context.pathPreparation
  return context
}

export function createDiscoveryContext(options = {}) {
  const platform = options.platform || process.platform
  const home = options.home || os.homedir()
  const env = options.env || process.env
  const paths = platform === 'win32' ? path.win32 : path.posix
  const getEnv = (name) => platform === 'win32' ? environmentValue(env, name) : env[name]
  const standardBinDirs = platform === 'win32'
    ? [getEnv('APPDATA') && paths.join(getEnv('APPDATA'), 'npm'), paths.join(home, '.local', 'bin'), getEnv('ProgramFiles') && paths.join(getEnv('ProgramFiles'), 'nodejs')]
    : [paths.join(home, '.local/bin'), paths.join(home, '.npm-global/bin'), '/usr/local/bin', '/usr/bin', ...(platform === 'darwin' ? ['/opt/homebrew/bin'] : [])]
  const npmPrefix = getEnv('npm_config_prefix') || getEnv('NPM_CONFIG_PREFIX')
  if (npmPrefix && paths.isAbsolute(npmPrefix)) standardBinDirs.push(platform === 'win32' ? npmPrefix : paths.join(npmPrefix, 'bin'))
  const pathValue = getEnv('PATH') || ''
  const inherited = platform === 'win32' ? windowsPathDirectories([pathValue], env) : pathValue.split(':').map((part) => part.replace(/^"|"$/g, '')).filter((part) => paths.isAbsolute(part))
  const fallback = options.standardBinDirs ?? standardBinDirs
  const context = {
    platform, home, env, paths,
    inheritedBinDirs: inherited,
    fallbackBinDirs: fallback,
    binDirs: platform === 'win32' ? windowsPathDirectories([...inherited, ...fallback], env) : [...new Set([...inherited, ...fallback].filter(Boolean))],
    applicationRoots: options.applicationRoots ?? (platform === 'darwin' ? ['/Applications', paths.join(home, 'Applications')] : []),
    extensionRoots: options.extensionRoots,
    registeredApplications: options.registeredApplications,
    applicationPreparation: null,
    executableCache: new Map(),
    versionCache: new Map(),
    versionTimeoutMs: options.versionTimeoutMs ?? 5000,
    runVersionCommand: options.runVersionCommand || runVersionCommand,
    probeActive: 0,
    probeWaiters: [],
  }
  return context
}

export function configuredSkillDirectory(entry, override, context = createDiscoveryContext()) {
  const definition = entry
  if (override) return { path: expand(override, context.home, context.paths, context.env), source: 'registry' }
  const config = definition.configuration
  const declared = entry.dir
  if (!declared) return { path: null, source: 'not-configured' }
  const value = config?.env && environmentValue(context.env, config.env)?.trim()
  if (value && config.dir) {
    const relative = context.paths.relative(expand(config.dir, context.home, context.paths, context.env), expand(declared, context.home, context.paths, context.env))
    if (relative && relative !== '..' && !relative.startsWith(`..${context.paths.sep}`) && !context.paths.isAbsolute(relative)) {
      const root = context.paths.join(expand(value, context.home, context.paths, context.env), config.suffix || '')
      return { path: context.paths.join(root, relative), source: config.env }
    }
  }
  return { path: expand(declared, context.home, context.paths, context.env), source: 'catalog' }
}

export function configuredAgentLocations(entry, override, context = createDiscoveryContext()) {
  const definition = entry
  const target = configuredSkillDirectory(entry, override, context)
  const config = definition.configuration
  const value = config?.env && environmentValue(context.env, config.env)?.trim()
  // Legacy custom catalogs can still specify only a Skills directory. Official
  // presets declare a configuration root independently of the link target.
  const configRoot = config?.dir
    ? value ? context.paths.join(expand(value, context.home, context.paths, context.env), config.suffix || '') : expand(config.dir, context.home, context.paths, context.env)
    : target.path && context.paths.basename(target.path) === 'skills' ? context.paths.dirname(target.path) : target.path
  const configSource = value ? config.env : config?.dir ? 'catalog' : 'legacy-custom'
  const roots = target.path ? [{ id: 'target', path: target.path, target: true, ignorePrefix: override ? '' : definition.resources?.targetIgnorePrefix || '' }] : []
  for (const root of definition.resources?.skills || []) {
    if (root.base === 'config' && !configRoot) continue
    const directory = root.base === 'config' ? context.paths.join(configRoot, root.path) : expand(root.path, context.home, context.paths, context.env)
    if (!roots.some((entry) => entry.path === directory)) roots.push({ id: root.id, path: directory, target: false, ignorePrefix: root.ignorePrefix ?? `@${root.id}/` })
  }
  // Resolve declared resource paths before the scanners touch the filesystem.
  // Optional file environment overrides share this path handling across vendors.
  const resources = definition.resources && {
    ...definition.resources,
    plugins: definition.resources.plugins?.map((location) => expand(location.startsWith('~') || location.includes('${') || context.paths.isAbsolute(location) ? location : context.paths.join(configRoot, location), context.home, context.paths, context.env)),
    mcp: definition.resources.mcp && {
      files: definition.resources.mcp.files.map((file) => {
        const override = file.env && environmentValue(context.env, file.env)?.trim()
        return override || file.path.includes('${') || file.path.startsWith('~')
          ? { ...file, path: expand(override || file.path, context.home, context.paths, context.env), recursive: false }
          : file
      }),
    },
  }
  return { target, configRoot, configSource, roots, definition: resources ? { ...definition, resources } : definition }
}

export async function directoryExists(directory) {
  try { return (await fs.stat(directory)).isDirectory() } catch { return false }
}

export function commandCandidates(command, context) {
  const extensions = context.platform === 'win32' && !/\.(exe|cmd|bat|com)$/i.test(command)
    ? (environmentValue(context.env, 'PATHEXT') || '.COM;.EXE;.BAT;.CMD').split(';').filter((value) => /^\.(exe|cmd|bat|com)$/i.test(value))
    : ['']
  return context.binDirs.flatMap((directory) => extensions.map((extension) => context.paths.join(directory, command + extension.toLowerCase())))
}

async function executableAt(candidate, context) {
  if (!context.executableCache.has(candidate)) context.executableCache.set(candidate, (async () => {
    try {
      const stat = await fs.stat(candidate)
      if (!stat.isFile() || stat.size === 0) return null
      await fs.access(candidate, context.platform === 'win32' ? constants.F_OK : constants.X_OK)
      return { path: candidate, realPath: await fs.realpath(candidate) }
    } catch { return null }
  })())
  return context.executableCache.get(candidate)
}

async function boundedJson(file) {
  try {
    if ((await fs.stat(file)).size > 262144) return null
    return JSON.parse(await fs.readFile(file, 'utf8'))
  } catch { return null }
}

function packageBin(manifest, command) {
  if (typeof manifest.bin === 'string') return manifest.name?.split('/').at(-1) === command ? manifest.bin : null
  return typeof manifest.bin?.[command] === 'string' ? manifest.bin[command] : null
}

async function packageExecutable(directory, manifest, command) {
  const relative = packageBin(manifest, command)
  if (!relative) return null
  const target = path.resolve(directory, relative)
  if (!target.startsWith(`${path.resolve(directory)}${path.sep}`)) return null
  try { return (await fs.stat(target)).isFile() ? { relative, realPath: await fs.realpath(target) } : null } catch { return null }
}

async function hasPackageIdentity(executable, packages, command) {
  let directory = path.dirname(executable.realPath)
  for (let depth = 0; depth < 7; depth += 1) {
    const manifest = await boundedJson(path.join(directory, 'package.json'))
    if (manifest?.name) {
      if (packages.includes(manifest.name)) {
        const target = await packageExecutable(directory, manifest, command)
        if (target?.realPath === executable.realPath) return true
      }
      break
    }
    const parent = path.dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  // Validate npm's Windows shim target, not just an adjacent leftover package.
  if (!/\.(cmd|bat)$/i.test(executable.path)) return false
  let shim
  try {
    if ((await fs.stat(executable.path)).size > 16384) return false
    shim = (await fs.readFile(executable.path, 'utf8')).replaceAll('\\', '/').toLowerCase()
  } catch { return false }
  for (const name of packages) {
    const directory = path.join(path.dirname(executable.path), 'node_modules', name)
    const manifest = await boundedJson(path.join(directory, 'package.json'))
    if (manifest?.name !== name) continue
    const target = await packageExecutable(directory, manifest, command)
    if (!target) continue
    const relative = path.relative(directory, path.resolve(directory, target.relative)).split(path.sep).join('/')
    if (shim.includes(`"%dp0%/node_modules/${name}/${relative}"`.toLowerCase())) return true
  }
  return false
}

function versionCommand(executable, context) {
  const env = { ...context.env }
  const pathKey = context.platform === 'win32' ? Object.keys(env).find((key) => key.toLowerCase() === 'path') || 'PATH' : 'PATH'
  env[pathKey] = [context.paths.dirname(executable.path), ...context.binDirs].join(context.platform === 'win32' ? ';' : ':')
  const options = { env, cwd: context.home, timeout: context.versionTimeoutMs, maxBuffer: 65536, windowsHide: true, platform: context.platform }
  if (context.platform !== 'win32' || !/\.(cmd|bat)$/i.test(executable.path)) return { file: executable.path, args: ['--version'], options }
  const systemRoot = environmentValue(context.env, 'SystemRoot') || environmentValue(context.env, 'WINDIR')
  if (!systemRoot || !/^[a-z]:[\\/]/i.test(systemRoot)) throw Object.assign(new Error('Windows system command interpreter was not found'), { code: 'ENOENT' })
  // Batch files need cmd.exe. Keep its AutoRun and delayed expansion disabled;
  // reject expansion characters rather than accidentally invoking another path.
  const scriptPath = executable.path.replace(/^\\\\\?\\UNC\\/i, '\\\\').replace(/^\\\\\?\\/, '')
  if (/["%\r\n\0]/.test(scriptPath)) throw Object.assign(new Error('Unsupported characters in the Windows CLI path'), { code: 'INVALID_PATH' })
  return { file: path.win32.join(systemRoot, 'System32', 'cmd.exe'), args: ['/d', '/v:off', '/s', '/c', `""${scriptPath}" --version"`], options: { ...options, windowsVerbatimArguments: true } }
}

// --version runs without a terminal or input. Kill the complete process group
// on timeout/output overflow so a stalled npm shim cannot leave children behind.
export function runVersionCommand(file, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { cwd: options.cwd, env: options.env, stdio: ['ignore', 'pipe', 'pipe'], detached: options.platform !== 'win32', windowsHide: true, windowsVerbatimArguments: options.windowsVerbatimArguments })
    let stdout = Buffer.alloc(0)
    let stderr = Buffer.alloc(0)
    let settled = false
    let terminationError = null
    let timer
    const settle = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const output = { stdout: stdout.toString('utf8'), stderr: stderr.toString('utf8') }
      if (error) reject(Object.assign(error, output))
      else resolve(output)
    }
    const terminate = async (error) => {
      if (settled || terminationError) return
      terminationError = error
      if (child.pid) {
        if (options.platform === 'win32') {
          const root = environmentValue(options.env, 'SystemRoot') || environmentValue(options.env, 'WINDIR')
          if (root && /^[a-z]:[\\/]/i.test(root)) await runFile(path.win32.join(root, 'System32', 'taskkill.exe'), ['/pid', String(child.pid), '/t', '/f'], { timeout: 1000, maxBuffer: 4096, windowsHide: true }).catch(() => {})
          child.kill('SIGKILL')
        } else {
          try { process.kill(-child.pid, 'SIGKILL') } catch { child.kill('SIGKILL') }
        }
      }
      settle(error)
      child.stdout.destroy()
      child.stderr.destroy()
    }
    const collect = (channel) => (chunk) => {
      if (settled) return
      if (stdout.length + stderr.length + chunk.length > options.maxBuffer) {
        void terminate(Object.assign(new Error('Version output exceeded its limit'), { code: 'OUTPUT_LIMIT' }))
        return
      }
      if (channel === 'stdout') stdout = Buffer.concat([stdout, chunk])
      else stderr = Buffer.concat([stderr, chunk])
    }
    child.stdout.on('data', collect('stdout'))
    child.stderr.on('data', collect('stderr'))
    child.once('error', (error) => settle(error))
    child.once('close', (code, signal) => {
      if (terminationError) settle(terminationError)
      else if (code === 0) settle()
      else settle(Object.assign(new Error(signal ? `Version command terminated by ${signal}` : `Version command exited with code ${code}`), { code, signal }))
    })
    timer = setTimeout(() => { void terminate(Object.assign(new Error('Version command timed out'), { code: 'ETIMEDOUT' })) }, options.timeout)
  })
}

async function probeVersion(executable, context) {
  const key = executable.path
  if (!context.versionCache.has(key)) context.versionCache.set(key, (async () => {
    if (context.probeActive >= 4) await new Promise((resolve) => context.probeWaiters.push(resolve))
    else context.probeActive += 1
    try {
      const { file, args, options } = versionCommand(executable, context)
      const { stdout = '', stderr = '' } = await context.runVersionCommand(file, args, options)
      const version = [stdout, stderr].map((output) => output.trim().replace(/\x1b\[[0-9;]*m/g, '')
        .match(/(?:^|[^\d])v?(\d+\.\d+(?:\.\d+)?(?:-[\w.-]+)?(?:\+[\w.-]+)?)(?![\d])/)?.[1]).find(Boolean)
      if (!version) return { runnable: false, version: null, error: { code: 'INVALID_VERSION', message: 'The command did not return a recognizable version' } }
      return { runnable: true, version, error: null }
    } catch (error) {
      const message = (error.stderr?.trim() || error.stdout?.trim() || error.message || 'Version command failed').replace(/\x1b\[[0-9;]*m/g, '').split(/\r?\n/).slice(-4).join('\n').slice(0, 1000)
      return { runnable: false, version: null, error: { code: String(error.code || error.signal || 'PROBE_FAILED'), message } }
    } finally {
      const next = context.probeWaiters.shift()
      if (next) next()
      else context.probeActive -= 1
    }
  })())
  return context.versionCache.get(key)
}

async function executableEvidence(executable, context, extra) {
  return { kind: 'executable', ...executable, ...extra, probe: await probeVersion(executable, context) }
}

async function discoverExecutable(provider, context) {
  for (const command of provider.commands || []) {
    for (const candidate of commandCandidates(command, context)) {
      const executable = await executableAt(candidate, context)
      if (executable && (!provider.packages?.length || await hasPackageIdentity(executable, provider.packages, command))) {
        return executableEvidence(executable, context, { command, source: 'command-location' })
      }
    }
  }
  const native = [...(provider.native || [])]
  if (provider.nativeEnv && context.env[provider.nativeEnv.name]?.trim()) {
    native.unshift(context.paths.join(expand(context.env[provider.nativeEnv.name].trim(), context.home, context.paths, context.env), provider.nativeEnv.relative))
  }
  for (const location of native) {
    let candidate
    try { candidate = expand(location, context.home, context.paths, context.env) } catch { continue }
    if (context.platform === 'win32' && !context.paths.extname(candidate)) candidate += '.exe'
    const executable = await executableAt(candidate, context)
    if (executable) return executableEvidence(executable, context, { source: 'native-location' })
  }
  return null
}

async function applicationAt(application, context) {
  const infoFile = path.join(application, 'Contents/Info.plist')
  try {
    if ((await fs.stat(infoFile)).size > 1048576) return null
    // Read platform metadata with the system parser; never launch the application.
    const { stdout } = await runFile('/usr/bin/plutil', ['-convert', 'json', '-o', '-', infoFile], { timeout: 1500, maxBuffer: 262144 })
    const info = JSON.parse(stdout)
    const name = info.CFBundleExecutable
    if (typeof name !== 'string' || path.basename(name) !== name || typeof info.CFBundleIdentifier !== 'string' || !info.CFBundleIdentifier) return null
    const executable = await executableAt(path.join(application, 'Contents/MacOS', name), context)
    if (!executable) return null
    return { kind: 'application', path: application, executablePath: executable.path, identifier: info.CFBundleIdentifier, source: 'application-bundle' }
  } catch { return null }
}

async function discoverApplication(provider, context) {
  if (context.platform === 'win32') return discoverWindowsApplication(provider, context)
  if (context.platform !== 'darwin') return null
  for (const root of context.applicationRoots) {
    for (const name of provider.applications || []) {
      const match = await applicationAt(path.join(root, name), context)
      if (match) return match
    }
  }
  return null
}

const WINDOWS_APPLICATIONS_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$apps = @()
foreach ($base in @([Microsoft.Win32.Registry]::CurrentUser, [Microsoft.Win32.Registry]::LocalMachine)) {
  foreach ($branch in @('SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall', 'SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall')) {
    $key = $null
    try {
      $key = $base.OpenSubKey($branch, $false)
      if ($null -eq $key) { continue }
      foreach ($name in ($key.GetSubKeyNames() | Select-Object -First 4096)) {
        $entry = $null
        try {
          $entry = $key.OpenSubKey($name, $false)
          $display = $entry.GetValue('DisplayName', '')
          $icon = $entry.GetValue('DisplayIcon', '')
          if ($display -is [string] -and $icon -is [string] -and $display.Length -gt 0 -and $display.Length -le 256 -and $icon.Length -le 8192) {
            $apps += @{ name = $display; icon = $icon }
          }
        } catch {} finally { if ($null -ne $entry) { $entry.Dispose() } }
        if ($apps.Count -ge 1024) { break }
      }
    } catch {} finally { if ($null -ne $key) { $key.Dispose() } }
    if ($apps.Count -ge 1024) { break }
  }
  if ($apps.Count -ge 1024) { break }
}
ConvertTo-Json -InputObject @($apps) -Compress
`

export async function prepareApplicationContext(context, { runCommand = runFile } = {}) {
  if (context.platform !== 'win32') return context
  if (context.applicationPreparation) { await context.applicationPreparation; return context }
  if (context.registeredApplications !== undefined) return context
  if (!context.applicationPreparation) context.applicationPreparation = (async () => {
    context.registeredApplications = []
    const systemRoot = environmentValue(context.env, 'SystemRoot') || environmentValue(context.env, 'WINDIR')
    if (typeof systemRoot !== 'string' || !/^[a-z]:[\\/]/i.test(systemRoot) || systemRoot.includes('\0')) return
    try {
      const powershell = path.win32.join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      const { stdout } = await runCommand(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', WINDOWS_APPLICATIONS_SCRIPT], { timeout: 2500, maxBuffer: 1048576, encoding: 'utf8', windowsHide: true })
      if (typeof stdout !== 'string' || stdout.length > 1048576) return
      const records = JSON.parse(stdout.replace(/^\uFEFF/, ''))
      if (Array.isArray(records)) context.registeredApplications = records.slice(0, 1024).filter((entry) => typeof entry?.name === 'string' && typeof entry.icon === 'string' && entry.name.length <= 256 && entry.icon.length <= 8192)
    } catch { /* Missing or unreadable metadata does not imply an installation. */ }
  })()
  await context.applicationPreparation
  return context
}

async function discoverWindowsApplication(provider, context) {
  if (!provider.applications?.length) return null
  await prepareApplicationContext(context)
  for (const app of context.registeredApplications || []) {
    if (!provider.applications.some((name) => name.toLowerCase() === app.name.trim().toLowerCase())) continue
    const candidate = /^"?(.+?\.(?:exe|com))"?(?:,\s*-?\d+)?$/i.exec(app.icon.trim())?.[1]
    if (!candidate || candidate.includes('\0') || !context.paths.isAbsolute(candidate)) continue
    const executable = await executableAt(candidate, context)
    if (executable) return { kind: 'application', path: executable.path, executablePath: executable.path, identifier: app.name, source: 'application-registration' }
  }
  return null
}

async function discoverExtension(provider, context) {
  if (!provider.extensions?.length) return null
  const locations = context.extensionRoots ?? (provider.extensionRoots || []).map((location) => expand(location, context.home, context.paths, context.env))
  for (const root of locations) {
    let entries
    try { entries = await fs.readdir(root, { withFileTypes: true }) } catch { continue }
    const obsolete = await boundedJson(path.join(root, '.obsolete')) || {}
    const candidates = entries.filter((entry) => entry.isDirectory() && !obsolete[entry.name] && provider.extensions.some((id) => entry.name.toLowerCase().startsWith(`${id.toLowerCase()}-`))).slice(0, 50)
    for (const entry of candidates) {
      const directory = path.join(root, entry.name)
      const manifest = await boundedJson(path.join(directory, 'package.json'))
      const identifier = `${manifest?.publisher}.${manifest?.name}`
      if (provider.extensions.includes(identifier)) return { kind: 'extension', path: directory, identifier, source: 'extension-manifest' }
    }
  }
  return null
}

export async function discoverAgent(entry, skillDir, configRoot, context = createDiscoveryContext()) {
  const provider = entry.discovery || { commands: /^[a-z0-9][a-z0-9._-]*$/i.test(entry.name) ? [entry.name] : [] }
  const [configured, skillsDirectoryExists] = await Promise.all([directoryExists(configRoot), directoryExists(skillDir)])
  // Isolated sample workspaces deliberately inspect their own data only.
  const explicit = entry.executable ? await executableAt(expand(entry.executable, context.home, context.paths, context.env), context) : null
  const checksCommand = Boolean(entry.executable || provider.commands?.length || provider.native?.length || provider.nativeEnv)
  const installation = entry.executable ? explicit ? await executableEvidence(explicit, context, { source: 'explicit-command' }) : null
    : entry.probeInstallation === false ? null
    : checksCommand ? await discoverExecutable(provider, context)
    : await discoverApplication(provider, context) || await discoverExtension(provider, context)
  const detected = installation?.kind === 'executable' ? installation.probe?.runnable === true : Boolean(installation)
  const evidence = []
  if (installation) evidence.push(installation)
  if (configured) evidence.push({ kind: 'configuration', path: configRoot, source: 'configured-root' })
  return {
    detected,
    installed: detected,
    runnable: installation?.probe?.runnable ?? null,
    version: installation?.probe?.version ?? null,
    configured,
    skillsDirectoryExists,
    status: installation?.probe?.runnable === false ? 'unavailable' : detected ? 'installed' : 'not-detected',
    detection: { kind: installation?.kind || (configured ? 'configuration' : 'none'), evidence },
  }
}
