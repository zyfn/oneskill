import { useState } from 'react'
import { resolveSkillLink } from '@/api'
import { useLocale } from '@/i18n'

function LinkIssue({ issue, skills, onRefresh, disabled }) {
  const { t } = useLocale()
  const [skill, setSkill] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const resolve = async repair => {
    setBusy(true); setError('')
    try { await resolveSkillLink(issue.id, repair ? skill : undefined); await onRefresh() }
    catch (failure) { setError(failure.message) }
    finally { setBusy(false) }
  }
  return <div className="link-issue">
    <div><strong>{issue.agents.join(' / ')}</strong><code>{issue.path}</code><small>{t('integrity.missingSource')} · {issue.source}</small></div>
    <div className="link-issue-actions">
      <select aria-label={t('integrity.chooseFor', { path: issue.path })} value={skill} onChange={event => setSkill(event.target.value)} disabled={busy || disabled}>
        <option value="">{t('integrity.chooseSkill')}</option>{skills.map(item => <option key={item.id} value={item.id}>{item.relative}</option>)}
      </select>
      <button type="button" className="quiet-button" disabled={!skill || busy || disabled} onClick={() => resolve(true)}>{t('integrity.repair')}</button>
      <button type="button" className="text-action" disabled={busy || disabled} onClick={() => resolve(false)}>{t('integrity.remove')}</button>
    </div>
    {error ? <p className="inline-error" role="alert">{error}</p> : null}
  </div>
}

export function LinkIssues({ issues = [], skills, onRefresh, disabled }) {
  const { t } = useLocale()
  if (!issues.length) return null
  return <details className="integrity-panel"><summary>{t('integrity.count', { count: issues.length })}<span>{t('integrity.review')}</span></summary>
    <p>{t('integrity.description')}</p>{issues.map(issue => <LinkIssue key={issue.id} issue={issue} skills={skills} onRefresh={onRefresh} disabled={disabled} />)}
  </details>
}
