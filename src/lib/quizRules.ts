import type { WordStats } from '../types/index'

/**
 * Pure rules shared by the quiz UI and its tests.
 *
 * The UI never scores while the learner is typing: these helpers are called
 * once, when the learner submits a question.
 */

/** Groups of four or more need ceil(80%) correct words; groups of 1–3 need all. */
export const SYNONYM_PASS_RATIO = 0.8

export type SynonymVerdict = 'correct' | 'missing' | 'wrong'

export interface SynonymMember {
  id: string
  text: string
}

export interface SynonymEntry {
  wordId: string
  /** the member word as stored in the library */
  expected: string
  /** what the learner wrote, in the original casing/spacing */
  given: string
  verdict: SynonymVerdict
}

export interface SynonymEvaluation {
  /** one entry per member, in member order */
  entries: SynonymEntry[]
  /** number of distinct members written correctly */
  correct: number
  /** number of distinct members that were attempted but misspelled */
  wrong: number
  /** number of members left blank */
  missing: number
  /** number of non-empty input boxes (duplicates included) */
  filled: number
  /** correct words needed for this group to pass */
  required: number
  passed: boolean
  /** non-empty answers that repeated an already-correct member */
  duplicates: string[]
  /** answers that could not be attributed to any member */
  extraWrong: string[]
  total: number
}

/**
 * Canonical form for comparison only: trim, lowercase, normalise curly
 * apostrophes and collapse internal whitespace. The learner's raw input is
 * kept separately for the review screen, and is never rewritten in the box.
 */
export function normalizeAnswer(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019`]/g, "'")
    .replace(/\s+/g, ' ')
}

/** Whether a single spelling attempt matches exactly (after normalisation). */
export function checkSpelling(given: string, expected: string): boolean {
  const normalized = normalizeAnswer(given)
  return normalized.length > 0 && normalized === normalizeAnswer(expected)
}

/** Correct words required for a group of `total` members to pass. */
export function requiredCorrect(total: number): number {
  if (!Number.isFinite(total) || total <= 0) return 0
  const n = Math.floor(total)
  if (n <= 3) return n
  return Math.ceil(n * SYNONYM_PASS_RATIO)
}

export function isPassingSynonymScore(correct: number, total: number): boolean {
  if (total <= 0) return false
  return correct >= requiredCorrect(total)
}

/** Levenshtein distance; only used to attribute misspellings for the review. */
export function editDistance(a: string, b: string): number {
  const left = normalizeAnswer(a)
  const right = normalizeAnswer(b)
  if (left === right) return 0
  if (!left.length) return right.length
  if (!right.length) return left.length
  let previous = new Array<number>(right.length + 1)
  let current = new Array<number>(right.length + 1)
  for (let j = 0; j <= right.length; j++) previous[j] = j
  for (let i = 1; i <= left.length; i++) {
    current[0] = i
    for (let j = 1; j <= right.length; j++) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + cost,
      )
    }
    ;[previous, current] = [current, previous]
  }
  return previous[right.length]
}

interface PendingInput {
  raw: string
  normalized: string
}

/**
 * Score one synonym-group attempt.
 *
 * Every non-empty box may answer any member (the inputs are intentionally
 * unordered). Exact matches are assigned first, so a repeated word can never
 * create a second point. Remaining misspellings are paired with the closest
 * unfilled member *only for the review screen*; they never count as correct.
 */
export function evaluateSynonymAttempt(
  inputs: readonly string[],
  members: readonly SynonymMember[],
): SynonymEvaluation {
  const expected = members.map((member) => ({
    member,
    normalized: normalizeAnswer(member.text),
  }))
  const assigned: Array<{ given: string; verdict: SynonymVerdict } | null> =
    expected.map(() => null)
  const remaining: PendingInput[] = []
  const duplicates: string[] = []
  let filled = 0

  for (const raw of inputs) {
    const normalized = normalizeAnswer(raw)
    if (!normalized) continue
    filled++
    let matched = -1
    for (let i = 0; i < expected.length; i++) {
      if (assigned[i]) continue
      if (expected[i].normalized === normalized) {
        matched = i
        break
      }
    }
    if (matched >= 0) {
      assigned[matched] = { given: raw, verdict: 'correct' }
      continue
    }
    // It is not an extra arbitrary answer if it repeats a member that was
    // already filled: that is a duplicate, and duplicates only count once.
    if (expected.some((item) => item.normalized === normalized)) {
      duplicates.push(raw)
      continue
    }
    remaining.push({ raw, normalized })
  }

  // Attribute plausible misspellings to still-empty members for feedback.
  const open = expected
    .map((_, index) => index)
    .filter((index) => !assigned[index])
  const pairs: Array<{ input: number; member: number; distance: number }> = []
  for (let i = 0; i < remaining.length; i++) {
    for (const memberIndex of open) {
      const distance = editDistance(
        remaining[i].normalized,
        expected[memberIndex].normalized,
      )
      const longest = Math.max(
        remaining[i].normalized.length,
        expected[memberIndex].normalized.length,
      )
      // Very different strings are listed as extra answers, not presented as
      // a confident "this is what you meant" attribution.
      if (distance <= Math.max(2, Math.ceil(longest * 0.4))) {
        pairs.push({ input: i, member: memberIndex, distance })
      }
    }
  }
  pairs.sort((a, b) => a.distance - b.distance)
  const usedInputs = new Set<number>()
  const usedMembers = new Set<number>()
  for (const pair of pairs) {
    if (usedInputs.has(pair.input) || usedMembers.has(pair.member)) continue
    usedInputs.add(pair.input)
    usedMembers.add(pair.member)
    assigned[pair.member] = {
      given: remaining[pair.input].raw,
      verdict: 'wrong',
    }
  }
  const extraWrong = remaining
    .filter((_, index) => !usedInputs.has(index))
    .map((item) => item.raw)

  const entries: SynonymEntry[] = expected.map((item, index) => {
    const result = assigned[index]
    return {
      wordId: item.member.id,
      expected: item.member.text,
      given: result?.given ?? '',
      verdict: result?.verdict ?? 'missing',
    }
  })
  const correct = entries.filter((entry) => entry.verdict === 'correct').length
  const wrong = entries.filter((entry) => entry.verdict === 'wrong').length
  const missing = entries.filter((entry) => entry.verdict === 'missing').length
  const total = entries.length

  return {
    entries,
    correct,
    wrong,
    missing,
    filled,
    required: requiredCorrect(total),
    passed: isPassingSynonymScore(correct, total),
    duplicates,
    extraWrong,
    total,
  }
}

/** Per-word mastery delta for one synonym attempt, without touching the store. */
export function synonymWordResults(
  evaluation: SynonymEvaluation,
): Array<{ wordId: string; correct: boolean; verdict: SynonymVerdict }> {
  return evaluation.entries.map((entry) => ({
    wordId: entry.wordId,
    correct: entry.verdict === 'correct',
    verdict: entry.verdict,
  }))
}

/* ------------------------------------------------------------------ */
/* Spelling hints                                                      */
/* ------------------------------------------------------------------ */

export const SPELL_HINT_LIMIT = 3

export interface SpellHintView {
  level: number
  /** false when the word has no phonetic entry (or it is whitespace) */
  phoneticAvailable: boolean
  /** honest explanation shown to the learner at this level */
  text: string | null
  /** whether the full answer is now visible */
  revealed: boolean
}

/**
 * Three escalating hints: first letter → phonetic → whole word.
 * A missing phonetic is reported honestly instead of being skipped silently.
 * The letter count is deliberately never exposed: that would turn the hint
 * into a length oracle.
 */
export function spellHintView(
  level: number,
  answer: string,
  phonetic?: string,
): SpellHintView {
  const step = Math.max(0, Math.min(SPELL_HINT_LIMIT, Math.floor(level)))
  const word = answer.trim()
  const first = word.slice(0, 1)
  const hasPhonetic = !!phonetic?.trim()

  if (step === 0) {
    return { level: 0, phoneticAvailable: hasPhonetic, text: null, revealed: false }
  }
  if (step === 1) {
    return {
      level: 1,
      phoneticAvailable: hasPhonetic,
      text: first ? `首字母是 “${first}”` : '这个词暂时没有可显示的首字母。',
      revealed: false,
    }
  }
  if (step === 2) {
    return {
      level: 2,
      phoneticAvailable: hasPhonetic,
      text: hasPhonetic
        ? `音标：${phonetic!.trim()}`
        : '这个词没有收录音标，无法提供音标提示。可以再点一次查看完整单词。',
      revealed: false,
    }
  }
  return {
    level: 3,
    phoneticAvailable: hasPhonetic,
    text: `完整单词：${word}`,
    revealed: true,
  }
}

export function nextSpellHint(level: number): number {
  return Math.min(SPELL_HINT_LIMIT, Math.max(0, Math.floor(level)) + 1)
}

/* ------------------------------------------------------------------ */
/* Small round helpers                                                 */
/* ------------------------------------------------------------------ */

/** Union the previous round's exclusions with this round's misses. */
export function mergeExcluded(
  previous: Iterable<string>,
  missed: Iterable<string>,
): Set<string> {
  const next = new Set(previous)
  for (const id of missed) if (id) next.add(id)
  return next
}

/** Ids still eligible for a follow-up round. */
export function remainingIds(
  all: readonly string[],
  excluded: Iterable<string>,
): string[] {
  const blocked = new Set(excluded)
  return all.filter((id) => !blocked.has(id))
}

export interface MasteryInput {
  words: Record<string, unknown> | ReadonlyArray<{ id: string }>
  stats: Record<string, WordStats>
}

/** The four display bands requested by the review charts. */
export function masteryBand(level: number | undefined): 0 | 1 | 2 | 3 {
  if (!level || level <= 0) return 0
  if (level <= 2) return 1
  if (level <= 4) return 2
  return 3
}
