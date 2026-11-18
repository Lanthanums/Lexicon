import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { EntryInput } from '@/lib/batchEntry'
import type { ShapeOption } from '@/lib/entryPlan'
import { coreGloss } from '@/lib/groupNames'
import type { LibraryState } from '@/types'

type MissingWord = { id: string; text: string }
export type EntryReviewTask =
  | { kind: 'gloss'; words: MissingWord[] }
  | { kind: 'shape'; input: EntryInput; options: ShapeOption[]; draft: LibraryState; changed: boolean }

export type EntryReviewAnswer =
  | { kind: 'gloss'; values: Record<string, string> }
  | { kind: 'group'; id: string }

interface EntryReviewProps {
  task: (EntryReviewTask & { step: number }) | null
  busy: boolean
  progress: string
  onAnswer: (answer: EntryReviewAnswer) => void
  onCancel: () => void
  onCloseAutoFocus?: () => void
}

function CandidateMembers({ ids, draft }: { ids: string[]; draft: LibraryState }) {
  return <span className="grid gap-1.5">
    {ids.map(id => {
      const word = draft.words[id]
      return <span key={id} className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-word font-medium [overflow-wrap:anywhere]">{word.text}</span>
        <span className="text-xs text-muted-foreground [overflow-wrap:anywhere]">{coreGloss(word.gloss)}</span>
      </span>
    })}
  </span>
}

function CandidateCard({ name, value, selected, onSelect, onConfirm, children, standalone = false }: {
  name: string; value: string; selected: boolean; onSelect: (id: string) => void
  onConfirm?: (id: string) => void; children: ReactNode; standalone?: boolean
}) {
  return <label onDoubleClick={() => onConfirm?.(value)} className={`flex min-w-0 cursor-pointer items-start gap-3 rounded-xl border p-4 transition-colors hover:border-primary/60 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary ${selected ? 'border-primary bg-primary/5' : 'bg-card'} ${standalone ? 'sm:col-span-2' : ''}`}>
    <input type="radio" name={name} value={value} checked={selected} onChange={() => onSelect(value)}
      className="mt-0.5 size-4 shrink-0 cursor-pointer accent-primary" />
    <span className="min-w-0 flex-1 space-y-2 [overflow-wrap:anywhere]">{children}</span>
  </label>
}

function GroupCandidates({ task, choice, onSelect, onConfirm }: {
  task: Extract<EntryReviewTask, { kind: 'shape' }>; choice: string | null; onSelect: (id: string) => void
  onConfirm: (id: string) => void
}) {
  const name = useId()
  const { draft, options } = task
  return <div role="group" aria-label="候选形近组" className="grid gap-3 sm:grid-cols-2">
    {options.map(option => <CandidateCard key={option.id} name={name} value={option.id}
      selected={choice === option.id} onSelect={onSelect} onConfirm={onConfirm}>
      {draft.groups[option.id]?.name &&
        <span className="block text-sm font-semibold">{draft.groups[option.id].name}</span>}
      <CandidateMembers ids={option.memberIds} draft={draft} />
    </CandidateCard>)}
    <CandidateCard name={name} value="" selected={choice === ''} onSelect={onSelect} onConfirm={onConfirm} standalone>
      <span className="block text-sm font-medium">暂不加入形近组</span>
    </CandidateCard>
  </div>
}

function ReviewStep({ task, busy, progress, onAnswer, onCancel }: {
  task: EntryReviewTask; busy: boolean; progress: string
  onAnswer: EntryReviewProps['onAnswer']; onCancel: () => void
}) {
  const heading = useRef<HTMLHeadingElement>(null)
  const fields = useRef<HTMLDivElement>(null)
  const [choice, setChoice] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  useEffect(() => {
    // A missing gloss is typed right away; a group choice starts from the heading.
    const field = fields.current?.querySelector<HTMLInputElement>('input')
    if (field) field.focus({preventScroll: true})
    else heading.current?.focus({preventScroll: true})
  }, [])
  const title = task.kind === 'gloss' ? '补充中文释义' : '选择形近组'
  const singleMissing = task.kind === 'gloss' && task.words.length === 1 ? task.words[0] : undefined
  const word = task.kind === 'gloss' ? singleMissing?.text : task.input.text
  const hasGloss = Object.values(values).some(value => value.trim())
  const submitLabel = task.kind !== 'gloss' ? '确认选择' :
    hasGloss ? '继续录入' : singleMissing ? '跳过这个词' : '跳过这些词'

  function confirm() {
    if (task.kind === 'gloss') onAnswer({ kind: 'gloss', values })
    else if (choice !== null) onAnswer({ kind: 'group', id: choice })
  }

  return <>
    <DialogHeader className="shrink-0 border-b px-5 pb-4 pt-5 sm:px-6">
      <DialogTitle ref={heading} tabIndex={-1} className="pr-6 text-sm leading-5 outline-none">{title}</DialogTitle>
      {word && <p className="break-words font-word text-2xl leading-tight">{word}</p>}
      {task.kind !== 'gloss' && <p className="line-clamp-2 break-words text-sm text-muted-foreground" title={task.input.gloss}>{task.input.gloss}</p>}
      <DialogDescription>
        {task.kind === 'gloss'
          ? '词典暂未提供可用释义。可以手动填写，留空的词会跳过。'
          : task.changed ? '可选分组有变化，请再选一次。'
            : '这些组里的词拼写相近。选一组，把它们放在一起辨认；双击可直接确认。'}
      </DialogDescription>
    </DialogHeader>
    <div className="min-h-0 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6">
      {task.kind === 'gloss'
        ? <div ref={fields} className="grid gap-4">{task.words.map((item, index) => <label key={item.id} className="grid gap-1.5">
          <span className="text-sm font-medium">{singleMissing ? '中文释义' : item.text}</span>
          <Input aria-label={singleMissing ? '中文释义' : `${item.text} 的中文释义`} placeholder="输入中文释义"
            value={values[item.id] ?? ''} disabled={busy} className="font-normal" onChange={event => {
              const value = event.target.value
              setValues(previous => ({...previous, [item.id]: value}))
            }} onKeyDown={event => {
              if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
              event.preventDefault()
              // Enter walks through the list; on the last field it continues the entry.
              const next = fields.current?.querySelectorAll<HTMLInputElement>('input')[index + 1]
              if (next) next.focus()
              else if (hasGloss) confirm()
            }} />
        </label>)}</div>
        : <fieldset disabled={busy} className="m-0 min-w-0 border-0 p-0"><GroupCandidates task={task} choice={choice} onSelect={setChoice}
          onConfirm={id => { if (!busy) onAnswer({ kind: 'group', id }) }} /></fieldset>}
    </div>
    <DialogFooter className="shrink-0 items-stretch gap-3 border-t px-5 py-4 sm:items-center sm:px-6">
      {busy && <p role="status" className="mr-auto text-xs text-muted-foreground">{progress || '正在处理…'}</p>}
      <Button variant="outline" onClick={onCancel}>取消本次录入</Button>
      <Button disabled={busy || (task.kind !== 'gloss' && choice === null)} onClick={confirm}>{submitLabel}<ArrowRight size={15} /></Button>
    </DialogFooter>
  </>
}

export default function EntryReview({ task, busy, progress, onAnswer, onCancel, onCloseAutoFocus }: EntryReviewProps) {
  return <Dialog open={task !== null} onOpenChange={open => { if (!open) onCancel() }}>
    <DialogContent className="flex max-h-[85svh] flex-col gap-0 overflow-hidden rounded-2xl p-0 sm:max-w-2xl"
      onOpenAutoFocus={event => event.preventDefault()}
      onInteractOutside={event => event.preventDefault()}
      onCloseAutoFocus={onCloseAutoFocus ? event => { event.preventDefault(); onCloseAutoFocus() } : undefined}>
      {task && <ReviewStep key={task.step}
        task={task} busy={busy} progress={progress} onAnswer={onAnswer} onCancel={onCancel} />}
    </DialogContent>
  </Dialog>
}
