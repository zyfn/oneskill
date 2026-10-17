// One switch per filesystem target, even when several Agent products share it.
export function skillTargets(agents) {
  const groups = new Map()
  for (const agent of agents.filter(agent => (agent.detected ?? agent.installed) && agent.dir)) {
    const key = agent.skillTargetId || agent.dir
    if (!groups.has(key)) groups.set(key, { key, agent, names: [], agents: [] })
    const group = groups.get(key)
    group.names.push(agent.name)
    group.agents.push(agent)
  }
  return [...groups.values()].map(group => ({ ...group, label: group.names.join(' / ') }))
}
