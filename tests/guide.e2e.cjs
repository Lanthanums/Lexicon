const {_electron}=require('playwright'),fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict')
const root=path.resolve(__dirname,'..'),out=process.env.LEXICON_ARTIFACT_DIR||path.join(root,'verification')
const report={checks:[],screenshots:[],errors:[]};let app,page
const guide=()=>page.locator('.guided-tour'),panel=()=>page.locator('.guide-panel')
const state=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('lexicon-state-v1')))
async function arrive(id){await page.waitForFunction(id=>{const el=document.querySelector('.guided-tour');return el?.dataset.guideStep===id&&el.dataset.phase==='ready'&&el.dataset.placed==='true'},id);await page.waitForTimeout(180);assert.equal(await guide().getByText('重新定位',{exact:true}).count(),0)}
async function shot(name){await page.screenshot({path:path.join(out,name+'.png'),animations:'allow'});report.screenshots.push(name+'.png')}
async function beginFrames(){await page.evaluate(()=>{cancelAnimationFrame(window._guideRAF);window._frames=[];window._recording=true;function tick(){if(!window._recording)return;const root=document.querySelector('.guided-tour'),panel=document.querySelector('.guide-panel'),dialog=document.querySelector('[data-slot="dialog-content"]');if(root&&panel){const s=getComputedStyle(panel),r=panel.getBoundingClientRect(),d=dialog?.getBoundingClientRect();window._frames.push({step:root.dataset.guideStep,phase:root.dataset.phase,placed:root.dataset.placed,visibility:s.visibility,opacity:Number(s.opacity),x:r.x,y:r.y,w:r.width,h:r.height,viewport:[innerWidth,innerHeight],dialog:d?{x:d.x,y:d.y,w:d.width,h:d.height}:null})}window._guideRAF=requestAnimationFrame(tick)}window._guideRAF=requestAnimationFrame(tick)})}
async function endFrames(label){const frames=await page.evaluate(()=>{window._recording=false;cancelAnimationFrame(window._guideRAF);return window._frames});assert.ok(frames.length>10);for(const f of frames){if(f.visibility==='hidden'||f.opacity<.02)continue;assert.equal(f.placed,'true','visible panel is positioned before painting');assert.ok(f.x>=0&&f.y>=0&&f.x+f.w<=f.viewport[0]+1&&f.y+f.h<=f.viewport[1]+1,'frame stays on screen');if(f.phase==='locating')assert.fail('locating frame was visible')}
await fs.writeFile(path.join(out,'frames-'+label+'.json'),JSON.stringify(frames,null,2));return frames}
async function drag(source,target,card=false){
 const a=await source.boundingBox(),b=await target.boundingBox(),sx=a.x+20,sy=a.y+(card?8:15),tx=b.x+30,ty=b.y+20
 await page.mouse.move(sx,sy);await page.mouse.down();await page.mouse.move(sx+5,sy+5,{steps:3});await page.mouse.move(tx,ty,{steps:14});await page.mouse.move(tx+1,ty+1,{steps:2});await page.mouse.up()
}
async function completed(){await guide().getByText('这个技巧已试过了',{exact:true}).waitFor();await page.waitForTimeout(150)}
async function next(){await guide().getByRole('button',{name:'下一个技巧',exact:true}).click()}
async function gestureCourse({keyboard=false,capture=false}={}){
 await arrive('overview');assert.equal(await guide().getByRole('heading',{level:3}).count(),4);assert.equal(await guide().getByText('点击「今日学习」',{exact:true}).count(),0)
 if(capture)await shot('motion-'+page.viewportSize().width+'-overview')
 await guide().getByRole('button',{name:'试试隐藏技巧',exact:true}).click();await arrive('word')
 assert.equal(await page.locator('.guide-practice [data-drag-word]').count(),7)
 const scout=page.locator('[data-drag-word="guide-scout"]'),letters=page.locator('[data-card-id="guide-letters"]')
 await drag(scout,letters)
 await guide().getByRole('button',{name:'下一个技巧',exact:true}).waitFor({state:'visible'});await page.waitForFunction(()=>!document.querySelector('.guide-panel button:last-of-type:disabled'))
 await page.locator('[data-card-id="guide-letters"] [data-drag-word="guide-scout"]').waitFor()
 await completed();if(capture)await shot('motion-'+page.viewportSize().width+'-word-drag')
 await next();await arrive('card')
 await drag(page.locator('[data-card-id="guide-shape"]'),page.locator('[data-card-id="guide-near"]'),true)
 await page.locator('[data-card-kind="custom"] [data-drag-word="guide-adapt"]').waitFor();await page.waitForTimeout(250)
 await completed();if(capture)await shot('motion-'+page.viewportSize().width+'-card-merge')
 await next();await arrive('sort')
 const grip=page.locator('[data-editor-row-id="guide-stout"] .management-grip'),row=page.locator('[data-editor-row-id="guide-spout"]')
 if(keyboard){await grip.focus();await grip.press('ArrowDown')}else{const a=await grip.boundingBox(),b=await row.boundingBox();await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.waitForTimeout(300);await page.mouse.move(b.x+45,b.y+b.height-5,{steps:10});await page.mouse.up()}
 await page.waitForFunction(()=>document.querySelector('[data-editor-row-id]')?.dataset.editorRowId==='guide-spout')
 await completed();if(capture)await shot('motion-'+page.viewportSize().width+'-hold-sort')
 await next();await arrive('mastery')
 await page.locator('[data-editor-row-id="guide-stout"] .management-mastery-trigger').click();const slider=page.locator('.management-mastery-popover [role="slider"]');await slider.waitFor();await page.waitForTimeout(240)
 if(keyboard){await slider.focus();await slider.press('ArrowRight')}else{const a=await slider.boundingBox(),track=await page.locator('.management-mastery-slider').boundingBox();await page.mouse.move(a.x+a.width/2,a.y+a.height/2);await page.mouse.down();await page.mouse.move(track.x+track.width*.8,a.y+a.height/2,{steps:8});await page.mouse.up()}
 await page.waitForFunction(()=>document.querySelector('.management-mastery-popover [role="slider"]')?.getAttribute('aria-valuenow')!=='2')
 await completed();if(capture)await shot('motion-'+page.viewportSize().width+'-mastery')
 await next();await arrive('finish');await guide().getByRole('button',{name:'开始使用',exact:true}).click();await guide().waitFor({state:'detached'});assert.equal(await page.getByRole('dialog').count(),0)
}
async function replay(){await page.getByRole('navigation').getByRole('button',{name:'设置与备份',exact:true}).click();await page.getByRole('button',{name:'互动使用教学',exact:true}).click();await arrive('overview')}
;(async()=>{
 await fs.mkdir(out,{recursive:true});app=await _electron.launch({executablePath:process.env.LEXICON_EXE||undefined,args:process.env.LEXICON_EXE?[]:[root],env:{...process.env,LEXICON_TEST_DATA:path.join(out,'motion-guide-profile-'+Date.now())}})
 page=await app.firstWindow();page.on('pageerror',e=>report.errors.push(e.message));await page.setViewportSize({width:1440,height:1000});await page.waitForFunction(()=>localStorage.getItem('lexicon-state-v1'));const blank=await state();await arrive('overview');await page.setViewportSize({width:390,height:900});await page.waitForFunction(()=>{const r=document.querySelector('.guide-panel').getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1});await page.setViewportSize({width:1440,height:1000});await page.waitForFunction(()=>{const r=document.querySelector('.guide-panel').getBoundingClientRect();return Math.abs(r.x+r.width/2-innerWidth/2)<1.5});await beginFrames();await gestureCourse({capture:true});await endFrames('desktop');assert.deepEqual(await state(),blank)
 assert.equal(await page.locator('[data-card-id^="guide-"]').count(),0);assert.equal(await page.locator('h1').textContent(),'Lexicon');report.checks.push('One four-module overview plus four hidden gestures use the real management UI; actual word/card drags, held-mouse sorting and mastery slider succeed; practice provider never changes empty personal data')
 await page.getByRole('navigation').getByRole('button',{name:'设置与备份',exact:true}).click();const fixture=structuredClone(blank);fixture.words.personal={id:'personal',text:'personal',gloss:'合成个人词库',meanings:[],source:'manual',groupId:'personal',addedAt:1};fixture.groups.personal={id:'personal',wordIds:['personal'],manual:false,createdAt:1}
 await page.locator('input[type=file]').setInputFiles({name:'synthetic-motion.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(fixture))});await page.getByRole('alertdialog').getByRole('button',{name:'确认导入',exact:true}).click();await page.waitForTimeout(300);const populated=await state();await page.getByRole('button',{name:/^深色 /}).click();await page.setViewportSize({width:390,height:900});await page.emulateMedia({reducedMotion:'reduce'});await replay();await beginFrames();await gestureCourse({keyboard:true,capture:true});await endFrames('narrow');assert.deepEqual(await state(),populated)
 report.checks.push('390px dark reduced-motion course keeps overview and targets usable; keyboard reorder/mastery work; populated personal library remains identical and temporary words vanish on exit')
 await page.setViewportSize({width:820,height:900});await replay();await guide().getByRole('button',{name:'试试隐藏技巧',exact:true}).click();await arrive('word');await guide().getByRole('button',{name:'跳过练习',exact:true}).click();await arrive('card');await guide().getByRole('button',{name:'跳过练习',exact:true}).click();await arrive('sort');await page.locator('[data-editor-row-id="guide-stout"] .management-grip').press('ArrowDown');await page.keyboard.press('Escape');await guide().waitFor({state:'detached'});await page.getByRole('dialog').waitFor({state:'detached'});assert.deepEqual(await state(),populated);await page.reload();assert.equal(await guide().count(),0)
 report.checks.push('Skipping gestures and Escape from a dirty temporary editor leave no confirmation window, no personal writes, no persisted practice data; dismissed guide stays dismissed')
 assert.deepEqual(report.errors,[]);report.passed=true
})().catch(async e=>{report.passed=false;report.failure=e.stack;console.error(e);if(page)await shot('motion-guide-failure').catch(()=>{});process.exitCode=1}).finally(async()=>{if(app){await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>{});await app.close().catch(()=>{})};await fs.writeFile(path.join(out,'guide-report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2))})
