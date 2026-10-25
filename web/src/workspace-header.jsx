import { useEffect, useRef } from 'react'
import { MagnifyingGlassIcon, XIcon } from '@phosphor-icons/react'
import { useLocale } from '@/i18n'

export function WorkspaceHeader({ route, query, onQueryChange, refreshing, filters }) {
  const input = useRef(null)
  const { t } = useLocale()
  useEffect(() => {
    const focusSearch = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        input.current?.focus()
      }
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])
  const titleKey = `page.${route}`
  const searchKey = `search.${route}`

  return (
    <header className={`workspace-header${filters ? ' has-filters' : ''}`}>
      <div className="workspace-title-line">
        <h1>{t(titleKey)}</h1>
        {route === 'skills' ? <p className="workspace-description">{t('skills.introduction')}</p> : null}
        {route === 'agents' ? <p className="workspace-description">{t('agent.introduction')}</p> : null}
        {route === 'plugins' ? <p className="workspace-description">{t('plugin.introduction')}</p> : null}
        {route === 'mcp' ? <p className="workspace-description">{t('mcp.introduction')}</p> : null}
      </div>
      <div className={`header-actions flex items-center gap-2.5${filters ? ' has-filters' : ''}`}>
        {filters}
        <div className="search-box relative flex min-w-0 flex-1 items-center gap-2.5 px-3.5">
          <MagnifyingGlassIcon className="shrink-0 text-muted-foreground" size={18} aria-hidden="true" />
          <input aria-label={t(searchKey)} ref={input} value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={t(searchKey)} type="search" className="h-11 w-full min-w-0 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/80" />
          {query ? <button type="button" className="search-clear" aria-label={t('common.clearSearch')} onClick={() => { onQueryChange(''); input.current?.focus() }}><XIcon size={14} /></button> : null}
        </div>
      </div>
      {refreshing ? <div className="scan-progress w-full" role="status"><span>{t('scanning')}</span><div /></div> : null}
    </header>
  )
}
