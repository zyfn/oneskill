import { CheckCircleIcon, MinusCircleIcon } from '@phosphor-icons/react'
import { useLocale } from '@/i18n'

export function StatusPill({ status }) {
  const { t } = useLocale()
  const installed = status === 'installed'
  const Icon = installed ? CheckCircleIcon : MinusCircleIcon
  return <span className="agent-installation" data-installed={installed}>
    <Icon size={14} weight="regular" aria-hidden="true" />
    {installed ? t('agent.installed') : t('agent.notInstalled')}
  </span>
}
