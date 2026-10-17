import fs from 'node:fs/promises'
import { atomicJson } from './runtime/paths.mjs'

async function readRules(file) {
  let rules
  try { rules = JSON.parse(await fs.readFile(file, 'utf8')) }
  catch (error) { if (error.code === 'ENOENT') return new Map(); throw new Error('Invalid Skill ignore preferences.') }
  if (!Array.isArray(rules) || rules.some(rule => typeof rule.agent !== 'string' || typeof rule.relative !== 'string' || typeof rule.ignored !== 'boolean')) throw new Error('Invalid Skill ignore preferences.')
  return new Map(rules.map(rule => [JSON.stringify([rule.agent, rule.relative]), rule.ignored]))
}
export function isSkillIgnored(item, rules) {
  for (const relative of [item.relative, ...(item.ignoreAliases || [])]) {
    const key = JSON.stringify([item.agent, relative])
    if (rules.has(key)) return rules.get(key)
  }
  return false
}
export function createIgnoreStore(file) {
  let queue = Promise.resolve()
  function update(resolveCandidate, ignored) {
    const operation = queue.then(async () => {
      if (typeof ignored !== 'boolean') throw new Error('Ignored must be true or false.')
      const candidate = await resolveCandidate()
      const rules = await readRules(file)
      if (isSkillIgnored(candidate, rules) === ignored) return { ok: true, changed: false, ignored }
      rules.set(JSON.stringify([candidate.agent, candidate.relative]), ignored)
      const records = [...rules].map(([key, value]) => { const [agent, relative] = JSON.parse(key); return { agent, relative, ignored: value } })
      await atomicJson(file, records)
      return { ok: true, changed: true, ignored }
    })
    queue = operation.catch(() => {})
    return operation
  }
  return { read: () => readRules(file), update }
}
