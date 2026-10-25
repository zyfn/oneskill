import { useLayoutEffect, useRef, useState } from 'react'
import { ArrowClockwiseIcon } from '@phosphor-icons/react'
import { ScopeTabs, ScopeTab } from '@/scope-tabs'
import { useLocale } from '@/i18n'
import brandSvg from '../public/logo.svg?raw'

// MCP Apps run from an inline sandboxed document, without an asset base URL.
const brandLogo = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(brandSvg)}`

export const routes = [
  { key: 'skills', labelKey: 'nav.skills' }, { key: 'agents', labelKey: 'nav.agents' },
  { key: 'plugins', labelKey: 'nav.plugins' }, { key: 'mcp', labelKey: 'nav.mcp' },
]

export function AppNavigation({ route, onNavigate, onRefresh, refreshing }) {
  const { locale, setLocale, t } = useLocale()
  const navigation = useRef(null)
  const [selection, setSelection] = useState(null)
  useLayoutEffect(() => {
    const nav = navigation.current
    const measure = () => {
      const active = nav?.querySelector('[aria-current="page"]')
      if (!active) return
      const container = nav.getBoundingClientRect(), button = active.getBoundingClientRect()
      const next = { x: button.x - container.x, y: button.y - container.y, width: button.width, height: button.height }
      setSelection(current => current && Object.keys(next).every(key => current[key] === next[key]) ? current : next)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(nav)
    for (const button of nav.querySelectorAll('.app-route-button')) observer.observe(button)
    return () => observer.disconnect()
  }, [route, locale])
  return <header className="app-navigation">
    <button type="button" className="brand" onClick={() => onNavigate('skills')} aria-label={t('brandHome')}>
      <img src={brandLogo} width="24" height="24" alt="" className="brand-mark" />
      <span className="brand-wordmark">oneskill</span>
    </button>
    <nav ref={navigation} className="app-routes" aria-label={t('common.workspace')} data-measured={Boolean(selection)}>
      {selection ? <span className="app-route-indicator" aria-hidden="true" style={{ width: selection.width, height: selection.height, transform: `translate3d(${selection.x}px,${selection.y}px,0)` }}><span className="nav-glass-pill" key={route} /></span> : null}
      {routes.map(({ key, labelKey }) => <button type="button" key={key} className="app-route-button"
        aria-current={route === key ? 'page' : undefined}
        onClick={() => onNavigate(key)}><span>{t(labelKey)}</span></button>)}
    </nav>
    <div className="navigation-tools">
      <ScopeTabs className="language-toggle" label={t('languageSwitch')} value={locale} onChange={setLocale}>
        <ScopeTab value="en" title="English">EN</ScopeTab><ScopeTab value="zh" title="中文">中文</ScopeTab>
      </ScopeTabs>
      <button type="button" className="icon-button navigation-rescan" onClick={onRefresh} disabled={refreshing} aria-label={refreshing ? t('scanning') : t('rescan')} title={t('rescan')}>
        <ArrowClockwiseIcon size={17} className={refreshing ? 'scan-spinner' : undefined} />
      </button>
    </div>
  </header>
}
