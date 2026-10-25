export function itemKey(item) {
  if (item.id) return item.id
  return [item.agent, item.manifest || item.path || item.dir, item.name].filter(Boolean).join(':')
}

export function resourceGroupKey(item) {
  return [...new Set(item.agents || [item.agent])].sort().join('+')
}

export function describeItem(route, item, locale = 'en') {
  if (item.description) return item.description
  if (route === 'mcp') return item.plugin ? `${locale === 'zh' ? '插件' : 'Plugin'} · ${item.plugin}` : item.source || ''
  if (route === 'plugins') return ''
  return ''
}

export function groupByAgent(items) {
  const groups = new Map()
  for (const item of items) {
    const agent = item.agent || 'Local'
    if (!groups.has(agent)) groups.set(agent, [])
    groups.get(agent).push(item)
  }
  return [...groups.entries()]
}
