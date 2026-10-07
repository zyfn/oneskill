let token = new URLSearchParams(window.location.search).get('t') || ''

async function request(path, options = {}, retried = false) {
  const response = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { 'x-oneskill-token': token } : {}),
      ...options.headers,
    },
  })
  if (response.status === 403 && !retried && (options.method || 'GET') !== 'GET') {
    const refreshed = await fetch('/api/session', { credentials: 'same-origin' })
    if (refreshed.ok) {
      // A stale launch URL must not override the renewed local cookie.
      token = ''
      return request(path, options, true)
    }
  }
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw Object.assign(new Error(body.error || `Request failed (${response.status})`), { code: body.code, status: response.status })
  return body
}

export function getWorkspace(force = false) {
  return request(force ? '/api/scan' : '/api/workspace')
}

export function updateSkillLink(agent, skill, linked) {
  return request('/api/link', {
    method: 'POST',
    body: JSON.stringify({ agent, skill, linked }),
  })
}

export function importLocalSkills(items) {
  return request('/api/import', { method: 'POST', body: JSON.stringify({ items }) })
}

export function setSkillIgnored(agent, path, ignored) {
  return request('/api/ignore-skill', { method: 'POST', body: JSON.stringify({ agent, path, ignored }) })
}

export function openFolder(path) {
  return request('/api/open-folder', { method: 'POST', body: JSON.stringify({ path }) })
}

export function folderErrorKey(error) {
  if (error.status === 403) return 'common.accessExpired'
  return error.code === 'PATH_NOT_FOUND' ? 'common.folderMissing' : 'common.openFolderFailed'
}
