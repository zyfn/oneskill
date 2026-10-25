import { useEffect, useState } from 'react'
import { useLocale } from '@/i18n'
import { workspaceScanStatus } from '@/workspace-scan.mjs'

export function WorkspaceStatus({ data, route, onRefresh, refreshing }) {
  const { locale, t } = useLocale()
  const [now, setNow] = useState(Date.now)
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer) }, [])
  const { diagnostics, truncated, incomplete, reason } = workspaceScanStatus(data, route)
  const statusKey = { stale: 'workspace.stale', unreadable: 'workspace.incomplete', limited: 'workspace.limitReached', incomplete: 'workspace.scanIncomplete' }[reason]
  const age = Math.max(0, Math.floor((now - Date.parse(data.checkedAt)) / 60000))
  const checked = Number.isFinite(age) ? age < 1 ? t('workspace.justScanned') : t('workspace.scannedAgo', { count: age }) : t('workspace.notScanned')
  return <footer className="workspace-status">
    <span className="workspace-location" title={data.source}>{data.source}</span>
    <details className="workspace-diagnostics">
      <summary data-warning={Boolean(reason) || undefined} title={data.checkedAt ? new Date(data.checkedAt).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en') : undefined}>
        <span className="scan-state-dot" />{statusKey ? t(statusKey) : checked}
      </summary>
      <div className="diagnostic-popover">
        <strong>{t('workspace.scanDetails')}</strong><p>{checked}</p>
        {data.scanError ? <p role="alert">{data.scanError.message}</p> : null}
        {diagnostics.length ? <ul>{diagnostics.map(item => <li key={`${item.path}:${item.code}`}><code>{item.path}</code><span>{item.code}</span></li>)}</ul> : null}
        <p>{t(truncated ? 'workspace.scanLimit' : incomplete ? 'workspace.scanIncomplete' : 'workspace.scanScope')}</p>
        <button type="button" className="quiet-button" onClick={onRefresh} disabled={refreshing}>{t('rescan')}</button>
      </div>
    </details>
  </footer>
}
