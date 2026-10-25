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
  const sources = [
    ...[item.relative, ...(item.ignoreAliases || [])].map(relative => ({ agent: item.agent, relative })),
    ...(item.ignoreSources || []),
  ]
  for (const { agent, relative } of sources) {
    const key = JSON.stringify([agent, relative])
    if (rules.has(key)) return rules.get(key)
  }
  return false
}
export function createIgnoreStore(file) {
  let queue = Promise.resolve()
  function updateMany(resolveCandidates, ignored) {
    const operation = queue.then(async () => {
      if (typeof ignored !== 'boolean') throw new Error('Ignored must be true or false.')
      const candidates = await resolveCandidates()
      const rules = await readRules(file)
      const results = candidates.map(candidate => {
        const changed = isSkillIgnored(candidate, rules) !== ignored
        if (changed) rules.set(JSON.stringify([candidate.agent, candidate.relative]), ignored)
        return { ok: true, changed, ignored }
      })
      if (!results.some(result => result.changed)) return results
      const records = [...rules].map(([key, value]) => { const [agent, relative] = JSON.parse(key); return { agent, relative, ignored: value } })
      await atomicJson(file, records)
      return results
    })
    queue = operation.catch(() => {})
    return operation
  }
  return { read: () => readRules(file), updateMany, update: async (resolveCandidate, ignored) => (await updateMany(async () => [await resolveCandidate()], ignored))[0] }
}
