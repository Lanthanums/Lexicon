import {useEffect,useRef,useState,type ReactNode,type Ref} from 'react'
import {toast,type ExternalToast} from 'sonner'
import {useLibrary,dayKey,type NewWordInput} from '@/store/library'
import {lookupWord} from '@/lib/dictionary'
import {planEntry,prefetchEntry,isTie,type EntryPlan} from '@/lib/entryPlan'
import {createSynonymVerifier,type SynonymVerifier} from '@/lib/synonyms'
import {indexEntryWords,insertPlanned,parseEntries} from '@/lib/batchEntry'
import {groupTitle} from '@/lib/groupNames'
import type {LibraryState} from '@/types'
import {Button} from '@/components/ui/button'
import {Input} from '@/components/ui/input'
import EntryReview,{type EntryReviewAnswer,type EntryReviewTask} from '@/sections/EntryReview'

type Choice = { id: string; signature: string }
interface Item { id: string; text: string; input?: NewWordInput; shape?: Choice }
type Prepared = { id: string; input: NewWordInput; plan: EntryPlan; shape: string; index: number }
interface Batch {
  items: Item[]
  invalid: string[]
  repeated: number
  startedAt: number
  date: string
  remaining: string[]
  verifier: SynonymVerifier
  resolveReview?: (answer: EntryReviewAnswer | undefined) => void
}
const KEEP_BATCH = 100
/** Dictionary requests in flight at once; keeps a 100-word batch quick without flooding the provider. */
const LOOKUP_CONCURRENCY = 4
const summarize = (entries: string[]) => entries.slice(0, 6).map(entry => entry.length > 48 ? entry.slice(0, 48) + '…' : entry).join('、') + (entries.length > 6 ? ` 等 ${entries.length} 项` : '')
let entryOwner:symbol|null=null

/**
 * One entry notice at a time. Updating a toast in place keeps the old timer, so a
 * new result could vanish at once when the previous notice was about to expire.
 * Each notice therefore replaces the last one under a fresh id.
 */
let entryNotice: string | number | undefined
function notify(kind: 'success' | 'info' | 'error', title: string, options: ExternalToast = {}) {
  if (entryNotice !== undefined) toast.dismiss(entryNotice)
  entryNotice = toast[kind](title, options)
}

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
  const active=useRef<{controller: AbortController; batch: Batch} | null>(null)
  const [value,setValue]=useState(''),[busy,setBusy]=useState(false),[progress,setProgress]=useState('')
  const step = useRef(0)
  const [review,setReview]=useState<(EntryReviewTask & {step: number})|null>(null)
  useEffect(()=>()=> {
    active.current?.controller.abort()
    active.current?.batch.resolveReview?.(undefined)
    active.current=null
    if(entryOwner===owner)entryOwner=null
  },[owner])
  useEffect(() => {
    if (visible || !active.current) return
    const timer = window.setTimeout(() => {
      active.current?.controller.abort()
      active.current?.batch.resolveReview?.(undefined)
      active.current = null
      if (entryOwner === owner) entryOwner = null
      setBusy(false)
      setReview(null)
      setProgress('')
    }, 0)
    return () => window.clearTimeout(timer)
  }, [owner, visible])
  const alive=(controller:AbortController)=>active.current?.controller===controller && !controller.signal.aborted

  function cancel(){
    active.current?.controller.abort()
    active.current?.batch.resolveReview?.(undefined)
    active.current=null;setBusy(false);setReview(null);setProgress('')
    if(entryOwner===owner)entryOwner=null
    onResumeInput?.()
    notify('info','已取消入库',{description:'本次查询的单词尚未加入词库。',duration:5000})
  }

  function ask(batch: Batch, task: EntryReviewTask) {
    setReview({...task, step: ++step.current})
    setProgress('')
    setBusy(false)
    return new Promise<EntryReviewAnswer | undefined>(resolve => { batch.resolveReview = resolve })
  }

  async function chooseShape(batch: Batch, item: Item, input: NewWordInput, plan: EntryPlan, draft: LibraryState) {
    const previous = item.shape
    const currentSignature = JSON.stringify(plan.shape.map(option => [option.id, option.label, option.memberIds]))
    if (previous?.signature === currentSignature) return previous.id
    if (!previous && !isTie(plan.shape)) return plan.shape[0]?.id ?? ''
    const answer = await ask(batch, {kind: 'shape', input, options: plan.shape, draft, changed: !!previous})
    if (answer?.kind !== 'group') return undefined
    item.shape = {id: answer.id, signature: currentSignature}
    return answer.id
  }

  async function prepare(batch: Batch, controller: AbortController) {
    const currentWords = indexEntryWords(getCurrentState())
    const missingGlosses = batch.items.filter(item => !item.input && !currentWords.has(item.text))
    if (missingGlosses.length) {
      const answer = await ask(batch, {kind: 'gloss', words: missingGlosses})
      if (!alive(controller) || answer?.kind !== 'gloss') return
      for (const item of missingGlosses) {
        const gloss = answer.values[item.id]?.trim()
        if (gloss) item.input = {text: item.text, gloss, meanings: [{pos: '', en: '', zh: gloss}], source: 'manual'}
      }
    }

    const {startedAt, date} = batch
    while (alive(controller)) {
      const baseline = getCurrentState()
      const draft = structuredClone(baseline)
      const words = indexEntryWords(draft)
      const excludedShape = new Set<string>()
      const prepared: Prepared[] = []
      const duplicates: string[] = []
      const missing: string[] = []

      for (const [index, item] of batch.items.entries()) {
        if (index > 0 && index % 8 === 0) await new Promise(resolve => window.setTimeout(resolve, 0))
        if (!alive(controller)) return
        const existing = words.get(item.text)
        if (existing) { duplicates.push(existing.id); continue }
        const input = item.input
        if (!input) { missing.push(item.text); continue }

        setProgress(`正在归组 ${index + 1}/${batch.items.length}：${item.text}`)
        // Only a pending network check takes this long; say so instead of looking stuck.
        const slow = draft.settings.synonymMode === 'verified' ? window.setTimeout(() => {
          if (alive(controller)) setProgress(`正在联网校验近义词 ${index + 1}/${batch.items.length}：${item.text}…`)
        }, 700) : 0
        const plan = await planEntry(input, draft, controller.signal, excludedShape, batch.verifier).finally(() => window.clearTimeout(slow))
        if (!alive(controller)) return
        const shape = await chooseShape(batch, item, input, plan, draft)
        if (!alive(controller) || shape === undefined) return

        insertPlanned(draft, input, plan, shape, item.id, startedAt + index, date, words)
        prepared.push({id: item.id, input, plan, shape, index})
        if (item.shape?.id === '') excludedShape.add(item.id)
      }

      const live = getCurrentState()
      if (live.words !== baseline.words || live.groups !== baseline.groups ||
          live.synonymSets !== baseline.synonymSets || live.settings !== baseline.settings) continue

      if (prepared.length) applyManagement(next => {
        const liveWords = indexEntryWords(next)
        for (const {id, input, plan, shape, index} of prepared) {
          insertPlanned(next, input, plan, shape, id, startedAt + index, date, liveWords)
        }
      })
      const saved = getCurrentState()
      const newIds = new Set(prepared.map(({id}) => id))
      const shapeIds = new Set(Object.values(saved.groups).filter(group => group.wordIds.length > 1).flatMap(group => group.wordIds.filter(id => newIds.has(id))))
      const nearCounts = new Map<string, number>()
      const nearGroups = Object.values(saved.synonymSets).filter(group => {
        const members = group.wordIds.filter(id => newIds.has(id))
        members.forEach(id => nearCounts.set(id, (nearCounts.get(id) ?? 0) + 1))
        return members.length > 0
      })
      const isolated = prepared.length - new Set([...shapeIds, ...nearCounts.keys()]).size
      const multiple = prepared.filter(({id}) => (nearCounts.get(id) ?? 0) > 1)
      const synonymDetail = nearGroups.length === 0 ? '' : prepared.length === 1
        ? `「${prepared[0].input.text}」已加入 ${nearGroups.length} 个近义组：${summarize(nearGroups.map(group =>
          groupTitle(saved, {kind: 'synonym', id: group.id}).replace(/^近义组 · /, '')))}`
        : `${nearCounts.size} 个词已加入 ${nearGroups.length} 个近义组${multiple.length ? `，含 ${summarize(multiple.map(({id, input}) =>
          `「${input.text}」加入 ${nearCounts.get(id)} 组`))}` : ''}`
      const repeated = duplicates.length + batch.repeated
      const details = [
        batch.remaining.length ? `还有 ${batch.remaining.length} 词留在录入框，可继续查询` : '',
        missing.length ? `已跳过缺少释义的词：${summarize(missing)}` : '',
        batch.invalid.length ? `未识别：${summarize(batch.invalid)}` : '',
        isolated ? `${isolated} 词已独立保存` : '',
        shapeIds.size ? `${shapeIds.size} 个词已加入形近组` : '',
        synonymDetail,
        repeated ? `已跳过 ${repeated} 个重复词` : '',
        prepared.some(row => row.plan.nearIssue === 'verify') ? '近义联网校验未完成，相关词暂未自动建近义组；网络不稳时可在设置中改用离线候选' :
          prepared.some(row => row.plan.nearIssue) ? '部分近义关系暂未查到，可稍后调整' : '',
      ].filter(Boolean)
      const target = multiple[0]?.id ?? prepared[0]?.id ?? duplicates[0]
      notify(prepared.length ? 'success' : 'info', prepared.length ? `已入库 ${prepared.length} 个单词` : '没有新增单词', {
        description: details.join('。'), duration: 12000,
        action: target ? {label: '查看', onClick: () => onLocateWord(target)} : undefined,
      })
      setValue([...batch.remaining, ...missing, ...batch.invalid].join(';'))
      return
    }
  }

  async function submit(input?:NewWordInput){
    if(active.current)return
    if(entryOwner&&entryOwner!==owner){notify('info','请先完成正在进行的入库',{duration:5000});return}
    const parsed = parseEntries(input?.text ?? value)
    if (input && (parsed.words.length !== 1 || parsed.invalid.length || parsed.repeated.length)) {
      notify('error', '无法识别这个单词')
      return
    }
    if(!parsed.words.length){notify('info','请输入英文单词',{duration:5000,description:'多个单词之间用分号或换行分隔，每批最多查询 100 个。'});return}
    const controller=new AbortController();setBusy(true)
    entryOwner=owner
    const baseline = getCurrentState()
    const texts = parsed.words.slice(0, KEEP_BATCH)
    const batch:Batch={items:texts.map(text=>({id:crypto.randomUUID(),text})),invalid:parsed.invalid,repeated:parsed.repeated.length,startedAt:Date.now(),date:dayKey(),remaining:parsed.words.slice(KEEP_BATCH),
      verifier:createSynonymVerifier(baseline.settings.synonymApiKey ?? '',controller.signal)}
    active.current={controller,batch}
    const words = indexEntryWords(baseline)
    try{
      let finished = 0, fallback = false, latest = ''
      const report = () => {
        if (!alive(controller)) return
        const lookups = batch.items.filter(item => !words.has(item.text) && !input).length
        if (!lookups) return
        setProgress(`正在查询 ${Math.min(finished + 1, lookups)}/${lookups}${latest ? '：' + latest : ''}` +
          (fallback ? '。有道暂未返回可用释义，正在使用备用词典，速度较慢，请稍候……' : ''))
      }
      let next = 0
      const worker = async () => {
        while (alive(controller) && next < batch.items.length) {
          const item = batch.items[next++]
          if (words.has(item.text)) continue
          if (input) { item.input = {...input, text: item.text}; continue }
          latest = item.text
          report()
          try {
            const result = await lookupWord(item.text, controller.signal, baseline.settings.dictProviders, () => { fallback = true; report() })
            if (result.gloss.trim() && result.gloss.trim().toLowerCase() !== item.text) item.input = {...result, text: item.text, source: 'api'}
          } catch { if (!alive(controller)) return }
          finished++
          report()
          // Synonym verification for this word can run while the next lookups wait.
          void prefetchEntry(item.text, baseline, batch.verifier, texts)
        }
      }
      await Promise.all(Array.from({length: Math.min(LOOKUP_CONCURRENCY, batch.items.length)}, worker))
      if (!alive(controller)) return
      await prepare(batch,controller)
    }catch(error){
      if(alive(controller))notify('error','入库未完成',{duration:5000,description:error instanceof Error?error.message:'请重试。'})
    }finally{
      if(alive(controller)){
        active.current=null
        if(entryOwner===owner)entryOwner=null
        setReview(null);setProgress('');setBusy(false)
        onResumeInput?.()
      }
    }
  }

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
      <p className="entry-hint mt-3 text-xs leading-5 text-muted-foreground">{compact ? '分号或换行分隔，每批最多 100 词。' : '用分号或换行分隔，每批查询最多 100 个单词。'}</p>
      {busy&&!review&&<p role="status" className="entry-progress mt-2 text-xs leading-5 text-primary">{progress}</p>}
    </>}
    <EntryReview task={review} busy={busy} progress={progress} onCancel={cancel} onCloseAutoFocus={onResumeInput}
      onAnswer={answer=>{
        const batch=active.current?.batch
        if(!batch?.resolveReview)return
        const resolve=batch.resolveReview
        batch.resolveReview=undefined
        setBusy(true)
        resolve(answer)
      }} />
  </div>
}
