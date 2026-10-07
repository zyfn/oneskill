import { useMemo, useState } from 'react'
import { ArrowUpRightIcon, MagnifyingGlassIcon } from '@phosphor-icons/react'
import { RadioGroup } from 'radix-ui'
import { SkillsLibrary } from '@/skills-library'
import { ImportSkills } from '@/import-skills'
import { UnmanagedSkills } from '@/unmanaged-skills'
import { AgentFilter } from '@/agent-filter'
import { AgentTable, AgentTableSkeleton } from '@/agent-table'
import { AgentIcon, CapabilityIcon } from '@/capability-icon'
import { describeItem, groupByAgent, itemKey } from '@/capability-model'
import { DetailSheet } from '@/detail-sheet'
import { useWideLayout } from '@/hooks/use-wide-layout'
import { WorkspaceHeader } from '@/workspace-header'
import { Skeleton } from '@/components/ui/skeleton'
import { useLocale } from '@/i18n'

const EMPTY = []

function matchesSearch(item, query) {
  const search = query.trim().toLowerCase()
  return !search || [item.name, item.description, item.source, item.agent, item.relative, item.category].filter(Boolean).join(' ').toLowerCase().includes(search)
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

function NotebookCard({ route, item, selected, onSelect, index }) {
  const { locale, t } = useLocale()
  const description = describeItem(route, item, locale)
  return (
    <button type="button" className="notebook-card group" data-selected={selected || undefined}
      style={{ '--entry-delay': `${Math.min(index, 7) * 30}ms` }}
      aria-label={t('agent.view', { name: item.name })} aria-pressed={selected} aria-controls={selected ? 'capability-detail' : undefined}
      onClick={(event) => onSelect(item, event.currentTarget)}>
      <span className="card-icon"><CapabilityIcon route={route} item={item} size={25} /></span>
      <span className="card-copy block min-w-0">
        <span className="card-title block">{item.name}</span>
        {description ? <span className="card-description">{description}</span> : null}
      </span>
      <ArrowUpRightIcon size={18} className="card-arrow" aria-hidden="true" />
    </button>
  )
}

function Inventory({ route, rows, agents, selected, onSelect, selectedAgent }) {
  const { t } = useLocale()
  const isScoped = selectedAgent !== 'all'
  return groupByAgent(rows).map(([agent, items]) => (
    <section key={agent} className={`inventory-section${isScoped ? ' inventory-section-scoped' : ''}`} aria-label={`${agent} ${t(`page.${route}`)}`}>
      {!isScoped ? <div className="section-heading flex items-center gap-2.5">
        <AgentIcon agent={agents.find((entry) => entry.name === agent)} size={17} />
        <h2>{agent}</h2><span className="section-count">{items.length}</span>
      </div> : null}
      <div className={`notebook-grid capability-grid capability-grid-${route}`}>
        {items.map((item, index) => <NotebookCard key={itemKey(item)} route={route} item={item} index={index} selected={Boolean(selected && itemKey(selected) === itemKey(item))} onSelect={onSelect} />)}
      </div>
    </section>
  ))
}

export function CapabilityView({ route, data, loading, refreshing, hasError, selected, onSelect, onClose, onRefresh, onNavigate, onLinkChange, onOpenFolder }) {
  const { t } = useLocale()
  const [query, setQuery] = useState('')
  const [agent, setAgent] = useState('all')
  const [skillView, setSkillView] = useState('library')
  const showAgentFilter = ['plugins', 'mcp'].includes(route)
  const wide = useWideLayout()
  const agents = data?.agents || EMPTY
  const skills = data?.skills || EMPTY
  const unmanaged = data?.migrations || EMPTY
  const ignored = data?.ignoredSkills || EMPTY
  const source = (route === 'migrate' || (route === 'skills' && skillView === 'unmanaged') ? unmanaged : data?.[route]) || EMPTY
  const rows = useMemo(() => source.filter((item) => (agent === 'all' || item.agent === agent) && matchesSearch(item, query)), [source, query, agent])
  const ignoredRows = useMemo(() => ignored.filter((item) => matchesSearch(item, query)), [ignored, query])
  const changeSkillView = (next) => { setSkillView(next); onClose(false) }

  const resetFilters = () => { setQuery(''); setAgent('all'); onClose(false) }
  const filtered = agent !== 'all'

  return (
    <div className="workspace flex min-h-0 flex-1 flex-col">
      <WorkspaceHeader route={route} approximate={Boolean(data?.scan?.[route]?.truncated)} query={query} onQueryChange={(value) => { setQuery(value); if (selected) onClose(false) }}
        refreshing={refreshing} />
      {route === 'skills' && !loading ? <RadioGroup.Root className="skills-scope" aria-label={t('skills.views')} value={skillView} onValueChange={changeSkillView} orientation="horizontal">
        <RadioGroup.Item value="library">{t('skills.libraryTab')}<span title={data?.scan?.skills?.truncated ? t('common.incompleteScan') : undefined}>{skills.length}{data?.scan?.skills?.truncated ? '+' : ''}</span></RadioGroup.Item>
        <RadioGroup.Item value="unmanaged">{t('skills.inboxTab')}<span title={data?.scan?.migrations?.truncated ? t('common.incompleteScan') : undefined}>{unmanaged.length}{data?.scan?.migrations?.truncated ? '+' : ''}</span></RadioGroup.Item>
      </RadioGroup.Root> : null}
      {showAgentFilter && !loading ? <AgentFilter agents={agents} source={source} selected={agent} onChange={(next) => { setAgent(next); onClose(false) }} /> : null}
      <div className="workspace-content" data-route={route} data-detail={wide && Boolean(selected) || undefined}>
        <div id="workspace-main" role="region" className="catalog-scroll min-w-0" aria-label={`${t(route === 'migrate' ? 'page.skills' : `page.${route}`)} · ${t('common.workspace')}`} aria-busy={loading}>
          {loading ? (route === 'agents' ? <AgentTableSkeleton /> : <LoadingCards />)
            : hasError && !data ? <EmptyState route={route} failed />
            : route === 'migrate' ? <ImportSkills items={rows} hasHiddenItems={rows.length < source.length} agents={agents} source={data?.source} onBack={() => onNavigate('skills')} onImported={onRefresh} />
            : route === 'skills' ? skillView === 'library'
              ? <SkillsLibrary rows={rows} skills={skills} agents={agents} selected={selected} onSelect={onSelect} onLinkChange={onLinkChange} onClose={onClose} source={data?.source} onOpenFolder={onOpenFolder} query={query} onClearSearch={resetFilters} onReviewUnmanaged={() => changeSkillView('unmanaged')} approximate={Boolean(data?.scan?.skills?.truncated)} />
              : <UnmanagedSkills defaultOpen items={rows} ignoredItems={ignoredRows} ignoredCount={ignored.length} agents={agents} selected={selected} onSelect={onSelect} onClose={onClose} onNavigate={onNavigate} onRefresh={onRefresh} />
            : !rows.length ? <EmptyState query={query} filtered={filtered} onReset={resetFilters} route={route} agent={agent} />
            : route === 'agents' ? <AgentTable rows={rows} data={data} onOpenFolder={onOpenFolder} />
            : <Inventory route={route} rows={rows} agents={agents} selected={selected} selectedAgent={agent} onSelect={onSelect} />}

        </div>
        <DetailSheet scoped={filtered} route={route} agents={agents} item={selected} wide={wide} onClose={onClose} onLinkChange={onLinkChange} onOpenFolder={onOpenFolder} />
      </div>
    </div>
  )
}
