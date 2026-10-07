import { useEffect, useRef, useState } from 'react'
import { CheckIcon, FolderOpenIcon } from '@phosphor-icons/react'
import { folderErrorKey } from '@/api'
import { useLocale } from '@/i18n'

export function OpenFolderButton({ path, label, onOpenFolder, compact = false, disabled = false, disabledReason }) {
  const { t } = useLocale()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const [opened, setOpened] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  async function open() {
    if (disabled || pending) return
    setPending(true)
    setError(''); setOpened(false); clearTimeout(timer.current)
    try { await onOpenFolder(path); setOpened(true); timer.current = setTimeout(() => setOpened(false), 2400) } catch (failure) { setError(t(folderErrorKey(failure))) }
    finally { setPending(false) }
  }
  return <span className="folder-action" title={disabled ? disabledReason : undefined}>
    <button type="button" className={compact ? 'icon-button' : 'quiet-button'} aria-label={disabledReason && disabled ? `${label} · ${disabledReason}` : label} title={disabled ? disabledReason : path} onClick={open} disabled={disabled || pending}>
      {opened ? <CheckIcon size={17} /> : <FolderOpenIcon size={17} />}{compact ? null : <span className="folder-action-label">{label}</span>}
    </button>
    {opened ? <span className="sr-only" role="status">{t('common.folderOpened')}</span> : null}
    {error ? <span role="alert" className="folder-error">{error}</span> : null}
  </span>
}
