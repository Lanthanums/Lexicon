import ActivityChart from '@/sections/ActivityChart'
import { useEffect, useMemo, useRef, useState } from 'react'
import UnifiedEntry from '@/sections/UnifiedEntry'
import { useLibrary, dayKey } from '@/store/library'
import { lookupWord, type LookupResult } from '@/lib/dictionary'
import type { DictProviderConfig, Word } from '@/types'
import { AddWordCard } from '@/sections/AddWordCard'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

function greeting(hour: number): string {
  if (hour < 6) return '夜深了'
  if (hour < 12) return '早上好'
  if (hour < 18) return '下午好'
  return '晚上好'
}

/** freeapi.me Word-of-the-Day (Merriam-Webster sourced, CORS open) */
interface Wotd {
  word: string
  definition?: string
  partOfSpeech?: string
  example?: string | null
  etymology?: string
  date?: string
  source?: string
}

interface DailyCache {
  wotd: Wotd
  data: LookupResult | null
}

interface DailyState {
  word: string
  /** freeapi = today's genuine WotD · library = offline fallback from the user's own words */
  source: 'freeapi' | 'library' | null
  wotd?: Wotd
  data: LookupResult | null
  libWord?: Word
  status: 'loading' | 'ready' | 'empty'
}

async function fetchWotd(signal?: AbortSignal): Promise<Wotd | null> {
  try {
    const ctrl = new AbortController()
    const t = setTimeout(() => ctrl.abort(), 8000)
    const onAbort = () => ctrl.abort()
    signal?.addEventListener('abort', onAbort)
    try {
      const res = await fetch('https://wordoftheday.freeapi.me/', {
        signal: ctrl.signal,
      })
      if (!res.ok) return null
      const data = (await res.json()) as Wotd
      return data.word ? data : null
    } finally {
      clearTimeout(t)
      signal?.removeEventListener('abort', onAbort)
    }
  } catch {
    return null
  }
}

/** stable string hash → deterministic per-day library pick */
function hashStr(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

function useDailyWord(
  providers: DictProviderConfig[],
  words: Record<string, Word>,
): DailyState & { retry: () => void; shuffle: () => void } {
  const [state, setState] = useState<DailyState>(() => {
    const list = Object.values(words).sort((a, b) => a.text.localeCompare(b.text))
    const word = list.length ? list[hashStr(dayKey()) % list.length] : undefined
    return word ? { word: word.text, source: 'library', data: null, libWord: word, status: 'ready' }
      : { word: '', source: null, data: null, status: 'empty' }
  })
  const [attempt, setAttempt] = useState(0)
  const [shuffleTick, setShuffleTick] = useState(0)
  // local-date stamp: rolls at the user's midnight, not UTC
  const [dayStamp, setDayStamp] = useState(() => dayKey())
  const wordsRef = useRef(words)
  wordsRef.current = words
  const currentRef = useRef(state.word)
  useEffect(() => {
    currentRef.current = state.word
  }, [state.word])

  // watch for the calendar day rolling over while the page stays open
  useEffect(() => {
    const check = () => {
      const k = dayKey()
      if (k !== dayStamp) {
        setDayStamp(k)
        setShuffleTick(0)
      }
    }
    const t = setInterval(check, 30_000)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', check)
      window.removeEventListener('focus', check)
    }
  }, [dayStamp])

  useEffect(() => {
    let cancelled = false
    // Keep the local word visible while the optional daily source loads.
    ;(async () => {
      // 1) today's genuine Word-of-the-Day — cached per local date
      const cacheKey = `lexicon-daily-${dayStamp}`
      let cached: DailyCache | null = null
      try {
        const raw = localStorage.getItem(cacheKey)
        if (raw) cached = JSON.parse(raw) as DailyCache
      } catch {
        /* bad cache — refetch */
      }
      if (!cached) {
        const wotd = await fetchWotd()
        if (cancelled) return
        if (wotd?.word) {
          let data: LookupResult | null = null
          try {
            data = await lookupWord(wotd.word.toLowerCase(), undefined, providers)
          } catch {
            /* phonetic/add-offline — the English card still renders */
          }
          if (cancelled) return
          cached = { wotd, data }
          try {
            for (const k of Object.keys(localStorage)) {
              if (k.startsWith('lexicon-daily-') && k !== cacheKey)
                localStorage.removeItem(k)
            }
            localStorage.setItem(cacheKey, JSON.stringify(cached))
          } catch {
            /* storage full — fine */
          }
        }
      }
      if (cached) {
        setState({
          word: cached.wotd.word!.toLowerCase(),
          source: 'freeapi',
          wotd: cached.wotd,
          data: cached.data,
          status: 'ready',
        })
        return
      }

      // 2) offline → fall back to the user's own library
      const lib = Object.values(wordsRef.current).sort((a, b) =>
        a.text.localeCompare(b.text),
      )
      if (lib.length === 0) {
        if (!cancelled)
          setState({ word: '', source: null, data: null, status: 'empty' })
        return
      }
      let pick: Word
      if (shuffleTick > 0) {
        const pool = lib.filter((w) => w.text !== currentRef.current)
        pick = pool[Math.floor(Math.random() * pool.length)] ?? lib[0]
      } else {
        pick = lib[hashStr(dayStamp) % lib.length]
      }
      if (!cancelled)
        setState({
          word: pick.text,
          source: 'library',
          data: null,
          libWord: pick,
          status: 'ready',
        })
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt, dayStamp, shuffleTick])

  return {
    ...state,
    retry: () => setAttempt((a) => a + 1),
    shuffle: () => setShuffleTick((t) => t + 1),
  }
}

export default function Welcome({
  onStartQuiz,
  onLocateGroup,
}: {
  onStartQuiz: () => void
  onLocateGroup: (groupId: string) => void
}) {
  const { state } = useLibrary()
  const daily = useDailyWord(state.settings.dictProviders, state.words)
  const now = new Date()

  const wordCount = Object.keys(state.words).length
  const dailyInLibrary = useMemo(
    () => Object.values(state.words).some((w) => w.text === daily.word),
    [state.words, daily.word],
  )

  /* ---- daily card height cap: 80% of the calendar card ---- */
  const calRef = useRef<HTMLDivElement>(null)
  const [calH, setCalH] = useState(0)
  useEffect(() => {
    const el = calRef.current
    if (!el) return
    const update = () => setCalH(el.offsetHeight)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const dailyCap = calH > 0 ? Math.round(calH * 0.8) : 0

  const [dailyExpanded, setDailyExpanded] = useState(false)
  useEffect(() => setDailyExpanded(false), [daily.word])
  const dailyBodyRef = useRef<HTMLDivElement>(null)
  const [dailyOverflows, setDailyOverflows] = useState(false)
  useEffect(() => {
    const el = dailyBodyRef.current
    if (!el || !dailyCap) return
    // header + paddings + toggle ≈ 110px of chrome inside the cap
    const check = () =>
      setDailyOverflows(el.scrollHeight > Math.max(96, dailyCap - 110))
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [dailyCap, daily.word, daily.status])

  /* ---- calendar check-in marks: days with any review activity ---- */
  const reviewedDays = useMemo(() => {
    const set = new Set<string>()
    for (const [k, v] of Object.entries(state.activity)) {
      if (v.reviewed > 0) set.add(k)
    }
    // history before the activity log existed: approximate via lastSeen
    for (const s of Object.values(state.stats)) {
      if (s.lastSeen) set.add(dayKey(new Date(s.lastSeen)))
    }
    return set
  }, [state])


  return (
    <div className="grid gap-6 lg:grid-cols-5">
      {/* left column: daily word, activity stats */}
      <div className="flex flex-col gap-6 lg:col-span-3">
        {/* daily word — capped at 80% of the calendar card's height */}
        <div
          data-guide="daily" className="stagger-in flex flex-col rounded-xl border bg-card p-6 shadow-sm"
          style={
            !dailyExpanded && dailyCap ? { maxHeight: dailyCap } : undefined
          }
        >
          <div className="flex shrink-0 items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge className="bg-primary/10 text-primary hover:bg-primary/10">
                每日一词
              </Badge>
              <span className="text-xs text-muted-foreground">
                {daily.source === 'freeapi'
                  ? daily.wotd?.source === 'merriam-webster'
                    ? 'Merriam-Webster'
                    : (daily.wotd?.source ?? 'Word of the Day')
                  : daily.source === 'library'
                    ? '来自你的词库'
                    : ''}
              </span>
              {daily.source === 'library' && (
                <button
                  type="button"
                  title="换一个"
                  aria-label="换一个推荐词"
                  onClick={daily.shuffle}
                  className="pressable rounded-full p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                >
                  <svg
                    className="size-3.5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                    <path d="M21 3v5h-5" />
                    <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                    <path d="M3 21v-5h5" />
                  </svg>
                </button>
              )}
            </div>
            {dailyInLibrary && <Badge variant="secondary">已在词库</Badge>}
          </div>

          <div
            ref={dailyBodyRef}
            className={`relative min-h-0 ${
              !dailyExpanded && dailyCap ? 'flex-1 overflow-hidden' : ''
            }`}
          >
            {daily.status === 'loading' ? (
              <div className="mt-4 space-y-3">
                <Skeleton className="h-10 w-48" />
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-full" />
              </div>
            ) : daily.status === 'empty' ? (
              <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                还没有可推荐的词，先在「录入与管理词汇」中添加一些单词吧。
              </p>
            ) : (
              <>
                <div className="mt-3 flex items-baseline gap-3">
                  <span className="font-word text-4xl font-semibold tracking-tight">
                    {daily.word}
                  </span>
                  {(daily.data?.phonetic ?? daily.libWord?.phonetic) && (
                    <span className="text-sm text-muted-foreground">
                      {daily.data?.phonetic ?? daily.libWord?.phonetic}
                    </span>
                  )}
                </div>

                {daily.source === 'library' && daily.libWord ? (
                  /* offline fallback — Chinese gloss allowed here */
                  <>
                    <p className="mt-2 text-base">{daily.libWord.gloss}</p>
                    {daily.libWord.meanings.length > 0 && (
                      <ul className="mt-3 space-y-1.5 border-t border-border/60 pt-3">
                        {daily.libWord.meanings.slice(0, 3).map((m, i) => (
                          <li
                            key={i}
                            className="text-sm leading-relaxed text-muted-foreground"
                          >
                            {m.pos && (
                              <span className="mr-2 inline-block rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">
                                {m.pos}
                              </span>
                            )}
                            {m.zh || m.en}
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  /* genuine Word-of-the-Day — English definitions only */
                  <>
                    {daily.wotd?.definition && (
                      <p className="mt-2 text-sm leading-relaxed">
                        {daily.wotd.partOfSpeech && (
                          <span className="mr-2 inline-block rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">
                            {daily.wotd.partOfSpeech}
                          </span>
                        )}
                        {daily.wotd.definition}
                      </p>
                    )}
                    {daily.wotd?.example && (
                      <p className="font-word mt-2 border-l-2 border-primary/30 pl-3 text-sm italic leading-relaxed text-muted-foreground">
                        {daily.wotd.example}
                      </p>
                    )}
                    {daily.data &&
                      daily.data.meanings.some((m) => m.en) && (
                        <ul className="mt-3 space-y-1.5 border-t border-border/60 pt-3">
                          {daily.data.meanings
                            .filter((m) => m.en)
                            .slice(0, 3)
                            .map((m, i) => (
                              <li
                                key={i}
                                className="text-sm leading-relaxed text-muted-foreground"
                              >
                                {m.pos && (
                                  <span className="mr-2 inline-block rounded bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground">
                                    {m.pos}
                                  </span>
                                )}
                                {m.en}
                              </li>
                            ))}
                        </ul>
                      )}
                    {!dailyInLibrary &&
                      (daily.data ? (
                        <UnifiedEntry
                          onLocateWord={id => onLocateGroup(state.words[id]?.groupId ?? id)}
                          knownInput={{...daily.data,source:'api'}}
                          renderTrigger={(add,busy) => <Button variant="outline" size="sm" className="pressable mt-4" onClick={add} disabled={busy}>{busy ? '正在归组…' : '加入词库'}</Button>}
                        />
                      ) : (
                        <button
                          className="mt-4 text-sm text-primary underline-offset-2 hover:underline"
                          onClick={daily.retry}
                        >
                          释义未获取（离线）· 点击重试
                        </button>
                      ))}
                  </>
                )}
              </>
            )}
            {!dailyExpanded && dailyOverflows && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-card to-transparent" />
            )}
          </div>

          {dailyOverflows && (
            <button
              className="pressable mx-auto mt-1 shrink-0 rounded-full px-3 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
              onClick={() => setDailyExpanded((e) => !e)}
            >
              {dailyExpanded ? '收起 ↑' : '展开全部 ↓'}
            </button>
          )}
        </div>

        {/* activity + retention forecast — stretches to align column bottoms */}
        <div
          className="stagger-in flex flex-1 flex-col rounded-xl border bg-card p-5 shadow-sm"
          style={{ transitionDelay: '60ms' }}
        >
          <ActivityChart state={state} />
        </div>
      </div>

      {/* right column: calendar, quick add, start review */}
      <div className="space-y-6 lg:col-span-2">
        {/* calendar card */}
        <div
          ref={calRef}
          className="stagger-in rounded-xl border bg-card p-5 shadow-sm"
          style={{ transitionDelay: '60ms' }}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="pt-1">
              <p className="text-sm text-muted-foreground">
                {now.getFullYear()} 年 {now.getMonth() + 1} 月
              </p>
              <h2 className="font-word mt-1.5 text-2xl font-semibold tracking-tight">
                {greeting(now.getHours())}，
                <br />
                欢迎回来。
              </h2>
            </div>
            <div className="text-right">
              <p className="font-word text-6xl font-semibold leading-none tabular-nums">
                {now.getDate()}
              </p>
              <p className="mt-1.5 text-sm text-muted-foreground">
                星期{WEEKDAYS[now.getDay()]}
              </p>
            </div>
          </div>
          <MiniCalendar now={now} reviewedDays={reviewedDays} />
          <p className="mt-3 border-t border-border/60 pt-3 text-xs text-muted-foreground">
            {wordCount > 0
              ? `词库里已有 ${wordCount} 个词，今天也积累一点吧。`
              : '从每日一词或手动录入开始，建立你的词库。'}
          </p>
        </div>

        {/* quick add — same component as the library page */}
        <div className="stagger-in" style={{ transitionDelay: '120ms' }}>
          <AddWordCard onLocateGroup={onLocateGroup} />
        </div>

        {/* start review */}
        <div className="stagger-in" style={{ transitionDelay: '180ms' }}>
          <Button
            className="pressable h-12 w-full text-base"
            disabled={wordCount === 0}
            onClick={onStartQuiz}
          >
            开始复习
            {wordCount > 0 && (
              <span className="ml-2 text-primary-foreground/70">
                {wordCount} 词可练
              </span>
            )}
          </Button>
          {wordCount === 0 && (
            <p className="mt-2 text-center text-xs text-muted-foreground">
              先录入或加入几个单词，再来开始复习
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

/** compact month grid, Monday-first, today highlighted, ✓ on reviewed days */
function MiniCalendar({
  now,
  reviewedDays,
}: {
  now: Date
  reviewedDays: Set<string>
}) {
  const year = now.getFullYear()
  const month = now.getMonth()
  const today = now.getDate()
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const offset = (new Date(year, month, 1).getDay() + 6) % 7
  const cells: Array<number | null> = [
    ...Array<null>(offset).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]
  return (
    <div className="mt-4">
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-muted-foreground">
        {['一', '二', '三', '四', '五', '六', '日'].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          const reviewed =
            d !== null && reviewedDays.has(dayKey(new Date(year, month, d)))
          return (
            <span
              key={i}
              className={`relative flex aspect-square items-center justify-center rounded-full text-xs tabular-nums ${
                d === today
                  ? 'bg-primary font-medium text-primary-foreground'
                  : d
                    ? 'text-foreground/75'
                    : ''
              }`}
            >
              {d ?? ''}
              {reviewed && (
                <svg
                  viewBox="0 0 8 8"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`absolute -right-0.5 -top-0.5 size-2 ${
                    d === today ? 'text-primary-foreground' : 'text-emerald-600'
                  }`}
                  aria-label="当天已复习"
                >
                  <path d="M1.5 4.2l1.8 1.8L6.8 2" />
                </svg>
              )}
            </span>
          )
        })}
      </div>
    </div>
  )
}
