import {rateMastery} from '@/lib/memorySchedule'
import { useContext, useEffect, useMemo, useRef, useState, type DragEvent as ReactDragEvent, type PointerEvent as ReactPointerEvent } from 'react'
import {
  ChevronDown,
  CircleMinus,
  Menu,
  Plus,
  Search,
  ShieldAlert,
  Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import {GuidedTourContext} from '@/lib/tutorial'
import { useLibrary } from '@/store/library'
import { saveGroup, setGroupKind } from '@/lib/grouping'
import { groupTitle, userNotes } from '@/lib/groupNames'
import type { GroupKind, GroupRef, LibraryState, Word, WordMeaning } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import ConfirmManagement from '@/sections/ConfirmManagement'
import MasteryControl from '@/sections/MasteryControl'
import CollapsibleGloss from '@/sections/CollapsibleGloss'
import { cn } from '@/lib/utils'
import './management-editor.css'

export type ManagementEditorTarget = GroupRef | { kind: GroupKind; id?: undefined }

export interface ManagementEditorProps {
  target: ManagementEditorTarget
  onClose: () => void
  focusWordId?: string
}

type WordField = 'gloss' | 'phonetic' | 'meanings' | 'usageNote' | 'example'
type WordEdit = Record<WordField, string>
type GroupRecord = { id: string; name?: string; notes?: string; wordIds: string[]; pendingTypeChoice?: boolean }

interface EditorDraft {
  name: string
  notes: string
  kind: GroupKind
  ids: string[]
  edits: Record<string, WordEdit>
  mastery: Record<string, number>
}

const KIND_ORDER: GroupKind[] = ['shape', 'synonym', 'custom']

const KIND_META: Record<GroupKind, { label: string; description: string; badge: string; dot: string }> = {
  shape: {
    label: '形近组',
    description: '拼写或读音相近，容易混淆',
    badge: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200',
    dot: 'bg-blue-500',
  },
  synonym: {
    label: '近义组',
    description: '意思相近，需要辨析用法',
    badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200',
    dot: 'bg-emerald-600',
  },
  custom: {
    label: '自定义组',
    description: '按你自己的主题归在一起',
    badge: 'bg-stone-200 text-stone-700 dark:bg-stone-800 dark:text-stone-200',
    dot: 'bg-stone-500',
  },
}

const ISOLATED_BADGE = 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200'

function readGroup(state: LibraryState, target: ManagementEditorTarget): GroupRecord | undefined {
  if (!target.id || target.kind === 'isolated') return undefined
  if (target.kind === 'shape') return state.groups[target.id] as GroupRecord | undefined
  if (target.kind === 'synonym') return state.synonymSets[target.id] as GroupRecord | undefined
  return state.customSets?.[target.id] as GroupRecord | undefined
}

function safeGroupTitle(state: LibraryState, ref: GroupRef): string {
  try {
    return groupTitle(state, ref)
  } catch {
    if (ref.kind === 'isolated') return state.words[ref.id]?.text ?? '独立单词'
    const group = readGroup(state, ref)
    return group?.name?.trim() || `${KIND_META[ref.kind].label} · ${group?.wordIds.map(id => state.words[id]?.text).filter(Boolean).join(' / ') || '未命名'}`
  }
}

function membershipsOf(state: LibraryState, wordId: string): GroupKind[] {
  const found: GroupKind[] = []
  if (Object.values(state.groups).some(group => group.wordIds.length > 1 && group.wordIds.includes(wordId))) found.push('shape')
  if (Object.values(state.synonymSets).some(group => group.wordIds.includes(wordId))) found.push('synonym')
  if (Object.values(state.customSets ?? {}).some(group => group.wordIds.includes(wordId))) found.push('custom')
  return found
}

function clampLevel(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(5, Math.round(value)))
}

function meaningsText(word: Word): string { return JSON.stringify(word.meanings) }
function parseMeanings(text:string):WordMeaning[] {
  try { const value=JSON.parse(text) as WordMeaning[];return Array.isArray(value)?value:[] } catch {return []}
}

function WordRowMenu({
  word,
  groupLabel,
  canRemove,
  onRemove,
  onDelete,
}: {
  word: Word
  groupLabel: string
  canRemove: boolean
  onRemove: (word: Word) => (() => void) | void
  onDelete: (word: Word) => (() => void) | void
}) {
  const [open, setOpen] = useState(false)
  const [pending, setPending] = useState<'remove' | 'delete' | null>(null)
  const [busy, setBusy] = useState(false)
  const removeTitle = `从${groupLabel}移出「${word.text}」？`
  const deleteTitle = `删除「${word.text}」？`
  const title = pending === 'delete' ? deleteTitle : removeTitle
  const description = pending === 'delete'
    ? '单词、笔记、学习记录和它在所有关系组中的成员身份都会被删除。可在提示中撤销。'
    : '只解除这一个词与本组的关系；单词、笔记和学习记录都会保留。可在提示中撤销。'

  function finish() {
    if (!pending || busy) return
    setBusy(true)
    try {
      const undo = pending === 'remove' ? onRemove(word) : onDelete(word)
      setOpen(false)
      setPending(null)
      toast.success('操作已完成', {
        description: title,
        duration: 10000,
        action: undo
          ? {
              label: '撤销',
              onClick: () => {
                try { undo() } catch (error) {
                  toast.error(error instanceof Error ? error.message : '无法撤销，当前数据已保留')
                }
              },
            }
          : undefined,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作未完成')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={next => { if (!busy) { setOpen(next); if (!next) setPending(null) } }}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          className="shrink-0 text-muted-foreground hover:text-foreground"
          aria-label={`管理「${word.text}」的成员操作`}
          title="移出或删除"
        >
          <CircleMinus />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-1.5">
        {pending ? (
          <div className="p-1.5">
            <p className="break-words text-sm font-medium">{title}</p>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">{description}</p>
            <div className="mt-3 flex justify-end gap-2">
              <Button type="button" size="sm" variant="outline" onClick={() => setPending(null)} disabled={busy}>取消</Button>
              <Button type="button" size="sm" variant="destructive" onClick={finish} disabled={busy}>
                {pending === 'remove' ? '移出本组' : '删除单词'}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="px-2 pb-1.5 pt-1 text-[11px] font-medium text-muted-foreground">「{word.text}」的成员操作</p>
            <Button
              type="button"
              variant="ghost"
              className="h-auto w-full justify-start whitespace-normal rounded-md px-2 py-2 text-left"
              disabled={!canRemove}
              onClick={() => setPending('remove')}
            >
              <CircleMinus />
              <span className="min-w-0">
                <span className="block text-sm font-medium">移出本组</span>
                <span className="block text-xs font-normal text-muted-foreground">保留单词与学习记录</span>
              </span>
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="mt-1 h-auto w-full justify-start whitespace-normal rounded-md px-2 py-2 text-left text-destructive hover:text-destructive"
              onClick={() => setPending('delete')}
            >
              <Trash2 />
              <span className="min-w-0">
                <span className="block text-sm font-medium">删除单词</span>
                <span className="block text-xs font-normal text-muted-foreground">同时删除学习记录与全部关系</span>
              </span>
            </Button>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

/**
 * Single management workspace for one isolated word or one relation group.
 * Group metadata, membership, ordering and every word field are edited here;
 * there is no nested word dialog. Destructive membership actions confirm and
 * return an undo snackbar. Top-level Save commits everything in one transaction.
 */
export default function ManagementEditor({ target, onClose, focusWordId }: ManagementEditorProps) {
  const guided = useContext(GuidedTourContext)
  const { state, managementTransaction, deleteManaged } = useLibrary()

  const [initialGroup] = useState(() => readGroup(state,target))
  const anchorWord = target.kind === 'isolated' && target.id ? state.words[target.id] : undefined
  const [initial] = useState<EditorDraft>(() => ({
    name: initialGroup && target.id ? safeGroupTitle(state,{kind:target.kind as GroupKind,id:target.id}).replace(/^(?:形近组|近义组|自定义组)\s*·\s*/,'') : '',
    notes: userNotes(initialGroup?.notes ?? ''),
    kind: target.kind === 'isolated' ? 'custom' : target.kind,
    ids: (initialGroup?.wordIds ?? (target.kind === 'isolated' && target.id ? [target.id] : [])).filter(id => !!state.words[id]),
    edits: {},
    mastery: {},
  }))

  const [baseline,setBaseline] = useState(initial)
  const [draft, setDraft] = useState<EditorDraft>(initial)
  const [kindTouched,setKindTouched] = useState(false)
  const [query, setQuery] = useState('')
  const [addOpen, setAddOpen] = useState(() => !target.id)
  const [expandedId, setExpandedId] = useState<string | null>(focusWordId ?? (target.kind==='isolated'?target.id:null))
  const [discardOpen, setDiscardOpen] = useState(false)
  const [announce, setAnnounce] = useState('')
  const [armedId, setArmedId] = useState<string | null>(null)
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)

  const pressTimer = useRef<number | null>(null)
  const pressPointerType = useRef<string>('mouse')
  const armedRef = useRef<string | null>(null)
  const draggingRef = useRef(false)
  const dragSourceRef = useRef<string | null>(null)
  const touchDragRef = useRef<{ source: string; over: string | null; after: boolean } | null>(null)
  const hadSourceRef = useRef(!!initialGroup)
  const ownMembershipChange = useRef(false)

  const sourceGroup = readGroup(state, target)
  const anchorMissing = target.kind === 'isolated' && !!target.id && !state.words[target.id]
  const sourceMissing = anchorMissing || (hadSourceRef.current && target.kind !== 'isolated' && !sourceGroup && !ownMembershipChange.current)

  const selectedWords = draft.ids.map(id => state.words[id]).filter((word): word is Word => !!word)
  const selectedSet = useMemo(()=>new Set(draft.ids),[draft.ids])
  const kindChanged = target.kind !== 'isolated' && !!target.id && draft.kind !== target.kind
  const groupLabel = target.kind === 'isolated'
    ? `「${anchorWord?.text ?? '该单词'}」`
    : sourceMissing
      ? '该关系组'
      : initialGroup
        ? `「${safeGroupTitle(state, { kind: target.kind as GroupKind, id: target.id as string })}」`
        : `「${draft.name.trim() || KIND_META[draft.kind].label}」`

  const singleWorkspace=draft.ids.length===1 && (target.kind==='isolated'||ownMembershipChange.current)
  const headerTitle = singleWorkspace ? `管理「${state.words[draft.ids[0]]?.text??'单词'}」` : sourceMissing
    ? '关系已不存在'
    : initialGroup
      ? safeGroupTitle(state, { kind: target.kind as GroupKind, id: target.id as string })
      : target.kind === 'isolated'
        ? `管理「${anchorWord?.text ?? '单词'}」`
        : `新建${KIND_META[draft.kind].label}`

  const dirty = draft.name.trim() !== baseline.name.trim() ||
    draft.notes !== baseline.notes ||
    draft.kind !== baseline.kind ||
    draft.ids.join('\u0000') !== baseline.ids.join('\u0000') ||
    Object.keys(draft.edits).length > 0 ||
    Object.keys(draft.mastery).length > 0

  const candidates = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return Object.values(state.words)
      .filter(word => !selectedSet.has(word.id))
      .filter(word => !needle || `${word.text} ${word.gloss} ${word.phonetic ?? ''}`.toLocaleLowerCase().includes(needle))
      .sort((a, b) => a.text.localeCompare(b.text, undefined, { sensitivity: 'base' }))
      .slice(0, 80)
  }, [state.words, query, selectedSet])

  // Live deletions and external edits: never leave a ghost row in the draft.
  useEffect(() => {
    setDraft(current => {
      const ids = current.ids.filter(id => !!state.words[id])
      if (ids.length === current.ids.length) return current
      const edits = { ...current.edits }
      const mastery = { ...current.mastery }
      for (const id of current.ids) {
        if (state.words[id]) continue
        delete edits[id]
        delete mastery[id]
      }
      return { ...current, ids, edits, mastery }
    })
  }, [state.words])

  useEffect(() => {
    if (!dirty || guided) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty, guided])

  useEffect(() => () => {
    if (pressTimer.current !== null) window.clearTimeout(pressTimer.current)
  }, [])

  function requestClose() {
    if (dirty && !guided) setDiscardOpen(true)
    else onClose()
  }

  function addMember(word: Word) {
    if (selectedSet.has(word.id)) return
    setDraft(current => current.ids.includes(word.id) ? current : { ...current, ids: [...current.ids, word.id] })
    setAnnounce(`已添加「${word.text}」，当前第 ${draft.ids.length + 1} 个`)
  }

  function updateWordEdit(word: Word, field: WordField, value: string) {
    setDraft(current => {
      const existing = current.edits[word.id] ?? {
        gloss: word.gloss,
        phonetic: word.phonetic ?? '',
        meanings: meaningsText(word),
        usageNote: word.usageNote ?? '',
        example: word.example ?? '',
      }
      return { ...current, edits: { ...current.edits, [word.id]: { ...existing, [field]: value } } }
    })
  }

  function editValue(word: Word, field: WordField): string {
    const edit = draft.edits[word.id]
    if (edit) return edit[field]
    if (field === 'gloss') return word.gloss
    if (field === 'meanings') return meaningsText(word)
    return word[field] ?? ''
  }

  function announceOrder(ids: string[]) {
    const names = ids.map(id => state.words[id]?.text).filter(Boolean)
    setAnnounce(`顺序已更新：${names.join('、')}`)
  }

  function moveBy(wordId: string, direction: -1 | 1) {
    const from = draft.ids.indexOf(wordId)
    const to = from + direction
    if (from < 0 || to < 0 || to >= draft.ids.length) {
      if (from >= 0) setAnnounce(direction < 0 ? '已经是第一位' : '已经是最后一位')
      return
    }
    const ids = [...draft.ids]
    ;[ids[from], ids[to]] = [ids[to], ids[from]]
    setDraft(current => ({ ...current, ids }))
    announceOrder(ids)
  }

  function reorderTo(sourceId: string, insertIndex: number) {
    const from = draft.ids.indexOf(sourceId)
    if (from < 0) return
    let to = insertIndex
    if (from < to) to -= 1
    to = Math.max(0, Math.min(draft.ids.length - 1, to))
    if (to === from) {
      setAnnounce('顺序未改变')
      return
    }
    const ids = [...draft.ids]
    ids.splice(from, 1)
    ids.splice(to, 0, sourceId)
    setDraft(current => ({ ...current, ids }))
    announceOrder(ids)
  }

  function clearPressTimer() {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current)
      pressTimer.current = null
    }
  }

  function startPress(word: Word, pointerType: string) {
    clearPressTimer()
    pressPointerType.current = pointerType
    pressTimer.current = window.setTimeout(() => {
      armedRef.current = word.id
      setArmedId(word.id)
      if (pointerType !== 'mouse') {
        touchDragRef.current = { source: word.id, over: null, after: false }
      }
      setAnnounce(`已按住「${word.text}」。拖动可排序，按上下方向键也可以调整顺序。`)
    }, 250)
  }

  function endPress() {
    clearPressTimer()
    if (!draggingRef.current) {
      armedRef.current = null
      setArmedId(null)
    }
  }

  function pointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (pressPointerType.current === 'mouse' || !touchDragRef.current) return
    const element = document.elementFromPoint(event.clientX, event.clientY)
    const row = element?.closest<HTMLElement>('[data-editor-row-id]')
    if (!row) return
    const id = row.dataset.editorRowId ?? null
    if (!id) return
    const rect = row.getBoundingClientRect()
    touchDragRef.current = { ...touchDragRef.current, over: id, after: event.clientY > rect.top + rect.height / 2 }
    setOverId(id)
  }

  function pointerUp() {
    const touchDrag = touchDragRef.current
    clearPressTimer()
    if (touchDrag?.over) {
      const targetIndex = draft.ids.indexOf(touchDrag.over) + (touchDrag.after ? 1 : 0)
      if (targetIndex >= 0) reorderTo(touchDrag.source, targetIndex)
    }
    touchDragRef.current = null
    setOverId(null)
    if (!draggingRef.current) {
      armedRef.current = null
      setArmedId(null)
    }
  }

  function dragStart(event: ReactDragEvent<HTMLButtonElement>, word: Word) {
    if (armedRef.current !== word.id) {
      event.preventDefault()
      return
    }
    draggingRef.current = true
    dragSourceRef.current = word.id
    setDraggingId(word.id)
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', word.id)
  }

  function dragEnd() {
    draggingRef.current = false
    armedRef.current = null
    dragSourceRef.current = null
    setDraggingId(null)
    setOverId(null)
    setArmedId(null)
  }

  function dropOn(event: ReactDragEvent<HTMLLIElement>, word: Word) {
    event.preventDefault()
    const source = dragSourceRef.current ?? draggingId ?? armedId
    if (!source) return
    const rect = event.currentTarget.getBoundingClientRect()
    const after = event.clientY > rect.top + rect.height / 2
    const insertIndex = draft.ids.indexOf(word.id) + (after ? 1 : 0)
    reorderTo(source, insertIndex)
    draggingRef.current = false
    armedRef.current = null
    dragSourceRef.current = null
    setDraggingId(null)
    setOverId(null)
    setArmedId(null)
  }

  function save() {
    if (sourceMissing) {
      toast.error('该关系已不存在，无法保存', { description: '请关闭工作区，回到管理页刷新后再试。' })
      return
    }
    const single = draft.ids.length === 1 && (target.kind === 'isolated' || ownMembershipChange.current)
    if (draft.ids.length < 2 && !single) {
      toast.error('至少保留两个单词', { description: '关系组需要两个或更多成员；可以继续添加单词。' })
      setAddOpen(true)
      return
    }
    const blankGloss = draft.ids.find(id => draft.edits[id] && !draft.edits[id].gloss.trim())
    if (blankGloss) {
      const blankWord = state.words[blankGloss]
      setExpandedId(blankGloss)
      toast.error('中文释义不能为空', { description: `请补充「${blankWord?.text ?? '该单词'}」的释义，或撤销这次修改。` })
      return
    }

    let savedRef: GroupRef | undefined
    try {
      const undo = managementTransaction(transactionDraft => {
        let ref: GroupRef | { kind: GroupKind; id?: undefined }
        if (target.kind === 'isolated') {
          if (!target.id) throw new Error('这个单词已不存在')
          ref = { kind: 'isolated', id: target.id }
        } else if (target.id && !(ownMembershipChange.current && !readGroup(transactionDraft,target))) {
          ref = { kind: target.kind, id: target.id }
          if (draft.kind !== target.kind || (initialGroup?.pendingTypeChoice && kindTouched)) {
            ref = setGroupKind(transactionDraft, ref, draft.kind)
          }
        } else {
          ref = { kind: draft.kind }
        }

        const result: GroupRef = single ? {kind:'isolated',id:draft.ids[0]} : saveGroup(transactionDraft, ref, {
          name: draft.name.trim(),
          notes: draft.notes.trim(),
          wordIds: [...draft.ids],
        })
        savedRef = result

        if (target.kind === 'isolated' && !single) {
          const provisional = readGroup(transactionDraft, result)
          if (result.kind !== draft.kind || provisional?.pendingTypeChoice) {
            savedRef = setGroupKind(transactionDraft, result, draft.kind)
          }
        }

        for (const [wordId, edit] of Object.entries(draft.edits)) {
          const word = transactionDraft.words[wordId]
          if (!word) continue
          word.gloss = edit.gloss.trim()
          word.phonetic = edit.phonetic.trim()
          word.meanings = parseMeanings(edit.meanings)
          word.usageNote = edit.usageNote.trim()
          word.example = edit.example.trim()
        }

        const now = Date.now()
        for (const [wordId, level] of Object.entries(draft.mastery)) {
          if (!transactionDraft.words[wordId]) continue
          const previous = transactionDraft.stats[wordId] ?? { correct: 0, wrong: 0, level: 0 }
          const safeLevel = clampLevel(level)
          transactionDraft.stats[wordId] = rateMastery(previous,safeLevel,now)
        }
      })
      toast.success(single ? '词条已保存' : '更改已保存', {duration:10000,action:{label:'撤销',onClick:undo}})
    } catch (error) {
      toast.error('更改未保存', { description: error instanceof Error ? error.message : '请检查数据后重试。' })
      return
    }

    if (!savedRef) {
      toast.error('更改未保存')
      return
    }
    onClose()
  }

  function restoreLocalMember(wordId: string, index: number) {
    const originalIndex=initial.ids.indexOf(wordId)
    if(originalIndex>=0)setBaseline(current=>current.ids.includes(wordId)?current:({...current,ids:[...current.ids.slice(0,originalIndex),wordId,...current.ids.slice(originalIndex)]}))
    setDraft(current => {
      if (current.ids.includes(wordId)) return current
      const ids = [...current.ids]
      ids.splice(Math.max(0, Math.min(index, ids.length)), 0, wordId)
      return { ...current, ids }
    })
  }

  function removeMember(word: Word): (() => void) | void {
    const index = draft.ids.indexOf(word.id)
    const restore = () => restoreLocalMember(word.id, index)
    if (target.kind === 'isolated' || !target.id) {
      setDraft(current => ({ ...current, ids: current.ids.filter(id => id !== word.id) }))
      setAnnounce(`已从本组暂存移除「${word.text}」，保存前尚未写入。`)
      return restore
    }
    const sourceKind = target.kind
    const sourceId = target.id
    const undo = managementTransaction(transactionDraft => {
      if (sourceKind === 'shape') {
        const group = transactionDraft.groups[sourceId]
        if (!group) throw new Error('形近组已不存在，请关闭后重试')
        group.wordIds = group.wordIds.filter(id => id !== word.id)
      } else if (sourceKind === 'synonym') {
        const group = transactionDraft.synonymSets[sourceId]
        if (!group) throw new Error('近义组已不存在，请关闭后重试')
        group.wordIds = group.wordIds.filter(id => id !== word.id)
      } else {
        transactionDraft.customSets ??= {}
        const group = transactionDraft.customSets[sourceId]
        if (!group) throw new Error('自定义组已不存在，请关闭后重试')
        group.wordIds = group.wordIds.filter(id => id !== word.id)
      }
    })
    ownMembershipChange.current = true
    setBaseline(current=>({...current,ids:current.ids.filter(id=>id!==word.id)}))
    setDraft(current => ({ ...current, ids: current.ids.filter(id => id !== word.id) }))
    setAnnounce(`已把「${word.text}」移出本组，可在提示中撤销。`)
    return () => { undo(); restore() }
  }

  function deleteWord(word: Word): (() => void) | void {
    const index = draft.ids.indexOf(word.id)
    const closing = (target.kind === 'isolated' && target.id === word.id) || draft.ids.length <= 1
    const undo = deleteManaged('word', word.id)
    ownMembershipChange.current = true
    setBaseline(current=>({...current,ids:current.ids.filter(id=>id!==word.id)}))
    if (closing) {
      onClose()
      return undo
    }
    setDraft(current => {
      const edits = { ...current.edits }
      const mastery = { ...current.mastery }
      delete edits[word.id]
      delete mastery[word.id]
      return { ...current, ids: current.ids.filter(id => id !== word.id), edits, mastery }
    })
    setAnnounce(`已删除「${word.text}」，可在提示中撤销。`)
    return () => { undo(); restoreLocalMember(word.id, index) }
  }

  function dissolve(): (() => void) | void {
    const kind = target.kind
    if (kind === 'isolated' || !target.id) return
    const undo = deleteManaged(kind, target.id)
    onClose()
    return undo
  }

  const kindHint = kindChanged
    ? `保存后会把本组转换为${KIND_META[draft.kind].label}。成员、学习记录和你的笔记都会保留。`
    : initialGroup?.pendingTypeChoice
      ? '这组由合并产生，类型尚未确定。选择一种类型并保存即可确定。'
      : target.kind === 'isolated'
        ? '选择一种关系类型，再添加至少一个单词，保存后即可成组。'
        : null

  return (
    <>
      <Dialog open onOpenChange={open => { if (!open) requestClose() }}>
        <DialogContent onInteractOutside={event=>{if((event.target as HTMLElement)?.closest?.('[data-sonner-toast]'))event.preventDefault()}} className="management-editor-dialog flex max-h-[92vh] w-full max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-3xl">
          <DialogHeader className="border-b px-5 pb-4 pr-12 pt-5 sm:pl-6 sm:pr-12">
            <DialogTitle className="min-w-0 break-words font-word text-2xl font-medium">{headerTitle}</DialogTitle>
            <DialogDescription className="leading-6">
              编辑词条、熟练度和分组。完成后保存修改。
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
            {sourceMissing && (
              <div role="alert" className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium">关系或单词已不存在</p>
                  <p className="mt-1 text-muted-foreground">它可能已在其他位置被删除或解散。请关闭后重新打开。</p>
                </div>
                <Button type="button" size="sm" variant="outline" onClick={onClose}>关闭</Button>
              </div>
            )}

            <section className="space-y-4" aria-label="关系组信息" hidden={singleWorkspace}>
              <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                <label className="block min-w-0 space-y-2 text-sm font-medium">
                  组名 <span className="font-normal text-muted-foreground">（可选）</span>
                  <Input
                    value={draft.name}
                    onChange={event => setDraft(current => ({ ...current, name: event.target.value }))}
                    placeholder={initialGroup ? safeGroupTitle(state, { kind: target.kind as GroupKind, id: target.id! }) : '例如：容易混淆的 -ceive 词族'}
                    disabled={sourceMissing}
                  />
                </label>
                <label className="block min-w-0 space-y-2 text-sm font-medium">
                  辨析 / 记忆笔记 <span className="font-normal text-muted-foreground">（可选）</span>
                  <Textarea
                    value={draft.notes}
                    onChange={event => setDraft(current => ({ ...current, notes: event.target.value }))}
                    placeholder="只记录你自己的辨析、搭配或记忆提示"
                    rows={2}
                    disabled={sourceMissing}
                  />
                </label>
              </div>

              <div>
                <p className="mb-2 text-sm font-medium">关系类型</p>
                <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label="关系类型">
                  {KIND_ORDER.map(kind => {
                    const active = draft.kind === kind
                    return (
                      <button
                        key={kind}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        disabled={sourceMissing}
                        onClick={() => {
                          setKindTouched(true)
                          setDraft(current => ({ ...current, kind }))
                          setAnnounce(`类型将保存为${KIND_META[kind].label}`)
                        }}
                        className={cn('management-kind-option min-w-0', active && 'is-selected')}
                      >
                        <span className="flex items-center gap-2">
                          <span className={cn('size-2 shrink-0 rounded-full', KIND_META[kind].dot)} aria-hidden="true" />
                          <span className="text-sm font-medium">{KIND_META[kind].label}</span>
                        </span>
                        <span className="mt-1 block text-left text-[11px] leading-4 text-muted-foreground">{KIND_META[kind].description}</span>
                      </button>
                    )
                  })}
                </div>
                {kindHint && <p className="mt-2 text-xs leading-5 text-muted-foreground">{kindHint}</p>}
              </div>
            </section>

            <section className="management-editor-section min-w-0 overflow-hidden rounded-xl border" aria-label="成员与排序">
              <div className="flex flex-wrap items-center gap-3 px-3 py-3">
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-semibold">成员 · {selectedWords.length} 个单词</h3>
                  <p className="mt-0.5 text-xs text-muted-foreground">长按手柄拖动排序，也可聚焦手柄后使用上下方向键。</p>
                </div>
                <Button type="button" size="sm" variant={addOpen ? 'secondary' : 'outline'} onClick={() => setAddOpen(open => !open)} disabled={sourceMissing} aria-expanded={addOpen}>
                  <Plus />{addOpen ? '收起添加' : '添加成员'}
                </Button>
              </div>

              {addOpen && !sourceMissing && (
                <div className="space-y-2 border-t bg-muted/25 p-3">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={query}
                      onChange={event => setQuery(event.target.value)}
                      placeholder="搜索英文、音标或释义…"
                      aria-label="搜索可添加的单词"
                      className="min-w-0 pl-8"
                    />
                  </div>
                  <div className="max-h-56 overflow-y-auto rounded-lg border bg-background">
                    {candidates.length === 0 ? (
                      <p className="px-3 py-5 text-center text-sm text-muted-foreground">{query.trim() ? '没有匹配的单词' : '所有单词都已在本组中'}</p>
                    ) : candidates.map(word => {
                      const memberships = membershipsOf(state, word.id)
                      return (
                        <div key={word.id} className="flex min-w-0 items-center gap-2 border-b px-2.5 py-2 last:border-b-0">
                          <div className="min-w-0 flex-1">
                            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                              <span className="min-w-0 truncate font-word text-base">{word.text}</span>
                              {word.phonetic && <span className="min-w-0 truncate text-[11px] text-muted-foreground">{word.phonetic}</span>}
                              {memberships.length === 0
                                ? <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', ISOLATED_BADGE)}>独立单词</span>
                                : memberships.map(kind => <span key={kind} className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', KIND_META[kind].badge)}>{KIND_META[kind].label}</span>)}
                            </div>
                            <span className="mt-0.5 block min-w-0 truncate text-xs text-muted-foreground">{word.gloss || '（暂无释义）'}</span>
                          </div>
                          <Button type="button" size="sm" variant="ghost" className="shrink-0" onClick={() => addMember(word)} aria-label={`添加 ${word.text}`}>
                            <Plus />添加
                          </Button>
                        </div>
                      )
                    })}
                  </div>
                  <p className="text-[11px] leading-5 text-muted-foreground">加入其他组的词后，保存时会从原同类组移出；单词与学习记录保留。</p>
                </div>
              )}

              <ul className="divide-y border-t" aria-label="已选单词，可拖动或使用方向键排序">
                {selectedWords.length === 0 ? (
                  <li className="px-4 py-8 text-center text-sm text-muted-foreground">还没有成员。添加至少两个单词后即可保存。</li>
                ) : selectedWords.map((word, index) => {
                  const expanded = expandedId === word.id
                  const memberships = membershipsOf(state, word.id).filter(kind => kind !== draft.kind)
                  const canRemove = draft.ids.length > 1 && !(target.kind === 'isolated' && target.id === word.id)
                  return (
                    <li
                      key={word.id}
                      data-editor-row-id={word.id}
                      data-dragging={draggingId === word.id ? 'true' : 'false'}
                      data-over={overId === word.id && draggingId !== word.id ? 'true' : 'false'}
                      className="management-editor-row min-w-0"
                      aria-posinset={index + 1}
                      aria-setsize={selectedWords.length}
                      onDragOver={event => {
                        event.preventDefault()
                        event.dataTransfer.dropEffect = 'move'
                        setOverId(word.id)
                      }}
                      onDragLeave={event => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                          setOverId(current => current === word.id ? null : current)
                        }
                      }}
                      onDrop={event => dropOn(event, word)}
                    >
                      <div className="flex min-w-0 items-start gap-2 px-2 py-2.5 sm:gap-2.5 sm:px-3">
                        <button
                          type="button"
                          className="management-grip mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                          draggable
                          data-armed={armedId === word.id ? 'true' : 'false'}
                          aria-label={`长按拖动「${word.text}」排序，或按上下方向键调整`}
                          title="长按拖动；方向键也可排序"
                          onPointerDown={event => {
                            if (event.button !== 0) return
                            startPress(word, event.pointerType || 'mouse')
                          }}
                          onPointerUp={pointerUp}
                          onPointerMove={pointerMove}
                          onPointerCancel={() => { touchDragRef.current = null; armedRef.current = null; endPress(); setOverId(null) }}
                          onPointerLeave={() => { if (!armedRef.current) endPress() }}
                          onKeyDown={event => {
                            if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                              event.preventDefault()
                              moveBy(word.id, event.key === 'ArrowUp' ? -1 : 1)
                            }
                          }}
                          onDragStart={event => dragStart(event, word)}
                          onDragEnd={dragEnd}
                        >
                          <Menu className="size-4" />
                        </button>

                        <span className="mt-1 w-5 shrink-0 text-center text-[11px] tabular-nums text-muted-foreground" aria-hidden="true">{index + 1}</span>

                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="min-w-0 break-words font-word text-lg leading-7">{word.text}</span>
                            {word.phonetic && <span className="min-w-0 break-words text-xs text-muted-foreground">{word.phonetic}</span>}
                            {memberships.map(kind => <span key={kind} className={cn('rounded px-1.5 py-0.5 text-[10px] font-medium', KIND_META[kind].badge)}>也在{KIND_META[kind].label}</span>)}
                          </div>
                          <CollapsibleGloss text={editValue(word, 'gloss')} className="mt-0.5" />
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
                            <button
                              type="button"
                              className="inline-flex items-center gap-1 rounded-sm text-xs text-primary underline-offset-2 hover:underline"
                              aria-expanded={expanded}
                              aria-controls={`word-fields-${word.id}`}
                              onClick={() => setExpandedId(current => current === word.id ? null : word.id)}
                            >
                              {expanded ? '收起词条编辑' : '编辑词条'}
                              <ChevronDown className={cn('size-3.5 transition-transform duration-150', expanded && 'rotate-180')} />
                            </button>
                            <span className="text-[11px] text-muted-foreground">{draft.edits[word.id] ? '有未保存的词条修改' : '释义、音标、词典释义、用法与例句'}</span>
                          </div>
                        </div>

                        <div className="flex shrink-0 flex-col items-end gap-1">
                          <MasteryControl
                            value={draft.mastery[word.id] ?? clampLevel(state.stats[word.id]?.level ?? 0)}
                            onChange={level => setDraft(current => ({ ...current, mastery: { ...current.mastery, [word.id]: clampLevel(level) } }))}
                            label={word.text}
                          />
                          <div className="flex items-center">
                            <WordRowMenu word={word} groupLabel={groupLabel} canRemove={canRemove} onRemove={removeMember} onDelete={deleteWord} />
                          </div>
                        </div>
                      </div>

                      {expanded && (
                        <div id={`word-fields-${word.id}`} className="grid min-w-0 gap-3 border-t bg-muted/20 p-3 sm:grid-cols-2 sm:p-4">
                          <label className="grid min-w-0 gap-1.5 text-xs font-medium sm:col-span-2">
                            中文释义
                            <Textarea aria-label={`编辑 ${word.text} 的中文释义`} value={editValue(word, 'gloss')} onChange={event => updateWordEdit(word, 'gloss', event.target.value)} rows={2} />
                          </label>
                          <label className="grid min-w-0 gap-1.5 text-xs font-medium">
                            音标
                            <Input aria-label={`编辑 ${word.text} 的音标`} value={editValue(word, 'phonetic')} onChange={event => updateWordEdit(word, 'phonetic', event.target.value)} />
                          </label>
                          <label className="grid min-w-0 gap-1.5 text-xs font-medium">
                            用法笔记
                            <Textarea aria-label={`编辑 ${word.text} 的用法笔记`} value={editValue(word, 'usageNote')} onChange={event => updateWordEdit(word, 'usageNote', event.target.value)} rows={2} />
                          </label>
                          <div className="min-w-0 space-y-2 sm:col-span-2"><p className="text-xs font-medium">词典释义</p>
                            {parseMeanings(editValue(word,'meanings')).map((meaning,meaningIndex)=><div key={meaningIndex} className="grid min-w-0 gap-2 rounded-lg border bg-card p-3 sm:grid-cols-[5rem_minmax(0,1fr)]">
                              <Input aria-label={`${word.text} 第 ${meaningIndex+1} 条词性`} placeholder="词性" value={meaning.pos} onChange={event=>{const values=parseMeanings(editValue(word,'meanings'));values[meaningIndex]={...meaning,pos:event.target.value};updateWordEdit(word,'meanings',JSON.stringify(values))}}/>
                              <Textarea aria-label={`${word.text} 第 ${meaningIndex+1} 条英文释义`} placeholder="英文释义" rows={2} value={meaning.en} onChange={event=>{const values=parseMeanings(editValue(word,'meanings'));values[meaningIndex]={...meaning,en:event.target.value};updateWordEdit(word,'meanings',JSON.stringify(values))}}/>
                              <Textarea className="sm:col-span-2" aria-label={`${word.text} 第 ${meaningIndex+1} 条中文释义`} placeholder="中文释义" rows={2} value={meaning.zh??''} onChange={event=>{const values=parseMeanings(editValue(word,'meanings'));values[meaningIndex]={...meaning,zh:event.target.value};updateWordEdit(word,'meanings',JSON.stringify(values))}}/>
                              <div className="sm:col-span-2"><ConfirmManagement title="移除这条词典释义？" description="保存词条后生效，可在提示中撤销。" onConfirm={()=>{const before=editValue(word,'meanings');const values=parseMeanings(before);values.splice(meaningIndex,1);updateWordEdit(word,'meanings',JSON.stringify(values));return ()=>updateWordEdit(word,'meanings',before)}}><Button size="sm" variant="ghost">移除此条释义</Button></ConfirmManagement></div>
                            </div>)}
                            <Button size="sm" variant="outline" onClick={()=>updateWordEdit(word,'meanings',JSON.stringify([...parseMeanings(editValue(word,'meanings')),{pos:'',en:'',zh:''}]))}><Plus/>添加词典释义</Button>
                          </div>
                          <label className="grid min-w-0 gap-1.5 text-xs font-medium sm:col-span-2">
                            英文例句
                            <Textarea className="font-word" aria-label={`编辑 ${word.text} 的例句`} value={editValue(word, 'example')} onChange={event => updateWordEdit(word, 'example', event.target.value)} rows={2} />
                          </label>
                          <p className="text-[11px] leading-5 text-muted-foreground sm:col-span-2">词条修改和熟练度会随保存按钮一起保存。</p>
                        </div>
                      )}
                    </li>
                  )
                })}
              </ul>
            </section>
            <p className="sr-only" role="status" aria-live="polite">{announce}</p>
          </div>

          <DialogFooter className="gap-3 border-t bg-background px-5 py-3 sm:justify-between sm:px-6">
            <div className="min-w-0">
              {target.kind !== 'isolated' && target.id && sourceGroup && sourceGroup.wordIds.length>1 ? (
                <ConfirmManagement
                  title={`解散${groupLabel}？`}
                  description="只解除分组；单词、词条笔记和学习记录保留，分组笔记随本组移除。可在提示中撤销。"
                  confirmText="解散关系组"
                  disabled={sourceMissing}
                  onConfirm={dissolve}
                >
                  <Button type="button" size="sm" variant="ghost" className="text-destructive hover:text-destructive">
                    <Trash2 />解散关系组
                  </Button>
                </ConfirmManagement>
              ) : (
                <span className="text-xs text-muted-foreground">选择成员后保存即可成组</span>
              )}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button data-guide="editor-cancel" type="button" variant="outline" onClick={requestClose}>取消</Button>
              <Button type="button" onClick={save} disabled={sourceMissing || draft.ids.length < 1 || (draft.ids.length===1 && target.kind!=='isolated' && !ownMembershipChange.current)}>
                {singleWorkspace?'保存词条':target.kind==='isolated'?'保存并成组':initialGroup?'保存修改':'创建关系组'}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>放弃未保存的更改？</AlertDialogTitle>
            <AlertDialogDescription>
              组名、笔记、成员顺序、词条修改和熟练度都还没有保存。放弃后无法恢复。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续编辑</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={onClose}>
              放弃更改
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
