import {useEffect,useRef,useState,type ReactNode} from 'react'
import {toast} from 'sonner'
import {useLibrary,dayKey,type NewWordInput} from '@/store/library'
import {lookupWord} from '@/lib/dictionary'
import {planEntry,isTie,type EntryPlan} from '@/lib/entryPlan'
import {insertPlanned,parseEntries} from '@/lib/batchEntry'
import type {LibraryState} from '@/types'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle,DialogFooter} from '@/components/ui/dialog'

interface Item {id:string;text:string;input?:NewWordInput;manual:string;plan?:EntryPlan;shape?:string;near?:string;duplicate?:string;reviewShape?:boolean;reviewNear?:boolean}
interface Review {items:Item[];invalid:string[];repeated:number}
const fingerprint=(state:LibraryState)=>JSON.stringify([state.words,state.groups,state.synonymSets,state.settings])
const candidates=(plan?:EntryPlan)=>JSON.stringify([plan?.shape.map(o=>o.id),plan?.near.map(o=>o.id)])
let entryOwner:symbol|null=null

export default function UnifiedEntry({onLocateWord,compact=false,knownInput,renderTrigger}:{onLocateWord:(id:string)=>void;compact?:boolean;knownInput?:NewWordInput;renderTrigger?:(add:()=>void,busy:boolean)=>ReactNode}){
  const {state,applyManagement}=useLibrary()
  const [owner]=useState(()=>Symbol('entry'))
  const latest=useRef(state), active=useRef<AbortController|null>(null)
  const [value,setValue]=useState(''),[busy,setBusy]=useState(false),[progress,setProgress]=useState('')
  const [review,setReview]=useState<Review|null>(null)
  useEffect(()=>{latest.current=state},[state])
  useEffect(()=>()=>{active.current?.abort();active.current=null;if(entryOwner===owner)entryOwner=null},[owner])
  const alive=(controller:AbortController)=>active.current===controller && !controller.signal.aborted

  function cancel(notify=true){
    active.current?.abort();active.current=null;setBusy(false);setReview(null);setProgress('')
    if(entryOwner===owner)entryOwner=null
    if(notify)toast.info('已取消入库',{description:'本次查询的单词尚未加入词库。',id:'entry-result',duration:5000,action:undefined})
  }

  async function prepare(batch:Review,controller:AbortController,confirmed=false){
    setBusy(true)
    try{
      const baseline=latest.current, stamp=fingerprint(baseline), draft=structuredClone(baseline), items:Item[]=[]
      let ask=false
      for(const [index,row] of batch.items.entries()){
        if(!alive(controller))return
        setProgress(`正在归组 ${index+1}/${batch.items.length}：${row.text}`)
        const item={...row}, existing=Object.values(draft.words).find(w=>w.text===item.text)
        if(existing){item.duplicate=existing.id;items.push(item);continue}
        const input=item.input ?? (item.manual.trim()?{text:item.text,gloss:item.manual.trim(),meanings:[{pos:'',en:'',zh:item.manual.trim()}],source:'manual' as const}:undefined)
        if(!input){ask ||= !confirmed;items.push(item);continue}
        const plan=await planEntry(input,draft,controller.signal)
        if(!alive(controller))return
        const shape=item.shape==='' || plan.shape.some(o=>o.id===item.shape) ? item.shape! : plan.shape[0]?.id??''
        const near=item.near==='' || plan.near.some(o=>o.id===item.near) ? item.near! : plan.near[0]?.id??''
        const changedShape=!!(confirmed&&item.shape&&!plan.shape.some(o=>o.id===item.shape))
        const changedNear=!!(confirmed&&item.near&&!plan.near.some(o=>o.id===item.near))
        if((isTie(plan.shape)||isTie(plan.near)) && (!confirmed || candidates(plan)!==candidates(item.plan)) || changedShape || changedNear)ask=true
        item.reviewShape=isTie(plan.shape)||changedShape;item.reviewNear=isTie(plan.near)||changedNear
        Object.assign(item,{input,plan,shape,near})
        insertPlanned(draft,input,plan,shape,near,item.id,Date.now()+index,dayKey())
        items.push(item)
      }
      if(!alive(controller))return
      const next={...batch,items}
      if(ask){setReview(next);setProgress('');return}
      if(fingerprint(latest.current)!==stamp){setReview(next);setProgress('词库已更新，请确认后继续。');return}
      const saved:Array<{id:string;duplicate:boolean;shape:boolean;near:boolean}>=[]
      applyManagement(live=>{
        for(const item of items){
          if(item.duplicate){saved.push({id:item.duplicate,duplicate:true,shape:false,near:false});continue}
          if(item.input && item.plan)saved.push(insertPlanned(live,item.input,item.plan,item.shape??'',item.near??'',item.id,Date.now(),dayKey()))
        }
      })
      const added=saved.filter(r=>!r.duplicate), missing=items.filter(r=>!r.input&&!r.duplicate).map(r=>r.text)
      const isolated=added.filter(r=>!r.shape&&!r.near).length
      const details=[missing.length?`未查到释义（未入库）：${missing.join('、')}`:'',batch.invalid.length?`未识别：${batch.invalid.join('、')}`:'',isolated?`${isolated} 词暂未归组，已独立保存`:'',added.some(r=>r.shape||r.near)?`形近归组 ${added.filter(r=>r.shape).length} 词，近义归组 ${added.filter(r=>r.near).length} 词`:'',saved.filter(r=>r.duplicate).length+batch.repeated?`已跳过 ${saved.filter(r=>r.duplicate).length+batch.repeated} 个重复词`:'',items.some(r=>r.plan?.nearStatus.includes('未完成'))?'部分近义关系暂未查到，可稍后调整':''].filter(Boolean)
      const target=added[0]?.id??saved[0]?.id
      toast[added.length?'success':'info'](added.length?`已入库 ${added.length} 个单词`:'没有新增单词',{id:'entry-result',description:details.join('；')||'这些单词已在词库中。',duration:12000,action:target?{label:'查看',onClick:()=>onLocateWord(target)}:undefined})
      setValue([...missing,...batch.invalid].join(';'));setReview(null);setProgress('');active.current=null
      if(entryOwner===owner)entryOwner=null
    }catch(error){
      if(alive(controller)){setReview(batch);setProgress('');toast.error('入库未完成',{id:'entry-result',duration:5000,action:undefined,description:error instanceof Error?error.message:'请重试。'})}
    }finally{if(alive(controller)||active.current===null)setBusy(false)}
  }

  async function submit(input?:NewWordInput){
    if(active.current)return
    if(entryOwner&&entryOwner!==owner){toast.info('请先完成正在进行的入库',{id:'entry-result',duration:5000,action:undefined});return}
    const parsed=input?{words:[input.text],invalid:[],repeated:[]}:parseEntries(value)
    if(!parsed.words.length){toast.info('请输入英文单词',{id:'entry-result',duration:5000,action:undefined,description:'多个单词之间用 ; 分隔。'});return}
    const controller=new AbortController();active.current=controller;setBusy(true)
    entryOwner=owner
    const batch:Review={items:[],invalid:parsed.invalid,repeated:parsed.repeated.length}
    try{
      for(const [index,text] of parsed.words.entries()){
        if(!alive(controller))return
        const item:Item={id:crypto.randomUUID(),text,manual:''}
        const existing=Object.values(latest.current.words).find(w=>w.text===text)
        if(existing)item.duplicate=existing.id
        else if(input)item.input=input
        else{
          setProgress(`正在查询 ${index+1}/${parsed.words.length}：${text}`)
          try{
            const result=await lookupWord(text,controller.signal,latest.current.settings.dictProviders)
            if(result.gloss.trim() && result.gloss.trim().toLowerCase()!==text)item.input={...result,source:'api'}
          }catch{if(!alive(controller))return}
        }
        batch.items.push(item)
      }
      if(alive(controller))await prepare(batch,controller)
    }finally{if(active.current===controller)setBusy(false)}
  }
  function change(id:string,patch:Partial<Item>){setReview(prev=>prev?{...prev,items:prev.items.map(item=>item.id===id?{...item,...patch}:item)}:prev)}

  return <div data-tutor="entry" className={renderTrigger?'contents':`${compact?'rounded-xl':'rounded-2xl'} border bg-card p-5 shadow-sm entry-panel`}>
    {renderTrigger?renderTrigger(()=>void submit(knownInput),busy):<>
      {compact&&<h2 className="mb-3 text-sm font-medium text-muted-foreground">录入新词</h2>}
      <form className="flex gap-2" onSubmit={e=>{e.preventDefault();if(!busy)void submit()}}>
        <Input aria-label="录入英文单词" placeholder="输入单词以添加" value={value} disabled={busy||!!review} onChange={e=>setValue(e.target.value)} className="h-11 min-w-0 font-word text-base"/>
        <Button type="button" className="h-11 shrink-0" disabled={!busy&&(!value.trim()||!!review)} onClick={e=>{e.preventDefault();if(busy)cancel();else void submit()}}>{busy?'取消查询':'查询并加入'}</Button>
      </form>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">支持多个单词同时入库，使用";"分隔，例如：effluent;affluent;effulgent</p>
      {busy&&<p role="status" className="entry-progress mt-2 text-xs text-primary">{progress}</p>}
    </>}
    <Dialog open={!!review} onOpenChange={open=>{if(!open)cancel()}}><DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl" onInteractOutside={e=>{if(busy)e.preventDefault()}}><DialogHeader><DialogTitle>确认本次入库</DialogTitle><DialogDescription>补充未查到的释义，或确认归组位置。释义留空的单词暂不入库。</DialogDescription></DialogHeader>
      {review?.invalid.length?<p className="text-sm text-destructive">未识别：{review.invalid.join('、')}</p>:null}
      <div className="space-y-3">{review?.items.filter(item=>!item.duplicate&&(!item.input||item.reviewShape||item.reviewNear)).map(item=><div key={item.id} className="rounded-xl border p-4 space-y-3">
        <p className="font-word text-xl">{item.text}</p>
        {!item.input&&<div><Label htmlFor={'gloss-'+item.id}>中文释义</Label><Input id={'gloss-'+item.id} className="mt-1" placeholder="未查到释义，可手动补充或留空跳过" value={item.manual} disabled={busy} onChange={e=>change(item.id,{manual:e.target.value})}/></div>}
        {item.plan&&item.reviewShape&&<div><Label htmlFor={'shape-'+item.id}>形近关系</Label><select id={'shape-'+item.id} className="settings-select mt-1 w-full" value={item.shape} disabled={busy} onChange={e=>change(item.id,{shape:e.target.value})}><option value="">不加入形近组</option>{item.plan.shape.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></div>}
        {item.plan&&item.reviewNear&&<div><Label htmlFor={'near-'+item.id}>近义关系</Label><select id={'near-'+item.id} className="settings-select mt-1 w-full" value={item.near} disabled={busy} onChange={e=>change(item.id,{near:e.target.value})}><option value="">不加入近义组</option>{item.plan.near.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></div>}
      </div>)}</div>
      {progress&&<p role="status" className="text-xs text-primary">{progress}</p>}
      <DialogFooter><Button variant="outline" onClick={()=>cancel()}>取消入库</Button><Button disabled={busy} onClick={()=>{if(review&&active.current)void prepare(review,active.current,true)}}>{busy?'正在归组…':'确认并入库'}</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>
}
