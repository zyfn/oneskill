import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { createMcpAppsClient } from './clients/mcp-apps-client'
import { configureWorkspaceClient } from './api'
import './index.css'

createMcpAppsClient().then(client => {
  configureWorkspaceClient(client)
  createRoot(document.getElementById('root')).render(<App />)
}).catch(error => {
  const message = document.createElement('p')
  message.setAttribute('role', 'alert')
  message.textContent = `Unable to connect to the workspace host: ${error.message}`
  document.getElementById('root').replaceChildren(message)
})
