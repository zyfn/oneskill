import { useId, useMemo } from 'react'
import { CaretRightIcon, FolderIcon, SidebarSimpleIcon, SquaresFourIcon } from '@phosphor-icons/react'
import { collectionHierarchy } from '@/skill-folders.mjs'
import { useLocale } from '@/i18n'

function DirectoryBranch({ entry, active, expanded, onExpand, onChoose, approximate, countHint }) {
  const { t } = useLocale()
  const groupId = useId()
  const hasChildren = entry.children.length > 0
  const open = expanded.has(entry.path)
  const containsActive = active?.startsWith(`${entry.path}/`)
  return <li>
    <div className="collection-row" data-path={entry.path} data-selected={active === entry.path || undefined} data-trail={containsActive || undefined} style={{ '--collection-depth': Math.min(entry.depth, 2) }}>
      {hasChildren ? <button type="button" className="collection-disclosure" aria-label={t(open ? 'skills.collapseFolder' : 'skills.expandFolder', { name: entry.path })} aria-expanded={open} aria-controls={groupId} onClick={() => onExpand(entry.path)}><CaretRightIcon size={13} /></button> : <span className="collection-leaf-icon" aria-hidden="true"><FolderIcon size={14} /></span>}
      <button type="button" className="collection-select" aria-pressed={active === entry.path} title={containsActive && !open ? t('skills.selectedWithin', { name: active }) : entry.path} onClick={() => onChoose(entry.path)}>
        <span className="collection-label">{entry.label}</span><span className="collection-count" title={countHint}>{entry.count}{approximate ? '+' : ''}</span>
      </button>
    </div>
    {hasChildren ? <ul id={groupId} className="collection-children" hidden={!open}>{open ? entry.children.map((child) => <DirectoryBranch key={child.path} entry={child} active={active} expanded={expanded} onExpand={onExpand} onChoose={onChoose} approximate={approximate} countHint={countHint} />) : null}</ul> : null}
  </li>
}

export function SkillCollectionNav({ id, visible, folders, active, count, approximate, expanded, onExpand, onChoose, onHide, hideButtonRef, folderAction }) {
  const { t } = useLocale()
  const tree = useMemo(() => collectionHierarchy(folders), [folders])
  const countHint = approximate ? t('common.incompleteScan') : undefined
  return <nav id={id} className="collection-rail" aria-label={t('skills.collections')} hidden={!visible}>
    <div className="collection-rail-heading"><div className="collection-heading-label"><h2>{t('skills.collections')}</h2>{folderAction}</div><span className="collection-tools"><button ref={hideButtonRef} type="button" className="collection-toggle" aria-label={t('skills.hideCollections')} title={t('skills.hideCollections')} aria-expanded="true" aria-controls={id} onClick={onHide}><SidebarSimpleIcon size={16} /></button></span></div>
    <button type="button" className="collection-all" aria-pressed={active === null} onClick={() => onChoose(null)}><SquaresFourIcon size={16} /><span>{t('skills.allSkills')}</span><span className="collection-count" title={countHint}>{count}{approximate ? '+' : ''}</span></button>
    <ul className="collection-folders">{tree.map((entry) => <DirectoryBranch key={entry.path} entry={entry} active={active} expanded={expanded} onExpand={onExpand} onChoose={onChoose} approximate={approximate} countHint={countHint} />)}</ul>
  </nav>
}
