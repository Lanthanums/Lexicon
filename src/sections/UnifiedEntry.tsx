import {useEffect,useRef,useState,type ReactNode,type Ref} from 'react'
import {toast} from 'sonner'
import {useLibrary,dayKey,type NewWordInput} from '@/store/library'
import {lookupWord} from '@/lib/dictionary'
import {planEntry,isTie,type EntryPlan} from '@/lib/entryPlan'
import {indexEntryWords,insertPlanned,parseEntries} from '@/lib/batchEntry'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Label} from '@/components/ui/label'
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle,DialogFooter} from '@/components/ui/dialog'

interface Item {id:string;text:string;input?:NewWordInput;manual:string;plan?:EntryPlan;shape?:string;near?:string;duplicate?:string;reviewShape?:boolean;reviewNear?:boolean; chooseShape?:boolean; chooseNear?:boolean}
interface Review {items:Item[];invalid:string[];repeated:number;startedAt:number;date:string;remaining:string[]}
const KEEP_BATCH = 100
const INVALID_CHOICE = '__lexicon_choose_again__'
const summarize = (entries: string[]) => entries.slice(0, 6).map(entry => entry.length > 48 ? entry.slice(0, 48) + '…' : entry).join('、') + (entries.length > 6 ? ` 等 ${entries.length} 项` : '')
const candidates=(plan?:EntryPlan)=>JSON.stringify([
  plan?.shape.map(o=>o.id),
  plan?.near.map(o=>[o.id,o.ids,o.moveFrom]),
])
let entryOwner:symbol|null=null

interface UnifiedEntryProps {
  onLocateWord: (id: string) => void
  compact?: boolean
  knownInput?: NewWordInput
  renderTrigger?: (add: () => void, busy: boolean) => ReactNode
  visible?: boolean
  inputRef?: Ref<HTMLInputElement>
  onResumeInput?: () => void
}

export default function UnifiedEntry({onLocateWord,compact=false,knownInput,renderTrigger,inputRef,onResumeInput,visible=true}:UnifiedEntryProps){
  const {getCurrentState,applyManagement}=useLibrary()
  const [owner]=useState(()=>Symbol('entry'))
  const active=useRef<AbortController|null>(null)
  const [value,setValue]=useState(''),[busy,setBusy]=useState(false),[progress,setProgress]=useState('')
  const [review,setReview]=useState<Review|null>(null)
  useEffect(()=>()=>{active.current?.abort();active.current=null;if(entryOwner===owner)entryOwner=null},[owner])
  useEffect(() => {
    if (visible || !active.current) return
    const timer = window.setTimeout(() => {
      active.current?.abort()
      active.current = null
      if (entryOwner === owner) entryOwner = null
      setBusy(false)
      setReview(null)
      setProgress('')
    }, 0)
    return () => window.clearTimeout(timer)
  }, [owner, visible])
  const alive=(controller:AbortController)=>active.current===controller && !controller.signal.aborted

  function cancel(notify=true){
    active.current?.abort();active.current=null;setBusy(false);setReview(null);setProgress('')
    if(entryOwner===owner)entryOwner=null
    onResumeInput?.()
    if(notify)toast.info('已取消入库',{description:'本次查询的单词尚未加入词库。',id:'entry-result',duration:5000,action:undefined})
  }

  async function prepare(batch:Review,controller:AbortController,confirmed=false){
    setBusy(true)
    const items: Item[] = []
    try{
      const baseline = getCurrentState(), draft = structuredClone(baseline)
      const words = indexEntryWords(draft)
      const { startedAt: addedAt, date } = batch
      let ask=false
      for(const [index,row] of batch.items.entries()){
        if (index > 0 && index % 8 === 0) await new Promise(resolve => window.setTimeout(resolve, 0))
        if(!alive(controller))return
        setProgress(`正在归组 ${index+1}/${batch.items.length}：${row.text}`)
        const item = {...row, duplicate: undefined as string | undefined}
        const existing = words.get(item.text)
        if(existing){item.duplicate=existing.id;items.push(item);continue}
        const input=item.input ?? (item.manual.trim()?{text:item.text,gloss:item.manual.trim(),meanings:[{pos:'',en:'',zh:item.manual.trim()}],source:'manual' as const}:undefined)
        if(!input){ask ||= !confirmed;items.push(item);continue}
        const plan=await planEntry(input,draft,controller.signal)
        if(!alive(controller))return
        const shape = item.shape ?? plan.shape[0]?.id ?? ''
        const automaticNear = plan.near.filter(option => !option.moveFrom)
        const near = item.near ?? automaticNear[0]?.id ?? ''
        const hasConflict = plan.near.some(option => option.moveFrom)
        const priorShape = item.plan?.shape.find(option => option.id === shape)
        const nextShape = plan.shape.find(option => option.id === shape)
        const changedShape = !!(shape && (!nextShape || (confirmed && priorShape &&
          JSON.stringify(priorShape.memberIds) !== JSON.stringify(nextShape.memberIds))))
        const changedNear = !!(near && !plan.near.some(o => o.id === near))
        const priorNear = item.plan?.near.find(o => o.id === near)
        const nextNear = plan.near.find(o => o.id === near)
        const changedNearMembers = !!(confirmed && priorNear && nextNear &&
          JSON.stringify([priorNear.ids, priorNear.moveFrom]) !== JSON.stringify([nextNear.ids, nextNear.moveFrom]))
        item.reviewShape = isTie(plan.shape) || changedShape
        item.reviewNear = isTie(automaticNear) || hasConflict || changedNear || changedNearMembers
        if (((item.reviewShape || item.reviewNear) && (!confirmed || candidates(plan)!==candidates(item.plan))) ||
            changedShape || changedNear || changedNearMembers) ask = true
        Object.assign(item,{
          input, plan,
          shape: changedShape ? INVALID_CHOICE : shape,
          near: changedNear || changedNearMembers ? INVALID_CHOICE : near,
          chooseShape: changedShape, chooseNear: changedNear || changedNearMembers,
        })
        insertPlanned(draft,input,plan,changedShape ? '' : shape,changedNear || changedNearMembers ? '' : near,item.id,addedAt+index,date,words)
        items.push(item)
      }
      if(!alive(controller))return
      const next={...batch,items}
      if(ask){setReview(next);setProgress('');return}
      const live = getCurrentState()
      if (live.words !== baseline.words || live.groups !== baseline.groups ||
          live.synonymSets !== baseline.synonymSets || live.settings !== baseline.settings) {
        setReview(next);setProgress('词库已更新，请确认后继续。');return
      }
      const saved:Array<{id:string;duplicate:boolean;shape:boolean;near:boolean}>=[]
      if (items.some(item => item.input && !item.duplicate)) applyManagement(live=>{
        const liveWords = indexEntryWords(live)
        for(const [index,item] of items.entries()){
          if(item.duplicate){saved.push({id:item.duplicate,duplicate:true,shape:false,near:false});continue}
          if(item.input && item.plan)saved.push(insertPlanned(live,item.input,item.plan,item.shape??'',item.near??'',item.id,addedAt+index,date,liveWords))
        }
      })
      else for (const item of items) {
        if (item.duplicate) saved.push({id:item.duplicate,duplicate:true,shape:false,near:false})
      }
      const added=saved.filter(r=>!r.duplicate), missing=items.filter(r=>!r.input&&!r.duplicate).map(r=>r.text)
      const isolated=added.filter(r=>!r.shape&&!r.near).length
      const details=[batch.remaining.length ? `还有 ${batch.remaining.length} 词留在录入框，可继续查询` : '',missing.length?`未查到释义（未入库）：${summarize(missing)}`:'',batch.invalid.length?`未识别：${summarize(batch.invalid)}`:'',isolated?`${isolated} 词暂未归组，已独立保存`:'',added.some(r=>r.shape||r.near)?`形近归组 ${added.filter(r=>r.shape).length} 词，近义归组 ${added.filter(r=>r.near).length} 词`:'',saved.filter(r=>r.duplicate).length+batch.repeated?`已跳过 ${saved.filter(r=>r.duplicate).length+batch.repeated} 个重复词`:'',items.some(r=>r.plan?.nearStatus.includes('未完成'))?'部分近义关系暂未查到，可稍后调整':''].filter(Boolean)
      const target=added[0]?.id??saved[0]?.id
      toast[added.length?'success':'info'](added.length?`已入库 ${added.length} 个单词`:'没有新增单词',{id:'entry-result',description:details.join('；')||'这些单词已在词库中。',duration:12000,action:target?{label:'查看',onClick:()=>onLocateWord(target)}:undefined})
      setValue([...batch.remaining,...missing,...batch.invalid].join(';'));setReview(null);setProgress('');active.current=null
      onResumeInput?.()
      if(entryOwner===owner)entryOwner=null
    }catch(error){
      if(alive(controller)){setReview({...batch,items:[...items,...batch.items.slice(items.length)]});setProgress('');toast.error('入库未完成',{id:'entry-result',duration:5000,action:undefined,description:error instanceof Error?error.message:'请重试。'})}
    }finally{if(alive(controller)||active.current===null)setBusy(false)}
  }

  async function submit(input?:NewWordInput){
    if(active.current)return
    if(entryOwner&&entryOwner!==owner){toast.info('请先完成正在进行的入库',{id:'entry-result',duration:5000,action:undefined});return}
    const parsed = parseEntries(input?.text ?? value)
    if (input && (parsed.words.length !== 1 || parsed.invalid.length || parsed.repeated.length)) {
      toast.error('无法识别这个单词', { id: 'entry-result' })
      return
    }
    if(!parsed.words.length){toast.info('请输入英文单词',{id:'entry-result',duration:5000,action:undefined,description:'多个单词之间用分号或换行分隔，每批最多查询 100 个。'});return}
    const controller=new AbortController();active.current=controller;setBusy(true)
    entryOwner=owner
    const batch:Review={items:[],invalid:parsed.invalid,repeated:parsed.repeated.length,startedAt:Date.now(),date:dayKey(),remaining:parsed.words.slice(KEEP_BATCH)}
    const baseline = getCurrentState()
    const words = indexEntryWords(baseline)
    try{
      for(const [index,text] of parsed.words.slice(0, KEEP_BATCH).entries()){
        if (index > 0 && index % 8 === 0) await new Promise(resolve => window.setTimeout(resolve, 0))
        if(!alive(controller))return
        const item:Item={id:crypto.randomUUID(),text,manual:''}
        const existing=words.get(text)
        if(existing)item.duplicate=existing.id
        else if(input)item.input={...input,text}
        else{
          setProgress(`正在查询 ${index+1}/${Math.min(KEEP_BATCH, parsed.words.length)}：${text}`)
          try{
            const result=await lookupWord(text,controller.signal,baseline.settings.dictProviders)
            if(result.gloss.trim() && result.gloss.trim().toLowerCase()!==text)item.input={...result,text,source:'api'}
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
        <Input ref={inputRef} aria-label="录入英文单词" placeholder="输入单词以添加" value={value} readOnly={busy||!!review} onChange={e=>setValue(e.target.value)} onPaste={event => {
          if (busy || review) return
          const clipboard = event.clipboardData.getData('text')
          if (!/[\r\n]/.test(clipboard)) return
          event.preventDefault()
          const field = event.currentTarget
          const start = field.selectionStart ?? value.length
          const end = field.selectionEnd ?? start
          const pasted = clipboard.replace(/[\r\n]+/g, ';')
          setValue(value.slice(0, start) + pasted + value.slice(end))
          requestAnimationFrame(() => field.setSelectionRange(start + pasted.length, start + pasted.length))
        }} className="h-11 min-w-0 font-word text-base"/>
        <Button type="button" className="h-11 shrink-0" disabled={!busy&&(!value.trim()||!!review)} onClick={e=>{e.preventDefault();if(busy)cancel();else void submit()}}>{busy?'取消查询':'查询并加入'}</Button>
      </form>
      <p className="mt-3 text-xs leading-5 text-muted-foreground">用分号或换行分隔，每批查询最多 100 个单词。</p>
      {busy&&<p role="status" className="entry-progress mt-2 text-xs text-primary">{progress}</p>}
    </>}
    <Dialog open={!!review} onOpenChange={open=>{if(!open)cancel()}}><DialogContent className="max-h-[85svh] overflow-y-auto sm:max-w-2xl" onCloseAutoFocus={onResumeInput ? event => { event.preventDefault(); onResumeInput() } : undefined} onInteractOutside={e=>{if(busy)e.preventDefault()}}><DialogHeader><DialogTitle>确认本次入库</DialogTitle><DialogDescription>补充未查到的释义，或确认归组位置。释义留空的单词暂不入库。</DialogDescription></DialogHeader>
      {review?.invalid.length?<p className="text-sm text-destructive">未识别：{summarize(review.invalid)}</p>:null}
      <div className="space-y-3">{review?.items.filter(item=>!item.duplicate&&(!item.input||item.reviewShape||item.reviewNear)).map(item=><div key={item.id} className="rounded-xl border p-4 space-y-3">
        <p className="font-word text-xl">{item.text}</p>
        {!item.input&&<div><Label htmlFor={'gloss-'+item.id}>中文释义</Label><Input id={'gloss-'+item.id} className="mt-1" placeholder="未查到释义，可手动补充或留空跳过" value={item.manual} disabled={busy} onChange={e=>change(item.id,{manual:e.target.value})}/></div>}
        {item.plan&&item.reviewShape&&<div><Label htmlFor={'shape-'+item.id}>形近关系</Label><select id={'shape-'+item.id} className="settings-select mt-1 w-full" value={item.shape} disabled={busy} onChange={e=>change(item.id,{shape:e.target.value,chooseShape:false})}>{item.chooseShape&&<option value={INVALID_CHOICE} disabled>候选已变化，请重新选择</option>}<option value="">不加入形近组</option>{item.plan.shape.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select></div>}
        {item.plan&&item.reviewNear&&<div><Label htmlFor={'near-'+item.id}>近义关系</Label><select id={'near-'+item.id} className="settings-select mt-1 w-full" value={item.near} disabled={busy} onChange={e=>change(item.id,{near:e.target.value,chooseNear:false})}>{item.chooseNear&&<option value={INVALID_CHOICE} disabled>候选已变化，请重新选择</option>}<option value="">不加入近义组</option>{item.plan.near.map(o=><option key={o.id} value={o.id}>{o.label}</option>)}</select>{item.plan.near.some(option=>option.moveFrom)&&
          <p className="mt-2 text-xs text-muted-foreground">匹配到的词已有近义组。选择新建关系后才会移出原组。原组若不足两个词，会归档其成员和笔记。</p>}</div>}
      </div>)}</div>
      {progress&&<p role="status" className="text-xs text-primary">{progress}</p>}
      <DialogFooter><Button variant="outline" onClick={()=>cancel()}>取消入库</Button><Button disabled={busy || review?.items.some(item => !item.duplicate && (item.chooseShape || item.chooseNear))} onClick={()=>{if(review&&active.current)void prepare(review,active.current,true)}}>{busy?'正在归组…':'确认并入库'}</Button></DialogFooter>
    </DialogContent></Dialog>
  </div>
}
