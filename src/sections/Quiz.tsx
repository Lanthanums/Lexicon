import {pickScheduled} from '@/lib/memorySchedule'
import {groupTitle} from '@/lib/groupNames'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLibrary } from '@/store/library'
import { wordSimilarity } from '@/lib/similarity'
import type { QuizMode, SynonymSet, Word } from '@/types'
import {
  checkSpelling,
  evaluateSynonymAttempt,
  mergeExcluded,
  nextSpellHint,
  normalizeAnswer,
  requiredCorrect,
  spellHintView,
  SPELL_HINT_LIMIT,
  type SynonymEvaluation,
} from '@/lib/quizRules'
import ReviewCharts from '@/sections/ReviewCharts'
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

type QMode = 'zh2en' | 'en2zh' | 'spell' | 'synonym'
type WordMode = 'zh2en' | 'en2zh' | 'spell'

interface Question {
  key: string
  mode: QMode
  wordId?: string
  setId?: string
  setName?: string
  prompt: string
  sub?: string
  phonetic?: string
  options?: Array<{ id: string; label: string }>
  answer: string
  members?: Array<{ id: string; text: string }>
  /** 'wrong-only': recognition warm-up in progressive mode — a correct pick
      proves little, so only a miss touches the mastery stats */
  credit?: 'wrong-only'
}

interface AnswerRec {
  q: Question
  correct: boolean
  given: string
  skipped?: boolean
  synonym?: SynonymEvaluation
  hintUsed?: number
}

interface RoundConfig {
  mode: QuizMode
  scope: string
  count: string
}

const MODE_LABEL: Record<QuizMode, string> = {
  zh2en: '看中文 · 选英文',
  en2zh: '看英文 · 选中文',
  spell: '听义拼写',
  mixed: '混合模式',
  progressive: '渐进掌握',
  synonym: '近义组回忆',
}

const MODE_SUB: Record<QuizMode, string> = {
  zh2en: '再认练习',
  en2zh: '再认练习',
  spell: '主动回忆',
  mixed: '三种现有题型轮换',
  progressive: '先认出 · 再写出',
  synonym: '每组一题 · 按词计分',
}

const MODES: QuizMode[] = ['zh2en', 'en2zh', 'spell', 'mixed', 'progressive', 'synonym']

const BADGE_LABEL: Record<QMode, string> = {
  zh2en: '看中文 · 选英文',
  en2zh: '看英文 · 选中文',
  spell: '听义拼写',
  synonym: '近义组回忆',
}

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
  const [notice, setNotice] = useState('')

  const [questions, setQuestions] = useState<Question[]>([])
  const [index, setIndex] = useState(0)
  const [answers, setAnswers] = useState<AnswerRec[]>([])
  const [retryQueue, setRetryQueue] = useState<AnswerRec[]>([])
  const [feedback, setFeedback] = useState<'idle' | 'correct' | 'wrong'>('idle')
  const [chosen, setChosen] = useState<string | null>(null)
  const [spellInput, setSpellInput] = useState('')
  const [spellWrong, setSpellWrong] = useState('')
  const [hint, setHint] = useState(0)
  const [synonymInputs, setSynonymInputs] = useState<string[]>([])
  const [synonymEval, setSynonymEval] = useState<SynonymEvaluation | null>(null)
  const [confirmEarly, setConfirmEarly] = useState(false)
  const [roundConfig, setRoundConfig] = useState<RoundConfig>({ mode: 'mixed', scope: 'all', count: '10' })
  const [excludedWords, setExcludedWords] = useState<string[]>([])
  const [excludedSets, setExcludedSets] = useState<string[]>([])

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const spellRef = useRef<HTMLInputElement>(null)
  const pendingRec = useRef<AnswerRec | null>(null)
  const synonymKeyRef = useRef('')

  const confusableGroups = useMemo(
    () =>
      Object.values(state.groups)
        .filter((g) => g.kind !== 'single' && g.wordIds.length > 1)
        .sort((a, b) => b.wordIds.length - a.wordIds.length),
    [state.groups],
  )

  const synonymGroups = useMemo(
    () =>
      Object.values(state.synonymSets)
        .filter((set) => set.wordIds.filter((id) => !!state.words[id]).length >= 2)
        .sort((a, b) => b.createdAt - a.createdAt),
    [state.synonymSets, state.words],
  )

  function wordsInScope(scopeValue: string): Word[] {
    if (scopeValue.startsWith('custom:')) {
      return (state.customSets?.[scopeValue.slice(7)]?.wordIds ?? []).map(id=>state.words[id]).filter((word):word is Word=>!!word)
    }
    if (scopeValue.startsWith('group:')) {
      const group = state.groups[scopeValue.slice(6)]
      if (!group) return allWords
      return group.wordIds
        .map((id) => state.words[id])
        .filter((word): word is Word => !!word)
    }
    return allWords
  }

  function setsInScope(scopeValue: string): SynonymSet[] {
    if (scopeValue.startsWith('set:')) {
      const id = scopeValue.slice(4)
      return synonymGroups.filter((set) => set.id === id)
    }
    return synonymGroups
  }

  const scopeWords = useMemo(
    () => wordsInScope(scope),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, allWords, state.groups, state.words, state.customSets],
  )
  const scopeSets = useMemo(
    () => setsInScope(scope),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, synonymGroups],
  )
  const availableCount = mode === 'synonym' ? scopeSets.length : scopeWords.length
  const q = questions[index]
  const liveWord = q?.wordId ? state.words[q.wordId] : undefined

  const liveSynonymMembers = useMemo(() => {
    if (!q || q.mode !== 'synonym' || !q.setId) return []
    const set = state.synonymSets[q.setId]
    if (!set) return []
    return set.wordIds
      .map((id) => state.words[id])
      .filter((word): word is Word => !!word)
      .map((word) => ({ id: word.id, text: word.text }))
  }, [q, state.synonymSets, state.words])

  const membersForQuestion = q?.members ?? []
  const isStale = feedback === 'idle' && !!q && (q.mode === 'synonym'
    ? liveSynonymMembers.length < 2 || (!state.synonymSets[q.setId!] || groupTitle(state,{kind:'synonym',id:q.setId!}) !== q.setName) ||
      JSON.stringify(liveSynonymMembers) !== JSON.stringify(membersForQuestion)
    : !liveWord || (q.mode === 'en2zh' ? q.answer !== meaningOf(liveWord) : q.prompt !== meaningOf(liveWord)))

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  useEffect(() => {
    if (phase === 'running' && q?.mode === 'spell') spellRef.current?.focus()
  }, [phase, index, q])

  // Freeze question members. Any library edit invalidates the unanswered question.
  useEffect(() => {
    if (!q || q.mode !== 'synonym') {
      synonymKeyRef.current = ''
      setSynonymInputs([])
      return
    }
    if (synonymKeyRef.current !== q.key) {
      synonymKeyRef.current = q.key
      setSynonymInputs(Array(membersForQuestion.length).fill(''))
      setSynonymEval(null)
      return
    }
    setSynonymInputs((current) =>
      current.length === membersForQuestion.length
        ? current
        : Array.from({ length: membersForQuestion.length }, (_, i) => current[i] ?? ''),
    )
  }, [q, membersForQuestion.length])

  // Scope values must not keep pointing at an item deleted in management.
  useEffect(() => {
    if (scope.startsWith('set:') && !state.synonymSets[scope.slice(4)]) setScope('all')
    if (scope.startsWith('group:') && !state.groups[scope.slice(6)]) setScope('all')
  }, [scope, state.synonymSets, state.groups])

  // "开始复习" from the Welcome page lands here and starts a round directly.
  const lastAutoStart = useRef(0)
  useEffect(() => {
    if (autoStartKey && autoStartKey !== lastAutoStart.current) {
      lastAutoStart.current = autoStartKey
      if (phase !== 'running') start()
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
      const label = labelOf(w)
      if (!seen.has(label) && label.trim()) {
        seen.add(label)
        out.push(w)
      }
      if (out.length >= 3) break
    }
    return out
  }

  function buildWordQuestion(word: Word, m: WordMode): Question {
    if (m === 'zh2en') {
      const ds = distractorsFor(word, (w) => w.text)
      if (ds.length < 3) return buildWordQuestion(word, 'spell')
      return {
        key: `zh2en:${word.id}`,
        mode: m,
        wordId: word.id,
        prompt: meaningOf(word),
        sub: '选择对应的英文单词',
        options: shuffle([
          { id: word.id, label: word.text },
          ...ds.map((w) => ({ id: w.id, label: w.text })),
        ]),
        answer: word.text,
      }
    }
    if (m === 'en2zh') {
      const ds = distractorsFor(word, meaningOf)
      if (ds.length < 3) return buildWordQuestion(word, 'spell')
      return {
        key: `en2zh:${word.id}`,
        mode: m,
        wordId: word.id,
        prompt: word.text,
        sub: word.phonetic,
        options: shuffle([
          { id: word.id, label: meaningOf(word) },
          ...ds.map((w) => ({ id: w.id, label: meaningOf(w) })),
        ]),
        answer: meaningOf(word),
      }
    }
    // Spelling never shows the phonetic or a letter count up front; both are
    // behind the explicit three-step hint control.
    return {
      key: `spell:${word.id}`,
      mode: 'spell',
      wordId: word.id,
      prompt: meaningOf(word),
      sub: word.meanings[0]?.pos || undefined,
      phonetic: word.phonetic,
      answer: word.text,
    }
  }

  function buildSynonymQuestion(set: SynonymSet): Question | null {
    const members = set.wordIds
      .map((id) => state.words[id])
      .filter((word): word is Word => !!word)
      .map((word) => ({ id: word.id, text: word.text }))
    if (members.length < 2) return null
    return {
      key: `synonym:${set.id}`,
      mode: 'synonym',
      setId: set.id,
      setName: groupTitle(state,{kind:'synonym',id:set.id}),
      // Only the group name is shown before submission — never the notes.
      prompt: groupTitle(state,{kind:'synonym',id:set.id}),
      sub: undefined,
      answer: members.map((member) => member.text).join(' · '),
      members,
    }
  }

  /* ---------- round control ---------- */

  function startRound(
    config: RoundConfig,
    options: { resetExclusions: boolean; fromSummary?: boolean },
  ): boolean {
    const blockedWords = options.resetExclusions ? [] : excludedWords
    const blockedSets = options.resetExclusions ? [] : excludedSets
    const prefix = options.fromSummary ? '下一轮' : ''
    let qs: Question[] = []

    if (config.mode === 'synonym') {
      const pool = setsInScope(config.scope).filter((set) => !blockedSets.includes(set.id))
      if (pool.length === 0) {
        setNotice(
          `${prefix}没有可抽的近义组了。${
            blockedSets.length > 0
              ? '之前未通过的词群已按规则排除；'
              : '请先在「录入与管理词汇」中创建至少两个成员的近义组；'
          }可以重练错题，或返回设置重新选择。`,
        )
        return false
      }
      const n =
        config.count === 'all'
          ? pool.length
          : Math.min(Number(config.count) || pool.length, pool.length)
      qs = pickScheduled(pool, set=>set.wordIds.map(id=>state.stats[id]), n)
        .map((set) => buildSynonymQuestion(set))
        .filter((item): item is Question => !!item)
    } else {
      const pool = wordsInScope(config.scope).filter((word) => !blockedWords.includes(word.id))
      if (pool.length === 0) {
        setNotice(
          `${prefix}没有可抽的单词了。${
            blockedWords.length > 0
              ? '之前答错的词已按规则排除；'
              : '请先在词库中录入单词；'
          }可以重练错题，或返回设置重新选择。`,
        )
        return false
      }
      const n =
        config.count === 'all'
          ? pool.length
          : Math.min(Number(config.count) || pool.length, pool.length)
      const picked = pickScheduled(pool, word=>[state.stats[word.id]], n)
      if (config.mode === 'progressive') {
        const stage1 = picked
          .map((word, i) => {
            const question = buildWordQuestion(word, i % 2 === 0 ? 'zh2en' : 'en2zh')
            if (question.mode !== 'spell') question.credit = 'wrong-only'
            return question
          })
          .filter((item): item is Question => !!item)
        const stage2 = shuffle(picked).map((word) => buildWordQuestion(word, 'spell'))
        qs = [...stage1, ...stage2]
      } else {
        const modes: WordMode[] =
          config.mode === 'mixed' ? ['zh2en', 'en2zh', 'spell'] : [config.mode]
        picked.forEach((word, i) => {
          const question = buildWordQuestion(word, modes[i % modes.length])
          if (question) qs.push(question)
        })
      }
    }

    if (qs.length === 0) {
      setNotice(`${prefix}没有生成可作答的题目，请检查词库内容或返回设置重新选择。`)
      return false
    }

    if (options.resetExclusions) {
      setExcludedWords([])
      setExcludedSets([])
      setRetryQueue([])
    }
    setRoundConfig(config)
    setQuestions(qs)
    setIndex(0)
    setAnswers([])
    setFeedback('idle')
    setChosen(null)
    setSpellInput('')
    setSpellWrong('')
    setHint(0)
    setSynonymInputs([])
    setSynonymEval(null)
    setNotice('')
    setPhase('running')
    return true
  }

  function start() {
    if (availableCount === 0) {
      setNotice(
        mode === 'synonym'
          ? '当前范围没有可考察的近义组。请先在「录入与管理词汇」中创建至少两个成员的近义组。'
          : '当前范围没有可考察的单词。请先在词库中录入单词。',
      )
      return
    }
    startRound({ mode, scope, count }, { resetExclusions: true })
  }

  function nextRound() {
    startRound(roundConfig, { resetExclusions: false, fromSummary: true })
  }

  function backToSetup() {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    pendingRec.current = null
    setExcludedWords([])
    setExcludedSets([])
    setRetryQueue([])
    setQuestions([])
    setAnswers([])
    setIndex(0)
    setFeedback('idle')
    setSynonymEval(null)
    setSynonymInputs([])
    setSpellInput('')
    setSpellWrong('')
    setNotice('')
    setPhase('setup')
  }

  /* ---------- answering ---------- */

  function needsRetry(record: AnswerRec): boolean {
    return !record.skipped && (!record.correct || !!record.hintUsed ||
      !!record.synonym?.entries.some(entry => entry.verdict !== 'correct'))
  }

  function missesOf(records: AnswerRec[]): { words: string[]; sets: string[] } {
    const words: string[] = []
    const sets: string[] = []
    for (const record of records) {
      if (!needsRetry(record)) continue
      if (record.q.mode === 'synonym') {
        if (record.q.setId) sets.push(record.q.setId)
      } else if (record.q.wordId) {
        words.push(record.q.wordId)
      }
    }
    return { words, sets }
  }

  function commit(record: AnswerRec) {
    pendingRec.current = null
    const nextAnswers = [...answers, record]
    setAnswers(nextAnswers)
    if (index + 1 >= questions.length) {
      setRetryQueue(previous => {
        const byKey = new Map(previous.map(record => [record.q.key, record]))
        for (const record of nextAnswers) {
          if (record.skipped) continue
          if (needsRetry(record)) byKey.set(record.q.key, record)
          else byKey.delete(record.q.key)
        }
        return [...byKey.values()]
      })
      const missed = missesOf(nextAnswers)
      if (missed.words.length > 0) {
        setExcludedWords((previous) => [...mergeExcluded(previous, missed.words)])
      }
      if (missed.sets.length > 0) {
        setExcludedSets((previous) => [...mergeExcluded(previous, missed.sets)])
      }
      setPhase('summary')
    } else {
      setIndex(index + 1)
      setFeedback('idle')
      setChosen(null)
      setSpellInput('')
      setSpellWrong('')
      setHint(0)
      setSynonymInputs([])
      setSynonymEval(null)
    }
  }

  function advance(record: AnswerRec, delay: number) {
    pendingRec.current = record
    timer.current = setTimeout(() => {
      timer.current = null
      commit(record)
    }, delay)
  }

  function answerChoice(optionId: string, label: string) {
    if (feedback !== 'idle' || !q || isStale) return
    const correct = label === q.answer
    if (q.wordId && (q.credit !== 'wrong-only' || !correct)) {
      recordAnswer(q.wordId, correct)
    }
    setChosen(optionId)
    setFeedback(correct ? 'correct' : 'wrong')
    const record: AnswerRec = { q, correct, given: label }
    if (correct) {
      advance(record, 750)
    } else {
      pendingRec.current = record
    }
  }

  function answerSpell() {
    if (feedback !== 'idle' || !q || q.mode !== 'spell' || isStale) return
    const raw = spellInput.trim()
    if (!raw) return
    const correct = checkSpelling(raw, q.answer)
    if (q.wordId && (!correct || hint === 0 || hint === SPELL_HINT_LIMIT)) recordAnswer(q.wordId, correct && hint === 0)
    setFeedback(correct ? 'correct' : 'wrong')
    const record: AnswerRec = { q, correct, given: raw, hintUsed: hint }
    if (correct) {
      advance(record, 750)
    } else {
      setSpellWrong(raw)
      pendingRec.current = record
    }
  }

  function submitSynonym(force: boolean) {
    if (feedback !== 'idle' || !q || q.mode !== 'synonym' || isStale) return
    const members = membersForQuestion
    if (members.length < 2) return
    const filled = synonymInputs.filter((value) => normalizeAnswer(value).length > 0).length
    if (!force && filled < requiredCorrect(members.length)) {
      setConfirmEarly(true)
      return
    }
    const evaluation = evaluateSynonymAttempt(synonymInputs, members)
    // One honest record per member: words actually written correctly get
    // credit, missing/misspelled words are recorded as wrong. A single group
    // answer can never inflate all members' scores.
    for (const entry of evaluation.entries) {
      recordAnswer(entry.wordId, entry.verdict === 'correct')
    }
    setSynonymEval(evaluation)
    setFeedback(evaluation.passed ? 'correct' : 'wrong')
    pendingRec.current = {
      q,
      correct: evaluation.passed,
      given: synonymInputs.filter((value) => normalizeAnswer(value).length > 0).join(' / '),
      synonym: evaluation,
    }
  }

  function requestSynonymSubmit() {
    if (feedback !== 'idle' || !q || q.mode !== 'synonym' || isStale) return
    const filled = synonymInputs.filter((value) => normalizeAnswer(value).length > 0).length
    if (filled < requiredCorrect(membersForQuestion.length)) setConfirmEarly(true)
    else submitSynonym(false)
  }

  function nextNow() {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    if (!q) return
    const record = pendingRec.current ?? {
      q,
      correct: false,
      given: spellInput.trim(),
      skipped: true,
    }
    commit(record)
  }

  function skipStale() {
    if (!q) {
      setPhase('setup')
      return
    }
    commit({ q, correct: false, given: '', skipped: true })
  }

  function retryWrong() {
    const wrong = retryQueue
    const seen = new Set<string>()
    const qs: Question[] = []
    for (const answer of wrong) {
      const dedupeKey =
        answer.q.mode === 'synonym' ? `set:${answer.q.setId}` : `${answer.q.mode}:${answer.q.wordId}`
      if (seen.has(dedupeKey)) continue
      if (answer.q.mode === 'synonym') {
        const set = answer.q.setId ? state.synonymSets[answer.q.setId] : undefined
        if (set) {
          const built = buildSynonymQuestion(set)
          if (built) {
            qs.push(built)
            seen.add(dedupeKey)
          }
        }
      } else if (answer.q.wordId) {
        const word = state.words[answer.q.wordId]
        if (word) {
          qs.push(buildWordQuestion(word, answer.q.mode as WordMode))
          seen.add(dedupeKey)
        }
      }
    }
    if (qs.length === 0) {
      setNotice('错题对应的单词或近义组已从词库中删除，暂时无法重练。可以再来一轮或返回设置。')
      return
    }
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
    pendingRec.current = null
    setQuestions(qs)
    setIndex(0)
    setAnswers([])
    setFeedback('idle')
    setChosen(null)
    setSpellInput('')
    setSpellWrong('')
    setHint(0)
    setSynonymInputs([])
    setSynonymEval(null)
    setNotice('')
    setPhase('running')
  }

  /* ---------- setup ---------- */

  if (phase === 'setup') {
    const synonymMode = mode === 'synonym'
    const none = availableCount === 0
    const countSuffix = synonymMode ? '组' : '题'
    return (
      <div className="space-y-6">
        <div className="stagger-in quiz-setup rounded-2xl border bg-card p-6 shadow-sm sm:p-8">
          <h2 className="font-word text-2xl tracking-tight">开始抽查</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            选择练习方式与范围；答错后可查看答案并巩固。
          </p>
          {allWords.length === 0 ? (
            <p className="mt-4 rounded-lg border border-dashed bg-background px-4 py-3 text-sm text-muted-foreground">
              还没有可考察的单词。请先在「录入与管理词汇」中录入单词；下方的图表也会在你有学习记录后变得有意义。
            </p>
          ) : null}

          <div className="quiz-setup-layout mt-6 grid gap-6">
            <div className="space-y-2">
              <Label>考察方式</Label>
              <div className="grid grid-cols-2 gap-2">
                {MODES.map((m) => (
                  <button
                    key={m}
                    data-guide={`mode-${m}`}
                    onClick={() => {
                      setMode(m)
                      setScope('all')
                      setNotice('')
                    }}
                    className={`pressable rounded-lg border px-3 py-2.5 text-left transition-colors duration-150 ${
                      m === 'progressive' || m === 'synonym' ? 'col-span-2' : ''
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
              {synonymMode && synonymGroups.length === 0 ? (
                <p className="text-xs leading-5 text-amber-800 dark:text-amber-300">
                  还没有近义组。到「录入与管理词汇」整理词群后，即可开始回忆。
                </p>
              ) : null}
            </div>

            <div className="space-y-5 rounded-xl bg-background p-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>范围</Label>
                  <Select value={scope} onValueChange={setScope}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        {synonymMode
                          ? `全部近义组（${synonymGroups.length}）`
                          : `全部单词（${allWords.length}）`}
                      </SelectItem>
                      {synonymMode
                        ? synonymGroups.map((set) => {
                            const size = set.wordIds.filter((id) => !!state.words[id]).length
                            return (
                              <SelectItem key={set.id} value={`set:${set.id}`}>
                                {groupTitle(state,{kind:'synonym',id:set.id})}（{size} 词）
                              </SelectItem>
                            )
                          })
                        : confusableGroups.map((group) => (
                            <SelectItem key={group.id} value={`group:${group.id}`}>
                              {group.wordIds
                                .slice(0, 3)
                                .map((id) => state.words[id]?.text)
                                .filter(Boolean)
                                .join(' / ')}
                              {group.wordIds.length > 3 ? ' …' : ''}（{group.wordIds.length}）
                            </SelectItem>
                          ))}
                      {!synonymMode && Object.values(state.customSets??{}).map(group=><SelectItem key={'custom-'+group.id} value={'custom:'+group.id}>{groupTitle(state,{kind:'custom',id:group.id})}（{group.wordIds.length}）</SelectItem>)}
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
                      <SelectItem value="5">5 {countSuffix}</SelectItem>
                      <SelectItem value="10">10 {countSuffix}</SelectItem>
                      <SelectItem value="20">20 {countSuffix}</SelectItem>
                      <SelectItem value="all">
                        全部（{availableCount} {countSuffix}）
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {notice ? (
                <p
                  role="alert"
                  className="rounded-lg border border-amber-600/30 bg-amber-600/10 px-3 py-2 text-xs leading-5 text-amber-900 dark:text-amber-200"
                >
                  {notice}
                </p>
              ) : null}

              <Button
                className="pressable h-11 w-full text-base"
                onClick={start}
                disabled={none}
              >
                开始（{availableCount} {synonymMode ? '组' : '词'}在范围内）
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                {synonymMode
                  ? '每组一道题。成员顺序不限，重复只算一次；提交时才检查拼写。'
                  : '优先复习到期的词，再学习新词'}
                {mode === 'progressive' && ' · 渐进模式下每个词出两题（先选择、后拼写）'}
              </p>
            </div>
          </div>
        </div>

        <ReviewCharts />
      </div>
    )
  }

  /* ---------- summary ---------- */

  if (phase === 'summary') {
    const answered = answers.filter((answer) => !answer.skipped)
    const skipped = answers.filter((answer) => answer.skipped)
    const correct = answered.filter((answer) => answer.correct).length
    const pct = answered.length ? Math.round((correct / answered.length) * 100) : 0
    const wrong = retryQueue
    return (
      <div className="stagger-in space-y-6">
        <div className="rounded-2xl border bg-card p-6 text-center shadow-sm sm:p-10">
          <p className="text-sm text-muted-foreground">本轮成绩</p>
          <p className="font-word mt-2 text-5xl tracking-tight">
            {correct}
            <span className="text-2xl text-muted-foreground">/{answered.length}</span>
          </p>
          <p className="mt-2 text-sm text-muted-foreground">
            正确率 {pct}%{answered.some(answer => answer.hintUsed) ? ' · 含提示后完成' : pct === 100 ? ' · 完美' : pct >= 80 ? ' · 很不错' : pct >= 60 ? ' · 继续加油' : ' · 错题值得重练'}
          </p>
          {skipped.length > 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">
              另有 {skipped.length} 题因词库内容变动跳过，不计分。
            </p>
          ) : null}
          <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
            <Button
              className="pressable"
              onClick={retryWrong}
              disabled={wrong.length === 0}
            >
              错题重练（{wrong.length}）
            </Button>
            <Button className="pressable" onClick={nextRound}>
              再来一轮
            </Button>
            <Button variant="outline" className="pressable" onClick={backToSetup}>
              返回
            </Button>
          </div>
          {notice ? (
            <p
              role="alert"
              className="mx-auto mt-4 max-w-xl rounded-lg border border-amber-600/30 bg-amber-600/10 px-3 py-2 text-left text-xs leading-5 text-amber-900 dark:text-amber-200"
            >
              {notice}
            </p>
          ) : null}
          <p className="mt-3 text-xs text-muted-foreground">
            再来一轮沿用当前模式、题量与范围；错题保留在「错题重练」中。
          </p>
        </div>

        <div>
          <p className="mb-3 text-sm font-medium text-muted-foreground">逐题回顾</p>
          <div className="columns-1 gap-4 sm:columns-2 xl:columns-3">
            {answers.map((answer, i) => {
              const word = answer.q.wordId ? state.words[answer.q.wordId] : undefined
              const title =
                answer.q.mode === 'synonym'
                  ? answer.q.setName || '近义组'
                  : word?.text ?? answer.q.answer
              const status = answer.skipped
                ? '已跳过'
                : answer.correct
                  ? answer.q.mode === 'synonym'
                    ? '通过'
                    : '答对'
                  : answer.q.mode === 'synonym'
                    ? '未通过'
                    : '答错'
              return (
                <div
                  key={`${answer.q.key}-${i}`}
                  className="stagger-in mb-4 break-inside-avoid rounded-xl border bg-card p-4 shadow-sm"
                  style={{ transitionDelay: `${Math.min(i, 10) * 40}ms` }}
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`inline-block size-2 shrink-0 rounded-full ${
                        answer.skipped
                          ? 'bg-amber-500'
                          : answer.correct
                            ? 'bg-emerald-600'
                            : 'bg-destructive'
                      }`}
                    />
                    <span className="font-word min-w-0 flex-1 truncate text-lg">{title}</span>
                    <span
                      className={`shrink-0 text-xs ${
                        answer.skipped
                          ? 'text-amber-700 dark:text-amber-300'
                          : answer.correct
                            ? 'text-emerald-600'
                            : 'text-destructive'
                      }`}
                    >
                      {status}
                    </span>
                  </div>

                  {answer.q.mode === 'synonym' ? (
                    <SynonymReview answer={answer} />
                  ) : (
                    <>
                      <p
                        className="mt-1.5 line-clamp-3 text-sm leading-relaxed text-muted-foreground"
                        title={word ? meaningOf(word) : ''}
                      >
                        {word ? meaningOf(word) : '（该词已从词库删除）'}
                      </p>
                      {answer.skipped ? (
                        <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">
                          题目内容在作答前已变动，本题不计分。
                        </p>
                      ) : !answer.correct ? (
                        <div className="mt-2 space-y-1 border-t border-border/60 pt-2 text-xs">
                          <p className="break-words text-muted-foreground">
                            你的答案：
                            <span className="text-destructive line-through decoration-destructive/60">
                              {answer.given || '（未作答）'}
                            </span>
                          </p>
                          <p className="break-words text-muted-foreground">
                            正确答案：
                            <span className="font-word text-sm text-foreground">{answer.q.answer}</span>
                          </p>
                          {answer.hintUsed ? (
                            <p className="text-muted-foreground">本题使用过 {answer.hintUsed}/3 级提示，提示后作答不提升掌握度</p>
                          ) : null}
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  /* ---------- running ---------- */

  if (!q) {
    return (
      <div className="rounded-2xl border border-dashed bg-card p-10 text-center">
        <p className="font-word text-xl">没有可作答的题目</p>
        <Button className="mt-4" variant="outline" onClick={backToSetup}>
          返回设置
        </Button>
      </div>
    )
  }

  const correctSoFar = answers.filter((answer) => answer.correct && !answer.skipped).length
  const filledSynonym = synonymInputs.filter((value) => normalizeAnswer(value).length > 0).length
  const synonymRequired = requiredCorrect(membersForQuestion.length)
  const hintView = q.mode === 'spell' ? spellHintView(hint, q.answer, q.phonetic) : null
  const allSynonymFilled =
    membersForQuestion.length > 0 && filledSynonym >= requiredCorrect(membersForQuestion.length)

  if (isStale) {
    return (
      <div className="study-workspace" aria-label="抽查练习">
        <div className="flex items-center gap-3">
          <Progress value={(index / questions.length) * 100} className="h-1.5 flex-1" />
          <span className="text-sm tabular-nums text-muted-foreground">
            {index + 1}/{questions.length}
          </span>
        </div>
        <div className="rounded-2xl border border-amber-600/30 bg-card p-6 text-center shadow-sm sm:p-10">
          <Badge variant="outline" className="border-amber-600/40 text-amber-800 dark:text-amber-300">
            内容已变动
          </Badge>
          <p className="mt-4 text-lg font-medium">这道题引用的内容已被删除或调整</p>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            {q.mode === 'synonym'
              ? '这个近义组的名称或成员已在管理页改变。本题已暂停，跳过不会写入学习记录。'
              : '这个单词已被删除或释义已修改。本题已暂停，跳过不会写入学习记录。'}
          </p>
          <div className="mt-5 flex flex-col justify-center gap-2 sm:flex-row">
            <Button className="pressable" onClick={skipStale}>
              跳过此题（不计分）
            </Button>
            <Button variant="outline" className="pressable" onClick={backToSetup}>
              结束本轮
            </Button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="study-workspace" aria-label="抽查练习">
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
        className={`stagger-in quiz-question ${
          feedback === 'correct' ? 'flash-correct' : feedback === 'wrong' ? 'flash-wrong' : ''
        }`}
      >
        <div className="quiz-prompt">
          <p className="mb-5 text-xs tracking-widest text-muted-foreground">
            第 {index + 1} 题 · 主动回忆
          </p>
          <div className="mb-1 flex items-center gap-2">
            <Badge variant="outline" className="font-normal">
              {BADGE_LABEL[q.mode]}
            </Badge>
            {q.mode === 'synonym' ? (
              <Badge variant="secondary" className="font-normal">
                {membersForQuestion.length} 个成员
              </Badge>
            ) : null}
          </div>

          <p
            className={`quiz-prompt-text mt-4 tracking-tight ${
              q.mode === 'en2zh' ? 'font-word' : 'font-medium'
            }`}
          >
            {q.prompt}
          </p>
          {q.mode === 'synonym' ? (
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              写出你记得的英文单词，顺序不限。
            </p>
          ) : q.sub ? (
            <p className="mt-2 text-sm text-muted-foreground">{q.sub}</p>
          ) : null}
        </div>

        <div className="quiz-response">
          {q.mode === 'synonym' ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs font-medium text-muted-foreground">
                  填写英文成员 · 已填 {filledSynonym}/{membersForQuestion.length}
                </p>
                <p className="text-xs text-muted-foreground">
                  本题需写对 {synonymRequired}/{membersForQuestion.length}
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {Array.from({ length: membersForQuestion.length }, (_, i) => (
                  <Input
                    key={i}
                    value={synonymInputs[i] ?? ''}
                    onChange={(event) => {
                      const value = event.target.value
                      setSynonymInputs((current) => {
                        const next = [...current]
                        next[i] = value
                        return next
                      })
                    }}
                    onKeyDown={(event) => {
                      if (event.key !== 'Enter' || feedback !== 'idle') return
                      event.preventDefault()
                      requestSynonymSubmit()
                    }}
                    placeholder={`成员 ${i + 1}`}
                    aria-label={`近义组成员拼写 ${i + 1}`}
                    className="font-word h-11"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    disabled={feedback !== 'idle'}
                  />
                ))}
              </div>

              {feedback === 'idle' ? (
                <div className="space-y-2">
                  <Button
                    className={`pressable h-11 w-full sm:w-auto ${
                      allSynonymFilled ? '' : 'bg-secondary text-secondary-foreground hover:bg-secondary/80'
                    }`}
                    variant={allSynonymFilled ? 'default' : 'secondary'}
                    onClick={requestSynonymSubmit}
                  >
                    {allSynonymFilled ? '提交答案' : '提交（还有空未填）'}
                  </Button>
                  <p className="text-xs text-muted-foreground">
                    {allSynonymFilled
                      ? '提交后逐词显示写对、漏写与错写。'
                      : '还有空未填时按钮不高亮，但仍可点击；会先弹窗确认是否提前提交。'}
                  </p>
                </div>
              ) : synonymEval ? (
                <SynonymFeedback
                  evaluation={synonymEval}
                  onNext={nextNow}
                  last={index + 1 >= questions.length}
                />
              ) : null}
            </div>
          ) : q.mode === 'spell' ? (
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input
                  ref={spellRef}
                  value={spellInput}
                  onChange={(event) => setSpellInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return
                    if (feedback === 'idle') answerSpell()
                    else if (feedback === 'wrong') nextNow()
                  }}
                  placeholder={feedback === 'wrong' ? '本题已提交…' : '拼出这个单词…'}
                  className={`font-word h-12 text-xl tracking-wide ${
                    feedback === 'correct'
                      ? 'border-emerald-600 bg-emerald-600/10'
                      : feedback === 'wrong'
                        ? 'border-destructive bg-destructive/10'
                        : ''
                  }`}
                  disabled={feedback !== 'idle'}
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                />
                {feedback === 'idle' ? (
                  <Button
                    className="pressable h-12 px-5"
                    onClick={answerSpell}
                    disabled={!spellInput.trim()}
                  >
                    确定
                  </Button>
                ) : null}
              </div>

              {feedback === 'idle' && hintView ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
                  <Button
                    variant="outline"
                    size="sm"
                    className="pressable"
                    onClick={() => setHint((current) => nextSpellHint(current))}
                    disabled={hint >= SPELL_HINT_LIMIT}
                  >
                    {hint === 0
                      ? '提示：首字母'
                      : hint === 1
                        ? '提示：音标'
                        : hint === 2
                          ? '提示：完整单词'
                          : '已显示完整单词'}
                  </Button>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    提示 {hint}/{SPELL_HINT_LIMIT} · 提示后不提升掌握度；查看完整词后安排巩固
                  </span>
                  {hintView.text ? (
                    <p
                      className={`basis-full rounded-lg bg-background px-3 py-2 text-sm ${
                        hintView.revealed ? 'font-word text-foreground' : 'text-muted-foreground'
                      }`}
                    >
                      {hintView.text}
                    </p>
                  ) : null}
                </div>
              ) : null}

              {feedback === 'wrong' ? (
                <div className="space-y-2 text-sm">
                  <p>
                    正确拼写：
                    <span className="font-word ml-1 text-lg font-medium text-emerald-700 dark:text-emerald-300">
                      {q.answer}
                    </span>
                  </p>
                  {spellWrong ? (
                    <p className="text-xs text-muted-foreground">
                      你的拼写：
                      <span className="line-through">{spellWrong}</span>
                    </p>
                  ) : null}
                  <Button autoFocus className="pressable h-11" onClick={nextNow}>
                    {index + 1 >= questions.length ? '查看本轮结果' : '下一题（Enter）'}
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="quiz-options">
              <p className="col-span-full mb-1 text-xs font-medium text-muted-foreground">选择一个答案</p>
              {q.options?.map((option, i) => {
                const isAnswer = option.label === q.answer
                const isChosen = chosen === option.id
                let cls = 'border bg-background hover:bg-accent hover:border-primary/40'
                if (feedback !== 'idle') {
                  if (isAnswer) {
                    cls = 'border-emerald-600 bg-emerald-600/10 text-emerald-800 dark:text-emerald-300'
                  } else if (isChosen) {
                    cls = 'border-destructive bg-destructive/10 text-destructive'
                  } else {
                    cls = 'border bg-background opacity-50'
                  }
                }
                return (
                  <button
                    key={option.id}
                    disabled={feedback !== 'idle'}
                    onClick={() => answerChoice(option.id, option.label)}
                    className={`quiz-option pressable option-in rounded-xl px-4 py-4 text-left transition-colors duration-150 ${cls} ${
                      q.mode === 'zh2en' ? 'font-word text-xl' : 'text-base'
                    }`}
                    style={{ transitionDelay: `${i * 55}ms` }}
                  >
                    <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full border text-xs text-muted-foreground">
                      {String.fromCharCode(65 + i)}
                    </span>
                    <span className="min-w-0">{option.label}</span>
                  </button>
                )
              })}
              {feedback === 'wrong' ? (
                <div className="col-span-full space-y-2">
                  <p className="text-sm text-muted-foreground">
                    正确答案：
                    <span className="font-word text-foreground">{q.answer}</span>
                  </p>
                  <Button autoFocus className="pressable h-11" onClick={nextNow}>
                    {index + 1 >= questions.length ? '查看本轮结果' : '下一题（Enter）'}
                  </Button>
                </div>
              ) : null}
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <button
          className="text-sm text-muted-foreground underline-offset-2 hover:underline"
          onClick={backToSetup}
        >
          结束本轮
        </button>
      </div>

      <AlertDialog open={confirmEarly} onOpenChange={setConfirmEarly}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>还有空没填，提前提交？</AlertDialogTitle>
            <AlertDialogDescription>
              本题共 {membersForQuestion.length} 个成员，仍有{' '}
              {Math.max(0, membersForQuestion.length - filledSynonym)} 个输入框为空。
              提前提交会按当前已填内容评分，空格计为漏写，不会补分。
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>继续填写</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmEarly(false)
                submitSynonym(true)
              }}
            >
              提前提交
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

/* ---------- synonym review pieces ---------- */

function SynonymFeedback({
  evaluation,
  onNext,
  last,
}: {
  evaluation: SynonymEvaluation
  onNext: () => void
  last: boolean
}) {
  return (
    <div className="space-y-2 border-t pt-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`font-medium ${
            evaluation.passed ? 'text-emerald-700 dark:text-emerald-300' : 'text-destructive'
          }`}
        >
          {evaluation.passed ? '本题通过' : '本题未通过'}
        </span>
        <span className="text-xs text-muted-foreground">
          写对 {evaluation.correct}/{evaluation.total} · 需 ≥ {evaluation.required}
        </span>
      </div>
      <ul className="space-y-1">
        {evaluation.entries.map((entry) => (
          <li key={entry.wordId} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs">
            <span
              className={`inline-block min-w-8 ${
                entry.verdict === 'correct'
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : entry.verdict === 'wrong'
                    ? 'text-destructive'
                    : 'text-amber-700 dark:text-amber-300'
              }`}
            >
              {entry.verdict === 'correct' ? '写对' : entry.verdict === 'wrong' ? '错写' : '漏写'}
            </span>
            <span className="font-word text-sm">{entry.expected}</span>
            {entry.verdict === 'wrong' && entry.given ? (
              <span className="text-muted-foreground">
                你的拼写：<span className="line-through">{entry.given}</span>
              </span>
            ) : entry.verdict === 'correct' &&
              entry.given &&
              normalizeAnswer(entry.given) !== normalizeAnswer(entry.expected) ? (
              <span className="text-muted-foreground">（{entry.given}）</span>
            ) : null}
          </li>
        ))}
      </ul>
      {evaluation.duplicates.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          重复填写只计一次：{evaluation.duplicates.join('、')}
        </p>
      ) : null}
      {evaluation.extraWrong.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          未能对应到成员：{evaluation.extraWrong.join('、')}
        </p>
      ) : null}
      <Button autoFocus className="pressable h-11" onClick={onNext}>
        {last ? '查看本轮结果' : '下一题'}
      </Button>
    </div>
  )
}

function SynonymReview({ answer }: { answer: AnswerRec }) {
  const evaluation = answer.synonym
  if (answer.skipped || !evaluation) {
    return (
      <p className="mt-2 border-t pt-2 text-xs text-muted-foreground">
        {answer.skipped
          ? '题目内容在作答前已变动，本题不计分。'
          : '本题没有可显示的近义组作答详情。'}
      </p>
    )
  }
  return (
    <div className="mt-2 space-y-2 border-t border-border/60 pt-2 text-xs">
      <p
        className={
          evaluation.passed
            ? 'text-emerald-700 dark:text-emerald-300'
            : 'text-destructive'
        }
      >
        {evaluation.passed ? '通过' : '未通过'} · 写对 {evaluation.correct}/{evaluation.total}，需 ≥{' '}
        {evaluation.required}
      </p>
      <ul className="space-y-1">
        {evaluation.entries.map((entry) => (
          <li key={entry.wordId} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span
              className={`min-w-8 ${
                entry.verdict === 'correct'
                  ? 'text-emerald-700 dark:text-emerald-300'
                  : entry.verdict === 'wrong'
                    ? 'text-destructive'
                    : 'text-amber-700 dark:text-amber-300'
              }`}
            >
              {entry.verdict === 'correct' ? '写对' : entry.verdict === 'wrong' ? '错写' : '漏写'}
            </span>
            <span className="font-word text-sm">{entry.expected}</span>
            {entry.verdict === 'wrong' && entry.given ? (
              <span className="text-muted-foreground line-through">{entry.given}</span>
            ) : null}
          </li>
        ))}
      </ul>
      {evaluation.duplicates.length > 0 ? (
        <p className="text-muted-foreground">重复只计一次：{evaluation.duplicates.join('、')}</p>
      ) : null}
      {evaluation.extraWrong.length > 0 ? (
        <p className="text-muted-foreground">未能对应：{evaluation.extraWrong.join('、')}</p>
      ) : null}
    </div>
  )
}
