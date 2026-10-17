import { createHttpClient } from './clients/http-client'
let client = createHttpClient()
export function configureWorkspaceClient(next) { client = next }
export function workspaceHost() { return client.host }
export const getWorkspace = force => client.getWorkspace(force)
export const getSkill = id => client.getSkill(id)
export const updateSkillLink = (agent, skill, linked) => client.updateSkillLink(agent, skill, linked)
export const importSkills = ids => client.importSkills(ids)
export const setSkillIgnored = (id, ignored) => client.setSkillIgnored(id, ignored)
export const openFolder = resource => client.openFolder(resource)
export const heartbeat = () => client.heartbeat()
export function folderErrorKey(error) {
  if (error.status === 401) return 'common.accessExpired'
  return error.code === 'PATH_NOT_FOUND' ? 'common.folderMissing' : 'common.openFolderFailed'
}
