import { useCallback, useEffect, useRef, useState } from 'react'
import { WarningCircleIcon, XIcon } from '@phosphor-icons/react'
import { AppNavigation, routes } from '@/app-navigation'
import { getWorkspace, openFolder, updateSkillLink, workspaceHost, heartbeat } from '@/api'
import { itemKey } from '@/capability-model'
import { CapabilityView } from '@/capability-view'
import { TooltipProvider } from '@/components/ui/tooltip'
import { LocaleContext, translate } from '@/i18n'
import { WorkspaceStatus } from '@/workspace-status'

const validRoutes = new Set(routes.map((route) => route.key))
function routeFromLocation() {
  const hash = window.location.hash.replace(/^#\/?/, '')
  return validRoutes.has(hash) ? hash : 'skills'
}

export default function App() {
  const host = workspaceHost()
  const [route, setRoute] = useState(routeFromLocation)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState('')
  const [selection, setSelection] = useState(null)
  const [locale, setLocale] = useState(() => {
    if (host.locale) return host.locale.startsWith('zh') ? 'zh' : 'en'
    try { return window.localStorage.getItem('oneskill-locale') === 'zh' ? 'zh' : 'en' } catch { return 'en' }
  })
  const selectionTrigger = useRef(null)
  const loadSequence = useRef(0)
  const t = useCallback((key, values) => translate(locale, key, values), [locale])

  const load = useCallback(async (force = false, quiet = false) => {
    const sequence = ++loadSequence.current
    if (!quiet) { force ? setRefreshing(true) : setLoading(true); setError('') }
    try {
      const next = await getWorkspace(force)
      if (sequence === loadSequence.current) { setData(next); setError('') }
      return true
    } catch (requestError) {
      if (sequence === loadSequence.current) setError(requestError instanceof Error ? requestError.message : String(requestError))
      return false
    } finally {
      if (sequence === loadSequence.current) { setLoading(false); setRefreshing(false) }
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const timer = setInterval(() => { if (document.visibilityState === 'visible') { heartbeat().catch(() => {}); load(false, true) } }, 20000)
    const visible = () => { if (document.visibilityState === 'visible') load(false, true) }
    document.addEventListener('visibilitychange', visible)
    return () => { clearInterval(timer); document.removeEventListener('visibilitychange', visible) }
  }, [load])
  useEffect(() => {
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
    try { window.localStorage.setItem('oneskill-locale', locale) } catch {}
  }, [locale])
  useEffect(() => {
    if (host.embedded) return
    const onHashChange = () => { setRoute(routeFromLocation()); setSelection(null) }
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [host.embedded])

  const navigate = (nextRoute) => {
    if (!validRoutes.has(nextRoute)) return
    setSelection(null)
    setRoute(nextRoute)
    if (!host.embedded) window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${nextRoute}`)
  }
  const closeSelection = useCallback((restoreFocus = true) => {
    setSelection(null)
    if (!restoreFocus) return
    requestAnimationFrame(() => {
      if (selectionTrigger.current?.isConnected) selectionTrigger.current.focus({ preventScroll: true })
    })
  }, [])
  const refresh = async () => { setSelection(null); await load(true) }
  const afterMutation = async () => {
    const refreshed = await load(false, true)
    if (!refreshed) setError(t('common.savedRefreshFailed'))
    return refreshed
  }
  const changeLink = async (agent, skill, linked) => {
    setError('')
    try {
      await updateSkillLink(agent, skill, linked)
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : String(requestError))
      return false
    }
    await afterMutation()
    return true
  }
  const revealFolder = (value) => openFolder(value)

  return (
    <LocaleContext.Provider value={{ locale, setLocale, t }}>
      <TooltipProvider delayDuration={300}>
      <div className="notebook-app">
        <AppNavigation route={route} onNavigate={navigate} onRefresh={refresh} refreshing={refreshing} />
        <main className="app-canvas">
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
            onClose={closeSelection} onRefresh={afterMutation} onLinkChange={changeLink} onOpenFolder={revealFolder} />
          {data ? <WorkspaceStatus data={data} route={route} onRefresh={refresh} refreshing={refreshing} /> : null}
        </main>
      </div>
      </TooltipProvider>
    </LocaleContext.Provider>
  )
}
