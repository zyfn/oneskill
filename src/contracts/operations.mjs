import { z } from 'zod'

export const PROTOCOL_VERSION = 1
const id = z.string().min(1).max(2048)
const mutation = { requestId: z.string().min(1).max(100), expectedRevision: z.string().optional() }
const define = (tool, description, shape, write = false) => ({ tool, description, schema: z.object(shape).strict(), write })

export const operations = {
  getWorkspace: define('oneskill_get_workspace', 'Open oneskill and inspect its Agents, Skills, links, plugins and MCP inventory.', {}),
  refreshWorkspace: define('oneskill_refresh_workspace', 'Rescan the same local workspace. Installation requires successful version evidence.', {}),
  getSkill: define('oneskill_get_skill', 'Read details and SKILL.md for a discovered Skill by its source identifier.', { skillId: id }),
  setSkillLink: define('oneskill_set_skill_link', 'Connect or disconnect a managed Skill and an Agent without replacing real directories.', { ...mutation, agentId: id, skillId: id, linked: z.boolean() }, true),
  importSkills: define('oneskill_import_skills', 'Adopt selected unmanaged Skills into the library, preserving originals in backups.', { ...mutation, skillIds: z.array(id).min(1).max(100) }, true),
  setSkillIgnored: define('oneskill_set_skill_ignored', 'Hide or restore one unmanaged Skill source without changing its files.', { ...mutation, skillId: id, ignored: z.boolean() }, true),
  openFolder: define('oneskill_open_folder', 'Open a discovered resource folder on the local computer.', { resourceId: id }),
}

export class WorkspaceError extends Error {
  constructor(code, message, status = 400) { super(message); this.code = code; this.status = status }
}
export function parseOperation(name, input) {
  const operation = operations[name]
  if (!operation) throw new WorkspaceError('UNKNOWN_OPERATION', `Unknown operation: ${name}`, 404)
  const parsed = operation.schema.safeParse(input)
  if (!parsed.success) throw new WorkspaceError('INVALID_INPUT', parsed.error.issues.map(issue => `${issue.path.join('.') || 'request'}: ${issue.message}`).join('; '))
  return parsed.data
}
export function errorResult(error) {
  return { error: { code: error.code || 'OPERATION_FAILED', message: error.message || 'The workspace operation failed.' } }
}
