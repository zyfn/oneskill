import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { useLocale } from '@/i18n'

export function SkillBindingAction({ skill, binding, group, busy, onChange }) {
  const { t } = useLocale()
  if (!binding) return null
  const label = group?.label || binding.agent
  const inherited = binding.state === 'inherited'
  const linked = inherited || binding.state === 'linked'
  const blocked = ['broken', 'conflict'].includes(binding.state)
  const pending = busy === `${binding.agent}:${skill.relative}`
  const stateText = t(blocked ? `skills.${binding.state}` : linked ? 'skills.linked' : 'skills.notLinked')
  const actionLabel = blocked || inherited ? `${label}: ${stateText} · ${skill.name}` : t(linked ? 'skills.unlinkFor' : 'skills.linkFor', { name: skill.name, agent: label })
  const hint = inherited ? `${t('skills.inheritedHint')} · ${binding.inheritedDestinations?.join(', ') || ''}` : blocked ? stateText : `${stateText} · ${t('skills.linkHint')} · ${binding.destination}`
  if (inherited) return <Tooltip><TooltipTrigger asChild><span className="binding-source-status" tabIndex={0}>{t('skills.linkedAtSource')}</span></TooltipTrigger><TooltipContent>{hint}</TooltipContent></Tooltip>
  return <Tooltip>
    <TooltipTrigger asChild>
      <span className="binding-trigger" tabIndex={blocked ? 0 : undefined} aria-label={blocked ? actionLabel : undefined}>
        <button type="button" className="binding-switch-action"
          disabled={blocked || Boolean(busy)} aria-busy={pending}
          role="switch" aria-checked={linked}
          aria-label={actionLabel}
          data-blocked={blocked || undefined} data-pending={pending || undefined}
          onClick={() => onChange(skill, binding)}>
          <span className="connection-switch" aria-hidden="true"><span /></span>
        </button>
      </span>
    </TooltipTrigger>
    <TooltipContent>{pending ? t('common.saving') : hint}</TooltipContent>
  </Tooltip>
}
