import { FolderIcon } from '@phosphor-icons/react'
import { AgentIcon } from '@/capability-icon'
import { useLocale } from '@/i18n'

export function skillSourceName(skill, t) {
  return skill.sourceKind === 'shared' ? t('skills.sharedSource') : skill.agent
}

export function SkillSource({ skill, agents, size = 17 }) {
  const { t } = useLocale()
  return <>
    {skill.sourceKind === 'shared' ? <FolderIcon size={size} aria-hidden="true" /> : <AgentIcon agent={agents.find(agent => agent.name === skill.agent)} size={size} />}
    <span>{skillSourceName(skill, t)}</span>
  </>
}
