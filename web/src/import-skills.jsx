import { useState } from 'react'
import { ArrowLeftIcon, ArrowRightIcon, CheckCircleIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { AgentIcon } from '@/capability-icon'
import { importLocalSkills } from '@/api'
import { itemKey } from '@/capability-model'
import { useLocale } from '@/i18n'

export function ImportSkills({ items, hasHiddenItems, agents, source, onBack, onImported }) {
  const { t } = useLocale()
  const [selected, setSelected] = useState([])
  const [results, setResults] = useState([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const finished = new Set(results.filter((item) => item.ok).map(itemKey))
  const available = items.filter((item) => !finished.has(itemKey(item)))
  const selectedItems = available.filter((item) => selected.includes(itemKey(item)))
  const allSelected = available.length > 0 && selectedItems.length === available.length
  const toggle = (key) => setSelected((previous) => previous.includes(key) ? previous.filter((item) => item !== key) : [...previous, key])
  const run = async () => {
    setBusy(true)
    setError('')
    try {
      const response = await importLocalSkills(selectedItems.map(({ agent, path }) => ({ agent, path })))
      setResults((previous) => [...previous.filter((item) => !selected.includes(itemKey(item))), ...response.results])
      setSelected([])
      await onImported()
    } catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  return <section className="import-workspace">
    <button type="button" className="back-link" onClick={onBack} disabled={busy}><ArrowLeftIcon size={15} />{t('import.back')}</button>
    <div className="import-heading"><div><h2>{t('import.title')}</h2><p>{t('import.description')}</p></div><div className="import-heading-action"><button type="button" className="primary-action" onClick={run} disabled={busy || !selectedItems.length}>{busy ? t('import.importing') : t('import.importAndLink')}<ArrowRightIcon size={16} /></button><span>{t('import.selected', { count: selectedItems.length })}</span></div></div>
    <p className="import-note">{t('import.note')}</p>
    {available.length ? <div className="agent-table-surface import-table-wrap"><table className="import-table">
      <thead><tr><th className="import-check"><input type="checkbox" aria-label={t('import.selectAll')} disabled={busy} checked={allSelected} onChange={() => setSelected(allSelected ? [] : available.map(itemKey))} /></th><th>{t('import.localSkill')}</th><th>{t('import.agent')}</th></tr></thead>
      <tbody>{available.map((item) => { const key = itemKey(item); return <tr key={key} data-selected={selected.includes(key) || undefined}>
        <td className="import-check"><input type="checkbox" id={`import-${encodeURIComponent(key)}`} aria-label={`${t('import.importAndLink')} ${item.name} ${t('common.from')} ${item.agent}`} disabled={busy} checked={selected.includes(key)} onChange={() => toggle(key)} /></td>
        <th scope="row"><label htmlFor={`import-${encodeURIComponent(key)}`}>{item.name}</label><span className="import-path" title={item.path}>{item.path}</span></th>
        <td><span className="import-agent"><AgentIcon agent={agents.find((agent) => agent.name === item.agent)} size={19} />{item.agent}</span></td>
      </tr> })}</tbody>
    </table></div> : !results.length ? <div className="import-empty"><CheckCircleIcon size={28} /><h3>{hasHiddenItems ? t('import.noMatch') : t('import.everything')}</h3><p>{hasHiddenItems ? t('import.clearSearch') : t('import.none')}</p></div> : null}
    {results.length > 0 ? <div className="import-results" role="status">{results.map((result) => <div key={itemKey(result)} className="import-result" data-ok={result.ok}>
      {result.ok ? <CheckCircleIcon size={19} /> : <WarningCircleIcon size={19} />}
      <div><strong>{result.name || result.path}</strong><p>{result.ok ? `${result.reused ? t('import.reused') : t('import.imported')} · ${t('import.nowLinked', { agent: result.agent })}` : result.error}</p>
        {result.ok ? <details><summary>{t('import.backup')}</summary><code>{result.backup}</code></details> : null}</div>
    </div>)}</div> : null}
    {error ? <p className="import-error" role="alert">{error}</p> : null}
    <div className="import-actions"><div><small title={source}>{t('import.library')} · {source}</small></div></div>
  </section>
}
