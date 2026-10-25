import { Select } from 'radix-ui'
import { CaretDownIcon, CheckIcon, SquaresFourIcon } from '@phosphor-icons/react'
import { AgentIcon } from '@/capability-icon'
import { resourceGroupKey } from '@/capability-model'
import { useLocale } from '@/i18n'

function AgentMarks({ names = [], agents }) {
  const marks = new Map(names.map(name => {
    const agent = agents.find(entry => entry.name === name) || { name }
    return [agent.logo || name, agent]
  }))
  return <span className="filter-agent-marks" aria-hidden="true">
    {marks.size ? [...marks].map(([key, agent]) => <AgentIcon key={key} agent={agent} size={17} />) : <SquaresFourIcon size={17} />}
  </span>
}

export function AgentFilter({ source, agents, selected, onChange }) {
  const { t } = useLocale()
  const groups = new Map()
  for (const item of source) {
    const key = resourceGroupKey(item)
    const group = groups.get(key) || { names: item.agents || [item.agent], count: 0 }
    group.count++; groups.set(key, group)
  }
  if (selected !== 'all' && !groups.has(selected)) groups.set(selected, { names: selected.split('+'), count: 0 })
  const options = [['all', { names: [], label: t('agent.all') }], ...groups]
  const current = groups.get(selected)
  return <Select.Root value={selected} onValueChange={onChange}>
    <Select.Trigger className="agent-filter-trigger" data-scoped={selected !== 'all' || undefined} aria-label={t('resources.filterAgent')}>
      <Select.Value>
        <span className="filter-agent-value"><AgentMarks names={current?.names} agents={agents} /><span>{current ? current.names.join(' / ') : t('agent.all')}</span></span>
      </Select.Value>
      <Select.Icon asChild><CaretDownIcon size={13} /></Select.Icon>
    </Select.Trigger>
    <Select.Portal>
      <Select.Content className="agent-filter-menu" position="popper" align="start" sideOffset={7} collisionPadding={12}>
        <Select.Viewport className="agent-filter-options">
          <Select.Group>
            {options.map(([key, group]) => <Select.Item key={key} value={key} className="agent-filter-option" textValue={group.label || group.names.join(' / ')}>
              <AgentMarks names={group.names} agents={agents} />
              <span className="filter-agent-label"><Select.ItemText>{group.label || group.names.join(' / ')}</Select.ItemText></span>
              {group.count !== undefined ? <span className="filter-agent-count">{group.count}</span> : null}
              <span className="filter-agent-check"><Select.ItemIndicator><CheckIcon size={14} weight="bold" /></Select.ItemIndicator></span>
            </Select.Item>)}
          </Select.Group>
        </Select.Viewport>
      </Select.Content>
    </Select.Portal>
  </Select.Root>
}
