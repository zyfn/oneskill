import { CaretRightIcon } from '@phosphor-icons/react'
import { AgentIcon } from '@/capability-icon'
import { itemKey } from '@/capability-model'
import { skillCategory } from '@/skill-folders.mjs'
import { useLocale } from '@/i18n'

export function SkillList({ rows, groups, active, onSelect }) {
  const { t } = useLocale()
  return <div className="skill-list" role="list">
    {rows.map(skill => {
      const linkedGroups = groups.filter(group => ['linked', 'inherited'].includes(skill.bindings?.find(entry => entry.agent === group.agent.name)?.state))
      return <div role="listitem" key={itemKey(skill)}>
      <button type="button" className="skill-list-row" data-selected={Boolean(active && itemKey(active) === itemKey(skill)) || undefined}
        aria-pressed={Boolean(active && itemKey(active) === itemKey(skill))} aria-label={t('skills.view', { name: skill.name })} onClick={event => onSelect(skill, event.currentTarget)}>
        <span className="skill-list-copy"><strong>{skill.name}</strong><span>{skill.description}</span></span>
        <span className="skill-list-category" title={skillCategory(skill)}>{skillCategory(skill)}</span>
        <span className="skill-agent-preview">{linkedGroups.slice(0, 3).map(group => {
          const binding = skill.bindings?.find(entry => entry.agent === group.agent.name)
          const linked = ['linked', 'inherited'].includes(binding?.state)
          return <span key={group.key} className="agent-presence" data-linked={linked || undefined} title={`${group.label} · ${t(linked ? 'skills.linked' : 'skills.notLinked')}`}><AgentIcon agent={group.agent} size={20} /><i /></span>
        })}{linkedGroups.length > 3 ? <small title={linkedGroups.slice(3).map(group => group.label).join(', ')}>+{linkedGroups.length - 3}</small> : null}{skill.status === 'attention' ? <small className="attention-label">{t('integrity.needsReview')}</small> : !linkedGroups.length ? <small>{t('skills.notLinked')}</small> : null}</span>
        <CaretRightIcon className="skill-row-arrow" size={16} />
      </button>
    </div>})}
  </div>
}
