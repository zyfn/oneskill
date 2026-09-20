export function Mark({ size = 22 }) {
  return (
    <svg className="mark flex-none rounded-[6px]" style={{ boxShadow: 'inset 0 .5px 0 rgba(255,255,255,.28), 0 1px 2px rgba(0,0,0,.25)' }} width={size} height={size} viewBox="0 0 32 32">
      <defs>
        <linearGradient id="lg" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3d9bff" /><stop offset="1" stopColor="#0055d6" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7.5" fill="url(#lg)" />
      <g fill="none" stroke="#fff" strokeWidth="2.6" strokeLinecap="round">
        <path d="M13 19l6-6" />
        <path d="M14.6 10.6l2.2-2.2a4.4 4.4 0 0 1 6.2 6.2l-2.2 2.2" />
        <path d="M17.4 21.4l-2.2 2.2a4.4 4.4 0 0 1-6.2-6.2l2.2-2.2" />
      </g>
    </svg>
  )
}

export function Switch({ on, warn, onChange }) {
  return (
    <label className={'sw' + (warn ? ' warn' : '')}>
      <input type="checkbox" checked={on} onChange={onChange} />
      <span className="tr" />
    </label>
  )
}

export function Pill({ ok, children }) {
  return (
    <span className="inline-flex items-center h-[19px] px-[9px] rounded-full text-[11px] font-medium"
      style={{ background: ok ? 'var(--green-t)' : 'var(--red-t)', color: ok ? 'var(--green)' : 'var(--red)' }}>
      {children}
    </span>
  )
}

export function Btn({ ghost, disabled, onClick, children, small }) {
  return (
    <button disabled={disabled} onClick={onClick}
      className={[
        'border-0 rounded-ctl font-medium cursor-pointer transition-colors duration-100 ease-apple active:scale-[.97]',
        small ? 'h-[24px] px-[10px] text-[12px]' : 'h-[29px] px-[13px] text-[12.5px]',
        ghost ? 'bg-btn2 text-ink hover:bg-btn2h' : 'bg-accent text-white hover:bg-accenth',
        disabled ? 'opacity-45 cursor-default' : ''
      ].join(' ')}>
      {children}
    </button>
  )
}

export function IconBtn({ title, onClick, children }) {
  return (
    <button title={title} onClick={onClick}
      className="w-[26px] h-[26px] border-0 rounded-[6px] bg-transparent text-ink flex items-center justify-center cursor-pointer hover:bg-hov">
      <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" className="w-[14px] h-[14px]">{children}</svg>
    </button>
  )
}

export function GroupLabel({ children }) {
  return <div className="text-[11px] text-ink2 mb-[5px] mx-[2px]">{children}</div>
}

export function Card({ pad, children }) {
  return <div className={'bg-card rounded-card edge overflow-hidden' + (pad ? ' p-[10px] px-[12px]' : '')}>{children}</div>
}

export function Table({ head, children }) {
  return (
    <table className="w-full border-collapse hairline">
      <thead>
        <tr>{head.map((h, i) => (
          <th key={i} className={'text-[11px] font-normal text-ink2 text-left pt-[8px] pb-[5px] px-[14px]' + (h.c ? ' text-center' : '')} style={h.w ? { width: h.w } : null}>{h.c ? null : h.t}{h.c ? h.t : null}</th>
        ))}</tr>
      </thead>
      <tbody>{children}</tbody>
    </table>
  )
}

export function Td({ c, mono, dim, children }) {
  return <td className={'h-[42px] px-[14px] text-left text-[13px] hover:bg-hov' + (c ? ' text-center' : '') + (mono ? ' font-mono text-[12px]' : '') + (dim ? ' text-ink2' : '')}>{children}</td>
}
