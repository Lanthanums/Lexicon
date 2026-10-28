const { _electron: electron, chromium } = require('playwright')
const path = require('node:path'), fs = require('node:fs/promises'), assert = require('node:assert/strict')
const { createServer } = require('node:http')
const root = path.resolve(__dirname, '..')
const artifactDir = path.resolve(process.env.LEXICON_ARTIFACT_DIR || path.join(root, 'verification'))
const profile = path.join(artifactDir, 'migration-profile-' + Date.now())
const legacy = { words: { old: { id: 'old', text: 'accept', gloss: '接受', phonetic: '/əkˈsept/', meanings: [{ pos: 'v.', en: 'to receive willingly', zh: '接受' }], source: 'manual', groupId: 'g', addedAt: 1 } }, groups: { g: { id: 'g', wordIds: ['old'], manual: false, createdAt: 1 } }, stats: { old: { correct: 4, wrong: 2, level: 2 } } }
const report = { checks: [], errors: [] }
let app, browser, seedServer
;(async()=>{
  seedServer = createServer((req,res)=>res.end('<html><title>legacy origin test</title></html>'))
  await new Promise((ok, fail)=>seedServer.once('error', fail).listen(3000,'127.0.0.1',ok))
  browser = await chromium.launch({ ...(process.env.LEXICON_BROWSER_PATH ? { executablePath: process.env.LEXICON_BROWSER_PATH } : { channel: process.env.LEXICON_BROWSER_CHANNEL || 'msedge' }), headless:true })
  const bp = await browser.newPage()
  await bp.goto('http://localhost:3000/')
  await bp.evaluate(raw=>localStorage.setItem('lexicon-state-v1',raw),JSON.stringify(legacy))
  await new Promise(ok=>seedServer.close(ok)); seedServer=null
  app = await electron.launch({ args:[root], env:{...process.env,LEXICON_TEST_DATA:profile} })
  const page = await app.firstWindow()
  page.on('pageerror',e=>report.errors.push(e.message))
  await page.getByRole('navigation',{name:'主导航'}).waitFor()
  await page.evaluate(()=>localStorage.setItem('lexicon-tour-done-v1','1'));await page.reload()
  await page.getByRole('navigation').getByRole('button',{name:'设置与备份',exact:true}).click()
  await app.evaluate(({shell})=>{ shell.openExternal = async url=>{ global.__migrationURL=url } })
  await page.getByRole('button',{name:'从旧版浏览器迁移',exact:true}).click()
  let url
  for(let i=0;i<30;i++){url=await app.evaluate(()=>global.__migrationURL);if(url)break;await page.waitForTimeout(100)}
  assert.ok(url)
  await bp.goto(url)
  await bp.getByText(/已读取。请返回/).waitFor()
  const confirm = page.getByRole('alertdialog')
  await confirm.getByRole('button',{name:'确认导入',exact:true}).click()
  await page.waitForTimeout(400)
  let migrated = await page.evaluate(()=>JSON.parse(localStorage.getItem('lexicon-state-v1')))
  assert.deepEqual(migrated.words,legacy.words);assert.deepEqual(migrated.stats,legacy.stats)
  assert.deepEqual(migrated.synonymSets,{})
  assert.equal(await bp.evaluate(()=>localStorage.getItem('lexicon-state-v1')),JSON.stringify(legacy))
  report.checks.push('Real Edge same-origin legacy transfer; confirmation; IDs/history unchanged; browser source unchanged')
  page.on('dialog',d=>d.accept())
  await page.locator('input[type=file]').setInputFiles({name:'invalid.json',mimeType:'application/json',buffer:Buffer.from('{"words":{},"groups":[],"stats":{}}')})
  await page.getByText('导入失败：文件格式不正确',{exact:true}).waitFor()
  // First file may be waiting for the intentional replacement confirmation.
  await page.waitForTimeout(200)
  await page.evaluate(()=>true)
  let after = await page.evaluate(()=>JSON.parse(localStorage.getItem('lexicon-state-v1')))
  assert.deepEqual(after.words,legacy.words)
  report.checks.push('Malformed import leaves existing library intact')
  // Force a worker cycle via mocked dictionary lookup at the 50th shape-word add.
  const next={...migrated,learning:{enabled:true,addCount:49,traces:[]}}
  for(let i=0;i<12;i++){let id='w'+i,gid='g'+Math.floor(i/3);next.words[id]={id,text:'testing'+String.fromCharCode(97+i),gloss:'测试'+i,meanings:[],source:'manual',groupId:gid,addedAt:100+i};if(!next.groups[gid])next.groups[gid]={id:gid,wordIds:[],manual:false,createdAt:1};next.groups[gid].wordIds.push(id)}
  await page.locator('input[type=file]').setInputFiles({name:'worker-fixture.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(next))})
  await page.getByText('备份已导入',{exact:true}).waitFor()
  await page.waitForTimeout(250)
  await page.route('lexicon://app/youdao/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ec:{word:{trs:[{pos:'n.',tran:'黄油'}]}}})}))
  await page.getByRole('navigation').getByRole('button',{name:'形近辨析',exact:true}).click()
  await page.locator('input[placeholder="输入单词以添加"]:visible').fill('butter')
  await page.locator('section:not([hidden])').getByRole('button',{name:'查询并加入',exact:true}).click()
  await page.waitForFunction(()=>{const s=JSON.parse(localStorage.getItem('lexicon-state-v1'));return s.learning.addCount===50&&s.learning.traces.length===1},null,{timeout:15000})
  const learned = await page.evaluate(()=>JSON.parse(localStorage.getItem('lexicon-state-v1')))
  assert.ok(learned.learning.traces[0].wordCount>0)
  report.checks.push('Desktop custom protocol loads background threshold worker and records 50th-add suggestion')
  assert.equal(report.errors.length,0)
  report.passed=true
})().catch(e=>{report.passed=false;report.failure=e.stack;console.error(e);process.exitCode=1}).finally(async()=>{
  if(seedServer)seedServer.close()
  if(browser)await browser.close()
  if(app)await app.close()
  await fs.writeFile(path.join(artifactDir,'migration-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))
})
