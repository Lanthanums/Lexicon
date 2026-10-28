import { useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useLibrary } from '@/store/library'
import { lookupWord } from '@/lib/dictionary'
import type { Word, WordGroup, WordMeaning } from '@/types'
import { AddWordCard } from '@/sections/AddWordCard'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
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
import { Separator } from '@/components/ui/separator'

/* ---------------- helpers ---------------- */

function fmtDate(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const sameDay = d.toDateString() === now.toDateString()
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  if (sameDay) return `今天 ${hh}:${mm}`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (d.toDateString() === yesterday.toDateString()) return `昨天 ${hh}:${mm}`
  return `${d.getMonth() + 1}月${d.getDate()}日`
}

function fmtFull(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(
    d.getMinutes(),
  ).padStart(2, '0')}`
}

function LevelDots({ level }: { level: number }) {
  return (
    <span className="inline-flex gap-0.5 align-middle">
      {Array.from({ length: 5 }).map((_, i) => (
        <span
          key={i}
          className={`inline-block size-1.5 rounded-full ${
            i < level ? 'bg-primary' : 'bg-border'
          }`}
        />
      ))}
    </span>
  )
}

/**
 * Long gloss clamped to 3 lines; a clickable "… 展开" sits at the end of
 * line 3, and the expanded text can be collapsed again.
 */
function GlossClamp({
  text,
  className,
}: {
  text: string
  className?: string
}) {
  const ref = useRef<HTMLParagraphElement>(null)
  const [overflows, setOverflows] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || expanded) return
    setOverflows(el.scrollHeight > el.clientHeight + 1)
  }, [text, expanded])

  return (
    <span className={`relative block ${className ?? ''}`}>
      <p ref={ref} className={expanded ? '' : 'line-clamp-3'}>
        {text}
      </p>
      {overflows && !expanded && (
        <button
          className="absolute bottom-0 right-0 bg-gradient-to-l from-background via-background/95 to-transparent pl-6 text-primary underline-offset-2 transition-colors duration-150 hover:underline"
          onClick={(e) => {
            e.stopPropagation()
            setExpanded(true)
          }}
        >
          … 展开
        </button>
      )}
      {overflows && expanded && (
        <button
          className="mt-0.5 text-primary underline-offset-2 transition-colors duration-150 hover:underline"
          onClick={(e) => {
            e.stopPropagation()
            setExpanded(false)
          }}
        >
          收起
        </button>
      )}
    </span>
  )
}


/* ---------------- word detail dialog ---------------- */

function WordDetailDialog({
  word,
  onClose,
}: {
  word: Word | null
  onClose: () => void
}) {
  const { updateWord, deleteWord, detachWord, resetWordStats, state } =
    useLibrary()
  const [gloss, setGloss] = useState('')
  const [editing, setEditing] = useState(false)
  const [refetching, setRefetching] = useState(false)
  const [refetchingBackup, setRefetchingBackup] = useState(false)
  /** meanings draft while the 词典释义 editor is open (null = read mode) */
  const [meaningsDraft, setMeaningsDraft] = useState<WordMeaning[] | null>(null)

  // sync when a different word opens
  const openId = word?.id
  const [lastId, setLastId] = useState<string | undefined>()
  if (openId !== lastId) {
    setLastId(openId)
    setGloss(word?.gloss ?? '')
    setEditing(false)
    setMeaningsDraft(null)
  }

  if (!word) return null
  const stats = state.stats[word.id]
  const group = state.groups[word.groupId]

  /** apply a full lookup result: gloss + dictionary meanings + phonetic */
  function applyLookup(r: { gloss: string; meanings: WordMeaning[]; phonetic?: string }, via: string) {
    if (!word) return
    updateWord(word.id, {
      gloss: r.gloss || word.gloss,
      meanings: r.meanings,
      phonetic: r.phonetic ?? word.phonetic,
    })
    setGloss(r.gloss || word.gloss)
    setMeaningsDraft(null)
    toast.success(`释义已更新${via}`, { description: r.gloss })
  }

  async function refetchGloss() {
    if (!word || refetching || refetchingBackup) return
    setRefetching(true)
    try {
      const r = await lookupWord(
        word.text,
        undefined,
        state.settings.dictProviders,
      ).catch(() => null)
      if (r) {
        applyLookup(r, '')
      } else {
        toast.info('没有获取到新的释义', { description: '可以手动编辑补充' })
      }
    } finally {
      setRefetching(false)
    }
  }

  /** re-fetch via backup channels only — skips the primary provider */
  async function refetchGlossBackup() {
    if (!word || refetching || refetchingBackup) return
    const enabled = state.settings.dictProviders.filter((p) => p.enabled)
    const backups = enabled.slice(1)
    if (backups.length === 0) {
      toast.info('没有可用的备用通道', {
        description: '可在「设置 · 查词 API」中启用更多通道',
      })
      return
    }
    setRefetchingBackup(true)
    try {
      const r = await lookupWord(word.text, undefined, backups).catch(
        () => null,
      )
      if (r) {
        applyLookup(r, '（备用通道）')
      } else {
        toast.info('备用通道没有获取到释义', {
          description: '可以手动编辑补充',
        })
      }
    } finally {
      setRefetchingBackup(false)
    }
  }

  function saveMeanings() {
    if (!word || !meaningsDraft) return
    const clean = meaningsDraft
      .map((m) => ({ pos: m.pos.trim(), en: m.en.trim(), zh: m.zh?.trim() }))
      .filter((m) => m.pos || m.en || m.zh)
    updateWord(word.id, { meanings: clean })
    setMeaningsDraft(null)
    toast.success('词典释义已更新')
  }

  return (
    <Dialog open={!!word} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-baseline gap-3">
            <span className="font-word text-3xl tracking-tight">
              {word.text}
            </span>
            {word.phonetic && (
              <span className="text-sm font-normal text-muted-foreground">
                {word.phonetic}
              </span>
            )}
          </DialogTitle>
          <DialogDescription className="sr-only">单词详情</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <Label>中文释义</Label>
              <div className="flex items-center gap-3">
                <button
                  className="text-xs text-primary underline-offset-2 hover:underline disabled:opacity-50"
                  onClick={refetchGlossBackup}
                  disabled={refetching || refetchingBackup}
                  title="跳过首选通道，用备用通道重新获取释义"
                >
                  {refetchingBackup ? '获取中…' : '用备用通道获取'}
                </button>
                <button
                  className="text-xs text-primary underline-offset-2 hover:underline disabled:opacity-50"
                  onClick={refetchGloss}
                  disabled={refetching || refetchingBackup}
                >
                  {refetching ? '获取中…' : '重新获取'}
                </button>
                {!editing ? (
                  <button
                    className="text-xs text-primary underline-offset-2 hover:underline"
                    onClick={() => setEditing(true)}
                  >
                    编辑
                  </button>
                ) : (
                  <button
                    className="text-xs text-primary underline-offset-2 hover:underline"
                    onClick={() => {
                      updateWord(word.id, { gloss: gloss.trim() || word.gloss })
                      setEditing(false)
                      toast.success('释义已更新')
                    }}
                  >
                    保存
                  </button>
                )}
              </div>
            </div>
            {editing ? (
              <Input
                value={gloss}
                onChange={(e) => setGloss(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    updateWord(word.id, { gloss: gloss.trim() || word.gloss })
                    setEditing(false)
                  }
                }}
                autoFocus
              />
            ) : (
              <GlossClamp
                text={word.gloss || '（暂无释义）'}
                className="text-base"
              />
            )}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>词典释义</Label>
              {meaningsDraft === null ? (
                <button
                  className="text-xs text-primary underline-offset-2 hover:underline"
                  onClick={() =>
                    setMeaningsDraft(
                      word.meanings.map((m) => ({ ...m })),
                    )
                  }
                >
                  编辑
                </button>
              ) : (
                <div className="flex items-center gap-3">
                  <button
                    className="text-xs text-muted-foreground underline-offset-2 hover:underline"
                    onClick={() => setMeaningsDraft(null)}
                  >
                    取消
                  </button>
                  <button
                    className="text-xs text-primary underline-offset-2 hover:underline"
                    onClick={saveMeanings}
                  >
                    保存
                  </button>
                </div>
              )}
            </div>
            {meaningsDraft === null ? (
              word.meanings.length > 0 ? (
                <ul className="space-y-2">
                  {word.meanings.map((m, i) => (
                    <li key={i} className="text-sm leading-relaxed">
                      <Badge variant="secondary" className="mr-2 font-normal">
                        {m.pos}
                      </Badge>
                      {m.zh ? (
                        <>
                          <span>{m.zh}</span>
                          {m.en && (
                            <span className="ml-1 text-muted-foreground">
                              — {m.en}
                            </span>
                          )}
                        </>
                      ) : (
                        m.en
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted-foreground">
                  （暂无词典释义，可点「编辑」手动添加）
                </p>
              )
            ) : (
              <div className="space-y-2">
                {meaningsDraft.map((m, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      value={m.pos}
                      onChange={(e) =>
                        setMeaningsDraft((d) =>
                          d!.map((x, j) =>
                            j === i ? { ...x, pos: e.target.value } : x,
                          ),
                        )
                      }
                      placeholder="n."
                      className="h-8 w-16 shrink-0 text-xs"
                    />
                    <Input
                      value={m.zh ?? ''}
                      onChange={(e) =>
                        setMeaningsDraft((d) =>
                          d!.map((x, j) =>
                            j === i ? { ...x, zh: e.target.value } : x,
                          ),
                        )
                      }
                      placeholder="中文释义"
                      className="h-8 min-w-0 flex-1 text-sm"
                    />
                    <Input
                      value={m.en}
                      onChange={(e) =>
                        setMeaningsDraft((d) =>
                          d!.map((x, j) =>
                            j === i ? { ...x, en: e.target.value } : x,
                          ),
                        )
                      }
                      placeholder="English (可选)"
                      className="h-8 min-w-0 flex-1 text-sm"
                    />
                    <button
                      className="pressable shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-destructive"
                      aria-label="删除这条释义"
                      onClick={() =>
                        setMeaningsDraft((d) => d!.filter((_, j) => j !== i))
                      }
                    >
                      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <path d="M3 3l8 8M11 3l-8 8" />
                      </svg>
                    </button>
                  </div>
                ))}
                <button
                  className="text-xs text-primary underline-offset-2 hover:underline"
                  onClick={() =>
                    setMeaningsDraft((d) => [...(d ?? []), { pos: '', en: '', zh: '' }])
                  }
                >
                  + 添加一条
                </button>
              </div>
            )}
          </div>

          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>加入于 {fmtFull(word.addedAt)}</span>
            {stats && stats.correct + stats.wrong > 0 && (
              <>
                <span>
                  掌握度 <LevelDots level={stats.level} />
                </span>
                <span>
                  {stats.correct} 对 · {stats.wrong} 错
                </span>
              </>
            )}
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              {group && group.wordIds.length > 1 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="pressable"
                  onClick={() => {
                    detachWord(word.id)
                    toast.info(`「${word.text}」已移出分组`)
                    onClose()
                  }}
                >
                  移出分组
                </Button>
              )}
              {stats && stats.correct + stats.wrong > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="pressable"
                  onClick={() => {
                    resetWordStats(word.id)
                    toast.info(`「${word.text}」的复习记录已重置`)
                  }}
                >
                  重置复习记录
                </Button>
              )}
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="pressable text-destructive hover:text-destructive"
              onClick={() => {
                deleteWord(word.id)
                toast.info(`「${word.text}」已删除`)
                onClose()
              }}
            >
              删除单词
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/* ---------------- group detail dialog ---------------- */

function GroupDetailDialog({
  group,
  onClose,
}: {
  group: WordGroup | null
  onClose: () => void
}) {
  const { state, detachWord, resetWordStats, resetGroupStats } = useLibrary()
  if (!group) return null
  const words = group.wordIds
    .map((id) => state.words[id])
    .filter((w): w is Word => !!w)
    .sort((a, b) => a.addedAt - b.addedAt)

  return (
    <Dialog open={!!group} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>组详情 · {words.length} 词</DialogTitle>
          <DialogDescription>
            建组于 {fmtFull(group.createdAt)}
            {group.manual ? ' · 手动归组' : ''}
          </DialogDescription>
        </DialogHeader>

        <ul className="divide-y divide-border/60">
          {words.map((w) => {
            const st = state.stats[w.id]
            const seen = st && st.correct + st.wrong > 0
            return (
              <li key={w.id} className="flex items-center gap-3 py-2.5">
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline gap-2">
                    <span className="font-word text-lg font-medium">
                      {w.text}
                    </span>
                  </div>
                  <GlossClamp
                    text={w.gloss}
                    className="text-sm text-muted-foreground"
                  />
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    加入于 {fmtFull(w.addedAt)}
                    {seen && st ? (
                      <>
                        {' · '}
                        {st.correct} 对 {st.wrong} 错 · 掌握度{' '}
                        <LevelDots level={st.level} />
                        {st.lastSeen ? ` · 上次 ${fmtDate(st.lastSeen)}` : ''}
                      </>
                    ) : (
                      ' · 尚未抽查过'
                    )}
                  </div>
                </div>
                <div className="flex shrink-0 gap-1.5">
                  {words.length > 1 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="pressable h-7 px-2 text-xs"
                      onClick={() => {
                        detachWord(w.id)
                        toast.info(`「${w.text}」已移出本组`)
                      }}
                    >
                      移出本组
                    </Button>
                  )}
                  {seen && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="pressable h-7 px-2 text-xs"
                      onClick={() => {
                        resetWordStats(w.id)
                        toast.info(`「${w.text}」的复习记录已重置`)
                      }}
                    >
                      重置
                    </Button>
                  )}
                </div>
              </li>
            )
          })}
        </ul>

        <DialogFooter>
          <Button
            variant="outline"
            className="pressable"
            onClick={() => {
              resetGroupStats(group.id)
              toast.success('本组复习状况已重置')
            }}
          >
            重置全组复习状况
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/* ---------------- group cards ---------------- */

function GroupCard({
  group,
  label,
  flash,
  index,
  selecting,
  selected,
  manualFlashKey,
  learningOn,
  onManualGrouped,
  onToggleSelect,
  onOpenWord,
  onOpenGroup,
  onResetGroup,
}: {
  group: WordGroup
  label: string
  flash: boolean
  index: number
  selecting: boolean
  selected: Set<string>
  /** changes when this group just received a manual grouping action */
  manualFlashKey: number | null
  learningOn: boolean
  onManualGrouped: (groupId: string) => void
  onToggleSelect: (id: string) => void
  onOpenWord: (w: Word) => void
  onOpenGroup: (g: WordGroup) => void
  onResetGroup: (g: WordGroup) => void
}) {
  const { state, moveWordInGroup, moveWordsToGroup, deleteGroup } = useLibrary()
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  // learning tag lifecycle (total 4.5s): circle → pill+text (0.5s) →
  // retract (2.5s) → fade out (3.8s) → unmount (4.5s)
  const [showLearnTag, setShowLearnTag] = useState(false)
  const [learnExpanded, setLearnExpanded] = useState(false)
  const [learnFading, setLearnFading] = useState(false)
  useEffect(() => {
    if (!manualFlashKey) return
    setShowLearnTag(true)
    setLearnExpanded(false)
    setLearnFading(false)
    const t0 = setTimeout(() => setLearnExpanded(true), 500)
    const t1 = setTimeout(() => setLearnExpanded(false), 2500)
    const t2 = setTimeout(() => setLearnFading(true), 3800)
    const t3 = setTimeout(() => setShowLearnTag(false), 4500)
    return () => {
      clearTimeout(t0)
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [manualFlashKey])
  const words = group.wordIds
    .map((id) => state.words[id])
    .filter((w): w is Word => !!w)
  const confusable = words.length > 1
  const movableSelected = [...selected].filter(
    (id) => state.words[id] && state.words[id].groupId !== group.id,
  )

  return (
    <div
      data-group-id={group.id}
      className={`lift stagger-in rounded-xl border bg-card p-4 shadow-sm ${
        confusable ? 'border-primary/25' : ''
      } ${flash ? 'group-flash' : ''}`}
      style={{ transitionDelay: `${Math.min(index, 8) * 50}ms` }}
    >
      <div className="mb-3 flex items-center gap-2">
        {confusable ? (
          <Badge className="bg-primary/10 text-primary hover:bg-primary/10">
            {label} · {words.length}
          </Badge>
        ) : (
          <Badge variant="secondary">{label}</Badge>
        )}
        {showLearnTag && learningOn && (
          /* in-flow anchor reserves just the circle's footprint; the pill
             expands over (covers) whatever sits to its right instead of
             pushing the date / menu out of the card */
          <span className="relative z-10 size-5 shrink-0">
            <span
              title="模糊算法学习中"
              className={`absolute left-0 top-1/2 -translate-y-1/2 rounded-full bg-gradient-to-r from-fuchsia-500 via-amber-400 to-sky-500 p-[1.5px] transition-opacity duration-500 ${
                learnFading ? 'opacity-0' : 'opacity-100'
              }`}
            >
              <span
                className="flex h-5 items-center overflow-hidden rounded-full bg-card transition-[max-width] duration-300 ease-(--ease-out-strong)"
                style={{ maxWidth: learnExpanded ? 132 : 20 }}
              >
                <svg
                  className="mx-[3px] size-3 shrink-0 animate-[spin_2.5s_linear_infinite] text-fuchsia-500"
                  viewBox="0 0 12 12"
                  fill="currentColor"
                >
                  <path d="M6 0l1.4 4.6L12 6 7.4 7.4 6 12 4.6 7.4 0 6l4.6-1.4z" />
                </svg>
                <span
                  className={`whitespace-nowrap pr-2 text-[10px] leading-none text-muted-foreground transition-opacity duration-200 ${
                    learnExpanded ? 'opacity-100' : 'opacity-0'
                  }`}
                >
                  模糊算法学习中
                </span>
              </span>
            </span>
          </span>
        )}
        {selecting && movableSelected.length > 0 && (
          <Button
            size="sm"
            variant="secondary"
            className="pressable h-6 px-2 text-xs"
            onClick={() => {
              moveWordsToGroup(movableSelected, group.id)
              onManualGrouped(group.id)
              toast.success(
                `已将 ${movableSelected.length} 个词加入「${label}」`,
              )
            }}
          >
            加入选中（{movableSelected.length}）
          </Button>
        )}
        <span className="ml-auto shrink-0 whitespace-nowrap text-xs text-muted-foreground">
          {fmtDate(group.createdAt)}
        </span>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="pressable -mr-1 rounded-md p-1 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground"
              aria-label="组操作"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="currentColor"
              >
                <circle cx="3" cy="8" r="1.5" />
                <circle cx="8" cy="8" r="1.5" />
                <circle cx="13" cy="8" r="1.5" />
              </svg>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onOpenGroup(group)}>
              查看组详情
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onResetGroup(group)}>
              重置本组复习状况
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive"
              onClick={() => setConfirmingDelete(true)}
            >
              删除本组
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>删除「{label}」？</AlertDialogTitle>
              <AlertDialogDescription>
                组内的 {words.length} 个单词及其复习记录将一并删除，且无法恢复。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="pressable">取消</AlertDialogCancel>
              <AlertDialogAction
                className="pressable bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  deleteGroup(group.id)
                  toast.info(`「${label}」及其 ${words.length} 个单词已删除`)
                }}
              >
                删除本组
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {words.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
          空分组 — 用「手动归组」勾选单词后，点卡片上的「加入选中」把词放进来
        </p>
      ) : (
        <ul className="divide-y divide-border/60">
          {words.map((w, wi) => {
            const st = state.stats[w.id]
            return (
              <li key={w.id} className="flex items-center gap-3 py-2">
                {selecting && (
                  <Checkbox
                    checked={selected.has(w.id)}
                    onCheckedChange={() => onToggleSelect(w.id)}
                    aria-label={`选择 ${w.text}`}
                  />
                )}
                <button
                  className="group flex min-w-0 flex-1 items-baseline gap-3 text-left"
                  onClick={() => onOpenWord(w)}
                >
                  <span className="font-word text-lg font-medium tracking-tight underline-offset-4 group-hover:underline">
                    {w.text}
                  </span>
                  {w.phonetic && (
                    <span className="hidden text-xs text-muted-foreground sm:inline">
                      {w.phonetic}
                    </span>
                  )}
                  <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
                    {w.gloss}
                  </span>
                </button>
                {st && st.level > 0 && (
                  <span className="shrink-0" title={`掌握度 ${st.level}/5`}>
                    <LevelDots level={st.level} />
                  </span>
                )}
                {words.length > 1 && !selecting && (
                  <span className="flex shrink-0 flex-col">
                    <button
                      className="pressable rounded p-0.5 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                      disabled={wi === 0}
                      onClick={() => moveWordInGroup(group.id, w.id, -1)}
                      aria-label={`上移 ${w.text}`}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2.5 7.5 6 4l3.5 3.5" />
                      </svg>
                    </button>
                    <button
                      className="pressable rounded p-0.5 text-muted-foreground transition-colors duration-150 hover:bg-accent hover:text-foreground disabled:opacity-30 disabled:hover:bg-transparent"
                      disabled={wi === words.length - 1}
                      onClick={() => moveWordInGroup(group.id, w.id, 1)}
                      aria-label={`下移 ${w.text}`}
                    >
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M2.5 4.5 6 8l3.5-3.5" />
                      </svg>
                    </button>
                  </span>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

/* ---------------- main section ---------------- */

export default function Library({
  flashRequest,
}: {
  /** external "locate this group" signal (e.g. duplicate added on Welcome) */
  flashRequest?: { id: string; key: number } | null
}) {
  const {
    state,
    mergeWordsIntoGroup,
    moveWordsToGroup,
    seedExamples,
    resetGroupStats,
    createGroup,
  } = useLibrary()
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  /* dialogs hold only an id — the word/group object is re-read from the
     store on every render, so refetch / edit / move inside a dialog shows
     up immediately instead of displaying a stale snapshot */
  const [detailId, setDetailId] = useState<string | null>(null)
  const [groupDetailId, setGroupDetailId] = useState<string | null>(null)
  const detail = detailId ? (state.words[detailId] ?? null) : null
  const groupDetail = groupDetailId
    ? (state.groups[groupDetailId] ?? null)
    : null
  const [flash, setFlash] = useState<{ id: string; key: number } | null>(null)
  const [manualFlash, setManualFlash] = useState<{
    id: string
    key: number
  } | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  /** display order: confusable groups first, then newest first */
  const groups = useMemo(
    () =>
      Object.values(state.groups).filter(g => g.kind !== 'single').sort((a, b) => {
        const ca = a.wordIds.length > 1 ? 0 : 1
        const cb = b.wordIds.length > 1 ? 0 : 1
        if (ca !== cb) return ca - cb
        return b.createdAt - a.createdAt
      }),
    [state.groups],
  )

  /** stable numbering by creation time: 形近组 1, 2, 3 … */
  const groupNumbers = useMemo(() => {
    const byCreation = Object.values(state.groups)
      .filter((g) => g.wordIds.length > 1)
      .sort((a, b) => a.createdAt - b.createdAt)
    const map = new Map<string, number>()
    byCreation.forEach((g, i) => map.set(g.id, i + 1))
    return map
  }, [state.groups])

  const wordCount = groups.reduce((total, group) => total + group.wordIds.length, 0)
  const learningOn = state.learning.enabled

  /* ---- masonry: lay out columns manually (instead of CSS multicol) so the
     entrance stagger runs diagonally top-left → bottom-right, not column by
     column. Column count mirrors the old breakpoints: sm 2 / xl 3 / 2xl 4. ---- */
  const [colCount, setColCount] = useState(1)
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth
      setColCount(w >= 1536 ? 4 : w >= 1280 ? 3 : w >= 640 ? 2 : 1)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  const masonryCols = useMemo(() => {
    const cols: Array<Array<{ g: WordGroup; i: number }>> = Array.from(
      { length: colCount },
      () => [],
    )
    const heights = new Array<number>(colCount).fill(0)
    groups.forEach((g, i) => {
      // shortest-column-first; rough height estimate from word count
      let target = 0
      for (let c = 1; c < colCount; c++)
        if (heights[c] < heights[target]) target = c
      cols[target].push({ g, i })
      heights[target] += 1 + g.wordIds.length
    })
    return cols
  }, [groups, colCount])

  /** how many distinct groups the current selection spans */
  const selectedGroupCount = new Set(
    [...selected].map((id) => state.words[id]?.groupId),
  ).size

  /** when the whole selection lives inside one group, offer splitting it out */
  const detachSourceGroup =
    selected.size >= 1 && selectedGroupCount === 1
      ? state.words[[...selected][0]!]?.groupId
      : undefined
  const canDetachSelected =
    !!detachSourceGroup &&
    (state.groups[detachSourceGroup]?.wordIds.length ?? 0) > selected.size

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function locateGroup(groupId: string) {
    if (flashTimer.current) clearTimeout(flashTimer.current)
    // clear first so re-locating the same group restarts the ring animation
    setFlash(null)
    requestAnimationFrame(() => {
      setFlash({ id: groupId, key: Date.now() })
      document
        .querySelector(`[data-group-id="${groupId}"]`)
        ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
    flashTimer.current = setTimeout(() => setFlash(null), 3000)
  }

  // respond to external locate requests (Welcome page duplicate adds)
  const lastFlashKey = useRef(0)
  useEffect(() => {
    if (flashRequest && flashRequest.key !== lastFlashKey.current) {
      lastFlashKey.current = flashRequest.key
      locateGroup(flashRequest.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flashRequest])

  return (
    <div className="space-y-6">
      <AddWordCard onLocateGroup={locateGroup} />

      {wordCount === 0 && groups.length === 0 ? (
        <div className="stagger-in rounded-xl border border-dashed bg-card/50 p-10 text-center">
          <p className="font-word text-xl text-muted-foreground">
            词库还是空的
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            在上方输入一个单词开始，或者先载入一组示例词感受流程。
          </p>
          <div className="mt-5 flex justify-center gap-2">
            <Button
              variant="outline"
              className="pressable"
              onClick={() => {
                const n = seedExamples()
                toast.success(`已载入 ${n} 个示例单词`)
              }}
            >
              载入示例词组
            </Button>
            <Button
              variant="outline"
              className="pressable"
              onClick={() => {
                createGroup()
                toast.success('已创建空白分组', {
                  description: '用「手动归组」勾选单词后加入，或先录入新词',
                })
              }}
            >
              手动建组
            </Button>
          </div>
        </div>
      ) : (
        <>
          <div className="sticky top-3 z-30">
            <div className="flex items-center justify-between rounded-full border bg-card/95 py-2 pl-5 pr-3 shadow-md backdrop-blur">
              <p className="text-sm text-muted-foreground">
                共 {wordCount} 词 · {groupNumbers.size} 个形近组
                {selecting && selected.size > 0 && (
                  <span className="ml-2 text-primary">
                    已选 {selected.size} 词
                  </span>
                )}
              </p>
              <div className="flex items-center gap-2">
                {selecting && selected.size >= 2 && selectedGroupCount >= 2 && (
                  <Button
                    size="sm"
                    className="pressable"
                    onClick={() => {
                      const ids = [...selected]
                      const target = state.words[ids[0]]?.groupId
                      mergeWordsIntoGroup(ids)
                      if (target)
                        setManualFlash({ id: target, key: Date.now() })
                      toast.success(`已将 ${ids.length} 个词归为一组`)
                      setSelected(new Set())
                      setSelecting(false)
                    }}
                  >
                    归为一组（{selected.size}）
                  </Button>
                )}
                {selecting && canDetachSelected && (
                  <Button
                    size="sm"
                    variant="secondary"
                    className="pressable"
                    onClick={() => {
                      const ids = [...selected]
                      const gid = createGroup()
                      moveWordsToGroup(ids, gid)
                      setManualFlash({ id: gid, key: Date.now() })
                      toast.success(`已将 ${ids.length} 个词单独成组`)
                      setSelected(new Set())
                      setSelecting(false)
                    }}
                  >
                    单独成组（{selected.size}）
                  </Button>
                )}
                <Button
                  size="sm"
                  variant={selecting ? 'secondary' : 'outline'}
                  className="pressable"
                  onClick={() => {
                    setSelecting((s) => !s)
                    setSelected(new Set())
                  }}
                >
                  {selecting ? '取消选择' : '手动归组'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="pressable"
                  onClick={() => {
                    createGroup()
                    toast.success('已创建空白分组', {
                      description: '勾选单词后，点卡片上的「加入选中」把词放进来',
                    })
                  }}
                >
                  手动建组
                </Button>
              </div>
            </div>
          </div>

          {/* masonry: cards size to their content, laid out by column so the
              entrance stagger sweeps diagonally like a feed */}
          <div className="flex items-start gap-4">
            {masonryCols.map((col, ci) => (
              <div key={ci} className="flex min-w-0 flex-1 flex-col gap-4">
                {col.map(({ g }, ri) => (
                  <GroupCard
                    key={g.id}
                    group={g}
                    label={
                      g.wordIds.length > 1
                        ? `形近组 ${groupNumbers.get(g.id) ?? ''}`
                        : g.wordIds.length === 1
                          ? '单词'
                          : '空组'
                    }
                    flash={flash?.id === g.id}
                    index={ri * colCount + ci}
                    selecting={selecting}
                    selected={selected}
                    manualFlashKey={
                      manualFlash?.id === g.id ? manualFlash.key : null
                    }
                    learningOn={learningOn}
                    onToggleSelect={toggleSelect}
                    onOpenWord={(w) => setDetailId(w.id)}
                    onOpenGroup={(g) => setGroupDetailId(g.id)}
                    onResetGroup={(gr) => {
                      resetGroupStats(gr.id)
                      toast.success('本组复习状况已重置')
                    }}
                    onManualGrouped={(gid) =>
                      setManualFlash({ id: gid, key: Date.now() })
                    }
                  />
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      <WordDetailDialog word={detail} onClose={() => setDetailId(null)} />
      <GroupDetailDialog
        group={groupDetail}
        onClose={() => setGroupDetailId(null)}
      />
    </div>
  )
}
