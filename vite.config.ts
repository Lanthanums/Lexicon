import { thirdPartyNotices } from './scripts/third-party-notices'
import { readFileSync } from 'node:fs'
import path from "path"
import react from "@vitejs/plugin-react"
import { defineConfig, type Plugin } from "vite"


/**
 * Generic forward proxy for dictionary APIs that send no CORS headers
 * (baidu / youdao-cloud / custom endpoints). Dev-server only.
 */
function fwdProxy(): Plugin {
  return {
    name: 'fwd-proxy',
    configureServer(server) {
      server.middlewares.use('/fwd', async (req, res) => {
        try {
          const url = new URL(req.url ?? '', 'http://localhost').searchParams.get('url')
          if (!url || !/^https:\/\//.test(url)) {
            res.statusCode = 400
            res.end('only https URLs are forwarded')
            return
          }
          const upstream = await fetch(url, {
            headers: { 'user-agent': 'Mozilla/5.0 (Lexicon local app)' },
            signal: AbortSignal.timeout(15000),
          })
          const buf = Buffer.from(await upstream.arrayBuffer())
          res.statusCode = upstream.status
          res.setHeader(
            'content-type',
            upstream.headers.get('content-type') ?? 'application/octet-stream',
          )
          res.setHeader('access-control-allow-origin', '*')
          res.end(buf)
        } catch (e) {
          res.statusCode = 502
          res.end(String(e))
        }
      })
    },
  }
}

// https://vite.dev/config/
const packageInfo = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))

export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(packageInfo.version) },
  plugins: [react(), fwdProxy(), thirdPartyNotices()],
  server: {
    port: 3000,
    proxy: {
      // dev-server proxy for the fast Youdao dictionary endpoint, which
      // rejects cross-origin browser requests (403 on Origin header)
      '/youdao': {
        target: 'https://dict.youdao.com',
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/youdao/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.removeHeader('origin')
            proxyReq.removeHeader('referer')
          })
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
