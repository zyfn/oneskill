import { createWorkspaceClient } from './workspace-client'

async function request(path, input) {
  const response = await fetch(path, { method: input === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...(input !== undefined ? { body: JSON.stringify(input) } : {}) })
  const result = await response.json()
  if (!response.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code, status: response.status })
  return result
}
export function createHttpClient() {
  return createWorkspaceClient({ call: (name, input) => request(`/api/operations/${name}`, input), heartbeat: () => request('/api/identity') })
}
