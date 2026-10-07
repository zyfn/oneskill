import { useId, useMemo, useRef, useState } from 'react'
import { FolderIcon, SidebarSimpleIcon, LinkIcon, LinkBreakIcon, WarningCircleIcon } from '@phosphor-icons/react'
import { AgentIcon } from '@/capability-icon'
import { OpenFolderButton } from '@/open-folder-button'
import { SkillCollectionNav } from '@/skill-collection-nav'
import { skillCategory, skillCollections, belongsToCollection } from '@/skill-folders.mjs'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLocale } from '@/i18n'

function SkillLinkButton({ skill, binding, busy, onChange }) {
  const { t } = useLocale()
  const linked = binding.state === 'linked'
  const blocked = ['broken', 'conflict'].includes(binding.state)
  const pending = busy === `${binding.agent}:${skill.relative}`
  const label = blocked ? `${binding.agent}: ${t(`skills.${binding.state}`)}` : t(linked ? 'skills.unlinkFor' : 'skills.linkFor', { name: skill.name, agent: binding.agent })
  return <Tooltip>
    <TooltipTrigger asChild>
      <button type="button" className="skill-link" data-linked={linked || undefined} data-blocked={blocked || undefined} data-pending={pending || undefined}
        disabled={blocked || Boolean(busy)} aria-label={label} aria-pressed={linked} aria-busy={pending} onClick={() => onChange(skill, binding)}>
        {blocked ? <WarningCircleIcon size={17} /> : linked ? <LinkIcon size={19} weight="bold" /> : <LinkBreakIcon size={19} />}
      </button>
    </TooltipTrigger>
    <TooltipContent>{blocked ? label : pending ? t('common.saving') : `${linked ? t('skills.linked') : t('skills.notLinked')} · ${t('skills.linkHint')}`}</TooltipContent>
  </Tooltip>
}

export function SkillsLibrary({ rows, skills, agents, selected, onSelect, onLinkChange, onClose, source, onOpenFolder, query, onClearSearch, onReviewUnmanaged, approximate = false }) {
  const { t } = useLocale()
  const [busy, setBusy] = useState('')
  const [folder, setFolder] = useState(null)
  const [collectionsOpen, setCollectionsOpen] = useState(() => {
    try { return localStorage.getItem('oneskill-collections-open') !== 'false' } catch { return true }
  })
  const [expanded, setExpanded] = useState(() => new Set())
  const navId = useId()
  const showButton = useRef(null)
  const hideButton = useRef(null)
  const { folders } = useMemo(() => skillCollections(skills), [skills])
  const activeFolder = folders.some((entry) => entry.path === folder) ? folder : null
  const showCollections = folders.length > 0 && collectionsOpen
  const visible = rows.filter((skill) => belongsToCollection(skill, activeFolder))
  const detected = agents.filter((agent) => (agent.detected ?? agent.installed) && agent.dir)
  const revealParents = (value) => {
    if (!value) return
    const parts = value.split('/')
    setExpanded((current) => new Set([...current, ...parts.slice(0, -1).map((_part, index) => parts.slice(0, index + 1).join('/'))]))
  }
  const chooseFolder = (next) => { setFolder(next); revealParents(next); onClose(false) }
  const toggleBranch = (path) => setExpanded((current) => { const next = new Set(current); next.has(path) ? next.delete(path) : next.add(path); return next })
  const toggleCollections = (open) => {
    setCollectionsOpen(open)
    try { localStorage.setItem('oneskill-collections-open', String(open)) } catch {}
    if (open) revealParents(activeFolder)
    requestAnimationFrame(() => (open ? hideButton : showButton).current?.focus({ preventScroll: true }))
  }
  const changeLink = async (skill, binding) => {
    setBusy(`${binding.agent}:${skill.relative}`)
    try { await onLinkChange(binding.agent, skill.relative, binding.state !== 'linked') }
    finally { setBusy('') }
  }
  const ancestors = activeFolder?.split('/').slice(0, -1).map((_part, index) => activeFolder.split('/').slice(0, index + 1).join('/')) || []
  const showScopePath = activeFolder && (!showCollections || ancestors.some((parent) => !expanded.has(parent)))
  const folderAction = <OpenFolderButton path={source} label={t('skills.libraryFolder')} onOpenFolder={onOpenFolder} compact />

  return <section className="skills-library" data-collections={showCollections ? 'open' : 'closed'} aria-label={t('skills.managedTitle')}>
    {folders.length > 0 ? <SkillCollectionNav id={navId} visible={showCollections} folders={folders} active={activeFolder} count={skills.length} approximate={approximate} expanded={expanded} onExpand={toggleBranch} onChoose={chooseFolder} onHide={() => toggleCollections(false)} hideButtonRef={hideButton} folderAction={showCollections ? folderAction : null} /> : null}
    <div className="library-main">
      {!showCollections || showScopePath ? <div className="library-tools">
        {!showCollections ? <span className="library-icon-actions">{folders.length > 0 ? <button ref={showButton} type="button" className="collection-show" aria-label={t('skills.showCollections')} title={t('skills.showCollections')} aria-expanded="false" aria-controls={navId} onClick={() => toggleCollections(true)}><SidebarSimpleIcon size={16} /></button> : folderAction}</span> : null}
        {showScopePath ? <span className="library-scope-path" title={activeFolder}>{activeFolder}</span> : null}
      </div> : null}
      <span className="sr-only" aria-live="polite">{t('common.result', { count: visible.length })}</span>
      {!visible.length ? <div className="library-empty">
        <FolderIcon size={28} />
        <h3>{query ? t('common.noMatches') : skills.length ? t('skills.emptyCollection') : t('empty.skills')}</h3>
        <p>{query ? t('common.tryAgain') : t('common.noManaged')}</p>
        <button type="button" className="quiet-button" onClick={query ? onClearSearch : onReviewUnmanaged}>{t(query ? 'common.clearSearch' : 'skills.reviewUnmanaged')}</button>
      </div> : <div className="matrix-scroll" tabIndex={0} role="region" aria-label={t('skills.bindings')}
        onScroll={(event) => { event.currentTarget.dataset.scrolled = String(event.currentTarget.scrollTop > 4) }}>
        <table className="skill-matrix library-matrix" style={{ minWidth: `${Math.max(460, 320 + detected.length * 96)}px` }}>
          <thead><tr>
            <th scope="col" className="skill-name-column"><span className="matrix-heading">{t('skills.column')}</span><span className="matrix-legend"><span><LinkIcon size={14} weight="bold" />{t('skills.linked')}</span><span><LinkBreakIcon size={14} />{t('skills.notLinked')}</span></span></th>
            {detected.map((agent) => <th scope="col" key={agent.name}><span className="matrix-agent-heading"><AgentIcon agent={agent} size={22} /><span className="matrix-agent-name" title={agent.name}>{agent.name}</span></span></th>)}
          </tr></thead>
          <tbody>{visible.map((skill) => {
            const category = skillCategory(skill)
            return <tr key={skill.path} data-selected={selected?.path === skill.path || undefined}>
              <th scope="row" className="skill-name-column">
                <button type="button" className="skill-name-button" aria-label={t('skills.view', { name: skill.name })} aria-expanded={selected?.path === skill.path} onClick={(event) => onSelect(skill, event.currentTarget)}>
                  <span className="skill-copy"><span className="skill-title-line"><span className="skill-title" title={skill.name}>{skill.name}</span>{category !== activeFolder && category ? <span className="skill-location" title={category}>{category}</span> : null}</span><span className="skill-description">{skill.description}</span></span>
                </button>
              </th>
              {detected.map((agent) => {
                const binding = skill.bindings?.find((entry) => entry.agent === agent.name)
                return <td key={agent.name}>{binding ? <SkillLinkButton skill={skill} binding={binding} busy={busy} onChange={changeLink} /> : <span className="text-muted-foreground">—</span>}</td>
              })}
            </tr>
          })}</tbody>
        </table>
      </div>}
      {!detected.length && visible.length ? <p className="library-no-agents">{t('skills.noAgents')}</p> : null}
    </div>
  </section>
}
