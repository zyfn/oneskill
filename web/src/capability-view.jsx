import { useMemo, useRef, useState } from 'react'
import { ArrowUpRightIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'
import { ScopeTabs, ScopeTab } from '@/scope-tabs'
import { SkillsLibrary } from '@/skills-library'
import { UnmanagedSkills } from '@/unmanaged-skills'
import { AgentFilter } from '@/agent-filter'
import { AgentTable, AgentTableSkeleton } from '@/agent-table'
import { AgentIcon, CapabilityIcon } from '@/capability-icon'
import { describeItem, groupByAgent, itemKey, resourceGroupKey } from '@/capability-model'
import { DetailSheet } from '@/detail-sheet'
import { useWideLayout } from '@/hooks/use-wide-layout'
import { WorkspaceHeader } from '@/workspace-header'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale } from '@/i18n'
import { skillCollections } from '@/skill-folders.mjs'
import { LinkIssues } from '@/link-issues'

const EMPTY = []

function matchesSearch(item, query) {
  const search = query.trim().toLowerCase()
  return !search || [item.name, item.description, item.source, item.agent, ...(item.agents || []), item.relative, item.category].filter(Boolean).join(' ').toLowerCase().includes(search)
}

function EmptyState({ query, filtered, onReset, route, failed, agent }) {
  const { t } = useLocale()
  const title = failed ? t('common.unable') : query ? t('common.noMatches') : t(`empty.${route || 'skills'}`)
  const description = failed ? t('common.retryAbove') : query ? t('common.tryAgain') : filtered ? t('common.noAgentItems', { agent }) : route === 'skills' ? t('common.noManaged') : t('common.scanAgain')
  return (
    <div className="empty-state flex min-h-72 flex-col items-center justify-center px-6 py-16 text-center">
      <span className="mb-5 flex size-14 items-center justify-center rounded-2xl border border-white bg-white/70">
        <MagnifyingGlassIcon size={25} className="text-muted-foreground" />
      </span>
      <h2 className="text-base font-medium">{title}</h2>
      <p className="mt-2 max-w-xs text-[13px] leading-6 text-muted-foreground">{description}</p>
      {query || filtered ? <button type="button" className="quiet-button mt-5" onClick={onReset}>{query ? t('skills.clearSearch') : t('agent.all')}</button> : null}
    </div>
  )
}

function LoadingCards() {
  const { t } = useLocale()
  return <div className="notebook-grid capability-grid" aria-label={t('scanning')} aria-busy="true">
    {Array.from({ length: 6 }, (_, i) => <div key={i} className="notebook-card skeleton-card">
      <Skeleton className="size-10 rounded-xl" /><span><Skeleton className="h-4 w-2/3" /><Skeleton className="mt-3 h-3 w-full" /></span>
    </div>)}
  </div>
}

function NotebookCard({ route, item, selected, onSelect }) {
  const { locale, t } = useLocale()
  const description = describeItem(route, item, locale)
  return (
    <button type="button" className="notebook-card group" data-selected={selected || undefined}
      aria-label={t('agent.view', { name: item.name })} aria-pressed={selected} aria-controls={selected ? 'capability-detail' : undefined}
      onClick={(event) => onSelect(item, event.currentTarget)}>
      <span className="card-icon"><CapabilityIcon route={route} item={item} size={25} /></span>
      <span className="card-copy block min-w-0">
        <span className="card-title-line">
          <span className="card-title" title={item.name}>{item.name}</span>
          {item.version ? <span className="resource-version">{item.version}</span> : null}
        </span>
        {description ? <span className="card-description">{description}</span> : null}
        {route === 'mcp' && item.enabled !== undefined ? <span className="resource-version">{t(item.enabled ? 'resources.enabledDeclaration' : 'resources.disabledDeclaration')}</span> : null}
      </span>
      <ArrowUpRightIcon size={18} className="card-arrow" aria-hidden="true" />
    </button>
  )
}

function Inventory({ route, rows, agents, selected, onSelect, selectedAgent }) {
  const { t } = useLocale()
  const isScoped = selectedAgent !== 'all'
  return groupByAgent(rows).map(([agent, items]) => {
    const label = [...new Set(items.flatMap(item => item.agents || [item.agent]))].join(' / ')
    return <section key={agent} className={`inventory-section${isScoped ? ' inventory-section-scoped' : ''}`} aria-label={`${label} ${t(`page.${route}`)}`}>
      {!isScoped ? <div className="section-heading flex items-center gap-2.5">
        <AgentIcon agent={agents.find((entry) => entry.name === agent)} size={17} />
        <h2>{label}</h2><span className="section-count">{items.length}</span>
      </div> : null}
      <div className={`notebook-grid capability-grid capability-grid-${route}`}>
        {items.map((item) => <NotebookCard key={itemKey(item)} route={route} item={item} selected={Boolean(selected && itemKey(selected) === itemKey(item))} onSelect={onSelect} />)}
      </div>
    </section>
  })
}

export function CapabilityView({ route, data, loading, refreshing, hasError, selected, onSelect, onClose, onRefresh, onLinkChange, onOpenFolder }) {
  const { t } = useLocale()
  const [query, setQuery] = useState('')
  const [agent, setAgent] = useState('all')
  const [skillView, setSkillView] = useState('library')
  const [agentView, setAgentView] = useState('installed')
  const [bindingBusy, setBindingBusy] = useState('')
  const pendingBinding = useRef(false)
  const showAgentFilter = ['plugins', 'mcp'].includes(route)
  const wide = useWideLayout()
  const agents = data?.agents || EMPTY
  const allSkills = data?.skills || EMPTY
  const skills = useMemo(() => allSkills.filter(item => item.managed), [allSkills])
  const { folders } = useMemo(() => skillCollections(skills), [skills])
  const unmanaged = useMemo(() => allSkills.filter(item => !item.managed && !item.ignored), [allSkills])
  const ignored = useMemo(() => allSkills.filter(item => !item.managed && item.ignored), [allSkills])
  const installedAgents = agents.filter((entry) => entry.installed)
  const uninstalledAgents = agents.filter((entry) => !entry.installed)
  const source = (route === 'skills' ? skillView === 'unmanaged' ? unmanaged : skills : route === 'agents' ? agentView === 'installed' ? installedAgents : uninstalledAgents : data?.[route]) || EMPTY
  const rows = useMemo(() => source.filter((item) => (agent === 'all' || resourceGroupKey(item) === agent) && matchesSearch(item, query)), [source, query, agent])
  const ignoredRows = useMemo(() => ignored.filter((item) => matchesSearch(item, query)), [ignored, query])
  const changeSkillView = (next) => { setSkillView(next); onClose(false) }
  const detailItem = selected ? (route === 'skills' ? allSkills : source).find(item => itemKey(item) === itemKey(selected)) || null : null
  const changeBinding = async (skill, binding) => {
    if (pendingBinding.current || ['inherited', 'broken', 'conflict'].includes(binding.state)) return false
    pendingBinding.current = true
    setBindingBusy(`${binding.agent}:${skill.relative}`)
    try { return await onLinkChange(binding.agent, skill.relative, binding.state !== 'linked') }
    finally { pendingBinding.current = false; setBindingBusy('') }
  }

  const resetFilters = () => { setQuery(''); setAgent('all'); onClose(false) }
  const filtered = agent !== 'all'
  const headerFilters = !loading && route === 'skills' ? <ScopeTabs className="header-scope-tabs" label={t('skills.views')} value={skillView} onChange={changeSkillView}>
    <ScopeTab value="library" count={`${skills.length}${data?.scan?.skills?.truncated ? '+' : ''}`} countHint={data?.scan?.skills?.truncated ? t('common.incompleteScan') : undefined}>{t('skills.libraryTab')}</ScopeTab>
    <ScopeTab value="unmanaged" count={`${unmanaged.length}${data?.scan?.skills?.unmanaged?.truncated ? '+' : ''}`} countHint={data?.scan?.skills?.unmanaged?.truncated ? t('common.incompleteScan') : undefined}>{t('skills.inboxTab')}</ScopeTab>
  </ScopeTabs> : !loading && route === 'agents' ? <ScopeTabs className="header-scope-tabs" label={t('agent.views')} value={agentView} onChange={setAgentView}>
    <ScopeTab value="installed" count={installedAgents.length}>{t('agent.installed')}</ScopeTab>
    <ScopeTab value="not-installed" count={uninstalledAgents.length}>{t('agent.notInstalled')}</ScopeTab>
  </ScopeTabs> : !loading && showAgentFilter ? <AgentFilter source={source} agents={agents} selected={agent} onChange={next => { setAgent(next); onClose(false) }} /> : null

  return (
    <div className="workspace flex min-h-0 flex-1 flex-col">
      <WorkspaceHeader route={route} query={query} onQueryChange={(value) => { setQuery(value); if (selected) onClose(false) }}
        refreshing={refreshing} filters={headerFilters} />
      {route === 'skills' ? <LinkIssues issues={data?.linkIssues} skills={skills} onRefresh={onRefresh} disabled={data?.stale} /> : null}
      <div className="workspace-content" data-route={route} data-detail={wide && Boolean(detailItem) || undefined}>
        <div id="workspace-main" role="region" className="catalog-scroll min-w-0" aria-label={`${t(`page.${route}`)} · ${t('common.workspace')}`} aria-busy={loading}>
          {loading ? (route === 'agents' ? <AgentTableSkeleton /> : <LoadingCards />)
            : hasError && !data ? <EmptyState route={route} failed />
            : route === 'skills' ? skillView === 'library'
              ? <SkillsLibrary rows={rows} skills={skills} folders={folders} agents={agents} selected={detailItem} onSelect={onSelect} onClose={onClose} source={data?.source} onOpenFolder={onOpenFolder} query={query} onClearSearch={resetFilters} onReviewUnmanaged={() => changeSkillView('unmanaged')} approximate={Boolean(data?.scan?.skills?.truncated)} />
              : <UnmanagedSkills items={rows} ignoredItems={ignoredRows} ignoredCount={ignored.length} agents={agents} selected={selected} onSelect={onSelect} onClose={onClose} onRefresh={onRefresh} disabled={data?.stale} query={query} />
            : route === 'agents' ? <AgentTable rows={rows} view={agentView} data={data} onOpenFolder={onOpenFolder} onSelect={onSelect} />
            : !rows.length ? <EmptyState query={query} filtered={filtered} onReset={resetFilters} route={route} agent={agent.replaceAll('+', ' / ')} />
            : <Inventory route={route} rows={rows} agents={agents} selected={selected} selectedAgent={agent} onSelect={onSelect} />}

        </div>
        <DetailSheet scoped={filtered} route={route} agents={agents} item={detailItem} wide={wide} onClose={onClose} onBindingChange={data?.stale ? undefined : changeBinding} bindingBusy={bindingBusy} onOpenFolder={onOpenFolder} />
      </div>
    </div>
  )
}
