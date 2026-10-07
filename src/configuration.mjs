import fs from 'node:fs/promises'
import { parse as parseJSONC } from 'jsonc-parser'
import { parse as parseTOML } from 'smol-toml'

export function parseConfiguration(text, format = 'json') {
  text = text.replace(/^\uFEFF/, '')
  if (format === 'json') return JSON.parse(text)
  if (format === 'toml') return parseTOML(text)
  if (format === 'jsonc') {
    const errors = []
    const value = parseJSONC(text, errors, { allowTrailingComma: true })
    if (errors.length) throw new Error('Invalid JSONC configuration')
    return value
  }
  throw new Error('Unsupported configuration format')
}

export async function readConfiguration(file, format) {
  let contents
  try {
    if ((await fs.stat(file)).size > 1048576) return { error: 'CONFIG_TOO_LARGE' }
    contents = await fs.readFile(file, 'utf8')
  } catch (error) {
    return error.code === 'ENOENT' || error.code === 'ENOTDIR' ? { missing: true } : { error: 'CONFIG_UNREADABLE' }
  }
  try { return { data: parseConfiguration(contents, format) } }
  catch { return { error: 'CONFIG_PARSE_FAILED' } }
}

export function configurationEntries(data, key) {
  const value = key.split('.').reduce((object, name) => object && Object.hasOwn(object, name) ? object[name] : undefined, data)
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  return Object.keys(value).map((name) => ({ name, enabled: typeof value[name]?.enabled === 'boolean' ? value[name].enabled : undefined }))
}
