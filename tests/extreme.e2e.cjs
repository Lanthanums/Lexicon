const { _electron } = require('playwright')
const assert = require('node:assert/strict')
const { createHash, randomUUID } = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const out = path.resolve(process.env.LEXICON_ARTIFACT_DIR || path.join(root, 'verification'))
const profile = path.join(out, 'extreme-profile-' + randomUUID())
const report = { checks: [], errors: [], measurements: {} }
let app, page

function fixture(count, gloss) {
  const words = {}, groups = {}
  for (let i = 0; i < count; i++) {
    const id = 'word' + i
    const text = i === count - 1 ? 'unmistakable' : id
    words[id] = { id, text, gloss, meanings: [], source: 'manual', groupId: id, addedAt: i }
    groups[id] = { id, wordIds: [id], manual: false, createdAt: i }
  }
  return { words, groups, synonymSets: {}, stats: {}, settings: { threshold: .95, dictProviders: [] },
    learning: { enabled: false, addCount: 0, traces: [] }, activity: {} }
}

async function launch() {
  app = await _electron.launch({
    executablePath: process.env.LEXICON_EXE || undefined,
    args: process.env.LEXICON_EXE ? [] : [root],
    env: { ...process.env, LEXICON_TEST_DATA: profile },
  })
  page = await app.firstWindow()
  page.on('pageerror', error => report.errors.push(error.message))
  await page.locator('nav[aria-label=主导航]').waitFor()
  if (!await page.evaluate(() => localStorage.getItem('lexicon-guide-v3'))) {
    await page.evaluate(() => localStorage.setItem('lexicon-guide-v3', 'complete'))
    await page.reload()
  }
}

async function exhaustLocalStorage() {
  await page.evaluate(() => {
    const set = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && value.length > 1024 * 1024) {
        throw new DOMException('Test storage quota exceeded', 'QuotaExceededError')
      }
      return set.call(this, key, value)
    }
  })
}

async function nav(name) {
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click()
}

async function importFixture(data) {
  await nav('设置与备份')
  await page.locator('input[type=file]').setInputFiles({
    name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)),
  })
  await page.getByRole('alertdialog').getByRole('button', { name: '确认导入', exact: true }).click()
  await page.getByText('备份已导入', { exact: true }).last().waitFor({ timeout: 30000 })
}

async function persisted(count, accept = () => true) {
  const deadline = Date.now() + 30000
  while (Date.now() < deadline) {
    const raw = await page.evaluate(() => window.lexicon.loadSnapshot())
    const state = raw && JSON.parse(raw)
    if (state && Object.keys(state.words).length === count && accept(state)) return state
    await new Promise(resolve => setTimeout(resolve, 150))
  }
  throw new Error('Disk snapshot did not reach ' + count + ' words')
}

async function mockDictionary() {
  await page.evaluate(() => {
    const native = window.fetch.bind(window)
    window.fetch = async (input, options) => {
      const url = new URL(String(input), location.href)
      if (url.pathname.startsWith('/youdao/')) {
        const word = url.searchParams.get('q')
        if (word === 'delayed') await new Promise(resolve => setTimeout(resolve, 500))
        if (word === 'unsourced') return Response.json({ input: word, ec: {} })
        return Response.json({ input: word, ec: { word: { trs: [{ pos: 'n.', tran: '测试释义 ' + word }] } } })
      }
      if (url.pathname === '/fwd') return new Response(null, { status: 503 })
      return native(input, options)
    }
  })
}

;(async () => {
  await fs.mkdir(out, { recursive: true })
  await launch()
  await exhaustLocalStorage()
  const large = fixture(10000, '独立测试词义'.repeat(90))
  report.measurements.largeBackupBytes = Buffer.byteLength(JSON.stringify(large))
  assert.ok(report.measurements.largeBackupBytes > 5 * 1024 * 1024)
  await importFixture(large)
  await persisted(10000)
  assert.notEqual(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('lexicon-state-v1') ?? '{"words":{}}').words).length), 10000)
  await nav('录入与管理词汇')
  await page.locator('[data-card-id]').first().waitFor()
  assert.equal(await page.locator('[data-card-id]').count(), 240)
  await page.getByRole('button', { name: '下一页', exact: true }).click()
  await page.locator('[data-card-id=word9759]').waitFor()
  await page.getByRole('button', { name: '列表视图', exact: true }).click()
  assert.equal(await page.locator('[data-management-word]').count(), 240)
  await page.getByRole('button', { name: '搜索词库', exact: true }).click()
  const start = performance.now()
  await page.getByRole('textbox', { name: '搜索关键词' }).fill('word0')
  await page.getByRole('button', { name: /^word0/ }).click()
  await page.locator('[data-management-word=word0]').waitFor()
  report.measurements.searchAndLocateMs = Math.round(performance.now() - start)
  report.checks.push('10,000-word, >5 MiB import reaches disk; card/list pagination and locating the oldest result work')

  await app.close()
  await launch()
  await exhaustLocalStorage()
  await nav('录入与管理词汇')
  await page.getByText('10000 个单词 · 拖词入组，拖卡合组').waitFor()
  await importFixture(fixture(2, '小词库'))
  await persisted(2)
  await page.getByRole('button', { name: '恢复导入前副本' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '确认恢复' }).click()
  await page.getByText('词库已恢复', { exact: true }).waitFor()
  assert.deepEqual((await persisted(10000)).words, large.words)
  report.checks.push('Large desktop-only snapshot survives relaunch, subsequent replacement and restoring the previous copy')

  const small = fixture(0, '')
  small.settings.dictProviders = [{ id: 'youdao-web', label: 'Youdao', enabled: true }]
  for (const [i, text] of ['adapt', 'adopt', 'adapts'].entries()) {
    const groupId = i < 2 ? 'curated' : 'isolated'
    small.words[text] = { id: text, text, gloss: '原义', meanings: [], source: 'manual', groupId, addedAt: i }
  }
  small.groups.curated = { id: 'curated', name: '手工辨析', notes: '原始手工笔记', wordIds: ['adopt', 'adapt'], manual: true, createdAt: 1, kind: 'confusable' }
  small.groups.isolated = { id: 'isolated', wordIds: ['adapts'], manual: false, createdAt: 2, kind: 'single' }
  await importFixture(small)
  const beforeRegroup = await persisted(3)
  await page.getByRole('button', { name: '重新分组形近词' }).click()
  await page.getByRole('alertdialog').getByRole('button', { name: '重新分组', exact: true }).click()
  await page.getByText('已按当前阈值重新分组').waitFor()
  const updated = await persisted(3, state => state.snapshotAt > beforeRegroup.snapshotAt)
  assert.deepEqual(updated.groups.curated, small.groups.curated)
  report.checks.push('Worker preview and actual regroup preserve the manual group ID, member order and notes')

  await mockDictionary()
  await nav('录入与管理词汇')
  const input = page.getByRole('textbox', { name: '录入英文单词' })
  await input.fill('delayed;abandoned')
  await page.getByRole('button', { name: '查询并加入', exact: true }).click()
  await page.getByRole('button', { name: '取消查询', exact: true }).click()
  await input.fill('')
  await input.evaluate(element => {
    const transfer = new DataTransfer()
    transfer.setData('text/plain', "ＣＡＮ’T\r\ncan't\nunsourced\nnot123\n" + 'a'.repeat(20000))
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
  })
  await page.getByRole('button', { name: '查询并加入', exact: true }).click()
  const review = page.getByRole('dialog', { name: '确认本次入库' })
  await review.getByLabel('中文释义').fill('手动录入')
  await review.getByRole('button', { name: '确认并入库' }).click()
  const final = await persisted(5)
  assert.deepEqual(Object.values(final.words).map(word => word.text).sort(), ['adapt', 'adapts', 'adopt', "can't", 'unsourced'].sort())
  assert.equal(Object.values(final.words).find(word => word.text === 'unsourced').gloss, '手动录入')
  assert.equal(Object.values(final.words).some(word => ['delayed', 'abandoned', 'not123'].includes(word.text)), false)
  report.checks.push('Multiline paste, normalized duplicates, overlong and invalid inputs, manual gloss and late cancelled responses')

  const batch = Array.from({ length: 103 }, (_, i) => {
    const bytes = createHash('sha256').update(String(i)).digest().subarray(0, 16)
    return Array.from(bytes, byte => String.fromCharCode(97 + byte % 26)).join('')
  })
  await input.fill(batch.join(';'))
  await input.press('Enter')
  const firstBatch = await persisted(105)
  assert.ok(batch.slice(0, 100).every(text => Object.values(firstBatch.words).some(word => word.text === text)))
  assert.equal(await input.inputValue(), batch.slice(100).join(';'))
  await input.press('Enter')
  const secondBatch = await persisted(108)
  assert.ok(batch.slice(100).every(text => Object.values(secondBatch.words).some(word => word.text === text)))
  report.checks.push('A 103-entry paste saves 100 entries then preserves the remaining three for the next batch')

  await page.evaluate(() => localStorage.removeItem('lexicon-state-v1'))
  await app.close()
  const corrupt = '{"words":{},"groups":[]}'
  await fs.writeFile(path.join(profile, 'backups', 'latest.json'), corrupt)
  await launch()
  await page.getByText('未能读取词库，请在设置中检查备份。', { exact: true }).waitFor()
  await app.close()
  app = null
  assert.equal(await fs.readFile(path.join(profile, 'backups', 'latest.json'), 'utf8'), corrupt)
  report.checks.push('A damaged disk snapshot remains untouched on startup and exit')

  assert.deepEqual(report.errors, [])
  report.passed = true
})().catch(error => {
  report.passed = false
  report.failure = error.stack
  process.exitCode = 1
}).finally(async () => {
  if (app) await app.close().catch(() => {})
  await fs.writeFile(path.join(out, 'extreme-report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
})
