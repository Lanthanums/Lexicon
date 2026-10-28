const { app, BrowserWindow, protocol, ipcMain, shell, dialog } = require('electron')
const { readFile, writeFile, mkdir, rename } = require('node:fs/promises')
const path = require('node:path')
const { createServer } = require('node:http')
const { randomBytes } = require('node:crypto')
const { lookup } = require('node:dns/promises')
const { isIP } = require('node:net')

if (process.env.LEXICON_TEST_DATA) app.setPath('userData', path.resolve(process.env.LEXICON_TEST_DATA))
protocol.registerSchemesAsPrivileged([{ scheme: 'lexicon', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
let win, migrationServer, migrationCancel
const ORIGIN = 'lexicon://app'
const MAX = 32 * 1024 * 1024
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon', '.svg': 'image/svg+xml', '.json': 'application/json', '.woff2': 'font/woff2' }
function trusted(event) { if (event.sender !== win?.webContents || !event.senderFrame?.url.startsWith(ORIGIN + '/')) throw new Error('Unknown caller') }
const dataFile = () => path.join(app.getPath('userData'), 'backups', 'latest.json')
function validSnapshot(raw) {
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > MAX) throw new Error('词库文件过大或格式错误')
  const state = JSON.parse(raw)
  if (!state || !state.words || !state.groups || typeof state.words !== 'object' || Array.isArray(state.words) || typeof state.groups !== 'object' || Array.isArray(state.groups)) throw new Error('词库文件格式错误')
  return state
}
let snapshotQueue = Promise.resolve()
async function saveSnapshot(raw) {
  validSnapshot(raw)
  snapshotQueue = snapshotQueue.catch(() => {}).then(async () => {
    const dest = dataFile()
    await mkdir(path.dirname(dest), { recursive: true })
    const day = new Date().toLocaleDateString('sv-SE')
    // First snapshot of each day remains available alongside the latest copy.
    await writeFile(path.join(path.dirname(dest), day + '.json'), raw, { flag: 'wx' }).catch(e => { if (e.code !== 'EEXIST') throw e })
    await writeFile(dest + '.tmp', raw, 'utf8')
    await rename(dest + '.tmp', dest)
  })
  return snapshotQueue
}
function isPrivate(ip) {
  const normalized = ip.toLowerCase()
  if (normalized.includes(':')) {
    if (normalized.startsWith('::ffff:')) return isPrivate(normalized.slice(7))
    return normalized === '::' || normalized === '::1' || /^(fc|fd|fe[89ab])/.test(normalized)
  }
  const [a, b] = ip.split('.').map(Number)
  return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || a >= 224
}
async function publicTarget(raw) {
  const target = new URL(raw)
  if (target.protocol !== 'https:' || target.username || target.password || (target.port && target.port !== '443')) throw new Error('Only public HTTPS dictionary URLs are allowed')
  const host = target.hostname.replace(/^\[|\]$/g, '')
  if (/^(localhost|.*\.(localhost|local|internal))$/i.test(host)) throw new Error('Local target blocked')
  const addresses = isIP(host) ? [{ address: host }] : await lookup(host, { all: true })
  if (!addresses.length || addresses.some(a => isPrivate(a.address))) throw new Error('Private target blocked')
  return target
}
async function proxy(raw) {
  let target = raw
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 15000)
  try {
    for (let i = 0; i < 5; i++) {
      const url = await publicTarget(target)
      const upstream = await fetch(url, { redirect: 'manual', signal: controller.signal, headers: { 'user-agent': `Mozilla/5.0 Lexicon/${app.getVersion()}` } })
      if (upstream.status >= 300 && upstream.status < 400 && upstream.headers.get('location')) {
        target = new URL(upstream.headers.get('location'), url).href
        await upstream.body?.cancel()
        continue
      }
      const reader = upstream.body?.getReader(), chunks = []
      let total = 0
      if (reader) while (true) {
        const { done, value } = await reader.read()
        if (done) break
        total += value.byteLength
        if (total > 8 * 1024 * 1024) { await reader.cancel(); throw new Error('Dictionary response too large') }
        chunks.push(Buffer.from(value))
      }
      return new Response(Buffer.concat(chunks), { status: upstream.status, headers: { 'content-type': upstream.headers.get('content-type') || 'application/json', 'cache-control': 'no-store' } })
    }
    throw new Error('Too many redirects')
  } finally { clearTimeout(timer) }
}
async function handleProtocol(request) {
  try {
    const url = new URL(request.url)
    if (url.hostname !== 'app' || request.method !== 'GET') return new Response('Forbidden', { status: 403 })
    if (url.pathname.startsWith('/youdao/')) return await proxy('https://dict.youdao.com' + url.pathname.slice(7) + url.search)
    if (url.pathname === '/fwd') return await proxy(url.searchParams.get('url'))
    const root = path.join(app.getAppPath(), 'dist')
    const decoded = decodeURIComponent(url.pathname)
    const file = path.resolve(root, '.' + (decoded === '/' ? '/index.html' : decoded))
    if (!file.startsWith(root + path.sep)) return new Response('Forbidden', { status: 403 })
    const content = await readFile(file)
    return new Response(content, { headers: { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https:; media-src 'self' https:; object-src 'none'; base-uri 'self'; frame-src 'none'", 'x-content-type-options': 'nosniff' } })
  } catch (e) { return new Response('Unable to load resource', { status: 502 }) }
}
function migrateLegacy() {
  if (migrationServer) throw new Error('迁移窗口已打开，请在浏览器完成迁移。')
  return new Promise((resolve, reject) => {
    const token = randomBytes(24).toString('hex')
    let timeout
    const close = () => { clearTimeout(timeout); migrationServer?.close(); migrationServer = null; migrationCancel = null }
    migrationCancel = () => { close(); reject(new Error('迁移已取消')) }
    migrationServer = createServer(async (req, res) => {
      res.setHeader('cache-control', 'no-store')
      res.setHeader('content-type', 'text/html; charset=utf-8')
      if (req.headers.host !== 'localhost:3000') { res.writeHead(403); res.end(); return }
      if (req.url === '/migrate/' + token && req.method === 'GET') {
        res.end(`<!doctype html><meta charset="utf-8"><title>Lexicon 旧词库迁移</title><body style="font:18px system-ui;background:#f8f5ee;max-width:650px;margin:80px auto;padding:20px"><h1>把旧词库带到 Lexicon</h1><p id="status">正在读取这个浏览器中的旧词库…</p><script>const raw=localStorage.getItem('lexicon-state-v1');if(!raw){document.getElementById('status').textContent='这个浏览器没有找到旧词库。请复制当前网址到以前使用 Lexicon 的浏览器，或从旧版设置导出 JSON 备份。'}else{fetch('/transfer/${token}',{method:'POST',headers:{'Content-Type':'application/json'},body:raw}).then(r=>{if(!r.ok)throw Error();document.getElementById('status').textContent='已读取。请返回 Lexicon 桌面窗口确认导入。旧版数据仍保留。'}).catch(()=>document.getElementById('status').textContent='传输失败，请返回桌面版重试。')}</script></body>`)
        return
      }
      if (req.url === '/transfer/' + token && req.method === 'POST' && req.headers.origin === 'http://localhost:3000') {
        try {
          const chunks = []; let bytes = 0
          for await (const chunk of req) { bytes += chunk.length; if (bytes > MAX) throw new Error('数据过大'); chunks.push(chunk) }
          const raw = Buffer.concat(chunks).toString('utf8')
          validSnapshot(raw)
          res.end('ok'); close(); resolve(raw)
        } catch { res.writeHead(400); res.end('Invalid library') }
        return
      }
      res.writeHead(404); res.end()
    })
    migrationServer.on('error', e => { close(); reject(new Error(e.code === 'EADDRINUSE' ? '旧版仍占用3000端口。请关闭旧版 Node.js 控制台后重试，或在旧版设置导出 JSON 备份再导入。' : e.message)) })
    migrationServer.listen(3000, '127.0.0.1', () => {
      shell.openExternal('http://localhost:3000/migrate/' + token).catch(e => { close(); reject(e) })
    })
    timeout = setTimeout(() => { close(); reject(new Error('迁移等待超时，请重试')) }, 180000)
  })
}
if (gotLock) app.whenReady().then(() => {
  protocol.handle('lexicon', handleProtocol)
  app.setAppUserModelId('local.lexicon.desktop')
  ipcMain.handle('snapshot:before-import', async (e, raw) => { trusted(e); validSnapshot(raw); const dest = path.join(app.getPath('userData'), 'backups'); await mkdir(dest, { recursive: true }); await writeFile(path.join(dest, 'before-import-' + Date.now() + '.json'), raw) })
  ipcMain.handle('snapshot:save', (e, raw) => { trusted(e); return saveSnapshot(raw) })
  ipcMain.handle('snapshot:load', async e => { trusted(e); try { return await readFile(dataFile(), 'utf8') } catch { return null } })
  ipcMain.handle('legacy:import', e => { trusted(e); return migrateLegacy() })
  ipcMain.handle('legacy:cancel', e => { trusted(e); migrationCancel?.() })
  ipcMain.handle('data:open', e => { trusted(e); return shell.openPath(app.getPath('userData')) })
  win = new BrowserWindow({ width: 1320, height: 900, minWidth: 780, minHeight: 620, backgroundColor: '#f8f5ef', title: 'Lexicon', icon: path.join(app.getAppPath(), 'assets', 'lexicon.ico'), show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } })
  win.setMenu(null)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN + '/')) e.preventDefault() })
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  win.webContents.session.setPermissionCheckHandler(() => false)
  win.once('ready-to-show', () => win.show())
  win.loadURL(ORIGIN + '/')
  app.on('second-instance', () => { if (win.isMinimized()) win.restore(); win.show(); win.focus() })
  app.on('window-all-closed', () => { migrationCancel?.(); snapshotQueue.finally(() => app.quit()) })
}).catch(e => { dialog.showErrorBox('Lexicon 无法启动', e.message); app.quit() })
