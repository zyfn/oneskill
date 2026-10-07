import { useEffect, useRef } from 'react'
import { RadioGroup } from 'radix-ui'
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
  return <RadioGroup.Root ref={strip} className="agent-filter" onFocusCapture={(event) => reveal(event.target.closest('[role="radio"]'))} aria-label={t('import.agent')} value={selected} onValueChange={onChange} orientation="horizontal">
    <RadioGroup.Item value="all" className="agent-filter-option agent-filter-all">
      <span>{t('agent.all')}</span><span className="filter-count">{source.length}</span>
    </RadioGroup.Item>

    {agents.filter((agent) => (agent.detected ?? agent.installed) || counts.has(agent.name)).map((agent) => <RadioGroup.Item key={agent.name} value={agent.name} className="agent-filter-option">
      <AgentIcon agent={agent} size={19} /><span>{agent.name}</span>
      <span className="filter-count">{counts.get(agent.name) || 0}</span>
    </RadioGroup.Item>)}
  </RadioGroup.Root>
}
