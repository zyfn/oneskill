import { useState } from 'react'
import { ArrowRightIcon, CheckCircleIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { InventoryGroup } from '@/inventory-group'
import { AgentIcon } from '@/capability-icon'
import { importLocalSkills, setSkillIgnored } from '@/api'
import { itemKey } from '@/capability-model'
import { useLocale } from '@/i18n'

export function UnmanagedSkills({ items, ignoredItems, ignoredCount = ignoredItems.length, agents, selected, onSelect, onClose, onNavigate, onRefresh, defaultOpen = false }) {
  const { t } = useLocale()
  const [busy, setBusy] = useState(null)
  const [feedback, setFeedback] = useState({})
  const [showIgnored, setShowIgnored] = useState(false)
  const [expanded, setExpanded] = useState(defaultOpen)
  const [notice, setNotice] = useState('')
  const rows = showIgnored ? ignoredItems : items

  const move = async (item) => {
    const key = itemKey(item)
    setBusy({ key, action: 'move' })
    setNotice('')
    setFeedback((current) => ({ ...current, [key]: null }))
    try {
      const response = await importLocalSkills([{ agent: item.agent, path: item.path }])
      const result = response.results?.[0]
      if (result?.ok) {
        setFeedback((current) => ({ ...current, [key]: { ok: true } }))
        await onRefresh()
      } else {
        setFeedback((current) => ({ ...current, [key]: { ok: false, message: result?.error || t('skills.moveFailed') } }))
      }
    } catch (error) {
      setFeedback((current) => ({ ...current, [key]: { ok: false, message: error.message || t('skills.moveFailed') } }))
    } finally { setBusy(null) }
  }

  const ignore = async (item, ignored) => {
    const key = itemKey(item)
    setBusy({ key, action: ignored ? 'ignore' : 'restore' })
    setNotice('')
    setFeedback((current) => ({ ...current, [key]: null }))
    try {
      await setSkillIgnored(item.agent, item.path, ignored)
      await onRefresh()
      setNotice(t(ignored ? 'skills.ignoredNotice' : 'skills.restoredNotice', { name: item.name }))
    } catch {
      setFeedback((current) => ({ ...current, [key]: { ok: false, message: t('skills.ignoreFailed') } }))
    } finally { setBusy(null) }
  }

  return <InventoryGroup title={t(showIgnored ? 'skills.ignoredTitle' : 'skills.unmanagedTitle')} count={rows.length} className="unmanaged-skills" open={expanded} onOpenChange={setExpanded} onCollapse={() => onClose(false)}
    headerAction={ignoredCount || showIgnored ? <button type="button" className="unmanaged-view-toggle" aria-pressed={showIgnored} onClick={(event) => {
      const group = event.currentTarget.closest('.inventory-group')
      setShowIgnored(!showIgnored); setExpanded(true); setNotice(''); onClose(false)
      requestAnimationFrame(() => { if (group?.isConnected) group.scrollIntoView({ block: 'start' }) })
    }} disabled={Boolean(busy)}>{showIgnored ? t('skills.backToUnmanaged') : t('skills.viewIgnored', { count: ignoredCount })}</button> : null}>
    <p className="inventory-group-description">{t(showIgnored ? 'skills.ignoredDescription' : 'skills.unmanagedDescription')}</p>
    <div className="unmanaged-list" data-ignored-view={showIgnored || undefined}>
      {!rows.length ? <p className="unmanaged-empty">{t(showIgnored ? 'skills.noIgnored' : 'skills.noUnmanaged')}</p> : null}
      {rows.map((item) => {
        const key = itemKey(item)
        const result = feedback[key]
        const detailItem = { ...item, unmanaged: true }
        const isSelected = selected?.unmanaged && itemKey(selected) === key
        return <div className="unmanaged-row" key={key} data-selected={isSelected || undefined} data-result={result?.ok ? 'success' : result?.ok === false ? 'error' : undefined}>
          <button type="button" className="unmanaged-skill-main" aria-label={t('skills.view', { name: item.name })} aria-expanded={isSelected} onClick={(event) => onSelect(detailItem, event.currentTarget)}>
            <span className="unmanaged-skill-copy"><strong>{item.name}</strong><span>{item.description}</span></span>
            <span className="unmanaged-source" title={item.path} aria-label={`${t('common.source')}: ${item.agent}`}>
              <span className="unmanaged-owner"><AgentIcon agent={agents.find((agent) => agent.name === item.agent)} size={17} /><span>{item.agent}</span></span>
            </span>
          </button>
          <span className="unmanaged-actions">
            {showIgnored ? <button type="button" className="unmanaged-action" onClick={() => ignore(item, false)} disabled={Boolean(busy)} aria-label={t('skills.restoreFor', { name: item.name, agent: item.agent })}>{busy?.key === key ? t('skills.restoring') : t('skills.restore')}</button> : <>
              <button type="button" className="unmanaged-ignore" onClick={() => ignore(item, true)} disabled={Boolean(busy)} aria-label={t('skills.ignoreFor', { name: item.name, agent: item.agent })}>{busy?.key === key && busy.action === 'ignore' ? t('skills.ignoring') : t('skills.ignore')}</button>
              <button type="button" className="unmanaged-action" onClick={() => move(item)} disabled={Boolean(busy)}>{result?.ok ? <CheckCircleIcon size={16} /> : result?.ok === false ? <WarningCircleIcon size={16} /> : null}{busy?.key === key && busy.action === 'move' ? t('skills.moving') : result?.ok ? t('skills.moved') : t('skills.moveToShared')}</button>
            </>}
          </span>
          {result?.ok === false ? <p className="unmanaged-error">{result.message}</p> : null}
        </div>
      })}
      {notice ? <p className="unmanaged-notice" role="status">{notice}</p> : null}
      {!showIgnored && items.length ? <div className="unmanaged-footer"><span>{t('skills.moveHint')}</span><button type="button" className="unmanaged-batch" onClick={() => onNavigate('migrate')}>{t('skills.importMultiple')}<ArrowRightIcon size={15} /></button></div> : null}
    </div>
  </InventoryGroup>
}
