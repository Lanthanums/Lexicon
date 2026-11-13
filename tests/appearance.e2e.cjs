const { _electron: electron } = require('playwright')
const path = require('node:path')
const fs = require('node:fs/promises')
const assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const out = path.resolve(process.env.LEXICON_ARTIFACT_DIR || path.join(root, 'verification'))
const profile = path.join(out, 'appearance-profile-' + Date.now())
const report = { checks: [], screenshots: [], errors: [] }
let app, page
const nav = async name => page.getByRole('navigation', { name: '主导航' }).getByRole('button', { name, exact: true }).click()
const check = name => report.checks.push(name)
async function shot(name) {
  await page.locator('[role="status"]').filter({ hasText: '正在打开学习空间' }).waitFor({ state: 'hidden' })
  await page.waitForTimeout(150)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: path.join(out, name + '.png'), fullPage: true, animations: 'disabled' })
  report.screenshots.push(name + '.png')
}
async function dark(expected) {
  await page.waitForFunction(expected => document.documentElement.classList.contains('dark') === expected, expected)
}
async function noOverflow() {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
}
async function checkQuizSetup(theme) {
  const modes = page.getByRole('group', { name: '考查方式' })
  const panel = page.locator('.quiz-start-panel')
  for (const width of [1920, 1280, 820, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    await modes.waitFor()
    const buttons = await modes.getByRole('button').evaluateAll(elements => elements.map(element => {
      const {x, y, width, height} = element.getBoundingClientRect()
      return {x, y, width, height}
    }))
    assert.equal(buttons.length, 6)
    for (let row = 0; row < 3; row++) {
      const [left, right] = buttons.slice(row * 2, row * 2 + 2)
      assert.equal(left.y, right.y)
      assert.ok(Math.abs(left.width - right.width) < 1)
      assert.equal(left.height, right.height)
      assert.ok(right.x > left.x)
      if (row > 0) assert.ok(left.y > buttons[(row - 1) * 2].y)
    }
    const modeBounds = await modes.boundingBox()
    const panelBounds = await panel.boundingBox()
    const label = await page.locator('#quiz-mode-label').boundingBox()
    assert.ok(modeBounds.y - label.y - label.height >= 12)
    if (width >= 1200) {
      assert.ok(Math.abs(modeBounds.y - panelBounds.y) < 1)
      assert.ok(Math.abs(modeBounds.height - panelBounds.height) < 1)
      assert.ok(panelBounds.x > modeBounds.x + modeBounds.width)
    } else {
      assert.ok(panelBounds.y - modeBounds.y - modeBounds.height >= 12)
    }
    await noOverflow()
    const note = page.getByText('按日终统计，单位：词。', { exact: true })
    const empty = page.getByText('还没有复习计划', { exact: true }).locator('..')
    const noteBounds = await note.boundingBox()
    const emptyBounds = await empty.boundingBox()
    assert.ok(emptyBounds.y - noteBounds.y - noteBounds.height >= 15)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await shot('beta2-quiz-layout-' + theme)
}

async function checkSticky(theme) {
  const sticky = page.locator('.management-sticky')
  await sticky.waitFor()
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate(() => window.scrollTo(0, 0))
    const before = await sticky.boundingBox()
    await page.evaluate(() => window.scrollTo(0, 670))
    await page.waitForFunction(() => Math.abs(document.querySelector('.management-sticky').getBoundingClientRect().top) < 1)
    const after = await sticky.boundingBox()
    const effect = await sticky.evaluate(element => {
      const glow = getComputedStyle(element, '::before')
      return { filter: glow.backdropFilter, mask: glow.maskImage, pointerEvents: glow.pointerEvents }
    })
    assert.ok(Math.abs(before.height - after.height) < 1)
    assert.equal(effect.filter, 'blur(14px)')
    assert.match(effect.mask, /linear-gradient/)
    assert.equal(effect.pointerEvents, 'none')
    assert.equal(await sticky.getByRole('textbox', { name: '录入英文单词' }).isVisible(), true)
    await noOverflow()
    if (width === 1440 || width === 390) {
      const name = `beta2-sticky-${theme}-${width}.png`
      await page.screenshot({ path: path.join(out, name), animations: 'disabled' })
      report.screenshots.push(name)
    }
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
}

async function launch() {
  app = await electron.launch({ executablePath: process.env.LEXICON_EXE || undefined, args: process.env.LEXICON_EXE ? [] : [root], env: { ...process.env, LEXICON_TEST_DATA: profile } })
  page = await app.firstWindow()
  page.on('pageerror', e => report.errors.push(e.message))
  page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()) })
  await page.locator('nav[aria-label=主导航]').waitFor()
}
;(async () => {
  await fs.mkdir(out, { recursive: true })
  await launch()
  await page.evaluate(() => localStorage.setItem('lexicon-guide-v3', 'complete'))
  await page.reload()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.emulateMedia({ colorScheme: 'light' })
  await nav('设置与备份')
  await dark(false)
  assert.equal(await page.getByRole('button', { name: /跟随系统 随设备/ }).getAttribute('aria-pressed'), 'true')
  assert.equal(await page.getByText(/从旧版|迁移助手/).count(), 0)
  assert.equal(await page.evaluate(() => 'migrateLegacy' in window.lexicon), false)
  check('Defaults to system appearance; legacy UI and preload capability removed')
  await page.emulateMedia({ colorScheme: 'dark' }); await dark(true)
  check('System colour scheme changes update the open page without reload')
  await page.getByRole('button', { name: /^浅色 / }).click(); await dark(false)
  assert.equal(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'light')
  await page.emulateMedia({ colorScheme: 'light' })
  await page.emulateMedia({ colorScheme: 'dark' }); await dark(false)
  await shot('11-settings-light')
  const cards = page.locator('.settings-layout > .settings-card')
  const bounds = await cards.evaluateAll(cards => cards.map(card => { const r=card.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,b:r.bottom} }))
  for (let i=1;i<bounds.length;i++) { assert.equal(bounds[i].x,bounds[0].x); assert.equal(bounds[i].w,bounds[0].w); assert.ok(bounds[i].y>=bounds[i-1].b) }
  await page.getByRole('button', { name: /^深色 / }).click(); await dark(true)
  assert.equal(await app.evaluate(({ nativeTheme }) => nativeTheme.themeSource), 'dark')
  await shot('12-settings-dark')
  await page.reload(); await dark(true)
  check('Manual override persists across reload and synchronizes Electron nativeTheme')
  await nav('设置与备份')
  await page.getByRole('button', { name: /自定义 API/, exact: false }).click()
  await page.getByRole('dialog').waitFor()
  await shot('13-dialog-dark')
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click()
  const fixture = await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('lexicon-state-v1'))
    const g = {id:'layout-shape',wordIds:[],kind:'confusable',manual:false,createdAt:1}
    const definitions = [
      ['property', '所有物，财产；地产，房地产；房地产股票（或投资）（properties）；〈法律〉所有权，处置权；特性，性质'],
      ['proprietor', '所有者；业主；经营者'], ['propriety', '得体；礼节；合宜'], ['proprietary', '所有权的；专有的；私有的'],
    ]
    s.words = {}; s.groups = { [g.id]: { ...g, wordIds: [] } }; s.stats = {}; s.synonymSets = {}
    definitions.forEach(([text, gloss], i) => {
      const id = 'fixture-' + i
      s.words[id] = { id, text, gloss, meanings: [], source: 'manual', groupId: g.id, addedAt: i + 1 }
      s.groups[g.id].wordIds.push(id)
    })
    return JSON.stringify(s)
  })
  await nav('设置与备份')
  await page.locator('input[type=file]').setInputFiles({ name: 'layout-fixture.json', mimeType: 'application/json', buffer: Buffer.from(fixture) })
  await page.getByRole('alertdialog').getByRole('button', { name: '确认导入', exact: true }).click()
  await page.getByText('备份已导入', { exact: true }).waitFor()
  await nav('综合抽查')
  await checkQuizSetup('dark')
  await page.getByRole('button', { name: '看中文 · 选英文 再认练习', exact: true }).click()
  await page.getByRole('button', { name: /^开始/  }).click()
  while (!(await page.locator('.quiz-prompt-text').textContent()).includes('房地产')) {
    const prompt = await page.locator('.quiz-prompt-text').textContent()
    const answer = prompt.includes('业主') ? 'proprietor' : prompt.includes('礼节') ? 'propriety' : 'proprietary'
    await page.locator('.quiz-option').filter({ hasText: new RegExp('^[A-D]\\s*' + answer + '$') }).click()
    await page.waitForTimeout(850)
  }
  await shot('17-quiz-long-dark')
  const prompt = await page.locator('.quiz-prompt').boundingBox()
  const response = await page.locator('.quiz-response').boundingBox()
  assert.ok(response.x > prompt.x + 300)
  for (const width of [1920, 1280, 820, 390]) {
    await page.setViewportSize({ width, height: 900 })
    await noOverflow()
    await shot('18-quiz-dark-' + width)
  }
  check('Long quiz definitions and options fit 1920 / 1440 / 1280 / 820 / 390 widths')
  await page.setViewportSize({ width: 1440, height: 1000 })
  await nav('设置与备份')
  await page.getByRole('button', { name: /^浅色 / }).click(); await dark(false)
  await nav('综合抽查'); await shot('19-quiz-long-light')
  // Select the wrong answer and verify correction feedback stays visible.
  await page.locator('.quiz-option').filter({ hasText: 'propriety' }).click()
  await page.getByRole('button', { name: /^(下一题（Enter）|查看本轮结果)$/ }).waitFor()
  await shot('20-quiz-feedback-light')
  await page.getByRole('button', { name: '结束本轮', exact: true }).click()
  await page.locator('.quiz-setup').waitFor()
  await nav('设置与备份')
  await page.locator('input[type=file]').setInputFiles({ name: 'layout-fixture.json', mimeType: 'application/json', buffer: Buffer.from(fixture) })
  await page.getByRole('alertdialog').getByRole('button', { name: '确认导入', exact: true }).click()
  await page.getByText('备份已导入', { exact: true }).last().waitFor()
  await nav('综合抽查')
  await checkQuizSetup('light')
  check('Six modes form a 2×3 grid, the start panel aligns on desktop, and forecast empty states have breathing room in both themes')
  await nav('设置与备份')
  for (const width of [820, 390]) {
    await page.setViewportSize({ width, height: 900 }); await noOverflow(); await shot('21-settings-light-' + width)
  }
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.getByRole('button', { name: /^深色 / }).click(); await dark(true)
  const management = JSON.parse(fixture)
  for (let i = 0; i < 48; i++) {
    const id = 'isolated-' + i
    management.words[id] = { id, text: 'example ' + i, gloss: '词库示例', meanings: [], source: 'manual', groupId: id, addedAt: i + 10 }
    management.groups[id] = { id, wordIds: [id], manual: false, createdAt: i + 10 }
  }
  await page.locator('input[type=file]').setInputFiles({ name: 'scroll-fixture.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(management)) })
  await page.getByRole('alertdialog').getByRole('button', { name: '确认导入', exact: true }).click()
  await page.getByText('备份已导入', { exact: true }).last().waitFor()
  await nav('录入与管理词汇')
  await checkSticky('dark')
  await nav('设置与备份')
  await page.getByRole('button', { name: /^浅色 / }).click(); await dark(false)
  await nav('录入与管理词汇')
  await checkSticky('light')
  check('Sticky entry and library toolbar retain their dimensions while a feathered, click-through blur covers the scrolling cards')
  await nav('设置与备份')
  await page.getByRole('button', { name: /^深色 / }).click(); await dark(true)
  for (const name of ['今日学习', '录入与管理词汇', '综合抽查', '设置与备份']) {
    await nav(name); await noOverflow(); await shot('22-dark-' + name)
  }
  await app.close(); app = null
  await launch(); await dark(true)
  check('All main sections and dialogs render in dark mode; override survives process relaunch')
  assert.equal(report.errors.length, 0, JSON.stringify(report.errors))
  report.passed = true
})().catch(e => { report.passed = false; report.failure = e.stack; console.error(e); process.exitCode = 1 }).finally(async () => {
  if (app) await app.close().catch(() => {})
  await fs.writeFile(path.join(out, 'appearance-report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
})
