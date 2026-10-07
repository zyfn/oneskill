import { useId, useState } from 'react'
import { CaretDownIcon } from '@phosphor-icons/react'
import { useLocale } from '@/i18n'

export function InventoryGroup({ title, hint, count, defaultOpen = false, open: controlledOpen, onOpenChange, status, children, className = '', onCollapse, headerAction }) {
  const [localOpen, setLocalOpen] = useState(defaultOpen)
  const open = controlledOpen ?? localOpen
  const id = useId()
  const { t } = useLocale()
  const toggle = () => {
    if (open) onCollapse?.()
    if (controlledOpen === undefined) setLocalOpen(!open)
    onOpenChange?.(!open)
  }
  return <section className={`inventory-group ${className}`} data-open={open}>
    <h2 className="inventory-group-heading">
      <button type="button" className="inventory-group-toggle" aria-expanded={open} aria-controls={id} onClick={toggle}>
        <span className="inventory-group-title" title={hint}>{status ? <i data-status={status} aria-hidden="true" /> : null}{title}<span className="inventory-group-count">{count}</span></span>
      </button>
      <span className="inventory-group-controls">
        {headerAction ? <span className="inventory-group-header-action">{headerAction}</span> : null}
        <button type="button" className="inventory-group-action" aria-expanded={open} aria-controls={id} onClick={toggle}>
          <span>{t(open ? 'common.collapse' : 'common.expand')}</span><CaretDownIcon size={16} />
        </button>
      </span>
    </h2>
    <div id={id} className="inventory-group-body" hidden={!open}>{children}</div>
  </section>
}
