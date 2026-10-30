import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Crosshair, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useReducedMotion } from '@/lib/motion'
import { GUIDE_STEPS, type GuidePage, type GuideTask } from '@/lib/tutorial'

type Box = { left:number; top:number; width:number; height:number }
type Layout = { index:number; boxes:Box[]; surface:string }
const visible = (el:HTMLElement) => el.getClientRects().length > 0 && !el.closest('[hidden]')
const sourceWord = '[data-drag-word="guide-scout"]'
const sourceCard = '[data-card-id="guide-shape"]'
const destination = '[data-card-id="guide-letters"]'
const grip = '[data-editor-row-id="guide-stout"] .management-grip'
const secondRow = '[data-editor-row-id="guide-spout"]'
const dots = '[data-editor-row-id="guide-stout"] .management-mastery-trigger'
const slider = '.management-mastery-popover [role="slider"]'
const MODULES = [
  ['今日学习','每日一词、日历和学习足迹，帮你回看积累并安排今天的复习。'],
  ['录入与管理词汇','查义后统一入库，用形近、近义、自定义关系整理单词，也能保留独立词。'],
  ['综合抽查','选择、拼写、渐进练习和近义词回忆；优先安排到期词，并支持错题巩固。'],
  ['设置与备份','调整外观、匹配与词典服务；导出、导入和恢复本地词库。'],
]
const rect = (el:HTMLElement):Box => { const r=el.getBoundingClientRect();const left=Math.max(4,Math.floor(r.left-6)),top=Math.max(4,Math.floor(r.top-6));return {left,top,width:Math.max(0,Math.min(innerWidth-4,Math.ceil(r.right+6))-left),height:Math.max(0,Math.min(innerHeight-4,Math.ceil(r.bottom+6))-top)} }
const overlap = (a:Box,b:Box) => a.left < b.left+b.width+10 && a.left+a.width+10 > b.left && a.top < b.top+b.height+10 && a.top+a.height+10 > b.top

function Walkthrough({onFinish,navigate,onStepChange}:{onFinish:(completed:boolean)=>void;navigate:(page:GuidePage)=>void;onStepChange:(step:GuideTask)=>void}) {
  const [index,setIndex]=useState(0),[phase,setPhase]=useState<'locating'|'ready'|'leaving'>('locating')
  const [layout,setLayout]=useState<Layout|null>(null),[placed,setPlaced]=useState(-1)
  const [position,setPosition]=useState({left:12,top:12}),[completed,setCompleted]=useState(false),[missing,setMissing]=useState(false),[retry,setRetry]=useState(0)
  const panel=useRef<HTMLDivElement>(null),active=useRef<HTMLElement[]>([]),nextTimer=useRef<ReturnType<typeof setTimeout>|null>(null)
  const callbacks=useRef({onFinish,navigate,onStepChange})
  const reduced=useReducedMotion(),step=GUIDE_STEPS[index],bookend=step.id==='overview'||step.id==='finish'
  useEffect(()=>{callbacks.current={onFinish,navigate,onStepChange}},[onFinish,navigate,onStepChange])
  useEffect(()=>()=>{if(nextTimer.current)clearTimeout(nextTimer.current)},[])

  function next(){
    if(phase!=='ready')return
    if(step.id==='finish'){onFinish(true);return}
    setPhase('leaving')
    nextTimer.current=setTimeout(()=>{setCompleted(false);setMissing(false);setPlaced(-1);setPhase('locating');setIndex(value=>value+1)},reduced?0:120)
  }

  useEffect(()=>{
    callbacks.current.onStepChange(step.id)
    callbacks.current.navigate(bookend?'today':'manage')
    let frame=0,cancelled=false,stable=0,previous='',scrolled=false,done=false,located=false
    const started=performance.now()
    const query=(selector:string)=>Array.from(document.querySelectorAll<HTMLElement>(selector)).find(visible)
    function elements(){
      if(step.id==='word'){
        const dest=query(destination)
        if(dest?.querySelector(sourceWord)){done=true;return dest?[dest]:[]}
        return [query(sourceWord),dest].filter((el):el is HTMLElement=>!!el)
      }
      if(step.id==='card'){
        const merged=Array.from(document.querySelectorAll<HTMLElement>('[data-card-kind="custom"]')).find(el=>el.querySelector('[data-drag-word="guide-adapt"]')&&el.querySelector('[data-drag-word="guide-accept"]'))
        if(merged){done=true;return [merged]}
        return [query(sourceCard),query('[data-card-id="guide-near"]')].filter((el):el is HTMLElement=>!!el)
      }
      if(step.id==='sort'){
        const rows=Array.from(document.querySelectorAll<HTMLElement>('[data-editor-row-id]'))
        if(rows.length&&rows[0].dataset.editorRowId!=='guide-stout')done=true
        return [query(grip),query(secondRow)].filter((el):el is HTMLElement=>!!el)
      }
      if(step.id==='mastery'){
        const control=query(slider)
        if(control){if(control.getAttribute('aria-valuenow')!=='2')done=true;return [control.closest<HTMLElement>('[data-slot="slider"]')??control]}
        return [query(dots)].filter((el):el is HTMLElement=>!!el)
      }
      return []
    }
    function moving(el:HTMLElement){
      for(let node:HTMLElement|null=el;node;node=node.parentElement){
        if(node.getAnimations().some(a=>a.playState==='running'&&Number(a.effect?.getTiming().iterations)<Infinity))return true
      }
      return false
    }
    function tick(){
      if(cancelled)return
      const found=elements(),required=bookend?0:done||step.id==='mastery'?1:2
      if(found.length>=required){
        if(!scrolled&&found.length){
          found[0].scrollIntoView({block:'center',inline:'nearest',behavior:'instant'})
          scrolled=true
        }
        const boxes=found.map(rect),surface=[innerWidth,innerHeight,panel.current?.offsetWidth,panel.current?.offsetHeight].join(':'),stamp=JSON.stringify([boxes,surface])
        const settling=found.some(moving)
        if(stamp===previous&&!settling)stable++;else stable=0
        previous=stamp
        if(located||stable>=2){
          located=true
          active.current=found
          setLayout(old=>old?.index===index&&old.surface===surface&&JSON.stringify(old.boxes)===JSON.stringify(boxes)?old:{index,boxes,surface})
          if(done)setCompleted(true)
        }
      }else if(performance.now()-started>4500){
        setMissing(true);setLayout(old=>old?.index===index?old:{index,boxes:[],surface:''})
      }
      // Track actual transforms and scrolling every frame, not a delayed poll.
      frame=requestAnimationFrame(tick)
    }
    frame=requestAnimationFrame(tick)
    return()=>{cancelled=true;cancelAnimationFrame(frame);active.current=[]}
  },[index,retry,step,bookend])

  // Measurement and the reveal are committed before paint. Locating never
  // renders a centered fallback, even if a portal is still animating.
  useLayoutEffect(()=>{
    if(!layout||layout.index!==index||!panel.current)return
    const pw=panel.current.offsetWidth,ph=panel.current.offsetHeight,w=innerWidth,h=innerHeight
    const clamp=(x:number,y:number)=>({left:Math.max(12,Math.min(x,w-pw-12)),top:Math.max(12,Math.min(y,h-ph-12))})
    const boxes=layout.boxes
    let chosen=clamp((w-pw)/2,(h-ph)/2)
    if(boxes.length){
      const left=Math.min(...boxes.map(b=>b.left)),right=Math.max(...boxes.map(b=>b.left+b.width)),top=Math.min(...boxes.map(b=>b.top)),bottom=Math.max(...boxes.map(b=>b.top+b.height))
      const options=[clamp(right+18,top),clamp(left-pw-18,top),clamp(left,bottom+18),clamp(left,top-ph-18),clamp(w-pw-12,h-ph-12),clamp(12,12)]
      chosen=options.find(p=>boxes.every(b=>!overlap({...p,width:pw,height:ph},b)))??options[4]
    }
    setPosition(chosen)
    setPlaced(index)
    setPhase(value=>value==='locating'?'ready':value)
  },[layout,index])

  useEffect(()=>{
    if(phase==='ready')panel.current?.focus({preventScroll:true})
  },[phase,index])

  useEffect(()=>{
    const allowed=(node:EventTarget|null)=>node instanceof Node&&(panel.current?.contains(node)||active.current.some(el=>el.contains(node))||step.id==='mastery'&&!!(node instanceof Element&&node.closest('.management-mastery-popover')))
    const block=(event:Event)=>{
      if(!allowed(event.target)){event.preventDefault();event.stopImmediatePropagation();return}
      if(!panel.current?.contains(event.target as Node)&&event.type==='click'&&step.id!=='mastery'){
        // Card pencils and ordinary buttons are outside this gesture lesson.
        if((event.target as Element).closest('button:not(.management-grip)')){event.preventDefault();event.stopImmediatePropagation()}
      }
    }
    const keyboard=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();callbacks.current.onFinish(false);return}
      if(event.key==='Tab'){
        const controls=[...active.current.flatMap(el=>el.matches('button,[role="slider"]')?[el]:Array.from(el.querySelectorAll<HTMLElement>('.management-grip,.management-mastery-trigger,[role="slider"]'))),...Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled)')??[])].filter(visible)
        if(!controls.length)return
        const at=controls.indexOf(document.activeElement as HTMLElement)
        event.preventDefault();event.stopImmediatePropagation();controls[(at+(event.shiftKey?-1:1)+controls.length)%controls.length].focus({preventScroll:true})
      }else if(!allowed(event.target)){event.preventDefault();event.stopImmediatePropagation()}
    }
    for(const name of ['pointerdown','click','dblclick','contextmenu','dragstart','dragover','drop'])document.addEventListener(name,block,true)
    document.addEventListener('keydown',keyboard,true)
    return()=>{
      for(const name of ['pointerdown','click','dblclick','contextmenu','dragstart','dragover','drop'])document.removeEventListener(name,block,true)
      document.removeEventListener('keydown',keyboard,true)
    }
  },[step])

  const hasLayout=layout?.index===index&&placed===index,boxes=hasLayout?(layout?.boxes??[]):[]
  return createPortal(<div className="guided-tour" data-guide-step={step.id} data-phase={phase} data-placed={hasLayout?'true':'false'}>
    <svg className="guide-mask" width="100%" height="100%" aria-hidden="true"><defs><mask id="lexicon-guide-mask"><rect width="100%" height="100%" fill="white"/>{boxes.map((b,i)=><rect key={i} {...{x:b.left,y:b.top,width:b.width,height:b.height}} rx="12" fill="black"/>)}</mask></defs><rect width="100%" height="100%" fill="rgb(12 18 17 / .64)" mask="url(#lexicon-guide-mask)"/></svg>
    {boxes.map((b,i)=><div key={i} data-guide-spotlight className="guide-spotlight" style={b} aria-hidden="true"/>)}
    <div ref={panel} role="dialog" aria-modal="false" aria-labelledby="guide-title" aria-describedby="guide-description" tabIndex={-1} className={`guide-panel rounded-2xl border bg-card text-card-foreground shadow-2xl ${bookend?'guide-overview':''}`} data-phase={hasLayout?phase:'locating'} style={{left:position.left,top:position.top}}>
      <div className="flex items-center justify-between gap-3"><p className="flex items-center gap-2 text-xs font-medium text-primary"><Crosshair size={15}/>{bookend?'认识 Lexicon':'不显眼的小技巧'}</p><button type="button" aria-label="退出教学" onClick={()=>onFinish(false)} className="rounded p-1 text-muted-foreground hover:bg-muted"><X size={17}/></button></div>
      <h2 id="guide-title" className="mt-3 text-xl font-semibold">{step.title}</h2>
      <p id="guide-description" className="mt-3 text-sm leading-6 text-muted-foreground">{step.text}</p>
      {step.id==='overview'&&<div className="guide-modules mt-5 grid gap-4 sm:grid-cols-2">{MODULES.map(([title,text])=><div key={title} className="rounded-xl border bg-background/70 p-4"><h3 className="text-sm font-medium">{title}</h3><p className="mt-2 text-xs leading-6 text-muted-foreground">{text}</p></div>)}</div>}
      {step.id==='finish'&&<p className="mt-4 rounded-xl bg-muted/60 p-4 text-xs leading-6 text-muted-foreground">还有两个提示：批量录入可用分号分隔；长释义可展开查看。移出、删除与解散各有不同后果，确认时请留意；定期导出 JSON 备份。</p>}
      {!bookend&&<p className="mt-4 flex items-center gap-2 text-xs text-primary">{completed?<><Check size={15}/>这个技巧已试过了</>:<>练习 {index} / 4 · 只操作临时示例</>}</p>}
      {missing&&<p role="status" className="mt-3 text-xs text-amber-700 dark:text-amber-300">目标暂未出现，可以重新定位或跳过练习。</p>}
      <div className="mt-5 flex items-center justify-between gap-2"><Button size="sm" variant="ghost" onClick={()=>onFinish(false)}>稍后再看</Button><div className="flex gap-2">{!bookend&&!completed&&<Button size="sm" variant="ghost" onClick={next}>跳过练习</Button>}{missing?<Button size="sm" onClick={()=>{setMissing(false);setPhase('locating');setRetry(v=>v+1)}}>重新定位</Button>:<Button size="sm" disabled={phase!=='ready'||!bookend&&!completed} onClick={next}>{step.id==='overview'?'试试隐藏技巧':step.id==='finish'?'开始使用':'下一个技巧'}</Button>}</div></div>
      <p className="mt-3 text-[10px] text-muted-foreground">Esc 退出 · 教学不改动个人词库</p>
    </div>
  </div>,document.body)
}
export default function GuidedTour({open,...props}:{open:boolean;onFinish:(completed:boolean)=>void;navigate:(page:GuidePage)=>void;onStepChange:(step:GuideTask)=>void}){return open?<Walkthrough {...props}/>:null}
