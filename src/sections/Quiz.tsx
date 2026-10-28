import { useEffect, useMemo, useRef, useState } from 'react'
import { useLibrary } from '@/store/library'
import { wordSimilarity } from '@/lib/similarity'
import type { QuizMode, Word } from '@/types'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'

type ChoiceMode = 'zh2en' | 'en2zh'
type QMode = ChoiceMode | 'spell'

interface Question {
  wordId: string
  mode: QMode
  prompt: string
  sub?: string
  options?: Array<{ id: string; label: string }>
  answer: string
  /** 'wrong-only': recognition warm-up in progressive mode — a correct pick
      proves little, so only a miss touches the mastery stats */
  credit?: 'wrong-only'
}

interface AnswerRec {
  q: Question
  correct: boolean
  given: string
}

const MODE_LABEL: Record<QuizMode, string> = {
  zh2en: '看中文 · 选英文',
  en2zh: '看英文 · 选中文',
  spell: '听义拼写',
  mixed: '混合模式',
  progressive: '渐进掌握',
}

const MODE_SUB: Record<QuizMode, string> = {
  zh2en: '再认练习',
  en2zh: '再认练习',
  spell: '主动回忆',
  mixed: '三种题型轮换',
  progressive: '先认出 · 再写出',
}

/**
 * Best available Chinese prompt for a word. Falls back when the gloss is
 * missing or accidentally equals the word itself (translator echo) — using
 * the first dictionary meaning instead, so a quiz never shows the answer
 * as its own prompt.
 */
function meaningOf(w: Word): string {
  const g = w.gloss.trim()
  if (g && g.toLowerCase() !== w.text.toLowerCase()) return g
  const m = w.meanings.find((x) => x.zh?.trim())?.zh ?? w.meanings[0]?.en
  return m?.trim() || '（无释义）'
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function pickWeighted(words: Word[], weights: Map<string, number>, n: number) {
  const pool = [...words]
  const picked: Word[] = []
  while (pool.length > 0 && picked.length < n) {
    const total = pool.reduce((s, w) => s + (weights.get(w.id) ?? 1), 0)
    let r = Math.random() * total
    let idx = 0
    for (let i = 0; i < pool.length; i++) {
      r -= weights.get(pool[i].id) ?? 1
      if (r <= 0) {
        idx = i
        break
      }
    }
    picked.push(pool.splice(idx, 1)[0])
  }
  return picked
}

export default function Quiz({
  autoStartKey,
}: {
  /** when this changes to a new non-zero value, start a round immediately */
  autoStartKey?: number
}) {
  const { state, recordAnswer } = useLibrary()
  const allWords = useMemo(() => Object.values(state.words), [state.words])

  const [phase, setPhase] = useState<'setup' | 'running' | 'summary'>('setup')
  const [mode, setMode] = useState<QuizMode>('mixed')
  const [scope, setScope] = useState<string>('all')
  const [count, setCount] = useState<string>('10')

  const [questions, setQuestions] = useState<Question[]>([])
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<AnswerRec[]>([])
  const [feedback, setFeedback] = useState<'idle' | 'correct' | 'wrong'>('idle')
  const [chosen, setChosen] = useState<string | null>(null)
  const [spellInput, setSpellInput] = useState('')
  const [wrongAttempt, setWrongAttempt] = useState('')
  const [hint, setHint] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const spellRef = useRef<HTMLInputElement>(null)

  const confusableGroups = useMemo(
    () =>
      Object.values(state.groups)
        .filter((g) => g.wordIds.length > 1)
        .sort((a, b) => b.wordIds.length - a.wordIds.length),
    [state.groups],
  )

  const scopeWords = useMemo(() => {
    if (scope === 'all') return allWords
    const g = state.groups[scope]
    if (!g) return allWords
    return g.wordIds
      .map((id) => state.words[id])
      .filter((w): w is Word => !!w)
  }, [scope, allWords, state.groups, state.words])

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  useEffect(() => {
    if (phase === 'running' && questions[index]?.mode === 'spell') {
      spellRef.current?.focus()
    }
  }, [phase, index, questions])

  // "开始复习" from the Welcome page lands here and starts a round directly
  // (also from the summary screen — a finished round shouldn't block a new one)
  const lastAutoStart = useRef(0)
  useEffect(() => {
    if (autoStartKey && autoStartKey !== lastAutoStart.current) {
      lastAutoStart.current = autoStartKey
      if (phase !== 'running' && scopeWords.length > 0) start()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoStartKey])

  /* ---------- question building ---------- */

  function distractorsFor(word: Word, labelOf: (w: Word) => string): Word[] {
    const others = allWords.filter((w) => w.id !== word.id)
    const sameGroup = others.filter((w) => w.groupId === word.groupId)
    const scored = others
      .filter((w) => w.groupId !== word.groupId)
      .map((w) => ({
        w,
        s: wordSimilarity(word.text, w.text, word.phonetic, w.phonetic).score,
      }))
      .sort((a, b) => b.s - a.s)
      .map((x) => x.w)
    const ordered = [...shuffle(sameGroup), ...scored]
    const seen = new Set<string>([labelOf(word)])
    const out: Word[] = []
    for (const w of ordered) {
      const l = labelOf(w)
      if (!seen.has(l) && l.trim()) {
        seen.add(l)
        out.push(w)
      }
      if (out.length >= 3) break
    }
    return out
  }

  function buildQuestion(word: Word, m: QMode): Question | null {
    if (m === 'zh2en') {
      const ds = distractorsFor(word, (w) => w.text)
      if (ds.length < 3) return buildQuestion(word, 'spell')
      const options = shuffle([
        { id: word.id, label: word.text },
        ...ds.map((w) => ({ id: w.id, label: w.text })),
      ])
      return {
        wordId: word.id,
        mode: m,
        prompt: meaningOf(word),
        sub: '选择对应的英文单词',
        options,
        answer: word.text,
      }
    }
    if (m === 'en2zh') {
      const ds = distractorsFor(word, meaningOf)
      if (ds.length < 3) return buildQuestion(word, 'zh2en')
      const options = shuffle([
        { id: word.id, label: meaningOf(word) },
        ...ds.map((w) => ({ id: w.id, label: meaningOf(w) })),
      ])
      return {
        wordId: word.id,
        mode: m,
        prompt: word.text,
        sub: word.phonetic,
        options,
        answer: meaningOf(word),
      }
    }
    // spell
    const pos = word.meanings[0]?.pos
    return {
      wordId: word.id,
      mode: 'spell',
      prompt: meaningOf(word),
      sub: [pos, word.phonetic].filter(Boolean).join(' · ') || undefined,
      answer: word.text,
    }
  }

  function start() {
    const n =
      count === 'all' ? scopeWords.length : Math.min(Number(count), scopeWords.length)
    if (n === 0) return
    const weights = new Map<string, number>()
    for (const w of scopeWords) {
      const st = state.stats[w.id]
      const level = st?.level ?? 0
      let weight = 6 - level
      if (st?.lastResult === false) weight *= 2
      weight *= 1 + (st?.wrong ?? 0) * 0.15
      weights.set(w.id, weight)
    }
    const picked = pickWeighted(scopeWords, weights, n)
    let qs: Question[] = []
    if (mode === 'progressive') {
      /* recognition → recall: a choice round first (recognition success
         proves little, so those only debit on a miss), then the same words
         reshuffled as spelling — a word never follows itself */
      const stage1 = picked
        .map((w, i) => {
          const q = buildQuestion(w, i % 2 === 0 ? 'zh2en' : 'en2zh')
          if (q && q.mode !== 'spell') q.credit = 'wrong-only'
          return q
        })
        .filter((x): x is Question => !!x)
      const stage2 = shuffle(picked)
        .map((w) => buildQuestion(w, 'spell'))
        .filter((x): x is Question => !!x)
      qs = [...stage1, ...stage2]
    } else {
      const modes: QMode[] =
        mode === 'mixed'
          ? ['zh2en', 'en2zh', 'spell']
          : [mode as QMode]
      picked.forEach((w, i) => {
        const q = buildQuestion(w, modes[i % modes.length])
        if (q) qs.push(q)
      })
    }
    if (qs.length === 0) return
    setQuestions(qs)
    setIndex(0)
    setAnswers([])
    setFeedback('idle')
    setChosen(null)
    setSpellInput('')
    setWrongAttempt('')
    setHint(0)
    setPhase('running')
  }

  /* ---------- answering ---------- */

  const q = questions[index]

  const pendingRec = useRef<AnswerRec | null>(null)

  function commit(rec: AnswerRec) {
    pendingRec.current = null
    const nextAnswers = [...answers, rec]
    setAnswers(nextAnswers)
    if (index + 1 >= questions.length) {
      setPhase('summary')
    } else {
      setIndex(index + 1)
      setFeedback('idle')
      setChosen(null)
      setSpellInput('')
      setWrongAttempt('')
      setHint(0)
    }
  }

  function advance(rec: AnswerRec, delay: number) {
    pendingRec.current = rec
    timer.current = setTimeout(() => {
      timer.current = null
      commit(rec)
    }, delay)
  }

  function answerChoice(optionId: string, label: string) {
    if (feedback !== 'idle' || !q) return
    const correct = label === q.answer
    // progressive warm-up picks only debit on a miss; everything else scores
    if (q.credit !== 'wrong-only' || !correct)
      recordAnswer(q.wordId, correct)
    setChosen(optionId)
    setFeedback(correct ? 'correct' : 'wrong')
    const rec: AnswerRec = { q, correct, given: label }
    if (correct) {
      advance(rec, 750)
    } else {
      // wrong: hold the card so the correct answer can sink in — the user
      // advances manually, same as the spelling correction flow
      pendingRec.current = rec
    }
  }

  function answerSpell() {
    if (feedback !== 'idle' || !q) return
    const given = spellInput.trim().toLowerCase()
    if (!given) return
    const correct = given === q.answer
    recordAnswer(q.wordId, correct)
    setFeedback(correct ? 'correct' : 'wrong')
    if (correct) {
      advance({ q, correct: true, given: spellInput.trim() }, 750)
    } else {
      /* correction drill: the miss is already recorded; the round only
         moves on once the word has been typed correctly (retyping below) */
      setWrongAttempt(spellInput.trim())
      pendingRec.current = { q, correct: false, given: spellInput.trim() }
      setSpellInput('')
    }
  }

  function nextNow() {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    const rec = pendingRec.current ?? {
      q,
      correct: false,
      given: spellInput.trim(),
    }
    commit(rec)
  }

  function retryWrong() {
    /* rebuild each missed question in the SAME mode it was asked — a
       miss on a spelling question must be re-drilled as spelling */
    const qs = answers
      .filter((a) => !a.correct)
      .map((a) => {
        const w = state.words[a.q.wordId]
        return w ? buildQuestion(w, a.q.mode) : null
      })
      .filter((x): x is Question => !!x)
    if (qs.length === 0) return
    setQuestions(qs)
    setIndex(0)
    setAnswers([])
    setFeedback('idle')
    setChosen(null)
    setSpellInput('')
    setWrongAttempt('')
    setHint(0)
    setPhase('running')
  }

  /* ---------- render ---------- */

  if (allWords.length === 0) {
    return (
      <div className="stagger-in rounded-xl border border-dashed bg-card/50 p-10 text-center">
        <p className="font-word text-xl text-muted-foreground">还没有可考察的单词</p>
        <p className="mt-2 text-sm text-muted-foreground">
          先去「词库」页录入几个单词吧。
        </p>
      </div>
    )
  }

  if (phase === 'setup') {
    return (
      <div className="stagger-in mx-auto max-w-lg rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="font-word text-2xl tracking-tight">开始抽查</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          干扰项优先取自同一形近组；答错的题必须纠错后才会放过你。
        </p>

        <div className="mt-6 space-y-5">
          <div className="space-y-2">
            <Label>考察方式</Label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.keys(MODE_LABEL) as QuizMode[]).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`pressable rounded-lg border px-3 py-2.5 text-left transition-colors duration-150 ${
                    m === 'progressive' ? 'col-span-2' : ''
                  } ${
                    mode === m
                      ? 'border-primary bg-primary/10 font-medium text-primary'
                      : 'bg-background hover:bg-accent'
                  }`}
                >
                  <span className="block text-sm">{MODE_LABEL[m]}</span>
                  <span
                    className={`mt-0.5 block text-xs ${
                      mode === m ? 'text-primary/70' : 'text-muted-foreground'
                    }`}
                  >
                    {MODE_SUB[m]}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>范围</Label>
              <Select value={scope} onValueChange={setScope}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">全部单词（{allWords.length}）</SelectItem>
                  {confusableGroups.map((g) => (
                    <SelectItem key={g.id} value={g.id}>
                      {g.wordIds
                        .slice(0, 3)
                        .map((id) => state.words[id]?.text)
                        .filter(Boolean)
                        .join(' / ')}
                      {g.wordIds.length > 3 ? ' …' : ''}（{g.wordIds.length}）
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>题量</Label>
              <Select value={count} onValueChange={setCount}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="5">5 题</SelectItem>
                  <SelectItem value="10">10 题</SelectItem>
                  <SelectItem value="20">20 题</SelectItem>
                  <SelectItem value="all">全部（{scopeWords.length}）</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <Button
            className="pressable h-11 w-full text-base"
            onClick={start}
            disabled={scopeWords.length === 0}
          >
            开始（{scopeWords.length} 词在范围内）
          </Button>
          <p className="text-center text-xs text-muted-foreground">
            掌握度低、最近答错的词会被优先抽中
            {mode === 'progressive' && ' · 渐进模式下每个词出两题（先选择、后拼写）'}
          </p>
        </div>
      </div>
    )
  }

  if (phase === 'summary') {
    const correct = answers.filter((a) => a.correct).length
    const pct = answers.length ? Math.round((correct / answers.length) * 100) : 0
    const wrong = answers.filter((a) => !a.correct)
    return (
      <div className="stagger-in space-y-6">
        <div className="mx-auto max-w-lg rounded-xl border bg-card p-6 text-center shadow-sm">
          <p className="text-sm text-muted-foreground">本轮成绩</p>
          <p className="font-word mt-2 text-5xl tracking-tight">
            {correct}
            <span className="text-2xl text-muted-foreground">
              /{answers.length}
            </span>
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            正确率 {pct}%{pct === 100 ? ' · 完美' : pct >= 80 ? ' · 很不错' : pct >= 60 ? ' · 继续加油' : ' · 错题值得重练'}
          </p>
          <div className="mt-5 flex justify-center gap-2">
            {wrong.length > 0 && (
              <Button className="pressable" onClick={retryWrong}>
                重练错题（{wrong.length}）
              </Button>
            )}
            <Button
              variant="outline"
              className="pressable"
              onClick={() => setPhase('setup')}
            >
              再来一轮
            </Button>
          </div>
        </div>

        {/* per-question review — masonry cards so long glosses wrap
            naturally instead of overflowing a single narrow list */}
        <div>
          <p className="mb-3 text-sm font-medium text-muted-foreground">
            逐题回顾
          </p>
          <div className="columns-1 gap-4 sm:columns-2 xl:columns-3">
            {answers.map((a, i) => {
              const w = state.words[a.q.wordId]
              const title = w?.text ?? a.q.answer
              return (
                <div
                  key={i}
                  className="stagger-in mb-4 break-inside-avoid rounded-xl border bg-card p-4 shadow-sm"
                  style={{ transitionDelay: `${Math.min(i, 10) * 40}ms` }}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`inline-block size-2 shrink-0 rounded-full ${
                        a.correct ? 'bg-emerald-600' : 'bg-destructive'
                      }`}
                    />
                    <span className="font-word min-w-0 flex-1 truncate text-lg">
                      {title}
                    </span>
                    <span
                      className={`shrink-0 text-xs ${
                        a.correct ? 'text-emerald-600' : 'text-destructive'
                      }`}
                    >
                      {a.correct ? '答对' : '答错'}
                    </span>
                  </div>
                  <p
                    className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-muted-foreground"
                    title={w ? meaningOf(w) : ''}
                  >
                    {w ? meaningOf(w) : ''}
                  </p>
                  {!a.correct && (
                    <div className="mt-2 space-y-1 border-t border-border/60 pt-2 text-xs">
                      <p className="break-words text-muted-foreground">
                        你的答案：
                        <span className="text-destructive line-through decoration-destructive/60">
                          {a.given || '（未作答）'}
                        </span>
                      </p>
                      {a.q.answer !== title && (
                        <p className="break-words text-muted-foreground">
                          正确答案：
                          <span className="text-foreground">{a.q.answer}</span>
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  /* running */
  const correctSoFar = answers.filter((a) => a.correct).length
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex items-center gap-3">
        <Progress
          value={((index + (feedback !== 'idle' ? 1 : 0)) / questions.length) * 100}
          className="h-1.5 flex-1"
        />
        <span className="text-sm tabular-nums text-muted-foreground">
          {index + 1}/{questions.length}
        </span>
        <Badge variant="secondary" className="tabular-nums">
          {correctSoFar} 对
        </Badge>
      </div>

      <div
        key={index}
        className={`stagger-in rounded-xl border bg-card p-8 shadow-sm ${
          feedback === 'correct'
            ? 'flash-correct'
            : feedback === 'wrong'
              ? 'flash-wrong'
              : ''
        }`}
      >
        <div className="mb-1 flex items-center gap-2">
          <Badge variant="outline" className="font-normal">
            {q.mode === 'zh2en'
              ? '看中文 · 选英文'
              : q.mode === 'en2zh'
                ? '看英文 · 选中文'
                : '听义拼写'}
          </Badge>
        </div>

        <p
          className={`mt-4 tracking-tight ${
            q.mode === 'en2zh' ? 'font-word text-4xl' : 'text-3xl font-medium'
          }`}
        >
          {q.prompt}
        </p>
        {q.sub && (
          <p className="mt-2 text-sm text-muted-foreground">{q.sub}</p>
        )}

        {q.mode !== 'spell' && q.options && (
          <div className="mt-7 grid gap-2.5">
            {q.options.map((o, i) => {
              const isAnswer = o.label === q.answer
              const isChosen = chosen === o.id
              let cls =
                'border bg-background hover:bg-accent hover:border-primary/40'
              if (feedback !== 'idle') {
                if (isAnswer)
                  cls = 'border-emerald-600 bg-emerald-600/10 text-emerald-800'
                else if (isChosen)
                  cls = 'border-destructive bg-destructive/10 text-destructive'
                else cls = 'border bg-background opacity-50'
              }
              return (
                <button
                  key={o.id}
                  disabled={feedback !== 'idle'}
                  onClick={() => answerChoice(o.id, o.label)}
                  className={`pressable option-in rounded-lg px-4 py-3 text-left transition-colors duration-150 ${cls} ${
                    q.mode === 'zh2en' ? 'font-word text-xl' : 'text-base'
                  }`}
                  style={{ transitionDelay: `${i * 55}ms` }}
                >
                  <span className="mr-3 inline-flex size-5 items-center justify-center rounded-full border text-xs text-muted-foreground">
                    {String.fromCharCode(65 + i)}
                  </span>
                  {o.label}
                </button>
              )
            })}
            {feedback === 'wrong' && (
              <Button
                autoFocus
                className="pressable mt-1 h-11"
                onClick={nextNow}
                onKeyDown={(e) => e.key === 'Enter' && nextNow()}
              >
                下一题（Enter）
              </Button>
            )}
          </div>
        )}

        {q.mode === 'spell' && (
          <div className="mt-7 space-y-3">
            <div className="flex gap-2">
              <Input
                ref={spellRef}
                value={spellInput}
                onChange={(e) => {
                  const v = e.target.value
                  setSpellInput(v)
                  // correction drill: typing it right after a miss flashes
                  // success and moves on with the original (wrong) record
                  if (
                    feedback === 'wrong' &&
                    q &&
                    v.trim().toLowerCase() === q.answer
                  ) {
                    setFeedback('correct')
                    const rec = pendingRec.current ?? {
                      q,
                      correct: false,
                      given: '',
                    }
                    advance(rec, 900)
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key !== 'Enter') return
                  if (feedback === 'idle') answerSpell()
                }}
                placeholder={
                  feedback === 'wrong' ? '请正确拼写一遍…' : '拼出这个单词…'
                }
                className={`h-12 font-word text-xl tracking-wide ${
                  feedback === 'correct'
                    ? 'border-emerald-600 bg-emerald-600/10'
                    : feedback === 'wrong'
                      ? 'border-destructive bg-destructive/10'
                      : ''
                }`}
                disabled={feedback === 'correct'}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
              />
              {feedback === 'idle' && (
                <Button
                  className="pressable h-12 px-5"
                  onClick={answerSpell}
                  disabled={!spellInput.trim()}
                >
                  确定
                </Button>
              )}
            </div>

            {feedback === 'wrong' && (
              <div className="space-y-1.5 text-sm">
                <p>
                  正确拼写：
                  <span className="font-word text-lg font-medium text-emerald-700">
                    {q.answer}
                  </span>
                  {wrongAttempt && (
                    <span className="ml-2 text-muted-foreground line-through">
                      {wrongAttempt}
                    </span>
                  )}
                </p>
                <p className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>在输入框正确拼写一遍后自动继续</span>
                  <button
                    className="underline-offset-2 hover:underline"
                    onClick={nextNow}
                  >
                    跳过本题
                  </button>
                </p>
              </div>
            )}

            {feedback === 'idle' && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <span className="tabular-nums">{q.answer.length} 个字母</span>
                <button
                  className="underline-offset-2 hover:underline"
                  onClick={() => setHint((h) => Math.min(h + 1, q.answer.length - 1))}
                >
                  提示一个字母
                </button>
                {hint > 0 && (
                  <span className="font-word text-base tracking-[0.2em] text-foreground">
                    {q.answer.slice(0, hint)}
                    <span className="text-muted-foreground">
                      {'·'.repeat(q.answer.length - hint)}
                    </span>
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <button
          className="text-sm text-muted-foreground underline-offset-2 hover:underline"
          onClick={() => {
            if (timer.current) clearTimeout(timer.current)
            setPhase('setup')
          }}
        >
          结束本轮
        </button>
      </div>
    </div>
  )
}
