export const pageMeta = {
  skills: { title: 'Skills', search: 'Search skills' },
  plugins: { title: 'Plugins', search: 'Search plugins' },
  mcp: { title: 'MCP', search: 'Search servers' },
  hooks: { title: 'Hooks', search: 'Search hooks' },
  agents: { title: 'Agents', search: 'Search agents' },
  migrate: { title: 'Skills', search: 'Search local skills' },
}

export function itemKey(item) {
  return [item.agent, item.manifest || item.path || item.dir, item.name].filter(Boolean).join(':')
}

export function describeItem(route, item, locale = 'en') {
  if (item.description) return item.description
  if (route === 'mcp') return ''
  if (route === 'plugins') return ''
  if (route === 'hooks') {
    const copy = {
      PreToolUse: 'Runs before an Agent uses a tool.',
      PostToolUse: 'Runs after an Agent uses a tool.',
      SessionStart: 'Runs when an Agent session starts.',
      Stop: 'Runs when an Agent finishes its response.',
      UserPromptSubmit: 'Runs when a prompt is submitted.',
      Notification: 'Responds to Agent notifications.',
    }[item.name]
    if (copy) return locale === 'zh' ? {
      PreToolUse: '在 Agent 使用工具前运行。',
      PostToolUse: '在 Agent 使用工具后运行。',
      SessionStart: 'Agent 会话开始时运行。',
      Stop: 'Agent 完成回复时运行。',
      UserPromptSubmit: '提交提示词时运行。',
      Notification: '响应 Agent 通知。',
    }[item.name] : copy
    return locale === 'zh' ? 'Agent 配置中声明的自动化。' : 'An automation declared in Agent configuration.'
  }
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
