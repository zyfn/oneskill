const tok = new URLSearchParams(location.search).get('t') || ''

export async function get(path) {
  return fetch(path + (path.includes('?') ? '&' : '?') + 't=' + encodeURIComponent(tok))
}

export async function action(args) {
  const r = await fetch('/api/action?t=' + encodeURIComponent(tok), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ args })
  })
  return r.json()
}
