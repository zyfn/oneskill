import { useEffect, useRef } from 'react'
import { ScopeTabs, ScopeTab } from '@/scope-tabs'
import { AgentIcon } from '@/capability-icon'
import { useLocale } from '@/i18n'

export function AgentFilter({ agents, source, selected, onChange }) {
  const { t, locale } = useLocale()
  const strip = useRef(null)
  const reveal = (item) => {
    const container = strip.current
    if (!container || !item) return
    const bounds = container.getBoundingClientRect()
    const target = item.getBoundingClientRect()
    const inset = 28
    if (target.left < bounds.left + inset) container.scrollLeft += target.left - bounds.left - inset
    else if (target.right > bounds.right - inset) container.scrollLeft += target.right - bounds.right + inset
  }
  useEffect(() => {
    reveal(strip.current?.querySelector('[data-state="checked"]'))
  }, [selected])
  useEffect(() => {
    const container = strip.current
    if (!container) return
    const updateEdges = () => {
      container.dataset.moreLeft = String(container.scrollLeft > 1)
      container.dataset.moreRight = String(container.scrollWidth - container.clientWidth - container.scrollLeft > 1)
    }
    const observer = new ResizeObserver(updateEdges)
    observer.observe(container)
    for (const item of container.querySelectorAll('[role="radio"]')) observer.observe(item)
    container.addEventListener('scroll', updateEdges, { passive: true })
    updateEdges()
    return () => {
      observer.disconnect()
      container.removeEventListener('scroll', updateEdges)
    }
  }, [agents, source, locale])
  const counts = new Map()
  for (const item of source) counts.set(item.agent, (counts.get(item.agent) || 0) + 1)
  return <ScopeTabs ref={strip} className="agent-filter" onFocusCapture={(event) => reveal(event.target.closest('[role="radio"]'))} label={t('import.agent')} value={selected} onChange={onChange}>
    <ScopeTab value="all" count={source.length}><span>{t('agent.all')}</span></ScopeTab>

    {agents.filter((agent) => (agent.detected ?? agent.installed) || counts.has(agent.name)).map((agent) => <ScopeTab key={agent.name} value={agent.name} count={counts.get(agent.name) || 0}>
      <AgentIcon agent={agent} size={19} /><span>{agent.name}</span>
    </ScopeTab>)}
  </ScopeTabs>
}
