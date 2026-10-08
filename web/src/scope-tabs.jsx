import { forwardRef } from 'react'
import { RadioGroup } from 'radix-ui'

export const ScopeTabs = forwardRef(function ScopeTabs({ label, value, onChange, children, className = '', onKeyDownCapture, ...props }, ref) {
  const navigate = (event) => {
    onKeyDownCapture?.(event)
    if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const options = [...event.currentTarget.querySelectorAll('button[role="radio"]:not(:disabled)')]
    const current = options.indexOf(event.target.closest('[role="radio"]'))
    if (current < 0 || !options.length) return
    const direction = getComputedStyle(event.currentTarget).direction === 'rtl' ? -1 : 1
    const delta = (event.key === 'ArrowRight' ? 1 : -1) * direction
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : (current + delta + options.length) % options.length
    event.preventDefault()
    options[index].focus()
    options[index].click()
  }
  return <RadioGroup.Root ref={ref} aria-label={label} value={value} onValueChange={onChange}
    orientation="horizontal" className={`scope-tabs ${className}`} {...props} onKeyDownCapture={navigate}>{children}</RadioGroup.Root>
})

export function ScopeTab({ value, children, count, countHint, className = '', ...props }) {
  return <RadioGroup.Item value={value} className={`scope-tab ${className}`} {...props}>
    {children}{count !== undefined ? <span className="scope-tab-count" title={countHint}>{count}</span> : null}
  </RadioGroup.Item>
}
