import { useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  useLibrary,
  type AddResolution,
  type GroupCandidate,
  type NewWordInput,
} from '@/store/library'
import { lookupWord, WordNotFoundError } from '@/lib/dictionary'
import type { WordMeaning } from '@/types'

/**
 * Parse manual gloss input like "v. 中文释义1；n. 中文释义2"
 * (both ; and ； accepted) into structured meanings.
 */
function parseManualGloss(raw: string): {
  gloss: string
  meanings: WordMeaning[]
} {
  const segments = raw
    .split(/[;；]/)
    .map((s) => s.trim())
    .filter(Boolean)
  const meanings: WordMeaning[] = segments.map((seg) => {
    const m = /^([a-z]+\.|abbr\.)\s*(.+)$/i.exec(seg)
    return m
      ? { pos: m[1].toLowerCase(), en: '', zh: m[2].trim() }
      : { pos: '', en: '', zh: seg }
  })
  const gloss = meanings
    .map((m) => (m.pos ? `${m.pos} ${m.zh}` : m.zh!))
    .join('；')
  return { gloss, meanings }
}
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'


export function AddWordCard({
  onLocateGroup,
}: {
  onLocateGroup: (groupId: string) => void
}) {
  const { addWord, previewGrouping, state } = useLibrary()
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)
  const [manualDraft, setManualDraft] = useState<string | null>(null)
  const [manualGloss, setManualGloss] = useState('')
  const [conflict, setConflict] = useState<{
    input: NewWordInput
    candidates: GroupCandidate[]
  } | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const abortRef = useRef<AbortController | null>(null)

  function cancel() {
    abortRef.current?.abort()
    abortRef.current = null
    setBusy(false)
    toast.info('已取消查询')
  }

  async function handleAdd() {
    const text = value.trim().toLowerCase()
    if (!text || busy) return
    if (!/^[a-z][a-z'’-]*$/.test(text)) {
      toast.error('请输入一个英文单词')
      return
    }
    const dup = Object.values(state.words).find((w) => w.text === text)
    if (dup) {
      toast.info(`「${text}」已在词库中`, { description: '已为你定位到所在分组' })
      onLocateGroup(dup.groupId)
      setValue('')
      return
    }
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setBusy(true)
    try {
      const r = await lookupWord(text, ctrl.signal, state.settings.dictProviders)
      if (ctrl.signal.aborted) return
      commit({
        text: r.text,
        phonetic: r.phonetic,
        gloss: r.gloss,
        meanings: r.meanings,
        source: 'api',
      })
    } catch (e) {
      if (ctrl.signal.aborted) return
      if (e instanceof WordNotFoundError) {
        setManualDraft(text)
        setManualGloss('')
      } else {
        toast.error('查询失败，请检查网络后重试', {
          description: e instanceof Error ? e.message : undefined,
        })
      }
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null
        setBusy(false)
      }
    }
  }

  function commit(input: NewWordInput) {
    // conflict check: two or more candidate groups with near-equal scores
    const candidates = previewGrouping({
      text: input.text,
      phonetic: input.phonetic,
    })
    if (candidates.length >= 2) {
      const [a, b] = candidates
      const nearTie = a.score - b.score <= 0.05
      const homophoneDecided = a.homophone && !b.homophone
      if (nearTie && !homophoneDecided) {
        setConflict({ input, candidates: candidates.slice(0, 3) })
        return
      }
    }
    finishCommit(input, { mode: 'auto' })
  }

  function finishCommit(input: NewWordInput, resolution: AddResolution) {
    const result = addWord(input, resolution)
    if (result.status === 'duplicate') {
      toast.info(`「${input.text}」已在词库中`, { description: '已为你定位到所在分组' })
      onLocateGroup(result.groupId)
      setValue('')
      return
    }
    const names = result.groupedWith
      .map((id) => state.words[id]?.text)
      .filter(Boolean)
    const noGloss = !input.gloss.trim() || input.gloss === '（待补充释义）'
    const glossHint = noGloss ? '；未获取到中文释义，点击单词可手动补充' : ''
    if (names.length > 0) {
      toast.success(`已加入「${input.text}」`, {
        description: `${result.homophoneMatch ? '检测到同音词，' : ''}与 ${names.join('、')} 归为一组${glossHint}`,
      })
    } else {
      toast.success(`已加入「${input.text}」`, {
        description: `未找到形近词，暂时单成一组${glossHint}`,
      })
    }
    setValue('')
    inputRef.current?.focus()
  }

  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">录入新词</h2>
        <span className="text-xs text-muted-foreground">
          自动查询释义 · 自动匹配形近 / 同音词
        </span>
      </div>
      <div className="mt-3 flex gap-2">
        <Input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="输入单词以添加"
          className="h-11 text-base font-word"
          disabled={busy}
        />
        {busy ? (
          <Button
            variant="outline"
            onClick={cancel}
            className="pressable h-11 px-5"
          >
            <Spinner className="mr-2 size-4" />
            取消
          </Button>
        ) : (
          <Button
            onClick={handleAdd}
            disabled={!value.trim()}
            className="pressable h-11 px-5"
          >
            查询并加入
          </Button>
        )}
      </div>

      {/* manual fallback when the dictionary has no entry */}
      <Dialog
        open={manualDraft !== null}
        onOpenChange={(open) => !open && setManualDraft(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-word text-2xl">
              {manualDraft}
            </DialogTitle>
            <p className="text-sm font-medium text-primary">请先检查拼写</p>
            <DialogDescription>
              词典中没有查到这个词。可以按词性格式手动填写释义，建立自定义词条。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="manual-gloss">中文释义</Label>
            <Input
              id="manual-gloss"
              value={manualGloss}
              onChange={(e) => setManualGloss(e.target.value)}
              placeholder="格式实例：v. 中文释义1；n. 中文释义2"
            />
            <p className="text-xs text-muted-foreground">
              用中英文分号（; 或；）隔开多个词性释义，词性可省略
            </p>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="pressable"
              onClick={() => setManualDraft(null)}
            >
              取消
            </Button>
            <Button
              className="pressable"
              onClick={() => {
                if (!manualDraft) return
                const parsed = manualGloss.trim()
                  ? parseManualGloss(manualGloss)
                  : { gloss: '（待补充释义）', meanings: [] }
                commit({
                  text: manualDraft,
                  gloss: parsed.gloss,
                  meanings: parsed.meanings,
                  source: 'manual',
                })
                setManualDraft(null)
              }}
            >
              加入词库
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* grouping conflict: near-equal scores across groups */}
      <Dialog
        open={conflict !== null}
        onOpenChange={(open) => !open && setConflict(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="font-word text-2xl">
              {conflict?.input.text}
            </DialogTitle>
            <DialogDescription>
              这个词与多个分组的相似度非常接近，请选择归类方式。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            {conflict?.candidates.map((c, i) => {
              const members =
                state.groups[c.groupId]?.wordIds
                  .map((id) => state.words[id]?.text)
                  .filter(Boolean)
                  .join('、') ?? ''
              return (
                <button
                  key={c.groupId}
                  onClick={() => {
                    finishCommit(conflict.input, {
                      mode: 'group',
                      groupId: c.groupId,
                    })
                    setConflict(null)
                  }}
                  className="pressable flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left transition-colors hover:bg-accent"
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">
                      加入分组 {i + 1}
                      {c.homophone && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          （同音）
                        </span>
                      )}
                    </span>
                    <span className="block truncate font-word text-sm text-muted-foreground">
                      {members}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    相似度 {(c.score * 100).toFixed(0)}%
                  </span>
                </button>
              )
            })}
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            {conflict && conflict.candidates.length >= 2 && (
              <Button
                variant="secondary"
                className="pressable w-full"
                onClick={() => {
                  finishCommit(conflict.input, {
                    mode: 'merge',
                    groupIds: conflict.candidates.map((c) => c.groupId),
                  })
                  setConflict(null)
                }}
              >
                全都加入（合并为一个大组）
              </Button>
            )}
            <Button
              variant="outline"
              className="pressable w-full"
              onClick={() => {
                if (!conflict) return
                finishCommit(conflict.input, { mode: 'new' })
                setConflict(null)
              }}
            >
              都不加入，单成一组
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
