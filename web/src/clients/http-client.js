import { createWorkspaceClient } from './workspace-client'
import packageInfo from '../../../package.json'

async function request(path, input) {
  const response = await fetch(path, { method: input === undefined ? 'GET' : 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json', 'x-oneskill-version': packageInfo.version }, ...(input !== undefined ? { body: JSON.stringify(input) } : {}) })
  const result = await response.json()
  if (!response.ok) throw Object.assign(new Error(result.error.message), { code: result.error.code, status: response.status })
  return result
}
export function createHttpClient() {
  return createWorkspaceClient({ call: (name, input) => request(`/api/operations/${name}`, input), heartbeat: () => request('/api/identity') })
}
