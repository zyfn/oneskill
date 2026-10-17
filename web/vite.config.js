import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

export default defineConfig(({ mode }) => {
  const endpoint = process.env.ONESKILL_ENDPOINT || 'http://127.0.0.1:8787'
  return {
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(process.cwd(), 'src') } },
  base: './',
  build: mode === 'embedded' ? { outDir: 'dist/embed', emptyOutDir: true, assetsInlineLimit: 1000000, rollupOptions: { input: path.resolve(process.cwd(), 'embedded.html'), output: { inlineDynamicImports: true } } } : { outDir: 'dist', emptyOutDir: true },
  server: { host: '127.0.0.1', proxy: { '/api': { target: endpoint, changeOrigin: true, configure(proxy) {
    proxy.on('proxyReq', (proxyRequest, request, response) => {
      if (request.headers.origin && request.headers.origin !== `http://${request.headers.host}`) { response.writeHead(403); response.end('Origin rejected'); proxyRequest.destroy(); return }
      if (request.headers.origin) proxyRequest.setHeader('origin', endpoint)
    })
  } } } }
  }
})
