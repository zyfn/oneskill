import { useEffect, useRef, useState } from 'react'
import { CheckIcon, CopyIcon, FolderOpenIcon, LinkBreakIcon, LinkIcon, XIcon } from '@phosphor-icons/react'
import { AgentIcon, CapabilityIcon } from '@/capability-icon'
import { StatusPill } from '@/status-pill'
import { describeItem, itemKey } from '@/capability-model'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { folderErrorKey } from '@/api'
import { skillCategory } from '@/skill-folders.mjs'
import { useLocale } from '@/i18n'

function DetailRow({ label, children }) {
  if (children === undefined || children === null || children === '') return null
  return <div className="detail-row grid grid-cols-[70px_minmax(0,1fr)] gap-3 py-2.5 text-[13px] leading-5">
    <dt className="text-muted-foreground">{label}</dt><dd className="min-w-0 break-words">{children}</dd>
  </div>
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
    <p className="path-value select-text break-all font-mono" title={value}>{displayValue || value}</p>
    {state ? <p className="mt-1 text-[10px] text-muted-foreground" role="status">{state}</p> : null}
    {openState ? <p className="mt-1 text-[10px] text-muted-foreground" role="status">
      {openState === 'opening' ? t('common.openingFolder') : openState === 'opened' ? t('common.folderOpened') : t(openState)}
    </p> : null}
  </div>
}

function SkillBindings({ item, agents, onLinkChange }) {
  const { t } = useLocale()
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const change = async (binding) => {
    setBusy(binding.agent)
    setError('')
    try {
      const success = await onLinkChange(binding.agent, item.relative, binding.state !== 'linked')
      if (!success) setError(t('skills.linkFailed'))
    } finally { setBusy('') }
  }
  return <section className="mt-6 border-t border-border pt-5">
    <h3 className="mb-2 text-[12px] font-medium">{t('skills.bindings')}</h3>
    {item.bindings.map((binding) => {
      const blocked = ['conflict', 'broken'].includes(binding.state)
      const linked = binding.state === 'linked'
      return <div key={binding.agent} className="flex min-h-12 items-center justify-between gap-3 border-b border-border/60 py-2 last:border-0">
        <div className="flex min-w-0 items-center gap-2.5"><AgentIcon agent={agents.find((agent) => agent.name === binding.agent)} size={20} /><div className="min-w-0"><span className="block truncate text-xs">{binding.agent}</span>
          {blocked ? <span className="text-[10px] text-warning">{t(`skills.${binding.state}`)}</span> : null}
        </div></div>
        <button type="button" className="quiet-button flex items-center gap-1.5" disabled={Boolean(busy) || blocked} onClick={() => change(binding)} aria-label={t(linked ? 'skills.unlinkFor' : 'skills.linkFor', { name: item.name, agent: binding.agent })}>
          {linked ? <LinkBreakIcon size={13} /> : <LinkIcon size={13} />}
          {busy === binding.agent ? t('common.saving') : linked ? t('common.unlink') : t('common.link')}
        </button>
      </div>
    })}
    {error ? <p role="alert" className="mt-3 text-xs leading-5 text-warning">{error}</p> : null}
  </section>
}

function DetailContent({ route, item, agents, onClose, onLinkChange, onOpenFolder, wide, scoped }) {
  const { locale, t } = useLocale()
  const description = describeItem(route, item, locale)
  const isCapability = ['plugins', 'mcp', 'hooks'].includes(route)
  const paths = [...new Set(item.paths?.length ? item.paths : [item.path || item.dir].filter(Boolean))]
  return <div className="detail-content h-full overflow-y-auto" data-route={route}>
    <div className="detail-topline flex items-start justify-between gap-4">
      {route !== 'skills' ? <span className="detail-icon">{route === 'agents' ? <AgentIcon agent={item} size={32} /> : <CapabilityIcon route={route} item={item} size={30} />}</span> : null}
      <button type="button" className="detail-close icon-button" onClick={onClose} aria-label={t('common.close')}><XIcon size={19} /></button>
    </div>
    <h2 id="detail-title" className="mt-7 break-words text-[23px] font-semibold leading-[1.25] tracking-[-0.045em]">{item.name}</h2>
    {item.version ? <p className="mt-2 font-mono text-[11px] text-muted-foreground">{item.version}</p> : null}
    {description ? <p className="mt-5 whitespace-pre-line break-words text-[13px] leading-[1.9] text-muted-foreground">{description}</p> : null}
    {isCapability && (!scoped || item.capabilities?.length) ? <div className="detail-context" aria-label={t('common.source')}>
      {item.agent && !scoped ? <span className="detail-owner"><AgentIcon agent={agents.find((agent) => agent.name === item.agent)} size={16} />{item.agent}</span> : null}
      {item.capabilities?.length ? <span className="detail-capabilities">{item.capabilities.join(' · ')}</span> : null}
    </div> : !isCapability ? <dl className="detail-meta">
      {route === 'agents' ? <div className="detail-status"><StatusPill status={(item.detected ?? item.installed) ? 'installed' : 'not-installed'} /></div> : null}
      {route === 'skills' && item.unmanaged ? <>
        <DetailRow label={t('common.status')}>{t(item.ignored ? 'skills.ignoredStatus' : 'skills.unmanagedStatus')}</DetailRow>
        <DetailRow label={t('common.source')}><span className="detail-owner"><AgentIcon agent={agents.find((agent) => agent.name === item.agent)} size={16} />{item.agent}{skillCategory(item) ? <span className="text-muted-foreground">/ {skillCategory(item)}</span> : null}</span></DetailRow>
      </> : null}
      {route === 'skills' && !item.unmanaged ? <DetailRow label={t('common.linked')}>{item.linked} / {item.agentCount}</DetailRow> : null}
    </dl> : null}
    <section className="detail-files">
      {paths.map((path) => <CopyPath key={path} label={route === 'agents' ? t('agent.directory') : route === 'skills' ? t('skills.skillFolder') : t('common.details')} value={path} onOpenFolder={route === 'agents' && !(item.skillsDirectoryExists ?? item.configured ?? item.installed) ? undefined : onOpenFolder} />)}
      {item.manifest && !paths.includes(item.manifest) ? <CopyPath label={t('common.manifest')} value={item.manifest} displayValue={item.path && item.manifest.startsWith(`${item.path}/`) ? item.manifest.slice(item.path.length + 1) : undefined} onOpenFolder={onOpenFolder} /> : null}
    </section>
    {route === 'skills' && !item.unmanaged && !wide && item.bindings?.length ? <SkillBindings item={item} agents={agents} onLinkChange={onLinkChange} /> : null}
  </div>
}

export function DetailSheet({ scoped, route, item, agents = [], wide, onClose, onLinkChange, onOpenFolder }) {
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
  const content = <DetailContent key={itemKey(item)} route={route} item={item} agents={agents} onClose={onClose} onLinkChange={onLinkChange} onOpenFolder={onOpenFolder} wide={wide} scoped={scoped} />
  if (wide) return <aside id="capability-detail" aria-labelledby="detail-title" className="detail-paper">{content}</aside>
  return <Sheet open onOpenChange={(open) => { if (!open) onClose() }}>
    <SheetContent id="capability-detail" showCloseButton={false} className="notebook-detail-sheet gap-0 p-0" onCloseAutoFocus={(event) => event.preventDefault()}>
      <SheetHeader className="sr-only"><SheetTitle>{item.name}</SheetTitle><SheetDescription>{t('common.detailDescription')}</SheetDescription></SheetHeader>
      {content}
    </SheetContent>
  </Sheet>
}
