import { useMemo } from 'react'
import { OpenFolderButton } from '@/open-folder-button'
import { AgentIcon } from '@/capability-icon'
import { useLocale } from '@/i18n'

const inventories = ['plugins', 'mcp']

export function AgentTable({ rows, view, data, onOpenFolder }) {
  const { t } = useLocale()
  const counts = useMemo(() => {
    const result = new Map()
    for (const type of inventories) {
      for (const item of data?.[type] || []) {
        if (!result.has(item.agent)) result.set(item.agent, {})
        const entry = result.get(item.agent)
        entry[type] = (entry[type] || 0) + 1
      }
    }
    for (const skill of data?.skills || []) {
      for (const binding of skill.bindings || []) {
        if (binding.state !== 'linked') continue
        if (!result.has(binding.agent)) result.set(binding.agent, {})
        const entry = result.get(binding.agent)
        entry.skills = (entry.skills || 0) + 1
      }
    }
    return result
  }, [data])
  const ordered = [...rows].sort((a, b) => a.name.localeCompare(b.name))
  return <section aria-label={t(view === 'installed' ? 'agent.installed' : 'agent.notInstalled')} className="agent-directory">
    {!ordered.length ? <p className="agent-group-empty">{t(view === 'installed' ? 'agent.noInstalled' : 'agent.noUninstalled')}</p>
      : view === 'installed' ? <div className="agent-table-surface"><table className="agent-table">
      <caption className="sr-only">{t('agent.installed')}</caption>
      <thead><tr><th scope="col">Agent</th><th scope="col" className="agent-metric" title={t('agent.allSkillsHint')}>{t('agent.allSkills')}</th><th scope="col" className="agent-metric">{t('agent.linkedSkills')}</th><th scope="col" className="agent-metric">{t('agent.plugins')}</th><th scope="col" className="agent-metric">MCP</th><th className="agent-table-action"><span className="sr-only">{t('common.openFolder')}</span></th></tr></thead>
      <tbody>{ordered.map((agent) => <tr key={agent.name}>
        <th scope="row"><div className="agent-name"><span className="agent-table-logo"><AgentIcon agent={agent} size={24} /></span><span>{agent.name}</span></div></th>
        <td className="agent-metric"><span data-empty={agent.totalSkills === 0}>{agent.totalSkills ?? '—'}{agent.skillsTruncated ? '+' : ''}</span></td>
        {['skills', ...inventories].map((type) => <td key={type} className="agent-metric"><span data-empty={!counts.get(agent.name)?.[type]} title={agent.support?.[type] === false ? t('agent.resourceLocationMissing') : undefined}>{agent.support?.[type] === false ? '—' : counts.get(agent.name)?.[type] || 0}</span></td>)}
        <td className="agent-table-action"><OpenFolderButton compact path={agent.root || agent.dir} label={`${t('common.openFolder')} · ${agent.name}`} onOpenFolder={onOpenFolder} disabled={agent.configured === false} disabledReason={t('agent.configurationMissing')} /></td>
      </tr>)}</tbody>
    </table></div>
      : <div className="available-agents">{ordered.map((agent) => <div key={agent.name} className="available-agent"><AgentIcon agent={agent} size={22} /><span>{agent.name}</span></div>)}</div>}
  </section>
}

export function AgentTableSkeleton() {
  const { t } = useLocale()
  return <div className="agent-table-surface agent-table-loading" aria-label={t('scanning')} aria-busy="true">
    <div className="h-12 border-b border-border" />
    {Array.from({ length: 8 }, (_, i) => <div key={i} className="flex h-[72px] items-center gap-5 border-b border-border/50 px-6"><span className="size-9 rounded-xl bg-muted animate-pulse" /><span className="h-3 w-28 rounded bg-muted animate-pulse" /><span className="ml-auto h-3 w-1/3 rounded bg-muted animate-pulse" /></div>)}
  </div>
}
