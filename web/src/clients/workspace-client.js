import { operations, parseOperation } from '../../../src/contracts/operations.mjs'

export function createWorkspaceClient(transport, host = {}) {
  let snapshot
  async function call(name, input = {}) {
    const result = await transport.call(name, parseOperation(name, input))
    if (name === 'getWorkspace' || name === 'refreshWorkspace') snapshot = result
    return result
  }
  const missing = () => Object.assign(new Error('This resource changed. Refresh the workspace.'), { code: 'SOURCE_CHANGED' })
  const skillId = (agent, relative) => snapshot?.skills.find(item => item.managed && item.relative === relative && item.bindings.some(binding => binding.agent === agent))?.id
  const mutation = () => ({ requestId: crypto.randomUUID(), expectedRevision: snapshot?.revision })
  return {
    host,
    call,
    getWorkspace: force => call(force ? 'refreshWorkspace' : 'getWorkspace'),
    getSkill: id => call('getSkill', { skillId: id }),
    async updateSkillLink(agentName, relative, linked) {
      const agentId = snapshot?.agents.find(item => item.name === agentName)?.id
      const id = skillId(agentName, relative)
      if (!agentId || !id) throw missing()
      return call('setSkillLink', { ...mutation(), agentId, skillId: id, linked })
    },
    importSkills: skillIds => call('importSkills', { ...mutation(), skillIds }),
    setSkillIgnored: (skillId, ignored) => call('setSkillIgnored', { ...mutation(), skillId, ignored }),
    openFolder(value) {
      const resources = [{ id: 'library', path: snapshot?.source }, ...(snapshot?.agents || []).map(item => ({ ...item, path: item.root || item.dir })), ...(snapshot?.skills || []), ...(snapshot?.plugins || []), ...(snapshot?.mcp || []), ...(snapshot?.hooks || [])]
      const resource = resources.find(item => item.id === value || item.path === value || item.manifest === value || item.paths?.includes(value))
      if (!resource) throw missing()
      return call('openFolder', { resourceId: resource.id })
    },
    heartbeat: transport.heartbeat,
  }
}
export const toolForOperation = name => operations[name].tool
