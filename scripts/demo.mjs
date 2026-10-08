import { startServer } from '../src/server.mjs'
import { createDemoWorkspace } from './demo-workspace.mjs'

const args = process.argv.slice(2)
const portIndex = args.indexOf('--port')
const port = portIndex < 0 ? undefined : Number(args[portIndex + 1])
if (portIndex >= 0 && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new Error('Use --port with a valid port number.')
const demo = await createDemoWorkspace()
let server
let closing = false
async function cleanup() {
  if (closing) return
  closing = true
  if (server) await new Promise((resolve) => { server.close(resolve); server.closeAllConnections() })
  await demo.cleanup()
}
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => cleanup().finally(() => process.exit()))
try {
  console.log('Demo workspace: sample data only. Changes are discarded when you stop it.')
  ;({ server } = await startServer({ open: !args.includes('--no-open'), port, workspace: demo.workspace }))
} catch (error) { await cleanup(); throw error }
