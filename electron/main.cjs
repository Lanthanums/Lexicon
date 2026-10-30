const { app, BrowserWindow, protocol, ipcMain, shell, dialog, nativeTheme } = require('electron')
const { readFile, writeFile, mkdir } = require('node:fs/promises')
const { replaceSnapshot } = require('./snapshot.cjs')
const path = require('node:path')
const { lookup } = require('node:dns/promises')
const { isIP } = require('node:net')

if (process.env.LEXICON_TEST_DATA) app.setPath('userData', path.resolve(process.env.LEXICON_TEST_DATA))
protocol.registerSchemesAsPrivileged([{ scheme: 'lexicon', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } }])
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()
let win
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
    await replaceSnapshot(dest + '.tmp', dest)
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
if (gotLock) app.whenReady().then(() => {
  protocol.handle('lexicon', handleProtocol)
  app.setAppUserModelId('local.lexicon.desktop')
  ipcMain.handle('snapshot:before-import', async (e, raw) => { trusted(e); validSnapshot(raw); const dest = path.join(app.getPath('userData'), 'backups'); await mkdir(dest, { recursive: true }); await writeFile(path.join(dest, 'before-import-' + Date.now() + '.json'), raw) })
  ipcMain.handle('snapshot:save', (e, raw) => { trusted(e); return saveSnapshot(raw) })
  ipcMain.handle('snapshot:load', async e => { trusted(e); try { return await readFile(dataFile(), 'utf8') } catch { return null } })
  ipcMain.handle('data:open', e => { trusted(e); return shell.openPath(app.getPath('userData')) })
  ipcMain.handle('appearance:set', (e, theme) => {
    trusted(e)
    if (!['system', 'light', 'dark'].includes(theme)) throw new Error('Unknown appearance')
    nativeTheme.themeSource = theme
  })
  nativeTheme.on('updated', () => win?.setBackgroundColor(nativeTheme.shouldUseDarkColors ? '#1c1a17' : '#f8f5ef'))
  win = new BrowserWindow({ width: 1320, height: 900, minWidth: 780, minHeight: 620, backgroundColor: nativeTheme.shouldUseDarkColors ? '#1c1a17' : '#f8f5ef', title: 'Lexicon', icon: path.join(app.getAppPath(), 'assets', 'lexicon.ico'), show: false, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false } })
  win.setMenu(null)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-prevent-unload', event => {
    const choice = dialog.showMessageBoxSync(win, { type: 'question', buttons: ['继续编辑', '放弃更改'], defaultId: 0, cancelId: 0, noLink: true, message: '有尚未保存的修改', detail: '放弃后，本次编辑的内容不会保存。' })
    if (choice === 1) event.preventDefault()
  })
  win.webContents.on('will-navigate', (e, url) => { if (!url.startsWith(ORIGIN + '/')) e.preventDefault() })
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  win.webContents.session.setPermissionCheckHandler(() => false)
  win.once('ready-to-show', () => win.show())
  win.loadURL(ORIGIN + '/')
  app.on('second-instance', () => { if (win.isMinimized()) win.restore(); win.show(); win.focus() })
  app.on('window-all-closed', () => { snapshotQueue.finally(() => app.quit()) })
}).catch(e => { dialog.showErrorBox('Lexicon 无法启动', e.message); app.quit() })
