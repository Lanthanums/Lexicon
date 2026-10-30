const { _electron } = require('playwright')
const path = require('node:path'), fs = require('node:fs/promises'), assert = require('node:assert/strict')
const root = path.resolve(__dirname, '..')
const out = process.env.LEXICON_ARTIFACT_DIR || path.join(root, 'verification')
const report = { checks: [], errors: [], screenshots: [] }
const profile = path.join(out, 'release-profile-' + Date.now())
let app, page
async function launch() {
  app = await _electron.launch({ executablePath: process.env.LEXICON_EXE || undefined, args: process.env.LEXICON_EXE ? [] : [root], env: { ...process.env, LEXICON_TEST_DATA: profile } })
  page = await app.firstWindow()
  page.on('pageerror', error => report.errors.push(error.message))
  await page.locator('nav[aria-label=主导航]').waitFor()
}
async function about() {
  await page.getByRole('navigation').getByRole('button', { name: '设置与备份', exact: true }).click()
  const label = page.locator('.settings-help [data-app-version]')
  assert.equal(await label.textContent(), 'Lexicon v2.0')
  assert.equal(await label.getAttribute('data-app-version'), '2.0.0')
  assert.equal(await app.evaluate(({ app }) => app.getVersion()), '2.0.0')
  return label
}
;(async () => {
  await fs.mkdir(out, { recursive: true })
  await launch()
  await page.evaluate(() => localStorage.setItem('lexicon-guide-v3', 'complete'))
  await page.reload()
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 })
    const label = await about()
    if (width === 1440) assert.equal(await page.locator('aside [data-app-version]').textContent(), 'v2.0')
    await label.scrollIntoViewIfNeeded()
    const filename = 'release-about-' + width + '.png'
    await page.locator('.settings-help').screenshot({ path: path.join(out, filename), animations: 'disabled' })
    report.screenshots.push(filename)
  }
  report.checks.push('Packaged application reports 2.0.0; About and sidebar show v2.0 at desktop/narrow sizes, with no beta or local-version placeholder')
  await app.close(); app = null
  await launch()
  await about()
  assert.equal(await page.evaluate(() => typeof require), 'undefined')
  report.checks.push('Version remains correct after process relaunch, and the renderer remains isolated from Node APIs')
  assert.deepEqual(report.errors, [])
  report.passed = true
})().catch(error => { report.passed = false; report.failure = error.stack; process.exitCode = 1; console.error(error) }).finally(async () => {
  if (app) await app.close().catch(() => {})
  await fs.writeFile(path.join(out, 'release-report.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
})
