import { App } from '@modelcontextprotocol/ext-apps'
import { createWorkspaceClient, toolForOperation } from './workspace-client'
import packageInfo from '../../../package.json'

export async function createMcpAppsClient() {
  const app = new App({ name: 'oneskill', version: packageInfo.version }, {}, { autoResize: false })
  await app.connect()
  const context = app.getHostContext() || {}
  const applyTheme = next => {
    document.documentElement.dataset.hostTheme = next.theme || 'light'
    // Keep the same product typography and spacing as Web; only the host theme varies.
  }
  applyTheme(context)
  app.onhostcontextchanged = applyTheme
  const transport = {
    async call(name, input) {
      const result = await app.callServerTool({ name: toolForOperation(name), arguments: input })
      if (result.isError) {
        const error = result.structuredContent?.error
        throw Object.assign(new Error(error?.message || result.content?.find(item => item.type === 'text')?.text || 'The workspace operation failed.'), { code: error?.code || 'OPERATION_FAILED' })
      }
      if (!result.structuredContent) throw new Error('The host returned no workspace data.')
      return result.structuredContent
    },
    async heartbeat() { await app.callServerTool({ name: toolForOperation('getWorkspace'), arguments: {} }) },
  }
  return createWorkspaceClient(transport, { embedded: true, locale: context.locale })
}
