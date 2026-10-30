import {useEffect,useMemo,useRef,useState,type DragEvent} from 'react'
import {LayoutGrid,List,Pencil,Plus,Search,LibraryBig} from 'lucide-react'
import {toast} from 'sonner'
import {useLibrary} from '@/store/library'
import type {GuideTask} from '@/lib/tutorial'
import type {DragItem,GroupKind,GroupRef,Word} from '@/types'
import {deriveManagementView,filterManagementCards,managementWords,searchManagement,sortManagementCards,type ManagementCard,type ManagementFilters,type ManagementSort,type RelationFilter} from '@/lib/managementView'
import {mergeGroups,setGroupKind} from '@/lib/grouping'
import {groupTitle} from '@/lib/groupNames'
import UnifiedEntry from '@/sections/UnifiedEntry'
import ManagementEditor,{type ManagementEditorTarget} from '@/sections/ManagementEditor'
import MasteryControl from '@/sections/MasteryControl'
import CollapsibleGloss from '@/sections/CollapsibleGloss'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import {Checkbox} from '@/components/ui/checkbox'
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog'
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from '@/components/ui/select'

const labels:Record<RelationFilter,string>={shape:'形近组',synonym:'近义组',custom:'自定义组',isolated:'独立单词'}
const colors:Record<RelationFilter,string>={shape:'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',synonym:'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',custom:'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-200',isolated:'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'}
const allFilters:ManagementFilters={shape:true,synonym:true,custom:true,isolated:true}
const MIME='application/x-lexicon-group'
const key=(ref:GroupRef)=>ref.kind+':'+ref.id
function Tag({kind}:{kind:RelationFilter}){return <span className={'inline-flex shrink-0 rounded-md px-2 py-1 text-[11px] font-medium '+colors[kind]}>{labels[kind]}</span>}
function Highlight({text,query}:{text:string;query:string}){
 const at=text.toLocaleLowerCase().indexOf(query.trim().toLocaleLowerCase()),length=query.trim().length
 if(at<0||!length)return <>{text}</>
 return <>{text.slice(0,at)}<mark className="rounded bg-amber-200 px-0.5 text-inherit dark:bg-amber-800">{text.slice(at,at+length)}</mark><Highlight text={text.slice(at+length)} query={query}/></>
}
function excerpt(text:string,query:string){const at=text.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());return at>80?'…'+text.slice(at-35,at+110):text.slice(0,145)+(text.length>145?'…':'')}

export default function Management({guideTask}:{guideTask?:GuideTask}){
 const {state,managementTransaction}=useLibrary()
 const anchor=useRef<HTMLDivElement>(null),[stuck,setStuck]=useState(false)
 useEffect(()=>{const observer=new IntersectionObserver(([e])=>setStuck(!e.isIntersecting&&e.boundingClientRect.top<12),{rootMargin:'-12px 0px 0px 0px'});if(anchor.current)observer.observe(anchor.current);return()=>observer.disconnect()},[])
 const [filters,setFilters]=useState<ManagementFilters>(allFilters)
 const [view,setView]=useState<'cards'|'list'>('cards')
 const [sort,setSort]=useState<ManagementSort>('newest')
 const [editor,setEditor]=useState<ManagementEditorTarget|null>(null)
 useEffect(()=>{
  if(!guideTask)return
  const frame=requestAnimationFrame(()=>setEditor(guideTask==='sort'||guideTask==='mastery'?{kind:'shape',id:'guide-letters'}:null))
  return()=>cancelAnimationFrame(frame)
 },[guideTask])
 const [focusWord,setFocusWord]=useState<string|undefined>()
 const [searchOpen,setSearchOpen]=useState(false),[query,setQuery]=useState('')
 const [locate,setLocate]=useState<string|null>(null)
 const [drag,setDrag]=useState<DragItem|null>(null),[over,setOver]=useState<string|null>(null)
 const model=useMemo(()=>deriveManagementView(state),[state])
 const cards=useMemo(()=>sortManagementCards(filterManagementCards(model.cards,filters),sort),[model.cards,filters,sort])
 const words=useMemo(()=>managementWords(cards,sort),[cards,sort])
 const results=useMemo(()=>searchManagement(state,query),[state,query])
 const checked=Object.values(filters).filter(Boolean).length
 const allChecked=checked===4?true:checked===0?false:'indeterminate' as const
 function locateWord(id:string){
  setFilters(allFilters);setSearchOpen(false);setLocate(id)
  setTimeout(()=>{document.querySelector(`[data-management-word="${CSS.escape(id)}"]`)?.scrollIntoView({behavior:'smooth',block:'center'});setTimeout(()=>setLocate(null),2200)},80)
 }
 function notifyUndo(title:string,undo:()=>void){if(guideTask)return;toast.success(title,{duration:10000,action:{label:'撤销',onClick:undo}})}
 function startDrag(event:DragEvent,item:DragItem){
  event.stopPropagation()
  if((event.target as Element).closest('button,input,textarea,select')){event.preventDefault();return}
  setDrag(item);event.dataTransfer.effectAllowed='move';event.dataTransfer.setData(MIME,JSON.stringify(item))
 }
 function drop(event:DragEvent,target:GroupRef){
  event.preventDefault();event.stopPropagation();setOver(null);setDrag(null)
  try{
   const source=JSON.parse(event.dataTransfer.getData(MIME)) as DragItem
   if(!source?.ref || !['shape','synonym','custom','isolated'].includes(source.ref.kind))return
   const targetIds=target.kind==='isolated'?[target.id]:target.kind==='shape'?state.groups[target.id]?.wordIds:target.kind==='synonym'?state.synonymSets[target.id]?.wordIds:state.customSets?.[target.id]?.wordIds
   if(key(source.ref)===key(target)||(source.wordId&&targetIds?.includes(source.wordId))){toast.info('已经在这张卡片中');return}
   let result:ReturnType<typeof mergeGroups>|undefined
   const undo=managementTransaction(draft=>{result=mergeGroups(draft,source,target)})
   if(!result)return
   if(result.groupRef.kind==='custom')setFilters(current=>({...current,custom:true}))
   if(result.needsTypeChoice){setView('cards');setTimeout(()=>document.querySelector(`[data-card-id="${CSS.escape(result!.groupRef.id)}"]`)?.scrollIntoView({behavior:'smooth',block:'center'}),100)}
   notifyUndo('已合并词汇',undo)
  }catch(error){toast.error(error instanceof Error?error.message:'没有完成合并')}
 }
 function dragOver(event:DragEvent,target:GroupRef){
  if(!drag&&!event.dataTransfer.types.includes(MIME))return
  event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='move';setOver(key(target))
 }
 function chooseType(ref:GroupRef,kind:GroupKind){
  try {const undo=managementTransaction(draft=>{setGroupKind(draft,ref,kind)});setFilters(current=>({...current,[kind]:true}));notifyUndo('分组类型已更新',undo)}catch(error){toast.error(error instanceof Error?error.message:'未能更新分组')}
 }
 function defaultRef(word:Word):GroupRef{
  const relation=model.relations[word.id]
  return relation?.shapeId?{kind:'shape',id:relation.shapeId}:relation?.synonymId?{kind:'synonym',id:relation.synonymId}:relation?.customId?{kind:'custom',id:relation.customId}:{kind:'isolated',id:word.id}
 }
 function wordBody(word:Word,card?:ManagementCard){
  const ref:GroupRef=card?{kind:card.kind,id:card.id}:{kind:'isolated',id:word.id}
  const item:DragItem={ref,wordId:word.id}
  const relation=model.relations[word.id]
  return <div data-management-word={word.id} data-drag-word={word.id} draggable onDragStart={event=>startDrag(event,item)} onDragEnd={()=>{setDrag(null);setOver(null)}}
    className={'management-word min-w-0 rounded-lg px-2 py-3 '+(locate===word.id?'bg-primary/10 ring-2 ring-primary ':'')+(drag?.wordId===word.id?'is-dragging':'')}>
   <div className="flex min-w-0 items-center justify-between gap-3"><div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1"><span className="font-word break-words text-xl">{word.text}</span>{word.phonetic&&<span className="text-xs text-muted-foreground">{word.phonetic}</span>}{!card&&<span className="flex flex-wrap gap-1">{relation?.shapeId&&<Tag kind="shape"/>}{relation?.synonymId&&<Tag kind="synonym"/>}{relation?.customId&&<Tag kind="custom"/>}{relation?.isolated&&<Tag kind="isolated"/>}</span>}</div><MasteryControl value={state.stats[word.id]?.level??0}/></div>
   <CollapsibleGloss text={word.gloss} className="mt-1"/>
   {!card&&<p className="mt-1 truncate text-xs text-muted-foreground">{[relation?.shapeId?groupTitle(state,{kind:'shape',id:relation.shapeId}):'',relation?.synonymId?groupTitle(state,{kind:'synonym',id:relation.synonymId}):'',relation?.customId?groupTitle(state,{kind:'custom',id:relation.customId}):''].filter(Boolean).join(' · ')}</p>}
  </div>
 }
 function renderCard(card:ManagementCard){
  const ref:GroupRef={kind:card.kind,id:card.id},isOver=over===key(ref),isSource=drag&&!drag.wordId&&key(drag.ref)===key(ref)
  const pending=card.kind==='custom'&&state.customSets?.[card.id]?.pendingTypeChoice
  return <article key={key(ref)} data-card-id={card.id} data-card-kind={card.kind} draggable onDragStart={event=>startDrag(event,{ref})} onDragEnd={()=>{setDrag(null);setOver(null)}} onDragOver={event=>dragOver(event,ref)} onDrop={event=>drop(event,ref)} onDragLeave={event=>{if(!event.currentTarget.contains(event.relatedTarget as Node))setOver(null)}}
   className={'management-card mb-4 inline-block w-full break-inside-avoid rounded-2xl border bg-card p-5 shadow-sm '+(isOver?'is-drop-target ':'')+(isSource?'is-dragging':'')}>
   <div className="mb-2 flex min-w-0 items-start justify-between gap-3"><div className="min-w-0 flex-1"><Tag kind={card.kind}/>{card.kind!=='isolated'&&<h3 className="mt-3 line-clamp-2 break-words text-sm font-medium leading-6" title={card.name}>{card.name}</h3>}</div><Button variant="ghost" size="icon-sm" aria-label={'编辑 '+card.name} onClick={()=>{setFocusWord(undefined);setEditor(ref)}}><Pencil size={16}/></Button></div>
   {pending&&<div className="pending-kind-choice mb-3 min-w-0 rounded-lg bg-muted/60 p-2.5" role="group" aria-label="归为什么类型？"><p className="mb-2 text-xs text-muted-foreground">归为什么类型？</p><div className="flex min-w-0 flex-wrap gap-1">{(['shape','synonym','custom'] as GroupKind[]).map(kind=><Button key={kind} size="sm" variant={kind==='custom'?'secondary':'ghost'} aria-pressed={kind==='custom'} className="max-w-full px-2 text-xs" onClick={()=>chooseType(ref,kind)}>{labels[kind]}</Button>)}</div></div>}
   {isOver&&<p className="mb-2 text-xs text-primary">松开以合并到此卡片</p>}
   <div className="-mx-2 divide-y divide-border/70">{card.words.map(word=><div key={word.id}>{wordBody(word,card)}</div>)}</div>
  </article>
 }
 return <div className="space-y-5"><div ref={anchor} className="management-anchor"/><div className="management-sticky" data-stuck={stuck}><UnifiedEntry onLocateWord={locateWord}/>
  <section className="rounded-2xl border bg-card p-4 shadow-sm sm:p-5 management-toolbar" aria-label="词汇管理工具" data-tutor="management">
   <div className="flex flex-wrap items-center gap-3"><div className="management-heading-copy"><h2 className="text-lg font-medium">词库</h2><p className="mt-1 text-xs text-muted-foreground">{Object.keys(state.words).length} 个单词 · 拖动单词或卡片合组</p></div><div className="ml-auto flex flex-wrap items-center gap-2">{(['shape','synonym','custom'] as GroupKind[]).map(kind=><Button key={kind} data-guide={`new-${kind}`} variant="outline" size="sm" onClick={()=>setEditor({kind})}><Plus size={15}/>{labels[kind]}</Button>)}<Button variant="outline" size="icon-sm" aria-label="搜索词库" onClick={()=>setSearchOpen(true)}><Search size={16}/></Button></div></div>
   <div className="mt-4 flex min-w-0 flex-wrap items-center gap-x-5 gap-y-3 border-t pt-4"><label className="flex items-center gap-2 text-sm"><Checkbox aria-label="全部关系" checked={allChecked} onCheckedChange={value=>setFilters({shape:!!value,synonym:!!value,custom:!!value,isolated:!!value})}/>全部</label>{(Object.keys(labels) as RelationFilter[]).map(kind=><label key={kind} className="flex items-center gap-2 text-sm"><Checkbox aria-label={'筛选'+labels[kind]} checked={filters[kind]} onCheckedChange={value=>setFilters(current=>({...current,[kind]:!!value}))}/>{labels[kind]}</label>)}
    <div className="ml-auto flex min-w-0 max-w-full flex-wrap items-center gap-2 sm:flex-nowrap"><Select value={sort} onValueChange={value=>setSort(value as ManagementSort)}><SelectTrigger size="sm" aria-label="排序方式" className="management-sort" style={{width:'15rem',maxWidth:'100%'}}><SelectValue/></SelectTrigger><SelectContent><SelectItem value="newest">添加时间：晚 → 早</SelectItem><SelectItem value="oldest">添加时间：早 → 晚</SelectItem>{view==='list'&&<><SelectItem value="az">A → Z</SelectItem><SelectItem value="za">Z → A</SelectItem></>}</SelectContent></Select><div className="flex shrink-0 rounded-md border p-0.5"><Button size="icon-sm" variant={view==='cards'?'secondary':'ghost'} aria-label="瀑布流视图" aria-pressed={view==='cards'} onClick={()=>{setView('cards');if(sort==='az'||sort==='za')setSort('newest')}}><LayoutGrid size={16}/></Button><Button size="icon-sm" variant={view==='list'?'secondary':'ghost'} aria-label="列表视图" aria-pressed={view==='list'} onClick={()=>setView('list')}><List size={16}/></Button></div></div>
   </div>
  </section></div>
  {!cards.length?<div className="rounded-2xl border border-dashed p-12 text-center"><LibraryBig className="mx-auto text-muted-foreground"/><p className="mt-3 text-sm text-muted-foreground">{Object.keys(state.words).length?'当前筛选没有结果。':'录入第一个单词，开始整理你的词库。'}</p></div>:view==='cards'?<div className="columns-1 gap-4 md:columns-2 xl:columns-3">{cards.map(renderCard)}</div>:<div className="divide-y rounded-2xl border bg-card px-3 sm:px-5">{words.map(word=><div key={word.id} className={'flex min-w-0 items-center gap-2 '+(over==='isolated:'+word.id?'bg-primary/5':'')} onDragOver={event=>dragOver(event,{kind:'isolated',id:word.id})} onDrop={event=>drop(event,{kind:'isolated',id:word.id})}><div className="min-w-0 flex-1">{wordBody(word)}</div><Button variant="ghost" size="icon-sm" aria-label={'编辑 '+word.text} onClick={()=>{setFocusWord(word.id);setEditor(defaultRef(word))}}><Pencil size={16}/></Button></div>)}</div>}
  <Dialog open={searchOpen} onOpenChange={setSearchOpen}><DialogContent className="max-h-[85vh] min-w-0 overflow-hidden sm:max-w-xl"><DialogHeader><DialogTitle>搜索词库</DialogTitle><DialogDescription>搜索组名、英文单词或释义。</DialogDescription></DialogHeader><Input aria-label="搜索关键词" placeholder="输入关键词…" value={query} onChange={event=>setQuery(event.target.value)}/><div className="max-h-[55vh] min-h-0 overflow-y-auto">{query.trim()&&!results.length?<p className="py-8 text-center text-sm text-muted-foreground">没有找到匹配单词。</p>:<ul className="divide-y">{results.map(word=><li key={word.id}><button className="w-full min-w-0 rounded-md px-2 py-3 text-left hover:bg-muted" onClick={()=>locateWord(word.id)}><span className="font-word text-lg"><Highlight text={word.text} query={query}/></span><span className="mt-1 block break-words text-sm text-muted-foreground"><Highlight text={excerpt(word.gloss,query)} query={query}/></span><span className="mt-1 block break-words text-xs text-muted-foreground"><Highlight text={groupTitle(state,defaultRef(word))} query={query}/></span></button></li>)}</ul>}</div></DialogContent></Dialog>
  {editor&&<ManagementEditor key={editor.kind+':'+(editor.id??'new')} target={editor} focusWordId={focusWord} onClose={()=>setEditor(null)}/>}
 </div>
}
