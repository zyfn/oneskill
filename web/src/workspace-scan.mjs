const visibleScopes = { skills: ['skills'], agents: ['skills', 'plugins', 'mcp'], plugins: ['plugins'], mcp: ['mcp'] }

export function workspaceScanStatus(data, route) {
  const scopes = (visibleScopes[route] || visibleScopes.agents).map(kind => data.scan?.[kind]).filter(Boolean)
  const diagnostics = [...new Map(scopes.flatMap(scan => scan.diagnostics || []).map(item => [`${item.path}:${item.code}`, item])).values()]
  const truncated = scopes.some(scan => scan.truncated)
  const incomplete = scopes.some(scan => scan.complete === false)
  const reason = data.stale ? 'stale' : diagnostics.length ? 'unreadable' : truncated ? 'limited' : incomplete ? 'incomplete' : null
  return { diagnostics, truncated, incomplete, reason }
}
