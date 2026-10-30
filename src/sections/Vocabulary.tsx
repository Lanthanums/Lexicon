import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  ArrowLeft,
  BookOpen,
  Check,
  ChevronRight,
  CircleHelp,
  Layers3,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { useLibrary } from '@/store/library'
import { lookupWord } from '@/lib/dictionary'
import SynonymSuggestions from '@/sections/SynonymSuggestions'
import type { Word } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

const ActiveContext = createContext(true)
type Mode = 'single' | 'synonyms'
type Direction = 'en2zh' | 'zh2en'
type Grade = 'known' | 'vague' | 'unknown'
type SynonymSet = {
  id: string
  name: string
  notes: string
  wordIds: string[]
  createdAt: number
}

type Draft = {
  text: string
  gloss: string
  usageNote: string
  example: string
}

const EMPTY_DRAFT: Draft = { text: '', gloss: '', usageNote: '', example: '' }

const EXAMPLES = [
  {
    name: '表示“大”的近义词',
    notes: 'big 最口语、最通用；large 偏正式，常描述尺寸、数量或程度；huge 强调“非常大”，语气最强。',
    words: [
      { text: 'big', gloss: '大的；重要的', usageNote: '日常口语中最常用，可指体积、规模或影响。', example: 'They live in a big house near the park.' },
      { text: 'large', gloss: '大的；大量的', usageNote: '比 big 稍正式，常用于面积、数量和尺寸。', example: 'A large number of students attended the lecture.' },
      { text: 'huge', gloss: '巨大的；庞大的', usageNote: '强调程度，表示“极大”，也可用于抽象事物。', example: 'The new bridge made a huge difference to the village.' },
    ],
  },
] as const

function wordInput(draft: Draft) {
  return {
    text: draft.text.trim().toLowerCase(),
    gloss: draft.gloss.trim(),
    meanings: draft.gloss.trim() ? [{ pos: '', en: '', zh: draft.gloss.trim() }] : [],
    usageNote: draft.usageNote.trim(),
    example: draft.example.trim(),
    source: 'manual' as const,
  }
}

function wordStatus(word: Word, stats: Record<string, { dueAt?: number; lastSeen?: number }>) {
  const stat = stats[word.id]
  if (!stat?.lastSeen) return { label: '未学习', className: 'bg-primary/10 text-primary' }
  if (!stat.dueAt || stat.dueAt <= Date.now()) return { label: '待复习', className: 'bg-amber-600/10 text-amber-800 dark:text-amber-300' }
  return { label: '已学习', className: 'bg-emerald-700/10 text-emerald-800 dark:text-emerald-300' }
}

function WordForm({
  draft,
  setDraft,
  lookup,
  loading,
  edit,
}: {
  draft: Draft
  setDraft: (draft: Draft) => void
  lookup?: () => void
  loading?: boolean
  edit?: boolean
}) {
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={edit ? 'edit-word' : 'new-word'}>英文单词</Label>
          <Input
            id={edit ? 'edit-word' : 'new-word'}
            className="font-word text-lg"
            value={draft.text}
            disabled={edit}
            onChange={(e) => setDraft({ ...draft, text: e.target.value })}
            placeholder="例如：serene"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor={edit ? 'edit-gloss' : 'new-gloss'}>中文释义</Label>
            {lookup && (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline disabled:opacity-50"
                disabled={loading || !draft.text.trim()}
                onClick={lookup}
              >
                {loading && <LoaderCircle className="size-3 animate-spin" />}
                {loading ? '查询中…' : '词典查询'}
              </button>
            )}
          </div>
          <Input
            id={edit ? 'edit-gloss' : 'new-gloss'}
            value={draft.gloss}
            onChange={(e) => setDraft({ ...draft, gloss: e.target.value })}
            placeholder="平静的；宁静的"
          />
        </div>
      </div>
      <div className="space-y-2">
        <Label htmlFor={edit ? 'edit-usage' : 'new-usage'}>用法与记忆提示 <span className="font-normal text-muted-foreground">（可选）</span></Label>
        <Textarea
          id={edit ? 'edit-usage' : 'new-usage'}
          value={draft.usageNote}
          onChange={(e) => setDraft({ ...draft, usageNote: e.target.value })}
          placeholder="记录搭配、语气、使用场景或你的记忆方法"
          rows={2}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor={edit ? 'edit-example' : 'new-example'}>英文例句 <span className="font-normal text-muted-foreground">（可选）</span></Label>
        <Textarea
          id={edit ? 'edit-example' : 'new-example'}
          className="font-word"
          value={draft.example}
          onChange={(e) => setDraft({ ...draft, example: e.target.value })}
          placeholder="The lake was perfectly serene."
          rows={2}
        />
      </div>
    </div>
  )
}

function WordDialog({
  word,
  onClose,
}: {
  word: Word | null
  onClose: () => void
}) {
  const { updateWord, deleteWord } = useLibrary()
  const [draft, setDraft] = useState<Draft>(() => word ? { text: word.text, gloss: word.gloss, usageNote: word.usageNote ?? '', example: word.example ?? '' } : EMPTY_DRAFT)
  const [confirming, setConfirming] = useState(false)


  if (!word) return null
  return (
    <>
      <Dialog open={!!word} onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>编辑单词与用法</DialogTitle>
            <DialogDescription>补充自己的用法笔记，让释义真正为你所用。</DialogDescription>
          </DialogHeader>
          <WordForm draft={draft} setDraft={setDraft} edit />
          <DialogFooter className="items-center border-t pt-4 sm:justify-between">
            <Button variant="ghost" className="text-destructive hover:text-destructive" onClick={() => setConfirming(true)}>
              <Trash2 /> 删除单词
            </Button>
            <div className="flex gap-2">
              <Button variant="outline" onClick={onClose}>取消</Button>
              <Button
                disabled={!draft.gloss.trim()}
                onClick={() => {
                  updateWord(word.id, { gloss: draft.gloss.trim(), usageNote: draft.usageNote.trim(), example: draft.example.trim() })
                  toast.success('单词笔记已保存')
                  onClose()
                }}
              >保存修改</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>删除「{word.text}」？</AlertDialogTitle>
            <AlertDialogDescription>单词、笔记及学习记录都会被删除，此操作无法撤销。它也会从所属近义词群中移除。</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => { deleteWord(word.id); onClose(); toast.success('单词已删除') }}>确认删除</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}

function AddWordDialog({
  open,
  onOpenChange,
  onAdded,
  initialText = '',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onAdded?: (id: string) => void
  initialText?: string
}) {
  const { addStudyWord, state } = useLibrary()
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [loading, setLoading] = useState(false)

  useEffect(() => { if (open) setDraft({ ...EMPTY_DRAFT, text: initialText }) }, [open, initialText])

  async function lookup() {
    if (!draft.text.trim() || loading) return
    setLoading(true)
    try {
      const result = await lookupWord(draft.text, undefined, state.settings.dictProviders)
      setDraft((current) => ({ ...current, gloss: result.gloss || current.gloss }))
    } catch {
      toast.info('暂时未查询到释义', { description: '仍可手动填写并保存，无需联网。' })
    } finally {
      setLoading(false)
    }
  }

  function save() {
    if (!draft.text.trim() || !draft.gloss.trim()) return
    if (!/^[a-z][a-z'’ -]*$/i.test(draft.text.trim())) { toast.error('请输入英文单词'); return }
    const result = addStudyWord(wordInput(draft))
    if (result.status === 'duplicate') {
      toast.info('这个词已在词库中', { description: '使用已有词条，不会重复创建。' })
    } else {
      toast.success(`已收录 ${draft.text.trim().toLowerCase()}`)
    }
    onAdded?.(result.wordId)
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>收录一个新词</DialogTitle>
          <DialogDescription>英文与中文释义即可保存；查词是可选的，离线也能录入。</DialogDescription>
        </DialogHeader>
        <WordForm draft={draft} setDraft={setDraft} lookup={lookup} loading={loading} />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button disabled={!draft.text.trim() || !draft.gloss.trim() || loading} onClick={save}><Plus /> 保存单词</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function SynonymEditor({
  set,
  onClose,
}: {
  set: SynonymSet | null
  onClose: () => void
}) {
  const { state, createSynonymSet, updateSynonymSet } = useLibrary()
  const [name, setName] = useState(set?.name ?? '')
  const [notes, setNotes] = useState(set?.notes ?? '')
  const [ids, setIds] = useState<string[]>(set?.wordIds ?? [])
  const [search, setSearch] = useState('')
  const [newOpen, setNewOpen] = useState(false)

  const words = useMemo(() => Object.values(state.words)
    .filter((word) => `${word.text} ${word.gloss}`.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => a.text.localeCompare(b.text)), [state.words, search])

  function toggle(id: string) {
    setIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
  }

  function save() {
    const unique = [...new Set(ids)].filter((id) => state.words[id])
    if (!name.trim() || unique.length < 2) return
    if (set) {
      updateSynonymSet(set.id, { name: name.trim(), notes: notes.trim(), wordIds: unique })
      toast.success('近义词群已更新')
    } else {
      createSynonymSet(name.trim(), unique, notes.trim())
      toast.success('近义词群已创建')
    }
    onClose()
  }

  return (
    <>
      <Dialog open onOpenChange={(open) => !open && onClose()}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{set ? '编辑近义词群' : '新建近义词群'}</DialogTitle>
            <DialogDescription>由你亲自挑选至少 2 个词，并写下真正容易混淆的区别。</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="set-name">词群名称</Label>
              <Input id="set-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如：表示“大”的近义词" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="set-notes">辨析笔记</Label>
              <Textarea id="set-notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="比较语气、正式程度、搭配和使用场景…" />
            </div>
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <Label>选择成员 <span className="font-normal text-muted-foreground">（已选 {ids.length}）</span></Label>
                <Button type="button" size="sm" variant="outline" onClick={() => setNewOpen(true)}><Plus /> 录入新词</Button>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <Input aria-label="搜索可选单词" className="pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索现有词库…" />
              </div>
              <div className="max-h-64 overflow-y-auto rounded-lg border bg-card/60 p-2">
                {words.length ? (
                  <div className="grid gap-1 sm:grid-cols-2">
                    {words.slice(0, 100).map((word) => {
                      const checked = ids.includes(word.id)
                      return (
                        <button
                          type="button"
                          key={word.id}
                          aria-pressed={checked}
                          className={`flex min-w-0 items-center gap-3 rounded-md border px-3 py-2 text-left transition-colors ${checked ? 'border-primary/40 bg-primary/10' : 'border-transparent hover:bg-accent'}`}
                          onClick={() => toggle(word.id)}
                        >
                          <span className={`flex size-4 shrink-0 items-center justify-center rounded border ${checked ? 'border-primary bg-primary text-primary-foreground' : 'bg-background'}`}>{checked && <Check className="size-3" />}</span>
                          <span className="min-w-0"><span className="font-word block truncate text-base">{word.text}</span><span className="block truncate text-xs text-muted-foreground">{word.gloss}</span></span>
                        </button>
                      )
                    })}
                  </div>
                ) : <p className="p-6 text-center text-sm text-muted-foreground">没有匹配的单词，可点击「录入新词」。</p>}
              </div>
              {words.length > 100 && <p className="text-xs text-muted-foreground">已显示前 100 项，请搜索以定位其余单词。</p>}
              {ids.length < 2 && <p className="text-xs text-amber-800 dark:text-amber-300">还需选择 {2 - ids.length} 个单词才能保存。</p>}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={onClose}>取消</Button>
            <Button disabled={!name.trim() || ids.length < 2} onClick={save}>保存词群</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <AddWordDialog open={newOpen} onOpenChange={setNewOpen} onAdded={(id) => setIds((current) => [...new Set([...current, id])])} />
    </>
  )
}

function Flashcards({
  wordIds,
  title,
  direction,
  onExit,
}: {
  wordIds: string[]
  title: string
  direction: Direction
  onExit: () => void
}) {
  const { state, recordAnswer } = useLibrary()
  const active = useContext(ActiveContext)
  const [queue, setQueue] = useState<string[]>(wordIds)
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [results, setResults] = useState<Array<{ id: string; grade: Grade }>>([])
  const scored = useRef(false)
  const word = state.words[queue[index]]


  function grade(value: Grade) {
    if (!flipped || !word || scored.current) return
    scored.current = true
    recordAnswer(word.id, value === 'known')
    const next = [...results, { id: word.id, grade: value }]
    setResults(next)
    if (index + 1 >= queue.length) {
      setIndex(queue.length)
    } else {
      setIndex((current) => current + 1)
      setFlipped(false)
      scored.current = false
    }
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!active || event.repeat || index >= queue.length || document.querySelector('[role="dialog"], [role="alertdialog"]')) return
      const target = event.target as HTMLElement | null
      if (target?.matches('input, textarea, select, [contenteditable="true"]')) return
      if (event.code === 'Space') {
        event.preventDefault()
        setFlipped((value) => !value)
      }
      if (flipped && ['1', '2', '3'].includes(event.key)) {
        event.preventDefault()
        grade(event.key === '1' ? 'known' : event.key === '2' ? 'vague' : 'unknown')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  function retry(ids: string[]) {
    setQueue(ids)
    setResults([])
    setIndex(0)
    setFlipped(false)
    scored.current = false
  }

  if (index >= queue.length) {
    const known = results.filter((item) => item.grade === 'known').length
    const missed = results.filter((item) => item.grade !== 'known').map((item) => item.id).filter((id) => state.words[id])
    return (
      <section className="stagger-in rounded-2xl border bg-card p-6 text-center shadow-sm sm:p-10" aria-live="polite">
        <span className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary"><BookOpen /></span>
        <p className="mt-5 text-sm text-muted-foreground">本轮完成 · {title}</p>
        <p className="font-word mt-2 text-5xl text-primary">{known}<span className="text-2xl text-muted-foreground"> / {results.length}</span></p>
        <p className="mt-2 text-sm text-muted-foreground">认识 {known} · 需巩固 {missed.length}</p>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          {missed.length > 0 && <Button onClick={() => retry(missed)}><RotateCcw /> 重练错词与模糊词（{missed.length}）</Button>}
          <Button variant="outline" onClick={onExit}><ArrowLeft /> 返回词库</Button>
        </div>
        {results.length > 0 && (
          <div className="mt-8 border-t pt-5 text-left">
            <p className="mb-3 text-sm font-medium">本轮回顾</p>
            <ul className="space-y-2">
              {results.map((result, i) => {
                const item = state.words[result.id]
                if (!item) return null
                return <li key={`${result.id}-${i}`} className="flex items-center gap-3 rounded-lg bg-background px-3 py-2 text-sm"><span className={`size-2 rounded-full ${result.grade === 'known' ? 'bg-emerald-600' : result.grade === 'vague' ? 'bg-amber-500' : 'bg-destructive'}`} /><span className="font-word text-lg">{item.text}</span><span className="min-w-0 flex-1 truncate text-muted-foreground">{item.gloss}</span><span className="text-xs text-muted-foreground">{result.grade === 'known' ? '认识' : result.grade === 'vague' ? '模糊' : '不认识'}</span></li>
              })}
            </ul>
          </div>
        )}
      </section>
    )
  }

  if (!word) return <div className="mx-auto max-w-2xl rounded-2xl border bg-card p-8 text-center"><p className="text-muted-foreground">这张卡片的单词已从词库中移除。</p><div className="mt-5 flex justify-center gap-2"><Button variant="outline" onClick={onExit}>返回词库</Button><Button onClick={() => { setIndex(i => i + 1); setFlipped(false); scored.current = false }}>跳过这张卡片</Button></div></div>
  const front = direction === 'en2zh' ? word.text : word.gloss
  return (
    <section className="study-workspace" aria-label={`${title}闪卡学习`}>
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={onExit}><ArrowLeft /> 退出</Button>
        <Progress value={(index / queue.length) * 100} className="h-1.5 flex-1" />
        <span className="text-sm tabular-nums text-muted-foreground">{index + 1} / {queue.length}</span>
      </div>
      <p className="text-center text-xs text-muted-foreground">{title} · {direction === 'en2zh' ? '英 → 中' : '中 → 英'} · 先主动回忆，再翻面</p>
      <div className="flashcard-layout">
      <div key={`${queue.join('-')}-${index}`} className="stagger-in overflow-hidden rounded-2xl border bg-card shadow-sm">
        <button
          type="button"
          className="flex min-h-72 w-full flex-col items-center justify-center min-w-0 px-6 py-10 text-center outline-none focus-visible:ring-2 focus-visible:ring-inset sm:min-h-80"
          onClick={() => setFlipped((value) => !value)}
          aria-label={flipped ? '收起答案' : '显示答案'}
          aria-expanded={flipped}
        >
          {!flipped ? (
            <>
              <span className="text-xs uppercase tracking-[0.2em] text-muted-foreground">回忆它的{direction === 'en2zh' ? '含义与用法' : '英文拼写'}</span>
              <span className={`mt-5 max-w-full break-words [overflow-wrap:anywhere] ${direction === 'en2zh' ? 'font-word text-5xl sm:text-6xl' : 'text-3xl font-medium leading-relaxed'}`}>{front}</span>
              {direction === 'en2zh' && word.phonetic && <span className="mt-3 text-sm text-muted-foreground">{word.phonetic}</span>}
              <span className="mt-10 inline-flex items-center gap-2 text-xs text-muted-foreground"><CircleHelp className="size-4" /> 点击或按 Space 翻面</span>
            </>
          ) : (
            <span className="w-full">
              <span className="font-word block text-4xl text-primary sm:text-5xl">{word.text}</span>
              <span className="mt-3 block text-xl leading-relaxed">{word.gloss || '（暂无释义）'}</span>
              {word.usageNote && <span className="mx-auto mt-5 block max-w-lg border-t pt-4 text-sm leading-relaxed text-muted-foreground">{word.usageNote}</span>}
              {word.example && <span className="font-word mx-auto mt-3 block max-w-lg text-base italic leading-relaxed text-muted-foreground">“{word.example}”</span>}
            </span>
          )}
        </button>
        <div className="border-t bg-background/60 p-4">
          {flipped ? (
            <div className="grid grid-cols-3 gap-2">
              <Button variant="outline" className="border-emerald-700/30 text-emerald-800 dark:text-emerald-300 hover:bg-emerald-700/10" onClick={() => grade('known')}><span className="hidden text-xs opacity-60 sm:inline">1</span> 认识</Button>
              <Button variant="outline" className="border-amber-600/30 text-amber-800 dark:text-amber-300 hover:bg-amber-600/10" onClick={() => grade('vague')}><span className="hidden text-xs opacity-60 sm:inline">2</span> 模糊</Button>
              <Button variant="outline" className="border-destructive/30 text-destructive hover:bg-destructive/10" onClick={() => grade('unknown')}><span className="hidden text-xs opacity-60 sm:inline">3</span> 不认识</Button>
            </div>
          ) : <Button variant="secondary" className="w-full" onClick={() => setFlipped(true)}>显示答案 <span className="text-xs opacity-60">Space</span></Button>}
        </div>
      </div>
      <aside className="study-sidebar" aria-label="本轮学习概况">
        <p className="text-xs font-medium tracking-widest text-muted-foreground">本轮学习</p>
        <p className="mt-3 text-lg font-semibold">一次专注，一个单词</p>
        <div className="mt-5 grid grid-cols-2 gap-3 xl:grid-cols-1">
          <div className="study-stat"><p className="text-xs text-muted-foreground">已完成</p><p className="mt-1 text-2xl font-semibold tabular-nums">{results.length}<span className="text-sm font-normal text-muted-foreground"> / {queue.length}</span></p></div>
          <div className="study-stat"><p className="text-xs text-muted-foreground">本轮自评认识</p><p className="mt-1 text-2xl font-semibold tabular-nums">{results.filter(item => item.grade === 'known').length}</p></div>
        </div>
        <div className="mt-6 border-t pt-5 text-xs leading-6 text-muted-foreground"><p>先回忆，再显示答案。</p><p>翻面后按 1 / 2 / 3 自评。</p><p>Space · 翻面</p></div>
      </aside>
      </div>
    </section>
  )
}

function SingleVocabulary() {
  const { state } = useLibrary()
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [limit, setLimit] = useState(60)
  const [editId, setEditId] = useState<string | null>(null)
  const [study, setStudy] = useState(false)
  const [direction, setDirection] = useState<Direction>('en2zh')

  const words = useMemo(() => {
    const ids = new Set<string>()
    Object.values(state.groups).forEach((group) => {
      if (group.kind === 'single' || group.wordIds.length === 1) group.wordIds.forEach((id) => ids.add(id))
    })
    return [...ids].map((id) => state.words[id]).filter((word): word is Word => !!word)
  }, [state.groups, state.words])

  const filtered = words.filter((word) => `${word.text} ${word.gloss} ${word.usageNote ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()))
  const queue = useMemo(() => [...words].sort((a, b) => {
    const sa = state.stats[a.id]
    const sb = state.stats[b.id]
    const rank = (lastSeen?: number, dueAt?: number) => !lastSeen ? 0 : !dueAt || dueAt <= Date.now() ? 1 : 2
    return rank(sa?.lastSeen, sa?.dueAt) - rank(sb?.lastSeen, sb?.dueAt) || (sa?.dueAt ?? 0) - (sb?.dueAt ?? 0) || a.addedAt - b.addedAt
  }).slice(0, 20).map((word) => word.id), [words, state.stats])

  if (study) return <Flashcards wordIds={queue} title="独立单词 · 本轮最多 20 词" direction={direction} onExit={() => setStudy(false)} />

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div><h2 className="font-word text-2xl">我的独立词库</h2><p className="mt-1 text-sm text-muted-foreground">不依赖形近关系，一词一页，慢慢积累。</p></div>
        <div className="flex gap-2"><Button variant="outline" disabled={!words.length} onClick={() => setStudy(true)}><BookOpen /> 开始背诵</Button><Button onClick={() => setAddOpen(true)}><Plus /> 录入单词</Button></div>
      </div>
      {words.length > 0 && (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1"><Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /><Input aria-label="搜索独立单词" className="bg-card pl-9" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="搜索英文、释义或用法…" /></div>
          <div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">背诵方向</span><button className={`rounded-full px-3 py-1.5 ${direction === 'en2zh' ? 'bg-primary text-primary-foreground' : 'bg-secondary'}`} onClick={() => setDirection('en2zh')}>英 → 中</button><button className={`rounded-full px-3 py-1.5 ${direction === 'zh2en' ? 'bg-primary text-primary-foreground' : 'bg-secondary'}`} onClick={() => setDirection('zh2en')}>中 → 英</button></div>
        </div>
      )}
      {words.length === 0 ? (
        <div className="rounded-2xl border border-dashed bg-card/50 px-6 py-16 text-center"><BookOpen className="mx-auto size-8 text-primary/60" /><h3 className="font-word mt-4 text-2xl">从第一个词开始</h3><p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">手动输入英文与中文释义即可，无需联网。之后可用闪卡按到期与未学优先复习。</p><Button className="mt-5" onClick={() => setAddOpen(true)}><Plus /> 收录第一个词</Button></div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed py-12 text-center text-sm text-muted-foreground">没有找到与「{search}」匹配的单词。</div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {filtered.slice(0, limit).map((word) => {
            const status = wordStatus(word, state.stats)
            return (
              <article key={word.id} className="lift stagger-in group rounded-xl border bg-card p-4 shadow-sm">
                <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><h3 className="font-word truncate text-2xl tracking-tight">{word.text}</h3>{word.phonetic && <p className="mt-0.5 text-xs text-muted-foreground">{word.phonetic}</p>}</div><Badge className={`border-0 ${status.className}`}>{status.label}</Badge></div>
                <p className="mt-3 line-clamp-2 min-h-10 text-sm leading-relaxed">{word.gloss || '（暂无释义）'}</p>
                {word.usageNote && <p className="mt-2 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{word.usageNote}</p>}
                <div className="mt-4 flex items-center justify-between border-t pt-3"><span className="text-xs text-muted-foreground">{state.stats[word.id] ? `${state.stats[word.id].correct} 对 · ${state.stats[word.id].wrong} 错` : '等待第一次学习'}</span><Button variant="ghost" size="sm" onClick={() => setEditId(word.id)}><Pencil /> 编辑</Button></div>
              </article>
            )
          })}
        </div>
      )}
      {filtered.length > limit && <Button variant="outline" className="w-full" onClick={() => setLimit(n => n + 60)}>显示更多（已显示 {limit} / {filtered.length}）</Button>}
      <AddWordDialog open={addOpen} onOpenChange={setAddOpen} />
      {editId && <WordDialog key={editId} word={state.words[editId] ?? null} onClose={() => setEditId(null)} />}
    </div>
  )
}

function SynonymVocabulary() {
  const active = useContext(ActiveContext)
  const { state, addStudyWord, createSynonymSet, deleteSynonymSet } = useLibrary()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editing, setEditing] = useState<SynonymSet | null | 'new'>(null)
  const [deleting, setDeleting] = useState<SynonymSet | null>(null)
  const [editWordId, setEditWordId] = useState<string | null>(null)
  const [study, setStudy] = useState(false)
  const [direction, setDirection] = useState<Direction>('en2zh')
  const [candidateWord, setCandidateWord] = useState('')
  const sets = Object.values(state.synonymSets) as SynonymSet[]
  const selected = selectedId ? state.synonymSets[selectedId] as SynonymSet | undefined : undefined

  function loadExamples() {
    for (const example of EXAMPLES) {
      if (sets.some((set) => set.name === example.name)) continue
      const ids = example.words.map((word) => addStudyWord({ ...word, meanings: [{ pos: 'adj.', en: '', zh: word.gloss }], source: 'manual' as const }).wordId)
      createSynonymSet(example.name, ids, example.notes)
    }
    toast.success('示例近义词群已载入', { description: '示例内容仅作学习演示，可自由编辑。' })
  }

  if (study && selected) return <Flashcards wordIds={selected.wordIds.filter((id) => state.words[id])} title={selected.name} direction={direction} onExit={() => setStudy(false)} />

  if (selected) {
    const words = selected.wordIds.map((id) => state.words[id]).filter((word): word is Word => !!word)
    return (
      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2"><Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}><ArrowLeft /> 全部词群</Button><span className="text-muted-foreground">/</span><span className="text-sm text-muted-foreground">{words.length} 个成员</span><div className="ml-auto flex gap-2"><Button variant="outline" size="sm" onClick={() => setEditing(selected)}><Pencil /> 编辑词群</Button><Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleting(selected)}><Trash2 /> 删除关系</Button></div></div>
        <header className="rounded-2xl border bg-card p-5 shadow-sm sm:p-7"><Badge variant="secondary">近义词辨析</Badge><h2 className="font-word mt-3 text-3xl sm:text-4xl">{selected.name}</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-muted-foreground">{selected.notes || '尚未添加辨析笔记。点击「编辑词群」，记下这些词在语气、搭配与场景上的区别。'}</p><div className="mt-5 flex flex-col gap-3 border-t pt-5 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2 text-sm"><span className="text-muted-foreground">闪卡方向</span><button className={`rounded-full px-3 py-1.5 ${direction === 'en2zh' ? 'bg-primary text-primary-foreground' : 'bg-secondary'}`} onClick={() => setDirection('en2zh')}>英 → 中</button><button className={`rounded-full px-3 py-1.5 ${direction === 'zh2en' ? 'bg-primary text-primary-foreground' : 'bg-secondary'}`} onClick={() => setDirection('zh2en')}>中 → 英</button></div><Button disabled={words.length < 2} onClick={() => setStudy(true)}>读完对照，开始背诵 <ChevronRight /></Button></div></header>
        <div className="grid gap-3 md:grid-cols-2">
          {words.map((word, index) => <article key={word.id} className="stagger-in rounded-xl border bg-card p-5 shadow-sm"><div className="flex items-baseline gap-3"><span className="font-word text-sm text-primary">{String(index + 1).padStart(2, '0')}</span><h3 className="font-word text-3xl">{word.text}</h3>{word.phonetic && <span className="text-xs text-muted-foreground">{word.phonetic}</span>}</div><p className="mt-3 font-medium">{word.gloss}</p>{word.usageNote && <p className="mt-3 text-sm leading-6 text-muted-foreground"><span className="mr-2 text-primary">辨析</span>{word.usageNote}</p>}{word.example && <p className="font-word mt-3 border-l-2 border-primary/25 pl-3 italic leading-6 text-muted-foreground">{word.example}</p>}<Button variant="ghost" size="sm" className="mt-3" onClick={() => setEditWordId(word.id)}><Pencil /> 编辑词条</Button></article>)}
        </div>
        {editWordId && <WordDialog key={editWordId} word={state.words[editWordId] ?? null} onClose={() => setEditWordId(null)} />}
        {editing && <SynonymEditor set={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
        <AlertDialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>删除「{deleting?.name}」词群？</AlertDialogTitle><AlertDialogDescription>只删除词之间的近义词关系，所有单词及其学习记录都会保留在词库中。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction className="bg-destructive text-white hover:bg-destructive/90" onClick={() => { if (deleting) deleteSynonymSet(deleting.id); setDeleting(null); setSelectedId(null); toast.success('词群关系已删除，单词仍保留') }}>删除词群</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-word text-2xl">近义词，成群记</h2><p className="mt-1 text-sm text-muted-foreground">先比较细微差别，再用主动回忆把它们分清楚。</p></div><Button onClick={() => setEditing('new')}><Layers3 /> 新建词群</Button></div>
      <SynonymSuggestions active={active} onCreated={setSelectedId} onAdd={setCandidateWord} />
      <AddWordDialog open={!!candidateWord} initialText={candidateWord} onOpenChange={open => { if (!open) setCandidateWord('') }} />
      {sets.length === 0 ? <div className="rounded-2xl border border-dashed bg-card/50 px-6 py-16 text-center"><Layers3 className="mx-auto size-8 text-primary/60" /><h3 className="font-word mt-4 text-2xl">让词与词发生联系</h3><p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">可在上方查找候选，按目标词义选择并确认；也可以从现有词库手动选词建群。</p><div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row"><Button onClick={() => setEditing('new')}><Plus /> 创建词群</Button><Button variant="outline" onClick={loadExamples}><Sparkles /> 载入示例词群</Button></div><p className="mt-3 text-xs text-muted-foreground">示例：big / large / huge，含英文例句与区别，可编辑。</p></div> : <><div className="flex justify-end"><Button variant="ghost" size="sm" onClick={loadExamples}><Sparkles /> 载入示例</Button></div><div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{sets.sort((a, b) => b.createdAt - a.createdAt).map((set) => { const words = set.wordIds.map((id) => state.words[id]).filter((word): word is Word => !!word); return <button key={set.id} className="lift stagger-in rounded-2xl border bg-card p-5 text-left shadow-sm focus-visible:ring-2" onClick={() => setSelectedId(set.id)}><div className="flex items-center justify-between"><Badge variant="secondary">{words.length} 个词</Badge><ChevronRight className="size-4 text-muted-foreground" /></div><h3 className="font-word mt-4 text-2xl">{set.name}</h3><p className="font-word mt-3 text-lg text-primary">{words.map((word) => word.text).join(' · ')}</p><p className="mt-3 line-clamp-2 min-h-10 text-sm leading-5 text-muted-foreground">{set.notes || '查看词义、用法与辨析笔记'}</p></button>})}</div></>}
      {editing && <SynonymEditor set={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  )
}

export default function Vocabulary({ mode, active = true }: { mode: Mode; active?: boolean }) {
  return <ActiveContext.Provider value={active}><div className="vocabulary-section">{mode === 'single' ? <SingleVocabulary /> : <SynonymVocabulary />}</div></ActiveContext.Provider>
}
