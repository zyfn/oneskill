import fs from 'node:fs'
import { randomUUID } from 'node:crypto'

async function readRules(file) {
  let text = ''
  try { text = await fs.promises.readFile(file, 'utf8') }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const legacy = new Set()
  const paths = new Map()
  const lines = text.split(/\r?\n/)
  const records = lines.map((line, index) => {
    const clean = line.trim()
    if (!clean || clean.startsWith('#')) return null
    if (!clean.startsWith('{')) { legacy.add(clean); return null }
    let rule
    try { rule = JSON.parse(clean) } catch { throw new Error(`Invalid ignore rule at migrate.ignore:${index + 1}`) }
    if (typeof rule.agent !== 'string' || typeof rule.relative !== 'string' || typeof rule.ignored !== 'boolean') {
      throw new Error(`Invalid ignore rule at migrate.ignore:${index + 1}`)
    }
    const key = JSON.stringify([rule.agent, rule.relative])
    paths.set(key, rule.ignored)
    return key
  })
  return { text, lines, records, legacy, paths }
}

export function isSkillIgnored(item, rules) {
  const key = JSON.stringify([item.agent, item.relative])
  if (rules.paths.has(key)) return rules.paths.get(key)
  for (const alias of item.ignoreAliases || []) {
    const aliasKey = JSON.stringify([item.agent, alias])
    if (rules.paths.has(aliasKey)) return rules.paths.get(aliasKey)
  }
  return rules.legacy.has(`${item.agent}:${item.name}`)
}

export function createIgnoreStore(file) {
  let ignoreUpdates = Promise.resolve()
  function update(resolveCandidate, ignored) {
    const operation = ignoreUpdates.then(async () => {
      if (typeof ignored !== 'boolean') throw new Error('Ignored must be true or false.')
      const candidate = await resolveCandidate()
      const rules = await readRules(file)
      const key = JSON.stringify([candidate.agent, candidate.relative])
      const before = isSkillIgnored(candidate, rules)
      if (before === ignored) return { ok: true, changed: false, ignored }
      const lines = rules.lines.filter((_line, index) => rules.records[index] !== key)
      // A false path rule restores this item without unprotecting same-name siblings.
      const inheritedPathRule = (candidate.ignoreAliases || []).some((alias) => rules.paths.get(JSON.stringify([candidate.agent, alias])) === true)
      if (ignored || inheritedPathRule || rules.legacy.has(`${candidate.agent}:${candidate.name}`)) {
        lines.push(JSON.stringify({ agent: candidate.agent, relative: candidate.relative, ignored }))
      }
      const next = lines.filter((line, index) => line.trim() || index < lines.length - 1).join('\n').replace(/\n+$/, '') + '\n'
      const temporary = `${file}.${randomUUID()}.tmp`
      const mode = await fs.promises.stat(file).then((stat) => stat.mode & 0o777).catch((error) => { if (error.code === 'ENOENT') return 0o600; throw error })
      try {
        await fs.promises.writeFile(temporary, next, { flag: 'wx', mode })
        await fs.promises.rename(temporary, file)
      } finally { await fs.promises.unlink(temporary).catch(() => {}) }
      return { ok: true, changed: true, ignored }
    })
    ignoreUpdates = operation.catch(() => {})
    return operation
  }

  return { read: () => readRules(file), update }
}
