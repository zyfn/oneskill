import { useEffect, useRef } from 'react'
import { MagnifyingGlassIcon, XIcon } from '@phosphor-icons/react'
import { RadioGroup } from 'radix-ui'
import { useLocale } from '@/i18n'

export function WorkspaceHeader({ route, approximate = false, query, onQueryChange, refreshing }) {
  const input = useRef(null)
  const { locale, setLocale, t } = useLocale()
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
  const titleKey = route === 'migrate' ? 'page.skills' : `page.${route}`
  const searchKey = route === 'migrate' ? 'search.migrate' : `search.${route}`

  return (
    <header className="workspace-header">
      <div className="workspace-title-line">
        <h1>{t(titleKey)}</h1>
        {approximate && ['plugins', 'mcp'].includes(route) ? <span className="workspace-scan-note" role="status" title={t('common.incompleteScan')}>{t('common.incompleteScan')}</span> : null}
      </div>
      <div className="header-actions flex items-center gap-2.5">
        <div className="search-box relative flex min-w-0 flex-1 items-center gap-2.5 px-3.5">
          <MagnifyingGlassIcon className="shrink-0 text-muted-foreground" size={18} aria-hidden="true" />
          <input aria-label={t(searchKey)} ref={input} value={query} onChange={(event) => onQueryChange(event.target.value)} placeholder={t(searchKey)} type="search" className="h-11 w-full min-w-0 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground/80" />
          {query ? <button type="button" className="search-clear" aria-label={t('common.clearSearch')} onClick={() => { onQueryChange(''); input.current?.focus() }}><XIcon size={14} /></button> : null}
        </div>
        <RadioGroup.Root className="language-toggle" data-locale={locale} aria-label={t('languageSwitch')} value={locale} onValueChange={setLocale} orientation="horizontal">
          <span className="language-lens" aria-hidden="true" />
          <RadioGroup.Item value="en" title="English">EN</RadioGroup.Item>
          <RadioGroup.Item value="zh" title="中文">中文</RadioGroup.Item>
        </RadioGroup.Root>
      </div>
      {route === 'skills' ? <p className="workspace-description">{t('skills.introduction')}</p> : null}
      {refreshing ? <div className="scan-progress w-full" role="status"><span>{t('scanning')}</span><div /></div> : null}
    </header>
  )
}
