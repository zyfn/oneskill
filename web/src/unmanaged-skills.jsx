import { useState } from 'react'
import { importSkills, setSkillsIgnored } from '@/api'
import { itemKey } from '@/capability-model'
import { useLocale } from '@/i18n'
import { SkillSource, skillSourceName } from '@/skill-source'

const sourceKey = item => item.sourceKind === 'shared' ? 'shared' : `agent:${item.agent}`

export function UnmanagedSkills({ items, ignoredItems, ignoredCount = ignoredItems.length, agents, selected, onSelect, onClose, onRefresh, disabled, query }) {
  const { t } = useLocale()
  const [busy, setBusy] = useState(false)
  const [showIgnored, setShowIgnored] = useState(false)
  const [selecting, setSelecting] = useState(false)
  const [selection, setSelection] = useState([])
  const [source, setSource] = useState('all')
  const [results, setResults] = useState([])
  const [error, setError] = useState('')
  const candidates = showIgnored ? ignoredItems : items
  const sources = new Map(candidates.map(item => [sourceKey(item), skillSourceName(item, t)]))
  if (source !== 'all' && !sources.has(source)) sources.set(source, source === 'shared' ? t('skills.sharedSource') : source.slice(6))
  const rows = candidates.filter(item => source === 'all' || sourceKey(item) === source)
  const chosen = rows.filter(item => selection.includes(item.id))
  const allSelected = rows.length > 0 && chosen.length === Math.min(rows.length, 100)
  const toggle = id => setSelection(current => current.includes(id) ? current.filter(value => value !== id) : current.length < 100 ? [...current, id] : current)
  const run = async (action, entries) => {
    if (!entries.length || busy || disabled) return
    setBusy(true); setError(''); setResults([])
    try {
      const response = action === 'import' ? await importSkills(entries.map(item => item.id)) : await setSkillsIgnored(entries.map(item => item.id), action === 'ignore')
      const outcome = (response.results || []).map(result => ({ ...result, name: entries.find(item => item.id === result.id)?.name || result.name, action }))
      setResults(outcome)
      const done = new Set(outcome.filter(result => result.ok).map(result => result.id))
      setSelection(current => current.filter(id => !done.has(id)))
      await onRefresh()
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  return <section className="skills-surface skills-inbox" aria-label={t(showIgnored ? 'skills.ignoredTitle' : 'skills.unmanagedTitle')}>
    <div className="inbox-toolbar">
      <div className="inbox-filter">
        {selecting ? <label className="select-visible"><input type="checkbox" checked={allSelected} disabled={busy || disabled} onChange={() => setSelection(allSelected ? [] : rows.slice(0, 100).map(item => item.id))} />{t('import.selected', { count: chosen.length })}</label> : <p className="inbox-description">{t(showIgnored ? 'skills.ignoredDescription' : 'skills.unmanagedDescription')}</p>}
      </div>
      <div className="inbox-tools">
        {selecting ? <>
          {!showIgnored ? <button type="button" className="quiet-button" disabled={!chosen.length || busy || disabled} onClick={() => run('import', chosen)}>{t('import.manageSelected')}</button> : null}
          <button type="button" className="quiet-button" disabled={!chosen.length || busy || disabled} onClick={() => run(showIgnored ? 'restore' : 'ignore', chosen)}>{t(showIgnored ? 'skills.restore' : 'skills.ignore')}</button>
          <button type="button" className="text-action" disabled={busy} onClick={() => { setSelecting(false); setSelection([]) }}>{t('common.cancel')}</button>
        </> : <>
          {sources.size > 1 || source !== 'all' ? <select className="scope-select" aria-label={t('skills.filterSource')} value={source} onChange={event => setSource(event.target.value)}><option value="all">{t('skills.allSources')}</option>{[...sources].map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select> : null}
          {rows.length ? <button type="button" className="text-action" disabled={disabled} onClick={() => { setSelecting(true); onClose(false) }}>{t('skills.selectMultiple')}</button> : null}
          {ignoredCount || showIgnored ? <button type="button" className="text-action" onClick={() => { setShowIgnored(!showIgnored); setSource('all'); setResults([]); onClose(false) }}>{t(showIgnored ? 'skills.backToUnmanaged' : 'skills.viewIgnored', { count: ignoredCount })}</button> : null}
        </>}
      </div>
    </div>
    {selecting ? <p className="bulk-note">{t('skills.batchNote')}</p> : null}
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
    {results.length ? <div className="bulk-results" role="status">
      <span>{t('skills.batchComplete', { count: results.filter(result => result.ok).length })}</span>
      {results.some(result => !result.ok || result.backup) ? <details><summary>{t('common.resultDetails')}</summary>{results.map(result => <p key={result.id}><strong>{result.name}</strong> · {result.ok ? t('common.saved') : result.error}{result.backup ? <code>{t('import.backup')} · {result.backup}</code> : null}</p>)}</details> : null}
    </div> : null}
    <div className="unmanaged-list" data-ignored-view={showIgnored || undefined}>
      {!rows.length ? <p className="unmanaged-empty">{t(query || source !== 'all' ? 'common.noMatches' : showIgnored ? 'skills.noIgnored' : 'skills.noUnmanaged')}</p> : null}
      {rows.map(item => <div className="unmanaged-row" key={itemKey(item)} data-selected={selected?.id === item.id || undefined}>
        {selecting ? <input className="row-check" type="checkbox" aria-label={t('skills.selectFor', { name: item.name })} checked={selection.includes(item.id)} disabled={busy || disabled} onChange={() => toggle(item.id)} /> : null}
        <button type="button" className="unmanaged-skill-main" aria-label={t('skills.view', { name: item.name })} aria-expanded={selected?.id === item.id} onClick={event => onSelect(item, event.currentTarget)}>
          <span className="unmanaged-skill-copy"><strong>{item.name}</strong><span>{item.description}</span></span>
          <span className="unmanaged-source" title={item.path}><SkillSource skill={item} agents={agents} size={17} /></span>
        </button>
        {!selecting ? <span className="unmanaged-actions">
          <button type="button" className="text-action" disabled={busy || disabled} onClick={() => run(showIgnored ? 'restore' : 'ignore', [item])}>{t(showIgnored ? 'skills.restore' : 'skills.ignore')}</button>
          {!showIgnored ? <button type="button" className="unmanaged-action" disabled={busy || disabled} onClick={() => run('import', [item])}>{t('skills.moveToShared')}</button> : null}
        </span> : null}
      </div>)}
    </div>
  </section>
}
