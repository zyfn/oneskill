import { useCallback, useEffect, useRef, useState } from 'react'
import { WarningCircleIcon, XIcon } from '@phosphor-icons/react'
import { AppSidebar, routes } from '@/app-sidebar'
import { getWorkspace, openFolder, updateSkillLink } from '@/api'
import { itemKey } from '@/capability-model'
import { CapabilityView } from '@/capability-view'
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar'
import { TooltipProvider } from '@/components/ui/tooltip'
import { LocaleContext, translate } from '@/i18n'

const validRoutes = new Set([...routes.map((route) => route.key), 'migrate'])
function routeFromLocation() {
  const hash = window.location.hash.replace(/^#\/?/, '')
  return validRoutes.has(hash) ? hash : 'agents'
}

export default function App() {
  const [route, setRoute] = useState(routeFromLocation)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [selection, setSelection] = useState(null)
  const [locale, setLocale] = useState(() => {
    try { return window.localStorage.getItem('oneskill-locale') === 'zh' ? 'zh' : 'en' } catch { return 'en' }
  })
  const selectionTrigger = useRef(null)
  const t = useCallback((key, values) => translate(locale, key, values), [locale])

  const load = useCallback(async (force = false) => {
    force ? setRefreshing(true) : setLoading(true)
    setError('')
    try {
      setData(await getWorkspace(force))
      return true
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError))
      return false
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
    try { window.localStorage.setItem('oneskill-locale', locale) } catch {}
  }, [locale])
  useEffect(() => {
    const onHashChange = () => { setRoute(routeFromLocation()); setSelection(null) }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  const navigate = (nextRoute) => {
    if (!validRoutes.has(nextRoute)) return
    setSelection(null)
    setRoute(nextRoute)
    window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${nextRoute}`)
  }
  const closeSelection = useCallback((restoreFocus = true) => {
    setSelection(null)
    if (!restoreFocus) return
    requestAnimationFrame(() => {
      if (selectionTrigger.current?.isConnected) selectionTrigger.current.focus({ preventScroll: true })
    })
  }, [])
  const refresh = async () => { setSelection(null); await load(true) }
  const changeLink = async (agent, skill, linked) => {
    setError('')
    try {
      await updateSkillLink(agent, skill, linked)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError))
      return false
    }
    setSelection(null)
    await load(true)
    return true
  }
  const revealFolder = (value) => openFolder(value)

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      <TooltipProvider delayDuration={300}>
      <SidebarProvider style={{ '--sidebar-width': '13.25rem' }} className="notebook-app">
        <AppSidebar route={route} onNavigate={navigate} onRefresh={refresh} refreshing={refreshing} />
        <SidebarInset className="app-canvas h-dvh min-w-0 overflow-hidden bg-transparent">
          <div className="mobile-bar flex h-14 shrink-0 items-center px-4 sm:hidden">
            <SidebarTrigger /><span className="ml-2 text-sm font-semibold tracking-tight">oneskill</span>
          </div>
          {error ? (
            <div role="alert" className="error-banner mx-5 mt-4 flex shrink-0 items-start gap-2 rounded-xl border border-warning-border bg-warning-muted px-4 py-3 text-xs text-warning sm:mx-8">
              <WarningCircleIcon size={17} className="shrink-0" />
              <span className="min-w-0 flex-1 break-words">{error}</span>
              <button type="button" className="font-semibold underline underline-offset-4" onClick={() => load(Boolean(data))} disabled={loading || refreshing}>{t('common.retry')}</button>
              <button type="button" onClick={() => setError('')} aria-label={t('common.dismiss')}><XIcon size={16} /></button>
            </div>
          ) : null}
          <CapabilityView key={route} route={route} data={data} loading={loading} refreshing={refreshing} hasError={Boolean(error)}
            selected={selection}
            onSelect={(item, trigger) => { selectionTrigger.current = trigger; setSelection((current) => current && itemKey(current) === itemKey(item) ? null : item) }}
            onClose={closeSelection} onRefresh={refresh} onNavigate={navigate} onLinkChange={changeLink} onOpenFolder={revealFolder} />
        </SidebarInset>
      </SidebarProvider>
      </TooltipProvider>
    </LocaleContext.Provider>
  )
}
