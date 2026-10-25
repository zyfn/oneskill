import { useEffect, useId, useRef, useState } from 'react'
import { CheckIcon, CopyIcon, FolderOpenIcon, XIcon } from '@phosphor-icons/react'
import { AgentIcon, CapabilityIcon } from '@/capability-icon'
import { StatusPill } from '@/status-pill'
import { describeItem, itemKey } from '@/capability-model'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { folderErrorKey, getSkill } from '@/api'
import { skillCategory } from '@/skill-folders.mjs'
import { skillTargets } from '@/skill-targets.mjs'
import { SkillBindingAction } from '@/skill-binding-action'
import { SkillSource } from '@/skill-source'
import { useLocale } from '@/i18n'

function DetailRow({ label, children }) {
  if (children === undefined || children === null || children === '') return null
  return <div className="detail-row grid grid-cols-[70px_minmax(0,1fr)] gap-3 py-2.5 text-[13px] leading-5">
    <dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 break-words">{children}</dd>
  </div>
}

function SkillJunctionMark() {
  return <svg viewBox="0 0 36 38" width="34" height="36" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 8v10m0 0c0 4-3 6-7 6H7v5m11-11v11m0-11c0 4 3 6 7 6h4v5" />
    <circle cx="18" cy="6" r="2.5" fill="currentColor" stroke="none" />
    <circle cx="7" cy="32" r="3" /><circle cx="18" cy="32" r="3" /><circle cx="29" cy="32" r="3" />
  </svg>
}

function CopyPath({ label, value, displayValue, onOpenFolder }) {
  const { t } = useLocale()
  const [state, setState] = useState('')
  const [openState, setOpenState] = useState('')
  const timer = useRef(null)
  const openTimer = useRef(null)
  useEffect(() => () => { clearTimeout(timer.current); clearTimeout(openTimer.current) }, [])
  if (!value) return null
  const copy = async () => {
    clearTimeout(timer.current)
    try { await navigator.clipboard.writeText(value); setState(t('common.copied')) }
    catch { setState(t('common.selectPath')) }
    timer.current = setTimeout(() => setState(''), 2400)
  }
  const openFolder = async () => {
    if (!onOpenFolder) return
    setOpenState('opening')
    try {
      await onOpenFolder(value)
      setOpenState('opened')
    } catch (failure) {
      setOpenState(folderErrorKey(failure))
    }
    clearTimeout(openTimer.current)
    openTimer.current = setTimeout(() => setOpenState(''), 2400)
  }
  return <div className="detail-path">
    <div className="mb-1.5 flex items-center justify-between"><span className="text-[11px] text-muted-foreground">{label}</span>
      <span className="path-actions">
        <button type="button" className="copy-button" aria-label={t('common.copyPath', { label })} title={t('common.copyPath', { label })} onClick={copy}>
          {state === t('common.copied') ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
        </button>
        {onOpenFolder ? <button type="button" className="copy-button" aria-label={t('common.openFolder')} title={t('common.openFolder')} onClick={openFolder} disabled={openState === 'opening'}>
          <FolderOpenIcon size={16} />
        </button> : null}
      </span>
    </div>
    <p className="path-value select-text font-mono" title={value}>{displayValue || value}</p>
    {state ? <p className="mt-1 text-[10px] text-muted-foreground" role="status">{state}</p> : null}
    {openState ? <p className="mt-1 text-[10px] text-muted-foreground" role="status">
      {openState === 'opening' ? t('common.openingFolder') : openState === 'opened' ? t('common.folderOpened') : t(openState)}
    </p> : null}
  </div>
}

function SkillBindings({ item, agents, readOnly, busy, onChange }) {
  const { t } = useLocale()
  const rows = skillTargets(agents).map(group => ({ group, binding: item.bindings?.find(entry => entry.agent === group.agent.name) })).filter(row => row.binding)
  return <section className="detail-bindings" data-count={rows.length}>
    <h3>{t('skills.bindings')}</h3>
    {rows.map(({ group, binding }) => {
      const linked = ['linked', 'inherited'].includes(binding.state)
      const pending = busy === `${binding.agent}:${item.relative}`
      const needsStatus = ['broken', 'conflict'].includes(binding.state) || pending
      return <div key={group.key} className="detail-binding-row" data-state={binding.state}>
        <span className="detail-binding-agent"><AgentIcon agent={group.agent} size={19} /><span>{group.label}</span></span>
        {readOnly ? <span className="binding-status" title={binding.state === 'inherited' ? t('skills.inheritedHint') : undefined}>{t(['broken', 'conflict'].includes(binding.state) ? `skills.${binding.state}` : linked ? 'skills.linked' : 'skills.notLinked')}</span>
          : <span className="detail-binding-control"><span className={`binding-status${needsStatus ? '' : ' sr-only'}`}>{t(pending ? 'common.saving' : ['broken', 'conflict'].includes(binding.state) ? `skills.${binding.state}` : linked ? 'skills.linked' : 'skills.notLinked')}</span><SkillBindingAction skill={item} binding={binding} group={group} busy={busy} onChange={onChange} /></span>}
      </div>
    })}
  </section>
}

function SkillContent({ id }) {
  const [open, setOpen] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!open || result) return
    let active = true
    getSkill(id).then(value => { if (active) setResult(value) }).catch(failure => { if (active) setError(failure.message) })
    return () => { active = false }
  }, [id, open, result])
  return <details className="skill-document" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>SKILL.md</summary>
    {error ? <p role="alert">{error}</p> : result ? <pre>{result.content}</pre> : <p aria-busy="true">…</p>}
  </details>
}

function DetailContent({ route, item, agents, onClose, onBindingChange, bindingBusy, onOpenFolder, scoped }) {
  const { locale, t } = useLocale()
  const [descriptionOpen, setDescriptionOpen] = useState(false)
  const descriptionId = useId()
  const description = describeItem(route, item, locale)
  const descriptionNeedsToggle = description.length > (route === 'skills' ? 80 : 160)
  const isCapability = ['plugins', 'mcp'].includes(route)
  const paths = [...new Set(item.paths?.length ? item.paths : [item.path || item.dir].filter(Boolean))]
  return <div className="detail-content h-full overflow-y-auto" data-route={route}>
    <div className="detail-topline">
      <div className="detail-heading">
        {route === 'skills' ? <span className="detail-skill-mark"><SkillJunctionMark /></span>
          : <span className="detail-icon">{route === 'agents' ? <AgentIcon agent={item} size={28} /> : <CapabilityIcon route={route} item={item} size={28} />}</span>}
        <h2 id="detail-title">{item.name}</h2>
      </div>
      <button type="button" className="detail-close icon-button" onClick={onClose} aria-label={t('common.close')}><XIcon size={19} /></button>
    </div>
    {item.version ? <p className="mt-2 font-mono text-[11px] text-muted-foreground">{item.version}</p> : null}
    {description ? <div className="detail-description">
      <p id={descriptionId} data-expanded={descriptionOpen || !descriptionNeedsToggle}>{description}</p>
      {descriptionNeedsToggle ? <button type="button" className="description-toggle quiet-button" aria-expanded={descriptionOpen} aria-controls={descriptionId} onClick={() => setDescriptionOpen(open => !open)}>
        {t(descriptionOpen ? 'skills.lessDescription' : 'skills.fullDescription')}
      </button> : null}
    </div> : null}
    {isCapability && (!scoped || item.capabilities?.length) ? <div className="detail-context" aria-label={t('common.source')}>
      {item.agent && !scoped ? <span className="detail-owner"><AgentIcon agent={agents.find((agent) => agent.name === item.agent)} size={16} />{(item.agents || [item.agent]).join(' / ')}</span> : null}
      {item.capabilities?.length ? <span className="detail-capabilities">{item.capabilities.join(' · ')}</span> : null}
    </div> : !isCapability && (route === 'agents' || !item.managed) ? <dl className="detail-meta">
      {route === 'agents' ? <div className="detail-status"><StatusPill status={item.installed ? 'installed' : 'not-installed'} /></div> : null}
      {route === 'skills' && !item.managed ? <>
        <DetailRow label={t('common.status')}>{t(item.ignored ? 'skills.ignoredStatus' : 'skills.unmanagedStatus')}</DetailRow>
        <DetailRow label={t('common.source')}><span className="detail-owner"><SkillSource skill={item} agents={agents} size={16} />{skillCategory(item) ? <span className="text-muted-foreground">/ {skillCategory(item)}</span> : null}</span></DetailRow>
      </> : null}
    </dl> : null}
    {route === 'agents' ? <section className="agent-evidence"><h3>{t('agent.evidence')}</h3>
      {(item.detection?.evidence || []).map((evidence, index) => <div key={index}><strong>{t(`agent.evidence_${evidence.kind}`)}</strong><code>{evidence.path || evidence.executablePath}</code>{evidence.probe ? <p>{evidence.probe.runnable ? evidence.probe.version : t('agent.versionFailed')}{evidence.probe.error ? ` · ${typeof evidence.probe.error === 'string' ? evidence.probe.error : JSON.stringify(evidence.probe.error)}` : ''}</p> : null}</div>)}
      {!item.detection?.evidence?.length ? <p>{t('agent.noEvidence')}</p> : null}
    </section> : null}
    {route === 'plugins' ? <p className="resource-scope-note">{t('resources.pluginScope')}</p> : route === 'mcp' ? <p className="resource-scope-note">{t('resources.mcpScope')}</p> : null}
    {route === 'skills' && item.managed && item.bindings?.length ? <SkillBindings item={item} agents={agents} readOnly={!onBindingChange} onChange={onBindingChange} busy={bindingBusy} /> : null}
    <details className="detail-files" open={route !== 'skills'}>
      <summary>{t(route === 'skills' ? 'skills.files' : 'common.details')}</summary>
      {paths.map((path) => <CopyPath key={path} label={route === 'agents' ? t('agent.directory') : route === 'skills' ? t('skills.skillFolder') : t('common.details')} value={path} onOpenFolder={route === 'agents' && !(item.skillsDirectoryExists ?? item.configured ?? item.installed) ? undefined : onOpenFolder} />)}
      {route === 'skills' ? item.sharedLinks?.map(path => <CopyPath key={path} label={t('skills.sharedLinks')} value={path} />) : null}
      {item.manifest && !paths.includes(item.manifest) ? <CopyPath label={t('common.manifest')} value={item.manifest} displayValue={item.path && item.manifest.startsWith(`${item.path}/`) ? item.manifest.slice(item.path.length + 1) : undefined} onOpenFolder={onOpenFolder} /> : null}
    </details>
    {route === 'skills' && item.id ? <SkillContent id={item.id} /> : null}
  </div>
}

export function DetailSheet({ scoped, route, item, agents = [], wide, onClose, onBindingChange, bindingBusy, onOpenFolder }) {
  const { t } = useLocale()
  useEffect(() => {
    if (!item || !wide) return
    const escape = (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) { event.preventDefault(); onClose() }
    }
    document.addEventListener('keydown', escape)
    return () => document.removeEventListener('keydown', escape)
  }, [item, wide, onClose])
  if (!item) return null
  const content = <DetailContent key={itemKey(item)} route={route} item={item} agents={agents} onClose={onClose} onBindingChange={onBindingChange} bindingBusy={bindingBusy} onOpenFolder={onOpenFolder} scoped={scoped} />
  if (wide) return <aside id="capability-detail" aria-labelledby="detail-title" className="detail-paper" data-route={route}>{content}</aside>
  return <Sheet open onOpenChange={(open) => { if (!open) onClose() }}>
    <SheetContent id="capability-detail" showCloseButton={false} className="notebook-detail-sheet gap-0 p-0" data-route={route} onCloseAutoFocus={(event) => event.preventDefault()}>
      <SheetHeader className="sr-only"><SheetTitle>{item.name}</SheetTitle><SheetDescription>{t('common.detailDescription')}</SheetDescription></SheetHeader>
      {content}
    </SheetContent>
  </Sheet>
}
