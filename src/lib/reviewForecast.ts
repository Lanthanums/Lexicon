import {scheduleAnswer,stabilityOf} from './memorySchedule'
import type { WordStats } from '../types/index'

/**
 * Deterministic "what if" review forecast.
 *
 * This is NOT a memory-retention model. It answers one narrow question:
 * if the learner reviews exactly when due, answers every card correctly and
 * adds no new words, how would the four mastery bands move over the next
 * seven days under the intervals the app already uses?
 */

export const DAY_MS = 86_400_000

export type MasteryBand = 'unfamiliar' | 'vague' | 'mastered' | 'familiar'

export interface MasteryDistribution {
  /** level 0 — includes words that have never been studied */
  unfamiliar: number
  /** levels 1–2 */
  vague: number
  /** levels 3–4 */
  mastered: number
  /** level 5 */
  familiar: number
  total: number
}

export interface ForecastDay {
  /** local date key YYYY-MM-DD */
  key: string
  /** short axis label: 今天 / 明天 / M/D */
  label: string
  timestamp: number
  /** level 5 at the end of this day */
  familiar: number
  /** levels 1–4 at the end of this day */
  needsReview: number
  /** level 0 / never scheduled at the end of this day */
  unfamiliar: number
  /** always all words — kept explicit so the chart can prove conservation */
  total: number
  /** how many words this day's plan reviews */
  reviewed: number
}

export interface ReviewForecast {
  days: ForecastDay[]
  totalWords: number
  scheduledWords: number
  unscheduledWords: number
  hasWords: boolean
  /** at least one word has a due date (explicit or inferable) */
  hasPlan: boolean
  /** scheduled reviews that fall inside the seven-day window */
  dueWithinHorizon: number
  assumption: string
}

export interface ForecastOptions {
  now?: number
  /** 1–14, defaults to 7 */
  days?: number
}

function clampLevel(level: number | undefined): number {
  if (typeof level !== 'number' || !Number.isFinite(level)) return 0
  return Math.max(0, Math.min(5, Math.round(level)))
}

export function masteryBandOf(level: number | undefined): MasteryBand {
  const value = clampLevel(level)
  if (value <= 0) return 'unfamiliar'
  if (value <= 2) return 'vague'
  if (value <= 4) return 'mastered'
  return 'familiar'
}

function wordIds(
  words: Record<string, unknown> | ReadonlyArray<{ id: string }>,
): string[] {
  return Array.isArray(words)
    ? words.map((word) => word.id)
    : Object.keys(words)
}

/** Current four-band composition, straight from stored levels. */
export function summarizeMastery(
  words: Record<string, unknown> | ReadonlyArray<{ id: string }>,
  stats: Record<string, WordStats>,
): MasteryDistribution {
  const distribution: MasteryDistribution = {
    unfamiliar: 0,
    vague: 0,
    mastered: 0,
    familiar: 0,
    total: 0,
  }
  for (const id of wordIds(words)) {
    distribution.total++
    distribution[masteryBandOf(stats[id]?.level)]++
  }
  return distribution
}

function startOfLocalDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function addLocalDays(timestamp: number, days: number): number {
  const date = new Date(timestamp)
  date.setDate(date.getDate() + days)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function labelFor(timestamp: number, today: number): string {
  if (timestamp === today) return '今天'
  if (timestamp === addLocalDays(today, 1)) return '明天'
  const date = new Date(timestamp)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function dateKey(timestamp: number): string {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * Prefer the stored dueAt. Legacy records without one can still have a plan:
 * infer it from lastSeen and the interval for their current level. A word with
 * neither value is unscheduled and is never promoted during the simulation.
 */
function dueFor(stat: WordStats | undefined): number | undefined {
  if (!stat) return undefined
  if (typeof stat.dueAt === 'number' && Number.isFinite(stat.dueAt)) {
    return stat.dueAt
  }
  if (typeof stat.lastSeen === 'number' && Number.isFinite(stat.lastSeen)) {
    return stat.lastSeen + stabilityOf(stat) * DAY_MS
  }
  return undefined
}

export const FORECAST_ASSUMPTION =
  '推演假设：按现有到期计划复习且全部答对，不新增词。没有复习计划的词保持原等级；曲线反映调度规则，不代表真实记忆保持率。'

export function buildReviewForecast(
  words: Record<string, unknown> | ReadonlyArray<{ id: string }>,
  stats: Record<string, WordStats>,
  options: ForecastOptions = {},
): ReviewForecast {
  const now = options.now ?? Date.now()
  const dayCount = Math.max(1, Math.min(14, Math.floor(options.days ?? 7)))
  const ids = wordIds(words)
  const today = startOfLocalDay(now)

  const states = ids.map((id) => {
    const level = clampLevel(stats[id]?.level)
    return { id, level, stat: stats[id], dueAt: dueFor(stats[id]) }
  })
  const scheduledWords = states.filter((state) => state.dueAt !== undefined).length
  const horizonEnd = addLocalDays(today, dayCount) - 1
  const dueWithinHorizon = states.filter(
    (state) => state.dueAt !== undefined && state.dueAt <= horizonEnd,
  ).length

  const days: ForecastDay[] = []
  for (let index = 0; index < dayCount; index++) {
    const dayStart = addLocalDays(today, index)
    const dayEnd = addLocalDays(today, index + 1) - 1
    let reviewed = 0

    for (const state of states) {
      if (state.dueAt === undefined || state.dueAt > dayEnd) continue
      reviewed++
      state.stat = scheduleAnswer(state.stat,true,Math.max(now,dayStart))
      state.level = state.stat.level
      state.dueAt = state.stat.dueAt
    }

    const familiar = states.filter((state) => state.level >= 5).length
    const needsReview = states.filter(
      (state) => state.level >= 1 && state.level <= 4,
    ).length
    const unfamiliar = states.length - familiar - needsReview
    days.push({
      key: dateKey(dayStart),
      label: labelFor(dayStart, today),
      timestamp: dayStart,
      familiar,
      needsReview,
      unfamiliar,
      total: states.length,
      reviewed,
    })
  }

  return {
    days,
    totalWords: ids.length,
    scheduledWords,
    unscheduledWords: ids.length - scheduledWords,
    hasWords: ids.length > 0,
    hasPlan: scheduledWords > 0,
    dueWithinHorizon,
    assumption: FORECAST_ASSUMPTION,
  }
}
