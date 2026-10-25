import { useMemo, useState } from 'react'
import { FolderIcon } from '@phosphor-icons/react'
import { OpenFolderButton } from '@/open-folder-button'
import { SkillCollectionNav } from '@/skill-collection-nav'
import { belongsToCollection } from '@/skill-folders.mjs'
import { skillTargets } from '@/skill-targets.mjs'
import { SkillList } from '@/skill-list'
import { useLocale } from '@/i18n'

export function SkillsLibrary({ rows, skills, folders, agents, selected, onSelect, onClose, source, onOpenFolder, query, onClearSearch, onReviewUnmanaged, approximate = false }) {
  const { t } = useLocale()
  const [folder, setFolder] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())
  const activeFolder = folders.some(entry => entry.path === folder) ? folder : null
  const visible = useMemo(() => rows.filter(skill => belongsToCollection(skill, activeFolder)), [rows, activeFolder])
  const groups = useMemo(() => skillTargets(agents), [agents])
  const chooseFolder = next => {
    setFolder(next); onClose(false)
    if (next) {
      const parts = next.split('/')
      setExpanded(current => new Set([...current, ...parts.slice(0, -1).map((_part, index) => parts.slice(0, index + 1).join('/'))]))
    }
  }
  const folderAction = <OpenFolderButton path={source} label={t('skills.libraryFolder')} onOpenFolder={onOpenFolder} compact />
  return <section className="skills-surface skills-library" data-collections={folders.length ? 'open' : 'closed'} aria-label={t('skills.managedTitle')}>
    {folders.length > 0 ? <SkillCollectionNav folders={folders} active={activeFolder} count={skills.length} approximate={approximate} expanded={expanded}
      onExpand={path => setExpanded(current => { const next = new Set(current); next.has(path) ? next.delete(path) : next.add(path); return next })}
      onChoose={chooseFolder} folderAction={folderAction} /> : null}
    <div className="library-main">
      {!folders.length ? <div className="library-toolbar library-toolbar-folder">{folderAction}</div> : null}
      {activeFolder ? <div className="library-toolbar">
        <div className="library-heading-row">
          <span className="library-scope-path" title={activeFolder}>{activeFolder}</span>
        </div>
      </div> : null}
      <span className="sr-only" aria-live="polite">{t('common.result', { count: visible.length })}</span>
      {visible.length ? <div className="skill-list-scroll"><SkillList rows={visible} groups={groups} active={selected} onSelect={onSelect} /></div>
        : <div className="library-empty"><FolderIcon size={28} /><h3>{query ? t('common.noMatches') : skills.length ? t('skills.emptyCollection') : t('empty.skills')}</h3><p>{query ? t('common.tryAgain') : t('common.noManaged')}</p><button type="button" className="quiet-button" onClick={query ? onClearSearch : onReviewUnmanaged}>{t(query ? 'common.clearSearch' : 'skills.reviewUnmanaged')}</button></div>}
      {!groups.length && visible.length ? <p className="library-no-agents">{t('skills.noAgents')}</p> : null}
    </div>
  </section>
}
