import { setTimeout as delay } from 'node:timers/promises'
import { connectWorkspace } from '../../src/runtime/connect.mjs'
import { processAlive } from '../../src/runtime/paths.mjs'

export async function stopWorkspaceProcess(options) {
  const client = await connectWorkspace({ ...options, start: false }).catch(error => {
    if (error.code === 'SERVICE_UNAVAILABLE') return null
    throw error
  })
  if (!client) return
  const pid = client.descriptor.pid
  if (pid === process.pid) throw new Error('Use runtime.close() for an in-process test server.')
  try { process.kill(pid, 'SIGTERM') }
  catch (error) { if (error.code !== 'ESRCH') throw error }
  const deadline = Date.now() + 5000
  while (processAlive(pid)) {
    if (Date.now() > deadline) throw new Error(`Test Workspace process ${pid} did not exit.`)
    await delay(25)
  }
}
