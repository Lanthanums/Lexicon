const {_electron:electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict')
const root=path.resolve(__dirname,'..'),out=process.env.LEXICON_ARTIFACT_DIR||path.join(root,'verification')
const report={checks:[],screenshots:[],errors:[]};let app,page
const nav=async name=>{await page.getByRole('navigation').getByRole('button',{name,exact:true}).click();await page.waitForTimeout(280)}
const state=async()=>{await page.waitForTimeout(240);return page.evaluate(()=>JSON.parse(localStorage.getItem('lexicon-state-v1')))}
const entryFocused=()=>page.waitForFunction(()=>document.activeElement?.getAttribute('aria-label')==='录入英文单词')
async function shot(name,fullPage=false){await page.waitForTimeout(250);await page.screenshot({path:path.join(out,name+'.png'),fullPage,animations:'disabled'});report.screenshots.push(name+'.png')}
async function importFixture(fixture){await nav('设置与备份');await page.locator('input[type=file]').setInputFiles({name:'synthetic-beta2.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});await page.getByRole('alertdialog').getByRole('button',{name:'确认导入',exact:true}).click();await state()}
function fixture(count=65){const f={words:{},groups:{},synonymSets:{},stats:{},settings:{threshold:.7,dictProviders:[{id:'youdao-web',label:'网易有道',enabled:true}]},activity:{},learning:{enabled:false,addCount:0,traces:[]}}
 for(let i=0;i<count;i++){const text='fixture'+String.fromCharCode(97+Math.floor(i/26))+String.fromCharCode(97+i%26);f.words[text]={id:text,text,gloss:'练习词义 '+i,meanings:[],source:'manual',groupId:text,addedAt:i};f.groups[text]={id:text,wordIds:[text],manual:false,createdAt:i}}
 const today=new Date(),key=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;for(let i=0;i<14;i++){const d=new Date(today);d.setDate(d.getDate()-i);f.activity[key(d)]={added:i%4+1,reviewed:14-i}}
 return f}
async function mockDictionary(){await page.evaluate(()=>{
 const native=window.fetch.bind(window);window._entryRequests=[]
 window.fetch=async(input,options)=>{
   const requestUrl=new URL(String(input),location.href)
   const url=requestUrl.pathname==='/fwd'?new URL(requestUrl.searchParams.get('url')):requestUrl
   if(url.hostname==='en.wiktionary.org' || url.hostname==='api.dictionaryapi.dev' || url.hostname==='api.mymemory.translated.net'){
     window._backupRequests ??= []
     window._backupRequests.push(url.hostname)
     if(!window._allowBackup)return new Response(null,{status:404})
     if(url.hostname==='api.dictionaryapi.dev'){
       if(url.pathname.endsWith('/pneumatic'))return Response.json([{word:'pneumatic',phonetic:'/njuːˈmætɪk/',meanings:[{partOfSpeech:'adjective',definitions:[{definition:'Powered by compressed air.'}]}]}])
       return Response.json([{phonetic:'/ˈefluənt/',meanings:[{partOfSpeech:'noun',definitions:[{definition:'Liquid waste flowing out of a plant.'}]}]}])
     }
     if(url.hostname==='api.mymemory.translated.net')return Response.json({responseData:{translatedText:url.searchParams.get('q')==='pneumatic'?'气动的':'流出的液体；工业废水'}})
     return new Response(null,{status:404})
   }
   if(!url.pathname.startsWith('/youdao/'))return native(input,options)
   const word=url.searchParams.get('q')
   // The home page can finish its independent word-of-the-day lookup mid-test.
   if(['effluent','affluent','effulgent','meandering','delayedword','pneumatic'].includes(word))window._entryRequests.push(word)
   if(word==='meandering')await new Promise(resolve=>setTimeout(resolve,900)) // intentionally ignores AbortSignal
   if(['unsourced','blankmeaning'].includes(word))return new Response('{}',{headers:{'Content-Type':'application/json'}})
   const definitions = {lethal:'致命的，致死的',leather:'皮革',fatal:'致命的；灾难性的'}
   if (Object.hasOwn(definitions, word)) {
     return Response.json({input:word,ec:{word:{trs:[{pos:word==='leather'?'n.':'adj.',tran:definitions[word]}]}}})
   }
   if(word==='pneumatic')return Response.json({
     input:'Flagstaff',meta:{input:'Flagstaff'},
     ec:{word:[{'return-phrase':{l:{i:'Flagstaff'}},ukphone:'ˈflæɡstɑːf',trs:[{tr:[{l:{i:['n. 旗杆']}}]}]}]},
     web_trans:{'web-translation':[{key:'Flagstaff',trans:[{value:'旗杆镇'},{value:'旗杆市'},{value:'旗杆'}]}]},
   })
   return new Response(JSON.stringify({input:word,ec:{word:{trs:[{pos:'adj.',tran:word==='effluent'?'富有':word==='affluent'?'富裕的':'词义 '+word}]}}}),{headers:{'Content-Type':'application/json'}})
 }
})}
;(async()=>{
 await fs.mkdir(out,{recursive:true});app=await electron.launch({executablePath:process.env.LEXICON_EXE||undefined,args:process.env.LEXICON_EXE?[]:[root],env:{...process.env,LEXICON_TEST_DATA:path.join(out,'beta2-profile-'+Date.now())}})
 page=await app.firstWindow();page.on('pageerror',error=>report.errors.push(error.message));await page.locator('nav[aria-label=主导航]').waitFor();await page.setViewportSize({width:1440,height:1000})
 await page.evaluate(()=>localStorage.setItem('lexicon-guide-v3','complete'));await page.reload();let dialog

 await importFixture(fixture(4));await nav('录入与管理词汇');await entryFocused()
 const four=await page.locator('[data-card-id]').evaluateAll(cards=>cards.map(card=>{
  const {x,y}=card.getBoundingClientRect();return {id:card.getAttribute('data-card-id'),x,y}
 }))
 assert.deepEqual(four.map(card=>card.id),['fixturead','fixtureac','fixtureab','fixtureaa'])
 assert.ok(four[0].x<four[1].x&&four[1].x<four[2].x&&four.slice(0,3).every(card=>Math.abs(card.y-four[0].y)<1))
 assert.ok(four[3].y>four[0].y&&Math.abs(four[3].x-four[0].x)<1)
 await page.getByRole('button',{name:'列表视图',exact:true}).click();await entryFocused()
 await page.getByRole('combobox',{name:'排序方式'}).click()
 await page.getByRole('option',{name:'A → Z',exact:true}).click();await entryFocused()
 await page.getByRole('checkbox',{name:'筛选独立单词'}).click();await entryFocused()
 await page.getByRole('checkbox',{name:'筛选独立单词'}).click();await entryFocused()
 await page.getByRole('button',{name:'搜索词库',exact:true}).click()
 await page.getByRole('textbox',{name:'搜索关键词'}).fill('fixturead')
 await page.keyboard.press('Escape');await entryFocused()
 await page.getByRole('button',{name:'编辑 fixturead',exact:true}).click()
 await page.getByRole('dialog').getByRole('button',{name:'取消',exact:true}).click();await entryFocused()
 await page.getByRole('button',{name:'瀑布流视图',exact:true}).click();await entryFocused()
 report.checks.push('Four cards are sorted left to right as 3+1, and switching views, sorting, filtering, search and editing restore entry focus')

 const uneven=fixture(7)
 for(const id of ['fixtureaa','fixtureab','fixtureac']){
  delete uneven.groups[id]
  uneven.words[id].groupId='fixtureaf'
  uneven.groups.fixtureaf.wordIds.push(id)
 }
 for(const id of ['fixtureag','fixtureae'])uneven.words[id].gloss='包含长释义和多个短语的词条。'.repeat(30)
 await importFixture(uneven);await nav('录入与管理词汇')
 const masonry=page.locator('.management-masonry')
 const packedBelow=(upper,lower)=>masonry.evaluate((container,{upper,lower})=>{
  const a=container.querySelector(`[data-card-id="${upper}"]`)?.getBoundingClientRect()
  const b=container.querySelector(`[data-card-id="${lower}"]`)?.getBoundingClientRect()
  return a&&b&&Math.abs(a.x-b.x)<1&&Math.abs(b.top-a.bottom-16)<1
 },{upper,lower})
 assert.ok(await packedBelow('fixtureag','fixturead'))
 const tall=await masonry.locator('[data-card-id=fixtureaf]').boundingBox()
 const fourth=await masonry.locator('[data-card-id=fixturead]').boundingBox()
 assert.ok(fourth.y+fourth.height<tall.y+tall.height)
 await masonry.locator('[data-card-id=fixtureag]').getByRole('button',{name:'展开释义'}).click()
 await page.waitForFunction(()=>document.querySelector('[data-card-id=fixturead]').style.getPropertyValue('--masonry-column')==='2')
 assert.ok(await packedBelow('fixtureae','fixturead'))
 await masonry.locator('[data-card-id=fixtureag]').getByRole('button',{name:'收起释义'}).click()
 await page.waitForFunction(()=>document.querySelector('[data-card-id=fixturead]').style.getPropertyValue('--masonry-column')==='0')
 assert.ok(await packedBelow('fixtureag','fixturead'))
 await shot('49-uneven-masonry')
 report.checks.push('Uneven cards fill the shortest column immediately, repacking after gloss expansion and collapse')

 await importFixture(fixture());await nav('录入与管理词汇');await mockDictionary();const input=page.getByRole('textbox',{name:'录入英文单词',exact:true});await input.fill('effluent;affluent;effulgent');await page.getByRole('button',{name:'查询并加入',exact:true}).click()
 await page.waitForFunction(()=>Object.values(JSON.parse(localStorage.getItem('lexicon-state-v1')).words).some(w=>w.text==='effulgent'))
 let s=await state();assert.equal(Object.keys(s.words).length,68);assert.deepEqual(await page.evaluate(()=>window._entryRequests),['effluent','affluent','effulgent']);const eff=Object.values(s.words).find(w=>w.text==='effluent'),aff=Object.values(s.words).find(w=>w.text==='affluent');assert.equal(eff.groupId,aff.groupId)
 assert.equal(await page.getByRole('dialog').count(),0);assert.equal(await page.locator('[data-sonner-toast]').filter({hasText:'已入库 3 个单词'}).count(),1);await shot('42-batch-result');report.checks.push('Semicolon queue queries in order, groups words from the same batch and emits one combined result notification')
 await entryFocused()
 const originalOrder=s.groups[eff.groupId].wordIds
 const shapeCard=page.locator(`[data-card-id="${eff.groupId}"]`)
 const retryMenu=shapeCard.getByRole('button',{name:'重试组内单词的释义',exact:true})
 assert.equal(await retryMenu.evaluate(button=>button.nextElementSibling?.getAttribute('aria-label')?.startsWith('编辑 ')),true)
 await retryMenu.click();await page.getByRole('menuitem',{name:'重试 effluent',exact:true}).click();await entryFocused()
 await page.getByText('「effluent」的释义未更新',{exact:true}).waitFor()
 assert.equal((await state()).words[eff.id].gloss,'富有')
 await page.evaluate(()=>{window._allowBackup=true})
 await retryMenu.click();await page.getByRole('menuitem',{name:'重试 effluent',exact:true}).click()
 await page.getByText('「effluent」的释义已更新',{exact:true}).waitFor();await entryFocused()
 s=await state();assert.equal(s.words[eff.id].gloss,'流出的液体；工业废水');assert.equal(s.words[eff.id].phonetic,'/ˈefluənt/');assert.match(s.words[eff.id].meanings[0].en,/Liquid waste/)
 assert.equal(s.words[eff.id].groupId,eff.groupId);assert.deepEqual(s.groups[eff.groupId].wordIds,originalOrder)
 assert.deepEqual(await page.evaluate(()=>window._entryRequests),['effluent','affluent','effulgent'])
 assert.ok(await shapeCard.getByRole('button',{name:'重试 affluent 的释义',exact:true}).isVisible())
 report.checks.push('Retry beside the pencil targets one suspect member, bypasses Youdao, preserves the original on failure and updates shared definitions on success')

 await input.fill('coriander;unsourced;blankmeaning');await page.getByRole('button',{name:'查询并加入',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:'确认本次入库',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),1);assert.equal(Object.keys((await state()).words).length,68)
 const missing=dialog.getByPlaceholder('未查到释义，可手动补充或留空跳过');assert.equal(await missing.count(),2);await missing.first().fill('手动补充释义');await shot('43-batch-review');await dialog.getByRole('button',{name:'确认并入库',exact:true}).click();await dialog.waitFor({state:'hidden'});s=await state();assert.equal(Object.keys(s.words).length,70);assert.ok(Object.values(s.words).some(w=>w.text==='unsourced'&&w.gloss==='手动补充释义'));assert.ok(!Object.values(s.words).some(w=>w.text==='blankmeaning'));assert.equal(await input.inputValue(),'blankmeaning');assert.equal(await page.locator('[data-sonner-toast]').filter({hasText:'未查到释义（未入库）：blankmeaning'}).count(),1)
 await entryFocused()
 report.checks.push('Multiple missing definitions share one review dialog, stage no partial writes, accept manual meanings and summarize skipped exceptions once')

 await input.fill('meandering;delayedword');await page.getByRole('button',{name:'查询并加入',exact:true}).click();await page.getByRole('button',{name:'取消查询',exact:true}).click();await input.fill('cotangent');await page.getByRole('button',{name:'查询并加入',exact:true}).click();await page.waitForFunction(()=>Object.values(JSON.parse(localStorage.getItem('lexicon-state-v1')).words).some(w=>w.text==='cotangent'));await page.waitForTimeout(1100);s=await state();assert.ok(!Object.values(s.words).some(w=>['meandering','delayedword'].includes(w.text)));assert.equal(await page.getByRole('button',{name:'取消查询',exact:true}).count(),0);assert.equal(await page.getByRole('dialog').count(),0);assert.ok(!(await page.evaluate(()=>window._entryRequests)).includes('delayedword'))
 report.checks.push('Cancel never re-submits the form; even a late provider response cannot add a word or reset a newer query')

 await page.evaluate(()=>window.scrollTo(0,0));const controls=page.locator('.management-sticky'),resting=await controls.boundingBox()
 const texts=[controls.getByRole('heading',{name:'词库',exact:true}),controls.getByText(/个单词 ·/),controls.getByText(/用分号或换行分隔/)]
 for(const scroll of [resting.y-1,resting.y+1,resting.y-1,1100]){
  await page.evaluate(y=>window.scrollTo(0,y),scroll);await page.waitForTimeout(240)
  const box=await controls.boundingBox();assert.ok(box.y>=0&&box.y<20);assert.ok(Math.abs(box.height-resting.height)<0.5)
  for(const label of texts)assert.ok(await label.isVisible())
 }
 await entryFocused();await shot('44-sticky-entry')
 for(const width of [820,390]){await page.setViewportSize({width,height:900});await page.waitForTimeout(300);const b=await controls.boundingBox();assert.ok(b.height<500);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)}
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await controls.evaluate(el=>getComputedStyle(el).transitionDuration),'1e-05s');await page.emulateMedia({reducedMotion:'no-preference'});report.checks.push('Entry and management controls keep the same size and text across the sticky boundary, with no horizontal overflow at desktop/tablet/phone widths')

 await page.setViewportSize({width:1920,height:1100});await nav('今日学习');assert.equal(await page.getByText('Look closer',{exact:true}).count(),0);let chart=page.getByTestId('home-activity');await chart.waitFor();assert.equal(await chart.getByRole('img',{name:/近14天录入/}).count(),1);assert.ok(await chart.locator('.recharts-yAxis .recharts-cartesian-axis-tick').count()>0);await chart.getByRole('button',{name:'近 30 天',exact:true}).click();assert.equal(await chart.getByRole('img',{name:/近30天录入/}).count(),1);await shot('45-home-light',true)
 await nav('设置与备份');const backup=page.locator('.settings-card').filter({has:page.getByRole('heading',{name:'数据与备份',exact:true})});const exp=await backup.getByRole('button',{name:'导出备份',exact:true}).boundingBox(),imp=await backup.getByRole('button',{name:'导入备份',exact:true}).boundingBox(),folder=await backup.getByRole('button',{name:'打开数据文件夹',exact:true}).boundingBox(),restore=await backup.getByRole('button',{name:'恢复导入前副本',exact:true}).boundingBox(),del=await backup.getByRole('button',{name:'清空全部数据',exact:true}).boundingBox();assert.ok(Math.abs(exp.y-imp.y)<2);assert.ok(folder.x>imp.x+imp.width+100);assert.ok(restore.y>exp.y+exp.height+20);assert.ok(Math.abs(restore.y-del.y)<5);assert.ok(exp.width<240&&imp.width<240);await backup.scrollIntoViewIfNeeded();await shot('46-backup-layout')
 await page.getByRole('button',{name:/^深色 /}).click();await nav('今日学习');await shot('47-home-dark',true);for(const width of [820,390]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)}
 report.checks.push('Homepage removes obsolete links, renders labelled history charts with 14/30-day detail, and backup actions form three clear spatial groups in the existing palette')

 await page.setViewportSize({width:1440,height:1000});const ties=fixture(0);for(const text of ['dare','care']){ties.words[text]={id:text,text,gloss:'示例词义',meanings:[],source:'manual',groupId:text,addedAt:1};ties.groups[text]={id:text,wordIds:[text],manual:false,createdAt:1}}
 await importFixture(ties);await nav('录入与管理词汇');await input.fill('fare;mare;unsourced');await page.getByRole('button',{name:'查询并加入',exact:true}).click();dialog=page.getByRole('dialog');await dialog.getByRole('heading',{name:'确认本次入库',exact:true}).waitFor();assert.equal(await page.getByRole('dialog').count(),1);assert.equal(await dialog.getByLabel('形近关系',{exact:true}).count(),2);assert.equal(Object.keys((await state()).words).length,2);await dialog.getByRole('button',{name:'取消入库',exact:true}).click();await dialog.waitFor({state:'hidden'});assert.equal(Object.keys((await state()).words).length,2);await page.getByRole('button',{name:'查询并加入',exact:true}).click();await dialog.getByRole('heading',{name:'确认本次入库',exact:true}).waitFor();await dialog.getByLabel('形近关系',{exact:true}).first().selectOption('care');await dialog.getByPlaceholder('未查到释义，可手动补充或留空跳过').fill('补充的释义');await shot('48-batch-ties');await dialog.getByRole('button',{name:'确认并入库',exact:true}).click();const staleShape=dialog.getByLabel('形近关系',{exact:true}).filter({has:page.locator('option[value="__lexicon_choose_again__"]')});await staleShape.waitFor();assert.equal(await dialog.getByRole('button',{name:'确认并入库',exact:true}).isEnabled(),false);assert.equal(Object.keys((await state()).words).length,2);await staleShape.selectOption('care');await dialog.getByRole('button',{name:'确认并入库',exact:true}).click();await dialog.waitFor({state:'hidden'});s=await state();assert.equal(Object.keys(s.words).length,5);assert.equal(Object.values(s.words).find(w=>w.text==='fare').groupId,'care');report.checks.push('Two ambiguous grouping decisions and a missing definition share one dialog; cancelling writes nothing and selected groups survive sequential re-planning before atomic save')

 await importFixture(fixture(0));await nav('录入与管理词汇')
 await input.fill('pneumatic');await input.press('Enter')
 await page.waitForFunction(()=>Object.values(JSON.parse(localStorage.getItem('lexicon-state-v1')).words).some(word=>word.text==='pneumatic'&&word.gloss==='气动的'))
 assert.equal(await page.evaluate(()=>window._entryRequests.filter(word=>word==='pneumatic').length),1)
 const legacy=fixture(0)
 legacy.words.pneumatic={id:'pneumatic',text:'pneumatic',gloss:'旗杆镇；旗杆市；旗杆',source:'api',groupId:'pneumatic',addedAt:1,
  meanings:['旗杆镇','旗杆市','旗杆'].map(zh=>({pos:'',en:'',zh}))}
 legacy.groups.pneumatic={id:'pneumatic',wordIds:['pneumatic'],manual:true,createdAt:1}
 await importFixture(legacy);await nav('录入与管理词汇')
 await page.locator('[data-card-id=pneumatic]').getByRole('button',{name:'重试 pneumatic 的释义',exact:true}).click()
 await page.waitForFunction(()=>JSON.parse(localStorage.getItem('lexicon-state-v1')).words.pneumatic.gloss==='气动的')
 assert.equal(await page.evaluate(()=>window._entryRequests.filter(word=>word==='pneumatic').length),1)
 assert.equal(await page.getByRole('button',{name:'重试 pneumatic 的释义',exact:true}).count(),0)
 report.checks.push('A mismatched Youdao headword is rejected before pneumatic is saved; the old Flagstaff gloss exposes Retry and is repaired')

 for (const entries of [['leather','lethal','fatal'],['leather','fatal','lethal'],['lethal;leather;fatal']]) {
  await importFixture(fixture(0));await nav('录入与管理词汇')
  let count=0
  for (const entry of entries) {
   count+=entry.split(';').length
   await input.fill(entry);await input.press('Enter')
   await page.waitForFunction(n=>Object.keys(JSON.parse(localStorage.getItem('lexicon-state-v1')).words).length===n,count)
  }
  const dual=await state()
  const [lethal,leather,fatal]=['lethal','leather','fatal'].map(text=>Object.values(dual.words).find(word=>word.text===text))
  assert.deepEqual(new Set(dual.groups[lethal.groupId].wordIds),new Set([lethal.id,leather.id]))
  assert.equal(Object.keys(dual.synonymSets).length,1)
  assert.deepEqual(new Set(Object.values(dual.synonymSets)[0].wordIds),new Set([lethal.id,fatal.id]))
  assert.equal(await page.locator(`[data-card-kind=shape] [data-management-word="${lethal.id}"]`).count(),1)
  assert.equal(await page.locator(`[data-card-kind=synonym] [data-management-word="${lethal.id}"]`).count(),1)
  assert.equal(await page.locator('[data-card-kind=isolated]').count(),0)
 }
 report.checks.push('Sequential and batch entry each create a lethal / leather shape group and a lethal / fatal synonym group')

 const conflict=fixture(0)
 for(const text of ['leather','lethal']){
  conflict.words[text]={id:text,text,gloss:text==='leather'?'皮革':'致命的',meanings:[],source:'api',groupId:'shape',addedAt:1}
 }
 conflict.groups.shape={id:'shape',wordIds:['leather','lethal'],manual:true,createdAt:1}
 const oldNear={id:'old-near',name:'旧近义组',notes:'原始笔记',wordIds:['leather','lethal'],createdAt:1}
 conflict.synonymSets[oldNear.id]=oldNear
 await importFixture(conflict);await nav('录入与管理词汇')
 await input.fill('fatal');await input.press('Enter')
 dialog=page.getByRole('dialog')
 const near=dialog.getByLabel('近义关系',{exact:true})
 await near.waitFor()
 assert.equal(await near.inputValue(),'')
 await dialog.getByRole('button',{name:'取消入库',exact:true}).click()
 await dialog.waitFor({state:'hidden'})
 assert.deepEqual((await state()).synonymSets[oldNear.id],oldNear)
 assert.equal(Object.keys((await state()).words).length,2)
 await input.press('Enter')
 await near.selectOption({label:'新建 fatal / lethal（从「近义组 · 旧近义组」移出 lethal）'})
 await dialog.getByRole('button',{name:'确认并入库',exact:true}).click()
 await dialog.waitFor({state:'hidden'})
 const repaired=await state(),fatal=Object.values(repaired.words).find(word=>word.text==='fatal')
 assert.deepEqual(repaired.groups.shape.wordIds,['leather','lethal'])
 assert.deepEqual(Object.values(repaired.synonymSets).map(group=>group.wordIds),[['lethal',fatal.id]])
 assert.deepEqual(repaired.relationArchive,[oldNear])
 assert.equal(await page.locator('[data-card-kind=isolated]').getByText('fatal',{exact:true}).count(),0)
 report.checks.push('An existing incompatible synonym group can be reassigned by explicit choice, preserving its notes in the archive and retaining the shape group')

 const f=fixture(3),ids=Object.keys(f.words);f.words[ids[0]].gloss='已经到期的测试词';f.stats[ids[0]]={correct:2,wrong:0,level:2,lastSeen:Date.now()-3*86400000,dueAt:Date.now()-86400000};f.stats[ids[2]]={correct:2,wrong:0,level:2,lastSeen:Date.now(),dueAt:Date.now()+7*86400000};await importFixture(f);await nav('综合抽查');assert.equal(await page.getByText(/推演假设|每日三档合计|不推测未记录的学习/).count(),0);await page.getByRole('button',{name:'听义拼写 主动回忆',exact:true}).click();await page.getByRole('button',{name:/^开始/}).click();assert.equal(await page.locator('.quiz-prompt-text').textContent(),'已经到期的测试词');await page.getByPlaceholder('拼出这个单词…').fill(ids[0]);await page.getByRole('button',{name:'确定',exact:true}).click();s=await state();assert.ok(s.stats[ids[0]].memory?.stability>0);assert.ok(s.stats[ids[0]].dueAt>Date.now());report.checks.push('Quiz selects due words before new/future words and saves adaptive memory scheduling; removed developer explanations stay absent')
 assert.deepEqual(report.errors,[]);report.passed=true
})().catch(async error=>{report.passed=false;report.failure=error.stack;console.error(error);if(page)await shot('beta2-failure').catch(()=>{});process.exitCode=1}).finally(async()=>{if(app){await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>{});await app.close().catch(()=>{})};await fs.writeFile(path.join(out,'beta2-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))})
