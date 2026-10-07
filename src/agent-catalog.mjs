import fs from 'node:fs/promises'
import path from 'node:path'

const hosts = { darwin: 'macos', win32: 'windows', linux: 'linux' }
const formats = new Set(['json', 'jsonc', 'toml'])
const flatKeys = new Set(['name', 'logo', 'references', 'commands', 'appNames', 'executablePaths', 'executableDirEnv', 'extensions', 'extensionDirs', 'packages', 'configDir', 'configDirEnv', 'configDirEnvSuffix', 'skillDir', 'extraSkillDirs', 'skillLinkIgnorePrefix', 'pluginDirs', 'mcp', 'executable', 'probeInstallation'])
const legacyKeys = new Set(['name', 'logo', 'references', 'dir', 'discovery', 'configuration', 'resources', 'executable', 'probeInstallation'])
const sharedKeys = new Set(['name', 'logo', 'references', 'executable', 'probeInstallation'])
const mapFields = ['configDir', 'skillDir', 'appNames', 'executablePaths', 'executable']
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const isText = value => typeof value === 'string' && Boolean(value.trim()) && !value.includes('\0')
const isArray = value => Array.isArray(value) && value.every(isText)
const isLocation = value => /^(~(?:[\\/]|$)|\$\{|[a-z]:[\\/]|\/|\\\\)/i.test(value)
const isFlat = entry => Object.keys(entry).some(key => flatKeys.has(key) && !sharedKeys.has(key))

function invalid(name, message) { throw new Error(`Agent definition ${name || '(unnamed)'}: ${message}`) }
function checkKeys(value, keys, name, label) {
  for (const key of Object.keys(value)) if (!keys.has(key)) invalid(name, `unknown ${label}field ${key}`)
}
function checkMap(value, name, field, validate, { complete = false, requiredMap = false } = {}) {
  if (!isObject(value)) {
    if (requiredMap || !validate(value)) invalid(name, `${field} must be ${requiredMap ? 'a platform path map' : 'a value or platform map'}`)
    return
  }
  if (!Object.keys(value).length) invalid(name, `${field} cannot be an empty object`)
  if (complete && ['macos', 'windows'].some(host => !Object.hasOwn(value, host))) invalid(name, `${field} must explicitly declare macos and windows`)
  for (const [host, selected] of Object.entries(value)) {
    if (!Object.values(hosts).includes(host) || (selected !== null && !validate(selected))) invalid(name, `invalid ${field}.${host}`)
  }
}
function selected(value, host) { return isObject(value) ? value[host] : value }

function validateFlat(entry, complete) {
  checkKeys(entry, flatKeys, entry.name, '')
  for (const key of ['logo', 'configDirEnv', 'configDirEnvSuffix']) if (entry[key] !== undefined && !isText(entry[key])) invalid(entry.name, `${key} must be nonempty`)
  for (const key of ['commands', 'extensions', 'extensionDirs', 'packages', 'pluginDirs']) if (entry[key] !== undefined && !isArray(entry[key])) invalid(entry.name, `${key} must be a string array`)
  if (entry.commands?.some(command => !/^[a-z0-9][a-z0-9._-]*$/i.test(command))) invalid(entry.name, 'commands must be executable names, not shell expressions')
  if (entry.configDir !== undefined) checkMap(entry.configDir, entry.name, 'configDir', isText, { complete, requiredMap: true })
  for (const key of ['skillDir', 'executable']) if (entry[key] !== undefined) checkMap(entry[key], entry.name, key, isText, { complete: isObject(entry[key]) && complete })
  for (const key of ['appNames', 'executablePaths']) if (entry[key] !== undefined) checkMap(entry[key], entry.name, key, isArray, { complete: isObject(entry[key]) && complete })
  if (entry.executableDirEnv !== undefined) {
    const value = entry.executableDirEnv
    if (!isObject(value) || !isText(value.name)) invalid(entry.name, 'executableDirEnv requires name and relative')
    checkKeys(value, new Set(['name', 'relative']), entry.name, 'executableDirEnv.')
    checkMap(value.relative, entry.name, 'executableDirEnv.relative', isText, { complete: isObject(value.relative) && complete })
  }
  if (entry.skillLinkIgnorePrefix !== undefined && typeof entry.skillLinkIgnorePrefix !== 'string') invalid(entry.name, 'skillLinkIgnorePrefix must be a string')
  if (entry.extraSkillDirs !== undefined) {
    if (!Array.isArray(entry.extraSkillDirs)) invalid(entry.name, 'extraSkillDirs must be an array')
    const ids = new Set()
    for (const root of entry.extraSkillDirs) {
      if (!isObject(root) || !isText(root.id) || ids.has(root.id)) invalid(entry.name, 'extraSkillDirs require unique ids')
      checkKeys(root, new Set(['id', 'path', 'scope', 'ignorePrefix']), entry.name, 'extraSkillDirs.')
      checkMap(root.path, entry.name, 'extraSkillDirs.path', isText, { complete: isObject(root.path) && complete })
      ids.add(root.id)
    }
  }
  if (entry.mcp !== undefined) {
    if (!Array.isArray(entry.mcp)) invalid(entry.name, 'mcp must be an array')
    for (const file of entry.mcp) {
      if (!isObject(file) || !isText(file.file) || !isText(file.key)) invalid(entry.name, 'mcp entries require file and key')
      checkKeys(file, new Set(['file', 'key', 'format', 'fileEnv', 'platforms', 'scope', 'compatibility']), entry.name, 'mcp.')
      if (file.format !== undefined && !formats.has(file.format)) invalid(entry.name, 'supported formats are json, jsonc, toml')
      if (file.fileEnv !== undefined && !isText(file.fileEnv)) invalid(entry.name, 'fileEnv must be nonempty')
      if (file.platforms !== undefined && (!isArray(file.platforms) || file.platforms.some(host => !Object.values(hosts).includes(host)))) invalid(entry.name, 'mcp platforms must contain platform names')
    }
  }
  if (entry.probeInstallation !== undefined && typeof entry.probeInstallation !== 'boolean') invalid(entry.name, 'probeInstallation must be boolean')
  if (complete && !entry.commands?.length && !entry.appNames && !entry.extensions?.length && !entry.executablePaths && !entry.executable) invalid(entry.name, 'declare commands, appNames, extensions, or an executable')
}

function validateRecord(entry, complete = false) {
  if (!isObject(entry) || !isText(entry.name) || !/^[a-z0-9][a-z0-9._-]*$/.test(entry.name)) invalid(entry?.name, 'name must be a lowercase command-style identifier')
  if (isFlat(entry)) { validateFlat(entry, complete); return }
  // Preserve existing flat runtime declarations and agents.registry targets.
  // Experimental common/platform-overrides formats are not part of the schema.
  checkKeys(entry, legacyKeys, entry.name, '')
  for (const key of ['dir', 'logo', 'executable']) if (entry[key] !== undefined && !isText(entry[key])) invalid(entry.name, `${key} must be nonempty`)
  if (entry.discovery !== undefined) {
    if (!isObject(entry.discovery)) invalid(entry.name, 'discovery must be an object')
    checkKeys(entry.discovery, new Set(['commands', 'applications', 'extensions', 'extensionRoots', 'native', 'nativeEnv', 'packages']), entry.name, 'discovery.')
    for (const [key, value] of Object.entries(entry.discovery)) if (key !== 'nativeEnv' && !isArray(value)) invalid(entry.name, `discovery.${key} must be a string array`)
    if (entry.discovery.commands?.some(command => !/^[a-z0-9][a-z0-9._-]*$/i.test(command))) invalid(entry.name, 'commands must be executable names, not shell expressions')
  }
  if (entry.configuration !== undefined) {
    if (!isObject(entry.configuration)) invalid(entry.name, 'configuration must be an object')
    checkKeys(entry.configuration, new Set(['dir', 'env', 'suffix']), entry.name, 'configuration.')
    if (Object.values(entry.configuration).some(value => !isText(value))) invalid(entry.name, 'configuration fields must be nonempty')
  }
  if (entry.resources !== undefined) {
    if (!isObject(entry.resources)) invalid(entry.name, 'resources must be an object')
    checkKeys(entry.resources, new Set(['skills', 'plugins', 'mcp', 'targetIgnorePrefix']), entry.name, 'resources.')
    if (entry.resources.plugins !== undefined && !isArray(entry.resources.plugins)) invalid(entry.name, 'plugins must be a string array')
    if (entry.resources.mcp !== undefined && (!isObject(entry.resources.mcp) || !Array.isArray(entry.resources.mcp.files))) invalid(entry.name, 'mcp requires a files array')
    for (const file of entry.resources.mcp?.files || []) if (!isText(file.path) || !isText(file.key) || (file.format && !formats.has(file.format))) invalid(entry.name, 'configuration files require a path, key, and supported format')
  }
}

export function resolveAgentPlatform(entry, platform = process.platform, { complete = true, fallback } = {}) {
  const host = hosts[platform]
  if (!host) return null
  if (!isFlat(entry)) return { ...entry }
  const configDir = selected(entry.configDir, host)
  if (entry.configDir !== undefined && configDir == null) return null
  const root = configDir ?? fallback?.configuration?.dir
  const target = selected(entry.skillDir, host)
  const absoluteTarget = target == null ? undefined : isLocation(target) ? target : root ? `${root.replace(/[\\/]+$/, '')}/${target}` : invalid(entry.name, 'configDir is required for a relative skillDir')
  const discovery = {}
  for (const [source, destination] of [['commands','commands'], ['appNames','applications'], ['executablePaths','native'], ['extensions','extensions'], ['extensionDirs','extensionRoots'], ['packages','packages']]) {
    if (entry[source] !== undefined) discovery[destination] = selected(entry[source], host) || []
  }
  if (entry.executableDirEnv) discovery.nativeEnv = { name: entry.executableDirEnv.name, relative: selected(entry.executableDirEnv.relative, host) }
  const resources = complete ? { skills: [], plugins: [], mcp: { files: [] } } : {}
  if (entry.pluginDirs !== undefined) resources.plugins = entry.pluginDirs
  if (entry.extraSkillDirs !== undefined) resources.skills = entry.extraSkillDirs.flatMap(({ path: location, ...metadata }) => {
    const value = selected(location, host)
    return value == null ? [] : [{ ...metadata, path: value, ...!isLocation(value) && { base: 'config' } }]
  })
  if (entry.skillLinkIgnorePrefix !== undefined) resources.targetIgnorePrefix = entry.skillLinkIgnorePrefix
  if (entry.mcp !== undefined) resources.mcp = { files: entry.mcp.filter(file => !file.platforms || file.platforms.includes(host)).map(({ file, fileEnv, platforms: _platforms, ...metadata }) => ({ ...metadata, path: file, base: isLocation(file) ? 'home' : 'config', ...fileEnv && { env: fileEnv } })) }
  return {
    name: entry.name,
    ...entry.logo !== undefined && { logo: entry.logo },
    ...entry.references !== undefined && { references: entry.references },
    ...Object.keys(discovery).length && { discovery },
    ...configDir !== undefined && { configuration: { dir: configDir, ...entry.configDirEnv && { env: entry.configDirEnv }, ...entry.configDirEnvSuffix && { suffix: entry.configDirEnvSuffix } } },
    ...configDir === undefined && entry.configDirEnv && { configuration: { ...fallback?.configuration, env: entry.configDirEnv, ...entry.configDirEnvSuffix && { suffix: entry.configDirEnvSuffix } } },
    ...absoluteTarget !== undefined && { dir: absoluteTarget },
    ...Object.keys(resources).length && { resources },
    ...entry.executable !== undefined && { executable: selected(entry.executable, host) },
    ...entry.probeInstallation !== undefined && { probeInstallation: entry.probeInstallation },
  }
}

async function readRecords(file, optional = false) {
  let text
  try { text = await fs.readFile(file, 'utf8') } catch (error) { if (optional && error.code === 'ENOENT') return []; throw error }
  let records
  try { records = JSON.parse(text) } catch { throw new Error(`${path.basename(file)} contains invalid JSON`) }
  if (!Array.isArray(records)) throw new Error(`${path.basename(file)} must contain an array of Agent definitions`)
  const names = new Set()
  for (const entry of records) {
    validateRecord(entry, !optional)
    if (names.has(entry.name)) invalid(entry.name, `duplicate entry in ${path.basename(file)}`)
    names.add(entry.name)
  }
  return records
}
async function readLegacyTargets(file) {
  let text
  try { text = await fs.readFile(file, 'utf8') } catch (error) { if (error.code === 'ENOENT') return new Map(); throw error }
  const targets = new Map()
  for (const line of text.split(/\r?\n/)) {
    const clean = line.trim()
    if (!clean || clean.startsWith('#')) continue
    const split = clean.indexOf('|')
    const entry = { name: clean.slice(0, split).trim(), dir: clean.slice(split + 1).trim() }
    if (split < 1) throw new Error('agents.registry requires name | skill directory')
    validateRecord(entry)
    targets.set(entry.name, entry.dir)
  }
  return targets
}
function mergeRuntime(base, local) {
  const merged = { ...base, ...local }
  for (const key of ['discovery','configuration','resources']) if (base?.[key] || local[key]) merged[key] = { ...base?.[key], ...local[key] }
  if (local.configuration?.dir && !Object.hasOwn(local.configuration, 'env')) delete merged.configuration.env
  return merged
}
function mergeFlat(base, local, host) {
  const merged = { ...base, ...local }
  for (const key of mapFields) if (isObject(base[key]) && isObject(local[key])) merged[key] = { ...base[key], ...local[key] }
  if (local.configDir !== undefined && Object.hasOwn(local.configDir, host) && local.configDirEnv === undefined) { delete merged.configDirEnv; delete merged.configDirEnvSuffix }
  return merged
}
export async function readAgentDefinitions(root, { platform = process.platform } = {}) {
  const presets = await readRecords(path.join(root, 'agents.catalog.json'))
  const local = await readRecords(path.join(root, 'agents.local.json'), true)
  const targets = await readLegacyTargets(path.join(root, 'agents.registry'))
  const presetByName = new Map(presets.map(entry => [entry.name, entry]))
  const entries = new Map()
  for (const entry of presets) {
    const resolved = resolveAgentPlatform(entry, platform)
    if (resolved) entries.set(entry.name, { ...resolved, preset: true })
  }
  for (const [name, dir] of targets) if (!presetByName.has(name)) entries.set(name, { name, dir, preset: false })
  for (const entry of local) {
    const preset = presetByName.get(entry.name)
    if (!preset) validateRecord(entry, true)
    const combined = preset && isFlat(preset) && isFlat(entry) ? mergeFlat(preset, entry, hosts[platform]) : null
    if (combined) validateRecord(combined, true)
    const base = entries.get(entry.name)
    const resolved = resolveAgentPlatform(combined || entry, platform, { complete: Boolean(combined || !preset), fallback: base })
    if (!resolved) { entries.delete(entry.name); continue }
    entries.set(entry.name, { ...(combined ? resolved : mergeRuntime(base, resolved)), preset: Boolean(preset) })
    if ((entry.skillDir !== undefined || entry.dir !== undefined) && resolved.dir) targets.set(entry.name, resolved.dir)
  }
  return [...entries.values()].map(entry => {
    const targetOverride = targets.get(entry.name)
    const hasRoot = Boolean(entry.configuration?.dir || entry.dir || targetOverride)
    if (!hasRoot && entry.resources?.plugins?.some(value => !isLocation(value))) invalid(entry.name, 'configDir is required for relative plugin directories')
    if (!hasRoot && entry.resources?.mcp?.files?.some(file => file.base !== 'home')) invalid(entry.name, 'configDir is required for relative MCP files')
    if (!hasRoot && entry.resources?.skills?.some(value => value.base === 'config')) invalid(entry.name, 'configDir is required for relative extra Skill directories')
    return { ...entry, targetOverride, discovery: entry.discovery || { commands: [entry.name] }, resources: entry.resources || (hasRoot ? undefined : { skills: [], plugins: [], mcp: { files: [] } }) }
  })
}
