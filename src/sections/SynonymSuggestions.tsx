import { useEffect, useMemo, useState } from 'react'
import { Check, Layers3, LoaderCircle, Search } from 'lucide-react'
import { toast } from 'sonner'
import { useLibrary } from '@/store/library'
import { lookupSynonyms, normalizeLemma, verifySynonyms, type SynonymSense } from '@/lib/synonyms'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

const POS: Record<string, string> = { n: '名词', v: '动词', a: '形容词', s: '形容词', r: '副词' }

function SenseCard({ sense, wordId, verified, onCreated, onAdd }: { sense: SynonymSense; wordId: string; verified: Set<string> | null | undefined; onCreated: (id: string) => void; onAdd: (term: string) => void }) {
  const { state, createSynonymSet } = useLibrary()
  const [selected, setSelected] = useState<string[]>([])
  const anchor = state.words[wordId]
  const wordsByLemma = useMemo(() => new Map(Object.values(state.words).map(word => [normalizeLemma(word.text), word])), [state.words])
  if (!anchor) return null
  const candidates = sense.terms.filter(term => term !== normalizeLemma(anchor.text))
  const eligible = (term: string) => wordsByLemma.has(term) && (verified === undefined || verified?.has(term))
  const ids = [wordId, ...selected.filter(eligible).map(term => wordsByLemma.get(term)!.id)]
  const duplicate = Object.values(state.synonymSets).some(group => group.wordIds.length === ids.length && group.wordIds.every(id => ids.includes(id)))
  return <article className="rounded-xl border bg-background/40 p-4 sm:p-5" data-sense-id={sense.id}>
    <p className="text-xs text-muted-foreground">{POS[sense.pos] ?? sense.pos} · OEWN 2025 · {sense.id}</p>
    <h4 className="mt-2 text-base font-medium leading-7">{sense.definition}</h4>
    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
      {candidates.map(term => {
        const word = wordsByLemma.get(term)
        const allowed = !!eligible(term)
        const checked = selected.includes(term)
        return <div key={term} className={`min-w-0 rounded-lg border ${checked && allowed ? 'border-primary bg-primary/10' : 'bg-card'}`}><button type="button" disabled={!allowed} aria-pressed={checked && allowed} onClick={() => setSelected(prev => prev.includes(term) ? prev.filter(value => value !== term) : [...prev, term])}
          className={`flex w-full min-w-0 items-start gap-3 rounded-lg px-3 py-3 text-left ${!allowed ? 'opacity-60' : 'hover:bg-accent'}`}>
          <span className="mt-1 grid size-4 shrink-0 place-items-center rounded border" aria-hidden="true">{checked && allowed && <Check className="size-3" />}</span>
          <span className="min-w-0 break-words"><span className="font-word text-lg">{term}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{word ? word.gloss : '尚未收录 · 补充释义后可加入'}</span><span className="mt-1 block text-xs text-muted-foreground">{verified === undefined ? (word ? '已在词库' : '离线候选') : verified === null ? '等待联网校验' : verified.has(term) ? 'API 结果支持' : 'API 未提供佐证'}</span></span>
        </button>{!word && <Button variant="link" size="sm" className="mb-1 ml-7" aria-label={`录入 ${term}`} onClick={() => onAdd(term)}>录入这个词</Button>}</div>
      })}
    </div>
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3"><p className="text-xs leading-5 text-muted-foreground">固定成员：{anchor.text} · 另选 {ids.length - 1} 个词{duplicate && ids.length > 1 ? ' · 已有相同成员的词群' : ''}</p><Button size="sm" disabled={ids.length < 2 || duplicate} onClick={() => {
      const note = `来源：Open English WordNet 2025 · ${sense.id}\n义项：${sense.definition}` + (verified ? '\nDatamuse 结果支持所选词形关系；不代表当前义项可任意互换。' : '')
      const id = createSynonymSet(ids.map(id => state.words[id].text).join(' / '), ids, note)
      toast.success('近义词群已创建'); onCreated(id)
    }}>确认创建词群</Button></div>
  </article>
}

function Results({ wordId, mode, apiKey, onCreated, onOffline, onAdd }: { wordId: string; mode: 'offline' | 'verified'; apiKey: string; onCreated: (id: string) => void; onOffline: () => void; onAdd: (term: string) => void }) {
  const { state } = useLibrary()
  const word = state.words[wordId]
  const [senses, setSenses] = useState<SynonymSense[] | null>(null)
  const [error, setError] = useState('')
  const [apiError, setApiError] = useState('')
  const [verified, setVerified] = useState<Set<string> | null>(null)
  const text = word?.text ?? ''
  useEffect(() => {
    const controller = new AbortController()
    async function run() {
      try {
        const result = await lookupSynonyms(text)
        if (controller.signal.aborted) return
        setSenses(result)
        if (mode === 'verified' && result.length) {
          try {
            const terms = await verifySynonyms(text, apiKey, controller.signal)
            if (!controller.signal.aborted) setVerified(terms)
          } catch (error) {
            if (!controller.signal.aborted) setApiError(error instanceof Error && error.name !== 'TimeoutError' ? error.message : '联网校验超时，请重试或切换离线候选。')
          }
        }
      } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '离线词库加载失败，请重试。') }
    }
    void run()
    return () => controller.abort()
  }, [text, mode, apiKey])
  if (!word) return <p className="mt-4 text-sm text-muted-foreground">这个词已移除，请重新选择。</p>
  return <div className="mt-5 space-y-3" aria-live="polite">
    <div className="rounded-xl bg-muted p-4"><p className="font-word text-xl">{word.text}</p><p className="mt-1 text-sm text-muted-foreground">{word.gloss}</p><p className="mt-2 text-xs leading-5 text-muted-foreground">对照下方英文义项，选择与你要记忆的含义一致的一组。仅展示同一义项的词，不合并不同义项。</p></div>
    {!senses && !error && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><LoaderCircle size={16} className="animate-spin" />正在读取离线候选…</p>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {senses?.length === 0 && <p className="rounded-xl border border-dashed p-5 text-sm leading-6 text-muted-foreground">离线词库中没有找到此词的多成员近义组。可尝试词典原形，或继续手动新建词群。</p>}
    {mode === 'verified' && !!senses?.length && <div className="rounded-xl border p-4 text-sm leading-6">
      {apiError ? <><p role="alert">{apiError}</p><Button variant="outline" size="sm" className="mt-2" onClick={onOffline}>切换为离线候选</Button></> : verified ? <p>联网校验已完成。仅 API 结果支持且已收录的候选可选；这不代表当前义项可任意互换。</p> : <p role="status" className="flex items-center gap-2"><LoaderCircle size={16} className="animate-spin" />正在联网校验，仅发送当前英文词…</p>}
    </div>}
    {senses?.map(sense => <SenseCard key={sense.id} sense={sense} wordId={wordId} verified={mode === 'offline' ? undefined : verified} onCreated={onCreated} onAdd={onAdd} />)}
    {!!senses?.length && <p className="text-xs leading-5 text-muted-foreground">来源：Open English WordNet 2025（Open English WordNet Team / Princeton WordNet）。未收录的候选可点击「录入这个词」，补充释义。联网模式使用 Datamuse API 作词形关系核对。</p>}
  </div>
}

export default function SynonymSuggestions({ onCreated, active, onAdd }: { onCreated: (id: string) => void; active: boolean; onAdd: (term: string) => void }) {
  const { state, updateSynonymSettings } = useLibrary()
  const [wordId, setWordId] = useState('')
  const [query, setQuery] = useState<{ wordId: string; key: number; mode: 'offline' | 'verified'; apiKey: string } | null>(null)
  const words = useMemo(() => Object.values(state.words).sort((a, b) => a.text.localeCompare(b.text)), [state.words])
  const mode = state.settings.synonymMode ?? 'offline'
  return <section className="rounded-2xl border bg-card p-5 shadow-sm sm:p-6" aria-labelledby="synonym-suggestions-title">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 id="synonym-suggestions-title" className="flex items-center gap-2 text-base font-semibold"><Layers3 size={18} className="text-primary" />查找近义词候选</h3><span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">{mode === 'offline' ? '离线候选' : 'API 联网校验'}</span></div>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">从已收录的词开始，按词义寻找候选。可在设置中切换离线或联网校验模式。</p>
    <form className="mt-4 flex flex-wrap items-end gap-3" onSubmit={event => { event.preventDefault(); if (wordId) setQuery({ wordId, key: Date.now(), mode, apiKey: state.settings.synonymApiKey ?? '' }) }}>
      <div className="min-w-0 flex-1 basis-60"><Label htmlFor="synonym-anchor">选择一个已收录的词</Label><select id="synonym-anchor" className="settings-select mt-2 w-full" value={wordId} onChange={event => { setWordId(event.target.value); setQuery(null) }}><option value="">{words.length ? '选择单词…' : '先录入单词，再查找候选'}</option>{words.map(word => <option key={word.id} value={word.id}>{word.text} · {word.gloss.slice(0, 40)}</option>)}</select></div>
      <Button disabled={!wordId} type="submit"><Search />查找候选</Button>
    </form>
    {query && (query.mode !== mode || query.apiKey !== (state.settings.synonymApiKey ?? '')) && <p className="mt-4 text-sm text-muted-foreground">模式或密钥已更改，请重新点击「查找候选」。</p>}
    {query && active && query.mode === mode && query.apiKey === (state.settings.synonymApiKey ?? '') && <Results key={query.key} wordId={query.wordId} mode={mode} apiKey={query.apiKey} onCreated={onCreated} onAdd={onAdd} onOffline={() => { updateSynonymSettings({ synonymMode: 'offline' }); setQuery({ ...query, key: Date.now(), mode: 'offline' }) }} />}
  </section>
}
