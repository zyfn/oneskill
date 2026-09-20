import React, { useEffect, useState, useCallback } from 'react'
import { get, action } from './api.js'
import { Mark, Switch, Pill, Btn, IconBtn, GroupLabel, Card, Table, Td, PaneHead } from './ui.jsx'

const VIEWS = [
  { id: 'agents', title: 'Agents', icon: <><rect x="2" y="3" width="12" height="10" rx="2" /><path d="M5 7l2 2-2 2M9.5 11H11" /></> },
  { id: 'skills', title: 'Skills', icon: <><rect x="2" y="3" width="12" height="10" rx="1.5" /><path d="M7 3v10M2 8h12" /></> },
  { id: 'migrate', title: 'Migrate', icon: <><path d="M2.5 8h8" /><path d="M8 5.2 10.8 8 8 10.8" /><path d="M13.5 3v10" /></> }
]

export default function App() {
  const [view, setView] = useState(() => {
    const h = location.hash.replace('#', '')
    return VIEWS.some(v => v.id === h) ? h : 'agents'
  })
  const [agents, setAgents] = useState([])
  const [rows, setRows] = useState([])
  const [scan, setScan] = useState([])
  const [err, setErr] = useState('')
  const [toast, setToast] = useState('')
  const [name, setName] = useState('')
  const [dir, setDir] = useState('')
  const [sel, setSel] = useState({})

  const load = useCallback(async () => {
    const [d, l, s] = await Promise.all([get('/api/detect'), get('/api/list'), get('/api/scan')])
    if (!d.ok || !l.ok || !s.ok) { setErr('Session token 已失效（服务重启过）。回终端看启动时打印的链接，用新地址重开本页。'); return }
    const [a, r, sc] = await Promise.all([d.json(), l.json(), s.json()])
    setErr(''); setAgents(a); setRows(r); setScan(sc)
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { document.title = 'oneskill — ' + VIEWS.find(v => v.id === view).title }, [view])
  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(''), 6000)
    return () => clearTimeout(t)
  }, [toast])

  const run = useCallback(async (args, quiet) => {
    setToast('$ oneskill ' + args.join(' ') + '\n…')
    const j = await action(args)
    setToast('$ oneskill ' + args.join(' ') + '\n' + j.output)
    if (!quiet) await load()
  }, [load])

  const inst = agents.filter(a => a.installed)
  let links = 0, broken = 0
  rows.forEach(r => inst.forEach(a => { const m = r.links[a.name]; if (m === '✓') links++; if (m === '!') broken++ }))
  const stray = scan.map(g => ({ agent: g.agent, hidden: g.hidden || 0, items: g.items.filter(i => i.kind === 'dir') }))
    .filter(g => g.items.length || g.hidden)
  const strayCount = stray.reduce((n, g) => n + g.items.length, 0)
  const hiddenCount = stray.reduce((n, g) => n + g.hidden, 0)
  const selCount = Object.values(sel).filter(Boolean).length

  const badge = (v) => v === 'agents' ? agents.length : v === 'skills' ? links : strayCount
  const badgeRed = (v) => (v === 'skills' ? broken : v === 'migrate' ? strayCount : 0) > 0

  return (
    <div className="flex min-h-screen">
      <aside className="glass w-[236px] flex-none sticky top-0 h-screen px-[10px] pt-[16px] pb-[12px] border-r border-hair flex flex-col select-none">
        <div className="flex items-center gap-[8px] px-[8px] pb-[14px]">
          <Mark />
          <span className="text-[14px] font-semibold tracking-[-0.01em]">oneskill</span>
        </div>
        {VIEWS.map(v => (
          <a key={v.id} onClick={() => setView(v.id)}
            className={'flex items-center gap-[10px] h-[32px] px-[9px] my-[1px] rounded-[7px] cursor-default text-[13px] transition-colors duration-100 ease-apple ' +
              (view === v.id ? 'bg-sel text-white font-medium' : 'text-ink hover:bg-hov')}>
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
              className={'w-[18px] h-[18px] flex-none ' + (view === v.id ? 'opacity-100' : 'opacity-85')}>{v.icon}</svg>
            {v.title}
            <span className={'ml-auto min-w-[18px] h-[17px] px-[5px] rounded-[9px] text-[10.5px] font-semibold leading-[17px] text-center ' +
              (view === v.id ? 'bg-white/25 text-white' : badgeRed(v.id) ? 'bg-bad text-white' : 'bg-black/8 text-ink2')}
              style={view === v.id ? null : { background: badgeRed(v.id) ? 'var(--red)' : 'rgba(0,0,0,.08)' }}>
              {badge(v.id)}
            </span>
          </a>
        ))}
        <div className="mt-auto pt-[10px] px-[8px] border-t border-hair">
          <div className="text-[10.5px] text-ink2 leading-[1.5]">
            source<br /><span className="font-mono text-[10px]">~/oneskill/skills</span>
          </div>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        <main className="flex-1 pt-[26px] px-[28px] pb-[64px] w-full max-w-[960px] mx-auto">
          {err && <div className="rounded-[9px] px-[13px] py-[9px] mb-[18px] text-[12.5px] font-medium" style={{ background: 'var(--red-t)', color: 'var(--red)' }}>{err}</div>}
          <PaneHead title={VIEWS.find(v => v.id === view).title}>
            <IconBtn title="Validate & repair" onClick={() => run(['validate'])}>
              <path d="M9.6 2.6a3.6 3.6 0 0 0-4.5 4.6L2.4 9.9a1.5 1.5 0 0 0 2.1 2.1l2.7-2.7a3.6 3.6 0 0 0 4.6-4.5L9.7 6.9 8.4 6.6l-.3-1.3z" />
              <path d="M10.8 10.8l2.6 2.6" />
            </IconBtn>
            <IconBtn title="Refresh" onClick={load}>
              <path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.8" /><path d="M13.4 2.6v2.8h-2.8" />
            </IconBtn>
          </PaneHead>

          {view === 'agents' && (
            <>
              <GroupLabel>Known agents</GroupLabel>
              <Card>
                <Table head={[{ t: 'Agent', w: '22%' }, { t: 'Skill dir' }, { t: 'Status', w: '130px' }]}>
                  {agents.map(a => (
                    <tr key={a.name}>
                      <Td>{a.name}</Td>
                      <Td mono dim>{a.dir}</Td>
                      <Td><Pill ok={a.installed}>{a.installed ? 'Installed' : 'Not installed'}</Pill></Td>
                    </tr>
                  ))}
                </Table>
              </Card>
              <div className="h-[22px]" />
              <GroupLabel>Add agent</GroupLabel>
              <Card pad>
                <div className="flex gap-[8px] items-center flex-wrap py-[2px]">
                  <input className="font-sans text-[12.5px] text-ink bg-btn2 border-0 rounded-field h-[28px] px-[9px] outline-none hover:bg-btn2h focus:shadow-[0_0_0_3px_rgba(10,102,255,.35)] flex-1 min-w-[120px]" value={name} onChange={e => setName(e.target.value)} placeholder="name" />
                  <input className="font-sans text-[12.5px] text-ink bg-btn2 border-0 rounded-field h-[28px] px-[9px] outline-none hover:bg-btn2h focus:shadow-[0_0_0_3px_rgba(10,102,255,.35)] flex-[3] min-w-[200px]" value={dir} onChange={e => setDir(e.target.value)} placeholder="~/path/to/skills" />
                  <Btn onClick={() => { run(['agent', 'add', name.trim(), dir.trim()]); setName(''); setDir('') }}>Add</Btn>
                </div>
              </Card>
            </>
          )}

          {view === 'skills' && (
            <>
              <GroupLabel>Link matrix</GroupLabel>
              <Card>
                {inst.length ? (
                  <Table head={[{ t: 'Skill', w: '30%' }, ...inst.map(a => ({ t: a.name, c: true }))]} >
                    {rows.map(r => (
                      <tr key={r.skill}>
                        <Td>
                          <div className="font-mono text-[12px]">{r.skill}</div>
                          {r.desc ? <div className="text-[11px] text-ink2 truncate max-w-full" title={r.desc}>{r.desc}</div> : null}
                        </Td>
                        {inst.map(a => {
                          const m = r.links[a.name]
                          return <Td key={a.name} c><Switch on={m === '✓' || m === '!'} warn={m === '!'}
                            onChange={() => run([m === '✓' || m === '!' ? 'unlink' : 'link', a.name, r.skill])} /></Td>
                        })}
                      </tr>
                    ))}
                  </Table>
                ) : <div className="text-ink2 p-[14px] text-[12.5px]">No installed agents yet.</div>}
              </Card>
              <div className="text-[11px] text-ink2 pt-[7px] px-[2px]">Orange = link exists but its source is missing; repair with the wrench.</div>
            </>
          )}

          {view === 'migrate' && (
            <>
              <GroupLabel>Unmanaged skills found in agent directories</GroupLabel>
              <Card>
                {stray.length ? (
                  <Table head={[{ t: '', w: '40px' }, { t: 'Agent', w: '26%' }, { t: 'Skill dir' }]}>
                    {stray.map(g => g.items.map(i => (
                      <tr key={g.agent + '/' + i.name}>
                        <Td c>
                          <input type="checkbox" className="w-[16px] h-[16px] cursor-pointer" style={{ accentColor: 'var(--accent)' }}
                            disabled={i.in_source}
                            checked={!!sel[g.agent + '/' + i.name]}
                            onChange={e => setSel(s => ({ ...s, [g.agent + '/' + i.name]: e.target.checked }))} />
                        </Td>
                        <Td>{g.agent}</Td>
                        <Td mono>{i.name}{i.in_source ? <span className="text-ink2"> (name clash)</span> : null}</Td>
                      </tr>
                    )))}
                  </Table>
                ) : <div className="text-ink2 p-[14px] text-[12.5px]">Nothing to migrate — every skill dir is already managed.</div>}
              </Card>
              <div className="text-[11px] text-ink2 pt-[7px] px-[2px]">
                Selected dirs move into the source; a symlink is left where they were, so that agent keeps working.
                {hiddenCount ? ` ${hiddenCount} protected entries hidden (migrate.ignore).` : ''}
              </div>
              <Card pad>
                <div className="flex gap-[8px] items-center flex-wrap py-[2px] mt-[10px]">
                  <Btn disabled={!selCount} onClick={async () => {
                    for (const k of Object.keys(sel).filter(k => sel[k])) {
                      const [agent, ...rest] = k.split('/')
                      await run(['migrate', agent, rest.join('/')], true)
                    }
                    setSel({})
                    await load()
                  }}>Migrate selected</Btn>
                  <span className="text-ink2">{selCount ? selCount + ' selected' : ''}</span>
                </div>
              </Card>
            </>
          )}
        </main>
      </div>

      {toast && (
        <div onClick={() => setToast('')}
          className="fixed left-1/2 bottom-[24px] -translate-x-1/2 opacity-100 cursor-pointer rounded-[12px] px-[14px] py-[10px] max-w-[560px] font-mono text-[11.5px] leading-[1.55] whitespace-pre-wrap z-20"
          style={{ background: 'rgba(30,30,32,.92)', color: '#f5f5f7', boxShadow: '0 6px 24px rgba(0,0,0,.35)', backdropFilter: 'blur(12px)' }}>
          {toast}
        </div>
      )}
    </div>
  )
}
