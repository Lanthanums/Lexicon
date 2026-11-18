import {useCallback,useEffect,useMemo,useRef,useState,type DragEvent,type KeyboardEvent as ReactKeyboardEvent} from 'react'
import type React from 'react'
import {createPortal,flushSync} from 'react-dom'
import {LayoutGrid,List,Pencil,Plus,RotateCw,Search,LibraryBig,Unlink} from 'lucide-react'
import {toast} from 'sonner'
import {useLibrary} from '@/store/library'
import type {GuideTask} from '@/lib/tutorial'
import type {DragItem,GroupKind,GroupRef,LibraryState,Word} from '@/types'
import {deriveManagementView,filterManagementCards,managementWords,searchManagement,sortManagementCards,type ManagementCard,type ManagementFilters,type ManagementSort,type RelationFilter} from '@/lib/managementView'
import {DROP_KINDS,DROP_LABELS,dropKindAt,mergeGroups,planDrop,recommendDropKinds,removeGroupMember,type DropPlan} from '@/lib/grouping'
import {needsDefinitionRetry,retryDefinition} from '@/lib/dictionary'
import {groupTitle} from '@/lib/groupNames'
import UnifiedEntry from '@/sections/UnifiedEntry'
import ManagementEditor,{type ManagementEditorTarget} from '@/sections/ManagementEditor'
import MasteryControl from '@/sections/MasteryControl'
import CollapsibleGloss from '@/sections/CollapsibleGloss'
import MasonryCards from '@/sections/MasonryCards'
import DropZoneOverlay from '@/sections/DropZoneOverlay'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Checkbox} from '@/components/ui/checkbox'
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog'
import {DropdownMenu,DropdownMenuContent,DropdownMenuItem,DropdownMenuTrigger} from '@/components/ui/dropdown-menu'
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select'

const labels:Record<RelationFilter,string>={shape:'形近组',synonym:'近义组',custom:'自定义组',isolated:'独立单词'}
const colors:Record<RelationFilter,string>={shape:'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',synonym:'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',custom:'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-200',isolated:'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'}
const allFilters:ManagementFilters={shape:true,synonym:true,custom:true,isolated:true}
const PAGE_SIZE = 240
const MIME='application/x-lexicon-group'
const key=(ref:GroupRef)=>ref.kind+':'+ref.id
const dropSurface = '[data-card-id], [data-list-drop-target]'
const EDGE_SCROLL_BAND = 96
const MAX_EDGE_SCROLL_SPEED = 300
interface DropHover {
 target: GroupRef
 kind: GroupKind | null
 plans: Record<GroupKind, DropPlan>
 recommended: GroupKind[]
 snapshot: LibraryState
}
let editHintShown = false
function Tag({kind}:{kind:RelationFilter}){return <span className={'inline-flex shrink-0 rounded-md px-2 py-1 text-[11px] font-medium '+colors[kind]}>{labels[kind]}</span>}
function Highlight({text,query}:{text:string;query:string}){
 const needle = query.trim().toLocaleLowerCase()
 if (!needle) return <>{text}</>
 const lower = text.toLocaleLowerCase(), parts: React.ReactNode[] = []
 let from = 0
 for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) {
  parts.push(text.slice(from, at), <mark key={at} className="rounded bg-amber-200 px-0.5 text-inherit dark:bg-amber-800">{text.slice(at, at + needle.length)}</mark>)
  from = at + needle.length
 }
 return parts.length ? <>{parts}{text.slice(from)}</> : <>{text}</>
}
/** The tag already names the relation, so the card heading drops the repeated prefix. */
const cardLabel = (name: string) => name.replace(/^(?:形近组|近义组|自定义组)\s*·\s*/, '')
function PageControls({page,count,onChange}:{page:number;count:number;onChange:(page:number)=>void}) {
 const pages = Math.ceil(count / PAGE_SIZE)
 return <div className="flex items-center justify-center gap-3 py-2" aria-label="分页">
  <Button variant="outline" size="sm" disabled={page === 0} onClick={() => onChange(page - 1)}>上一页</Button>
  <span className="text-sm tabular-nums text-muted-foreground">{page + 1} / {pages}</span>
  <Button variant="outline" size="sm" disabled={page + 1 >= pages} onClick={() => onChange(page + 1)}>下一页</Button>
 </div>
}
function excerpt(text:string,query:string){const at=text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());return at>80?'…'+text.slice(at-35,at+110):text.slice(0,145)+(text.length>145?'…':'')}

export default function Management({guideTask,active=true,locateRequest}:{guideTask?:GuideTask;active?:boolean;locateRequest?:{id:string}|null}){
 const {state,getCurrentState,managementTransaction}=useLibrary()
 const surfaceRef=useRef<HTMLDivElement>(null)
 const toolbarRef=useRef<HTMLDivElement>(null)
 const stickySentinel=useRef<HTMLDivElement>(null)
 const [stuck,setStuck]=useState(false)
 useEffect(()=>{
  const sentinel=stickySentinel.current
  if(!sentinel)return
  // Once the toolbar pins to the top, it condenses so the cards keep most of the window.
  const observer=new IntersectionObserver(([entry])=>setStuck(!entry.isIntersecting&&entry.boundingClientRect.top<0))
  observer.observe(sentinel)
  return()=>observer.disconnect()
 },[])
 const stickyFrame=useRef<HTMLDivElement>(null)
 useEffect(()=>{
  const frame=stickyFrame.current,controls=toolbarRef.current
  if(!frame||!controls||stuck)return
  // The pinned frame keeps its resting height while the controls inside condense, so the
  // document never changes height at the pinning point. A changing height there made scroll
  // anchoring push smooth wheel scrolling back up.
  const measure=()=>{const height=controls.getBoundingClientRect().height;if(height)frame.style.minHeight=height+'px'}
  measure()
  const observer=new ResizeObserver(measure)
  observer.observe(controls)
  return()=>observer.disconnect()
 },[stuck])
 const entryInput=useRef<HTMLInputElement>(null)
 const resumeInput=useCallback(()=>{
  requestAnimationFrame(()=>{
   const input=entryInput.current
   if(!input?.getClientRects().length || document.activeElement===input) return
   if(document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [data-slot="select-content"][data-state="open"], [role="menu"][data-state="open"]')) return
   input.focus({preventScroll:true})
  })
 },[])
 const restoreFocus=(event:Event)=>{event.preventDefault();resumeInput()}
 useEffect(()=>{if(active)resumeInput()},[active,resumeInput])

 const retryRequests=useRef(new Map<string,AbortController>())
 const [retrying,setRetrying]=useState<string[]>([])
 useEffect(()=>{
  const requests=retryRequests.current
  return ()=>{for(const controller of requests.values())controller.abort();requests.clear()}
 },[])
 const [filters,setFilters]=useState<ManagementFilters>(allFilters)
 const [view,setView]=useState<'cards'|'list'>('cards')
 const [pageIndex, setPageIndex] = useState(0)
 const [resultPage, setResultPage] = useState(0)
 const [sort,setSort]=useState<ManagementSort>('newest')
 const [editor,setEditor]=useState<ManagementEditorTarget|null>(null)
 useEffect(()=>{
  if(!guideTask)return
  const frame=requestAnimationFrame(()=>setEditor(guideTask==='sort'||guideTask==='mastery'?{kind:'shape',id:'guide-letters'}:null))
  return()=>cancelAnimationFrame(frame)
 },[guideTask])
 const [focusWord,setFocusWord]=useState<string|undefined>()
 const [searchOpen,setSearchOpen]=useState(false),[query,setQuery]=useState('')
 // Results stay rendered until the close animation ends, so the dialog never flashes "no match".
 const [searchClosing,setSearchClosing]=useState(false)
 const closeSearch=useCallback(()=>{setSearchClosing(true);setSearchOpen(false)},[])
 const [locate,setLocate]=useState<string|null>(null)
 const [drag,setDrag]=useState<DragItem|null>(null)
 const [hover,setHover]=useState<DropHover|null>(null)
 const [editHint,setEditHint]=useState<string|null>(null)
 const dragRef=useRef<DragItem|null>(null)
 const hoverRef=useRef<DropHover|null>(null)
 const detachHint=useRef<HTMLDivElement>(null)
 const searchInput=useRef<HTMLInputElement>(null)
 const searchList=useRef<HTMLDivElement>(null)
 const updateHover=useCallback((next:DropHover|null)=>{
  if(hoverRef.current===next)return
  hoverRef.current=next
  setHover(next)
 },[])
 const endDrag=useCallback(()=>{
  dragRef.current=null
  updateHover(null)
  if(detachHint.current)detachHint.current.hidden=true
  setDrag(null)
 },[updateHover])
 const selectDropZone=useCallback((source:DragItem,target:GroupRef,surface:HTMLElement,clientX:number)=>{
  if(key(source.ref)===key(target)){
   if(hoverRef.current)flushSync(()=>updateHover(null))
   return 'move'
  }
  const bounds=surface.getBoundingClientRect()
  if(!bounds.width)return 'none'
  let current=hoverRef.current
  if(!current||key(current.target)!==key(target)){
   const snapshot=getCurrentState()
   const plans=Object.fromEntries(DROP_KINDS.map(kind=>[kind,planDrop(snapshot,source,target,kind)])) as Record<GroupKind,DropPlan>
   current={target,kind:null,plans,recommended:recommendDropKinds(snapshot,source,target,plans),snapshot}
  }
  const kind=dropKindAt((clientX-bounds.left)/bounds.width,current.kind)
  const plan=current.plans[kind]
  if(kind!==current.kind){
   const next={...current,kind}
   flushSync(()=>updateHover(next))
  }
  if(!plan.allowed)return 'none'
  const keepsSource=source.wordId && source.ref.kind!=='isolated' &&
    !plan.movedFrom && (plan.action==='join'||plan.action==='create')
  return keepsSource?'copy':'move'
 },[getCurrentState,updateHover])
 useEffect(()=>{
  if(!editHint)return
  const timer=window.setTimeout(()=>setEditHint(null),5000)
  return ()=>window.clearTimeout(timer)
 },[editHint])
 const model=useMemo(()=>deriveManagementView(state),[state])
 const cards=useMemo(()=>sortManagementCards(filterManagementCards(model.cards,filters),sort),[model.cards,filters,sort])
 const words=useMemo(()=>view === 'list' ? managementWords(cards,sort) : [],[view,cards,sort])
 const results=useMemo(()=>searchOpen||searchClosing ? searchManagement(state,query,model) : [],[state,query,model,searchOpen,searchClosing])
 const itemCount = view === 'cards' ? cards.length : words.length
 const page = Math.min(pageIndex, Math.max(0, Math.ceil(itemCount / PAGE_SIZE) - 1))
 const start = page * PAGE_SIZE
 const visibleCards = useMemo(() => cards.slice(start, start + PAGE_SIZE), [cards, start])
 const visibleWords = words.slice(start, start + PAGE_SIZE)
 const visibleResults = results.slice(resultPage * PAGE_SIZE, (resultPage + 1) * PAGE_SIZE)
 const checked=Object.values(filters).filter(Boolean).length
 const allChecked=checked===4?true:checked===0?false:'indeterminate' as const
 const handledLocate = useRef<typeof locateRequest>(null)
 const locateWord = useCallback((id:string,group?:GroupRef)=>{
  const current = getCurrentState()
  const nextView = group && group.kind !== 'isolated' ? 'cards' : view
  const nextSort = nextView === 'cards' && (sort === 'az' || sort === 'za') ? 'newest' : sort
  const allCards = sortManagementCards(current === state ? model.cards : deriveManagementView(current).cards, nextSort)
  const index = nextView === 'list' ? managementWords(allCards, nextSort).findIndex(word => word.id === id) :
    allCards.findIndex(card => (!group || (card.kind === group.kind && card.id === group.id)) && card.words.some(word => word.id === id))
  setView(nextView);setSort(nextSort)
  setPageIndex(Math.max(0, Math.floor(index / PAGE_SIZE)))
  setFilters(allFilters);closeSearch();setLocate(id);resumeInput()
  setTimeout(()=>{
   const selector=`[data-management-word="${CSS.escape(id)}"]`
   const preferred=group&&document.querySelector(`[data-card-kind="${group.kind}"][data-card-id="${CSS.escape(group.id)}"] ${selector}`)
   const row=preferred||document.querySelector(selector)
   if(row?.getClientRects().length)row.scrollIntoView({behavior:'smooth',block:'center'})
   setTimeout(()=>setLocate(current=>current===id?null:current),2200)
  },80)
 },[getCurrentState, state, model.cards, sort, view, resumeInput, closeSearch])
 useEffect(() => {
  if (!active || !locateRequest || handledLocate.current === locateRequest) return
  const frame = requestAnimationFrame(() => {
   handledLocate.current = locateRequest
   locateWord(locateRequest.id)
  })
  return () => cancelAnimationFrame(frame)
 }, [active, locateRequest, locateWord])
 const notifyUndo=useCallback((title:string,undo:()=>void)=>{
  if(guideTask)return
  toast.success(title,{duration:10000,action:{label:'撤销',onClick:()=>{undo();resumeInput()}}})
 },[guideTask,resumeInput])
 useEffect(()=>{
  if(!active || !drag)return
  const source=drag
  const {ref,wordId}=source
  const canDetach=wordId && ref.kind!=='isolated'
  let frame=0, previousTime=0, fractionalPixels=0
  let pointer:{x:number;y:number}|null=null
  const hideHint=()=>{if(detachHint.current)detachHint.current.hidden=true}
  function showOutside(x:number,y:number){
   updateHover(null)
   const hint=detachHint.current
   if(canDetach&&hint){
    hint.hidden=false
    hint.style.left=Math.max(8,Math.min(x+16,window.innerWidth-hint.offsetWidth-8))+'px'
    hint.style.top=Math.max(8,Math.min(y+20,window.innerHeight-hint.offsetHeight-8))+'px'
   }
  }
  function retargetAfterScroll(x:number,y:number){
   const surface=document.elementFromPoint(x,y)?.closest<HTMLElement>(dropSurface)
   if(surface&&surfaceRef.current?.contains(surface)){
    hideHint()
    const target:GroupRef=surface.dataset.cardId
      ? {kind:surface.dataset.cardKind as GroupRef['kind'],id:surface.dataset.cardId}
      : {kind:'isolated',id:surface.dataset.listDropTarget!}
    selectDropZone(source,target,surface,x)
   }else showOutside(x,y)
  }
  function stopScrolling(){
   cancelAnimationFrame(frame)
   frame=0;previousTime=0;fractionalPixels=0;pointer=null
  }
  function edgeSpeed(){
   if(guideTask||!pointer)return 0
   const band=Math.min(EDGE_SCROLL_BAND,window.innerHeight*.18)
   const top=Math.max(0,Math.min(1,1-pointer.y/band))
   const bottom=Math.max(0,Math.min(1,1-(window.innerHeight-pointer.y)/band))
   if(!top&&!bottom)return 0
   const bounds=surfaceRef.current?.getBoundingClientRect()
   if(!bounds||pointer.x<bounds.left||pointer.x>=bounds.right)return 0
   return MAX_EDGE_SCROLL_SPEED*(bottom**2-top**2)
  }
  function scrollAtEdge(now:number){
   frame=0
   if(!pointer||dragRef.current!==drag){stopScrolling();return}
   const speed=edgeSpeed()
   const scrolling=document.scrollingElement
   if(!scrolling||!speed||
    (speed<0&&scrolling.scrollTop<=0)||
    (speed>0&&scrolling.scrollTop>=scrolling.scrollHeight-scrolling.clientHeight)){
    stopScrolling();return
   }
   const elapsed=previousTime?Math.min(now-previousTime,32):16
   previousTime=now
   fractionalPixels+=speed*elapsed/1000
   const step=Math.trunc(fractionalPixels)
   if(step){
    fractionalPixels-=step
    window.scrollBy({top:step,behavior:'instant'})
    retargetAfterScroll(pointer.x,pointer.y)
   }
   frame=requestAnimationFrame(scrollAtEdge)
  }
  const isOutsideCard=(event:globalThis.DragEvent)=>event.dataTransfer?.types.includes(MIME) &&
   event.target instanceof Element && !event.target.closest(dropSurface)
  function onDragOutside(event:globalThis.DragEvent){
   if(event.dataTransfer?.types.includes(MIME)){
    pointer={x:event.clientX,y:event.clientY}
    if(!edgeSpeed())stopScrolling()
    else if(!frame)frame=requestAnimationFrame(scrollAtEdge)
   }
   if(!isOutsideCard(event)){hideHint();return}
   showOutside(event.clientX,event.clientY)
   if(!canDetach)return
   event.preventDefault()
   if(event.dataTransfer)event.dataTransfer.dropEffect='move'
  }
  function onDragLeave(event:globalThis.DragEvent){
   if(event.relatedTarget instanceof Node && document.contains(event.relatedTarget))return
   const leavingDocument=event.target===document||event.target===document.documentElement
   // Child dragleave events may have a null relatedTarget and zeroed coordinates.
   if(!leavingDocument)return
   stopScrolling();hideHint();updateHover(null)
  }
  function onDrop(event:globalThis.DragEvent){
   stopScrolling()
   if(!wordId || !canDetach || dragRef.current!==drag || !isOutsideCard(event))return
   event.preventDefault();event.stopPropagation();hideHint()
   endDrag()
   try{
    const word=getCurrentState().words[wordId]
    const undo=managementTransaction(draft=>removeGroupMember(draft,ref,wordId))
    setFilters(current=>({...current,isolated:true}))
    notifyUndo(`已将「${word.text}」移出本组`,undo)
   }catch(error){toast.error(error instanceof Error?error.message:'未能移出本组')}
   resumeInput()
  }
  document.addEventListener('dragover',onDragOutside,true)
  document.addEventListener('dragenter',onDragOutside,true)
  document.addEventListener('dragleave',onDragLeave,true)
  document.addEventListener('drop',onDrop,true)
  document.addEventListener('dragend',endDrag,true)
  return ()=>{
   stopScrolling()
   document.removeEventListener('dragover',onDragOutside,true)
   document.removeEventListener('dragenter',onDragOutside,true)
   document.removeEventListener('dragleave',onDragLeave,true)
   document.removeEventListener('drop',onDrop,true)
   document.removeEventListener('dragend',endDrag,true)
  }
 },[active,drag,endDrag,getCurrentState,guideTask,managementTransaction,notifyUndo,resumeInput,selectDropZone,updateHover])
 async function retryWord(word:Word){
  if(retryRequests.current.has(word.id))return
  const controller=new AbortController()
  retryRequests.current.set(word.id,controller)
  setRetrying(current=>[...current,word.id])
  try{
   const result=await retryDefinition(word.text,state.settings.dictProviders,controller.signal)
   if(controller.signal.aborted)return
   const undo=managementTransaction(draft=>{
    const current=draft.words[word.id]
    if(!current || current.text!==word.text || current.addedAt!==word.addedAt ||
      current.source!==word.source || current.gloss!==word.gloss || current.phonetic!==word.phonetic ||
      JSON.stringify(current.meanings)!==JSON.stringify(word.meanings)){
      throw new Error('词条已更新或移除，请检查当前释义。')
    }
    current.gloss=result.gloss
    current.phonetic=result.phonetic
    current.meanings=result.meanings
   })
   notifyUndo(`「${word.text}」的释义已更新`,undo)
  }catch(error){
   if(!controller.signal.aborted){
    toast.error(`「${word.text}」的释义未更新`,{
     description:error instanceof Error && error.message.startsWith('词条') ? error.message : '备用词典未返回可用的中文释义，原释义已保留。',
    })
   }
  }finally{
   retryRequests.current.delete(word.id)
   if(!controller.signal.aborted)setRetrying(current=>current.filter(id=>id!==word.id))
  }
 }
 function retryButton(suspect:Word[]){
  if(!suspect.length)return null
  const word=suspect[0]
  if(suspect.length===1){
   const busy=retrying.includes(word.id)
   const label=busy?`正在重试 ${word.text} 的释义`:`重试 ${word.text} 的释义`
   return <Button variant="ghost" size="icon-sm" aria-label={label} title={label} disabled={busy} onClick={()=>void retryWord(word)}>
    <RotateCw size={16} className={busy?'animate-spin':''}/>
   </Button>
  }
  return <DropdownMenu>
   <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label="重试组内单词的释义" title="重试组内单词的释义"><RotateCw size={16}/></Button></DropdownMenuTrigger>
   <DropdownMenuContent align="end" onCloseAutoFocus={restoreFocus}>
    {suspect.map(word=><DropdownMenuItem key={word.id} disabled={retrying.includes(word.id)} onSelect={()=>void retryWord(word)}>
     {retrying.includes(word.id)?'正在重试':'重试'} {word.text}
    </DropdownMenuItem>)}
   </DropdownMenuContent>
  </DropdownMenu>
 }
 function startDrag(event:DragEvent,item:DragItem){
  event.stopPropagation()
  if((event.target as Element).closest('button,input,textarea,select')){event.preventDefault();return}
  dragRef.current=item
  updateHover(null)
  setDrag(item)
  event.dataTransfer.effectAllowed=item.wordId?'copyMove':'move'
  event.dataTransfer.setData(MIME,'1')
 }
 function dragOver(event:DragEvent<HTMLElement>,target:GroupRef){
  const source=dragRef.current
  if(!source||!event.dataTransfer.types.includes(MIME))return
  event.preventDefault()
  event.dataTransfer.dropEffect=selectDropZone(source,target,event.currentTarget,event.clientX)
 }
 function drop(event:DragEvent,target:GroupRef){
  const source=dragRef.current, current=hoverRef.current
  if(!source||!event.dataTransfer.types.includes(MIME))return
  event.preventDefault();event.stopPropagation()
  endDrag()
  if(key(source.ref)===key(target))return
  resumeInput()
  if(!current?.kind||key(current.target)!==key(target))return
  const plan=current.plans[current.kind]
  if(!plan.allowed){toast.info(plan.preview);return}
  try{
   if(getCurrentState()!==current.snapshot)throw new Error('词库已变化，请重新拖放')
   const kind=current.kind
   let result:GroupRef|undefined
   const undo=managementTransaction(draft=>{result=mergeGroups(draft,source,target,kind)})
   if(!result)return
   const resultKey=key(result)
   const nextFilters=filters[kind]?filters:{...filters,[kind]:true}
   if(nextFilters!==filters)setFilters(nextFilters)
   if(view==='cards'){
    const nextCards=sortManagementCards(filterManagementCards(deriveManagementView(getCurrentState()).cards,nextFilters),sort)
    const index=nextCards.findIndex(card=>key(card)===resultKey)
    if(index>=0&&Math.floor(index/PAGE_SIZE)!==page)setPageIndex(Math.floor(index/PAGE_SIZE))
    if(!guideTask&&!editHintShown){editHintShown=true;setEditHint(resultKey)}
   }
   notifyUndo(
    plan.action==='join'||plan.action==='extend' ? `已加入${DROP_LABELS[kind]}` :
    plan.action==='merge' ? `已合并为${DROP_LABELS[kind]}` : `已创建${DROP_LABELS[kind]}`,
    undo,
   )
  }catch(error){toast.error(error instanceof Error?error.message:'分组未完成')}
 }
 function dropOverlay(target:GroupRef){
  return hover&&key(hover.target)===key(target)
    ? <DropZoneOverlay active={hover.kind} plans={hover.plans} recommended={hover.recommended} toolbar={toolbarRef}/>
    : null
 }
 function searchKeys(event:ReactKeyboardEvent){
  if(event.nativeEvent.isComposing)return
  const items=[...(searchList.current?.querySelectorAll<HTMLButtonElement>('[data-search-result]')??[])]
  if(!items.length)return
  const index=items.indexOf(document.activeElement as HTMLButtonElement)
  if(event.key==='Enter'&&index<0){event.preventDefault();items[0].click();return}
  if(event.key!=='ArrowDown'&&event.key!=='ArrowUp')return
  event.preventDefault()
  if(event.key==='ArrowUp'&&index<=0){searchInput.current?.focus();return}
  items[Math.min(items.length-1,index+(event.key==='ArrowDown'?1:-1))].focus()
 }
 function relationRefs(word:Word):GroupRef[]{
  const relation=model.relations[word.id]
  const refs:GroupRef[]=[]
  if(relation?.shapeId)refs.push({kind:'shape',id:relation.shapeId})
  for(const id of relation?.synonymIds ?? [])refs.push({kind:'synonym',id})
  if(relation?.customId)refs.push({kind:'custom',id:relation.customId})
  if(!refs.length)refs.push({kind:'isolated',id:word.id})
  return refs
 }
 function wordBody(word:Word,card?:ManagementCard){
  const ref:GroupRef=card?{kind:card.kind,id:card.id}:{kind:'isolated',id:word.id}
  const item:DragItem={ref,wordId:word.id}
  const relation=model.relations[word.id]
  return <div data-management-word={word.id} data-drag-word={word.id} draggable onDragStart={event=>startDrag(event,item)} onDragEnd={endDrag}
    className={'management-word min-w-0 rounded-lg px-2 py-3 '+(locate===word.id?'bg-primary/10 ring-2 ring-primary ':'')+(drag?.wordId===word.id?'is-dragging':'')}>
   <div className="flex min-w-0 items-center justify-between gap-3"><div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1"><span className="font-word break-words text-xl">{word.text}</span>{word.phonetic&&<span className="text-xs text-muted-foreground">{word.phonetic}</span>}{!card&&<span className="flex flex-wrap gap-1">{relation?.shapeId&&<Tag kind="shape"/>}{!!relation?.synonymIds.length&&<Tag kind="synonym"/>}{relation?.customId&&<Tag kind="custom"/>}{relation?.isolated&&<Tag kind="isolated"/>}</span>}</div><MasteryControl value={state.stats[word.id]?.level??0}/></div>
   <CollapsibleGloss text={word.gloss} className="mt-1"/>
   {!card&&!relation?.isolated&&<div className="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1">
    {relationRefs(word).map(group=><button key={key(group)} type="button" onClick={()=>locateWord(word.id,group)}
      className="min-w-0 break-words text-left text-xs text-muted-foreground hover:text-primary hover:underline">
      {groupTitle(state,group)}
    </button>)}
   </div>}
  </div>
 }
 function renderCard(card:ManagementCard){
  const ref:GroupRef={kind:card.kind,id:card.id}
  const hint=editHint===key(ref),isSource=drag&&!drag.wordId&&key(drag.ref)===key(ref)
  return <article key={key(ref)} data-card-id={card.id} data-card-kind={card.kind} draggable
   onDragStart={event=>startDrag(event,{ref})} onDragEnd={endDrag}
   onDragEnter={event=>dragOver(event,ref)} onDragOver={event=>dragOver(event,ref)} onDrop={event=>drop(event,ref)}
   className={'management-card drop-zone-surface min-w-0 rounded-2xl border bg-card p-5 shadow-sm '+(isSource?'is-dragging':'')}>
   <div className="mb-2 flex min-w-0 items-start justify-between gap-3"><div className="min-w-0 flex-1"><Tag kind={card.kind}/>{card.kind!=='isolated'&&<h3 className="mt-3 line-clamp-2 break-words text-sm font-medium leading-6" title={cardLabel(card.name)}>{cardLabel(card.name)}</h3>}</div><div className="flex shrink-0 gap-1">{retryButton(card.words.filter(needsDefinitionRetry))}<Button variant="ghost" size="icon-sm" className={hint?'ring-1 ring-primary/50 text-primary':undefined} aria-label={'编辑 '+card.name} onClick={()=>{setFocusWord(undefined);setEditor(ref)}}><Pencil size={16}/></Button></div></div>
   {hint&&<p role="status" className="drop-edit-hint mb-2 flex justify-end gap-1.5 text-xs text-primary"><Pencil size={13}/>可用右上角的编辑按钮修改类型</p>}
   <div className="-mx-2 divide-y divide-border/70">{card.words.map(word=><div key={word.id}>{wordBody(word,card)}</div>)}</div>
   {dropOverlay(ref)}
  </article>
 }
 return <div ref={surfaceRef} className="space-y-5" onClick={event=>{
  // Portalled editors and text selection keep their own focus.
  const target=event.target
  if(target instanceof Element && event.currentTarget.contains(target) &&
    !target.closest('input, textarea, [contenteditable]') && window.getSelection()?.isCollapsed!==false)resumeInput()
 }}>
  <div ref={stickySentinel} aria-hidden="true" className="h-px -mb-5"/>
  <div ref={stickyFrame} className="management-sticky" data-stuck={stuck||undefined}><div ref={toolbarRef} className="management-sticky-inner"><UnifiedEntry visible={active} onLocateWord={locateWord} inputRef={entryInput} onResumeInput={resumeInput}/>
  <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5 management-toolbar" aria-label="词汇管理工具" data-tutor="management">
   <div className="flex flex-wrap items-center gap-3"><div className="management-heading-copy"><h2 className="text-lg font-medium">词库</h2><p className="mt-1 text-xs text-muted-foreground">{Object.keys(state.words).length} 个单词 <span title="把单词拖到卡片外，即可移出当前分组">· 拖词入组，拖卡合组</span></p></div><div className="ml-auto flex flex-wrap items-center gap-2">{(['shape','synonym','custom'] as GroupKind[]).map(kind=><Button key={kind} data-guide={`new-${kind}`} variant="outline" size="sm" onClick={()=>setEditor({kind})}><Plus size={15}/>{labels[kind]}</Button>)}<Button variant="outline" size="icon-sm" aria-label="搜索词库" onClick={()=>setSearchOpen(true)}><Search size={16}/></Button></div></div>
   <div className="management-filters mt-4 flex min-w-0 flex-wrap items-center gap-x-5 gap-y-3 border-t pt-4"><label className="flex items-center gap-2 text-sm"><Checkbox aria-label="全部关系" checked={allChecked} onCheckedChange={value=>{setPageIndex(0);setFilters({shape:!!value,synonym:!!value,custom:!!value,isolated:!!value})}}/>全部</label>{(Object.keys(labels) as RelationFilter[]).map(kind=><label key={kind} className="flex items-center gap-2 text-sm"><Checkbox aria-label={'筛选'+labels[kind]} checked={filters[kind]} onCheckedChange={value=>{setPageIndex(0);setFilters(current=>({...current,[kind]:!!value}))}}/>{labels[kind]}</label>)}
    <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:flex-nowrap"><Select value={sort} onValueChange={value=>{setPageIndex(0);setSort(value as ManagementSort)}}><SelectTrigger size="sm" aria-label="排序方式" className="management-sort" style={{width:'15rem',maxWidth:'100%'}}><SelectValue/></SelectTrigger><SelectContent onCloseAutoFocus={restoreFocus}><SelectItem value="newest">添加时间：晚 → 早</SelectItem><SelectItem value="oldest">添加时间：早 → 晚</SelectItem>{view==='list'&&<><SelectItem value="az">A → Z</SelectItem><SelectItem value="za">Z → A</SelectItem></>}</SelectContent></Select><div className="flex shrink-0 rounded-md border p-0.5"><Button size="icon-sm" variant={view==='cards'?'secondary':'ghost'} aria-label="瀑布流视图" aria-pressed={view==='cards'} onClick={()=>{setPageIndex(0);setView('cards');if(sort==='az'||sort==='za')setSort('newest')}}><LayoutGrid size={16}/></Button><Button size="icon-sm" variant={view==='list'?'secondary':'ghost'} aria-label="列表视图" aria-pressed={view==='list'} onClick={()=>{setPageIndex(0);setView('list')}}><List size={16}/></Button></div></div>
   </div>
  </section></div></div>
  {!cards.length?<div className="rounded-2xl border border-dashed p-12 text-center"><LibraryBig className="mx-auto text-muted-foreground"/><p className="mt-3 text-sm text-muted-foreground">{Object.keys(state.words).length?'当前筛选没有结果。':'录入第一个单词，开始整理你的词库。'}</p></div>:view==='cards'?<MasonryCards cards={visibleCards} renderCard={renderCard}/>:<div className="divide-y rounded-2xl border bg-card px-3 sm:px-5">
   {visibleWords.map(word=>{
    const ref:GroupRef={kind:'isolated',id:word.id}
    return <div key={word.id} data-list-drop-target={word.id} className="drop-zone-surface flex min-w-0 items-center gap-2"
     onDragEnter={event=>dragOver(event,ref)} onDragOver={event=>dragOver(event,ref)} onDrop={event=>drop(event,ref)}>
     <div className="min-w-0 flex-1">{wordBody(word)}</div>
     {needsDefinitionRetry(word)&&retryButton([word])}
     <Button variant="ghost" size="icon-sm" aria-label={'编辑 '+word.text} onClick={()=>{setFocusWord(word.id);setEditor(relationRefs(word)[0])}}><Pencil size={16}/></Button>
     {dropOverlay(ref)}
    </div>
   })}
  </div>}
  {drag?.wordId&&drag.ref.kind!=='isolated'&&createPortal(
   <div ref={detachHint} hidden aria-hidden="true" className="pointer-events-none fixed z-[70] rounded-lg bg-foreground px-3 py-2 text-xs font-medium text-background shadow-lg">
    <Unlink size={14} className="mr-1.5 inline align-text-bottom"/>松开移出本组
   </div>,document.body)}
  {itemCount > PAGE_SIZE && <PageControls page={page} count={itemCount} onChange={next => {
    setPageIndex(next)
    document.querySelector('.management-toolbar')?.scrollIntoView({ block: 'start' })
  }} />}
  <Dialog open={searchOpen} onOpenChange={open=>{if(open)setSearchOpen(true);else closeSearch()}}><DialogContent onCloseAutoFocus={event=>{setSearchClosing(false);restoreFocus(event)}} onOpenAutoFocus={event=>{event.preventDefault();const field=searchInput.current;field?.focus();field?.select()}} className="top-[12vh] max-h-[80vh] min-w-0 translate-y-0 overflow-hidden sm:max-w-xl"><DialogHeader><DialogTitle>搜索词库</DialogTitle><DialogDescription>搜索组名、英文单词或释义。↑↓ 选择，回车定位。</DialogDescription></DialogHeader><Input ref={searchInput} aria-label="搜索关键词" placeholder="输入关键词…" value={query} onKeyDown={searchKeys} onChange={event=>{setQuery(event.target.value);setResultPage(0)}}/>{query.trim()&&results.length>0&&<p className="-mt-2 text-xs text-muted-foreground" role="status">找到 {results.length} 个单词</p>}<div ref={searchList} className="max-h-[55vh] min-h-0 overflow-y-auto" onKeyDown={searchKeys}>{query.trim()&&!results.length?<p className="py-8 text-center text-sm text-muted-foreground">没有找到匹配单词。</p>:<ul className="divide-y">{visibleResults.map(word=>{
   const groups=relationRefs(word).map(ref=>({ref,title:groupTitle(state,ref)}))
   const matching=groups.find(group=>group.title.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
   return <li key={word.id}><button data-search-result className="w-full min-w-0 rounded-md px-2 py-3 text-left outline-none hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/30" onClick={()=>locateWord(word.id,matching?.ref)}><span className="font-word text-lg"><Highlight text={word.text} query={query}/></span><span className="mt-1 block break-words text-sm text-muted-foreground"><Highlight text={excerpt(word.gloss,query)} query={query}/></span><span className="mt-1 block break-words text-xs text-muted-foreground"><Highlight text={groups.map(group=>group.title).join(' · ')} query={query}/></span></button></li>})}</ul>}</div>{results.length > PAGE_SIZE && <PageControls page={resultPage} count={results.length} onChange={setResultPage}/>}</DialogContent></Dialog>
  {editor&&<ManagementEditor key={editor.kind+':'+(editor.id??'new')} target={editor} focusWordId={focusWord} onCloseAutoFocus={restoreFocus} onClose={()=>setEditor(null)}/>}
 </div>
}
