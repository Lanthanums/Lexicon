import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  checkSpelling,
  editDistance,
  evaluateSynonymAttempt,
  isPassingSynonymScore,
  mergeExcluded,
  normalizeAnswer,
  requiredCorrect,
  spellHintView,
  synonymWordResults,
  type SynonymMember,
} from '../src/lib/quizRules'
import {
  buildReviewForecast,
  summarizeMastery,
  type ReviewForecast,
} from '../src/lib/reviewForecast'

const members: SynonymMember[] = [
  { id: '1', text: 'big' },
  { id: '2', text: 'large' },
  { id: '3', text: 'huge' },
]

test('normalization trims, lowercases and preserves a meaningful spelling check', () => {
  assert.equal(normalizeAnswer('  Serene  '), 'serene')
  assert.equal(normalizeAnswer('Don’t'), "don't")
  assert.equal(normalizeAnswer('  a   b '), 'a b')
  assert.equal(checkSpelling(' SERENE ', 'serene'), true)
  assert.equal(checkSpelling('serene.', 'serene'), false)
  assert.equal(checkSpelling('', 'serene'), false)
})

test('pass rule: up to three needs all; four or more needs ceil(80%)', () => {
  assert.equal(requiredCorrect(0), 0)
  assert.equal(requiredCorrect(1), 1)
  assert.equal(requiredCorrect(2), 2)
  assert.equal(requiredCorrect(3), 3)
  assert.equal(requiredCorrect(4), 4)
  assert.equal(requiredCorrect(5), 4)
  assert.equal(requiredCorrect(6), 5)
  assert.equal(requiredCorrect(7), 6)
  assert.equal(requiredCorrect(8), 7)
  assert.equal(isPassingSynonymScore(4, 5), true)
  assert.equal(isPassingSynonymScore(3, 5), false)
  assert.equal(isPassingSynonymScore(3, 3), true)
  assert.equal(isPassingSynonymScore(2, 3), false)
})

test('unordered inputs match members; repeated words never create extra points', () => {
  const result = evaluateSynonymAttempt([' HUGE ', 'big', 'big'], members)
  assert.equal(result.correct, 2)
  assert.equal(result.missing, 1)
  assert.equal(result.wrong, 0)
  assert.equal(result.filled, 3)
  assert.equal(result.required, 3)
  assert.equal(result.passed, false)
  assert.deepEqual(result.duplicates, ['big'])
  const big = result.entries.find((entry) => entry.wordId === '1')!
  const large = result.entries.find((entry) => entry.wordId === '2')!
  const huge = result.entries.find((entry) => entry.wordId === '3')!
  assert.equal(big.verdict, 'correct')
  assert.equal(big.given, 'big')
  assert.equal(large.verdict, 'missing')
  assert.equal(huge.verdict, 'correct')
  assert.equal(huge.given, ' HUGE ')
})

test('a group of five can pass with four correct and one misspelled word', () => {
  const five: SynonymMember[] = [
    { id: 'a', text: 'alpha' },
    { id: 'b', text: 'bravo' },
    { id: 'c', text: 'charlie' },
    { id: 'd', text: 'delta' },
    { id: 'e', text: 'echo' },
  ]
  const result = evaluateSynonymAttempt(
    ['alpha', 'BRAVO', 'charlie', 'delta', 'zzzz'],
    five,
  )
  assert.equal(result.correct, 4)
  assert.equal(result.required, 4)
  assert.equal(result.passed, true)
  assert.equal(result.extraWrong.length, 1)
  assert.equal(result.entries.find((entry) => entry.wordId === 'e')?.verdict, 'missing')
})

test('misspellings are attributed for review but never count as correct', () => {
  const three: SynonymMember[] = [
    { id: 'a', text: 'accommodate' },
    { id: 'b', text: 'achieve' },
    { id: 'c', text: 'acquire' },
  ]
  const result = evaluateSynonymAttempt(['accomodate', 'achive', 'acquire'], three)
  assert.equal(result.correct, 1)
  assert.equal(result.wrong, 2)
  assert.equal(result.missing, 0)
  assert.equal(result.passed, false)
  assert.equal(result.entries[0].verdict, 'wrong')
  assert.equal(result.entries[0].given, 'accomodate')
  assert.equal(result.entries[1].verdict, 'wrong')
  assert.equal(result.entries[2].verdict, 'correct')
  const perWord = synonymWordResults(result)
  assert.deepEqual(
    perWord.map((item) => [item.wordId, item.correct]),
    [
      ['a', false],
      ['b', false],
      ['c', true],
    ],
  )
  assert.ok(editDistance('accomodate', 'accommodate') <= 2)
})

test('two identical boxes only fill one member', () => {
  const result = evaluateSynonymAttempt(['big', 'big'], members.slice(0, 2))
  assert.equal(result.correct, 1)
  assert.equal(result.missing, 1)
  assert.equal(result.required, 2)
  assert.equal(result.passed, false)
  assert.equal(result.duplicates.length, 1)
})

test('three escalating spelling hints never expose a length oracle', () => {
  const first = spellHintView(1, 'serene', '/səˈriːn/')
  assert.match(first.text ?? '', /s/)
  assert.ok(!(first.text ?? '').includes('6'))
  const second = spellHintView(2, 'serene', '/səˈriːn/')
  assert.match(second.text ?? '', /音标/)
  const noPhonetic = spellHintView(2, 'serene')
  assert.equal(noPhonetic.phoneticAvailable, false)
  assert.match(noPhonetic.text ?? '', /没有收录音标/)
  const full = spellHintView(3, 'serene')
  assert.equal(full.revealed, true)
  assert.match(full.text ?? '', /serene/)
})

test('round exclusions accumulate and can be cleared by returning to setup', () => {
  const first = mergeExcluded([], ['a', 'b'])
  const second = mergeExcluded(first, ['b', 'c'])
  assert.deepEqual([...second].sort(), ['a', 'b', 'c'])
  assert.deepEqual([...mergeExcluded(second, [])].sort(), ['a', 'b', 'c'])
  assert.deepEqual([...mergeExcluded([], [])], [])
})

function forecastFixture(): {
  forecast: ReviewForecast
  now: number
} {
  const now = new Date(2025, 0, 1, 12, 0, 0, 0).getTime()
  const day = 86_400_000
  const words = { a: {}, b: {}, c: {}, d: {}, e: {}, f: {} }
  const stats = {
    a: { correct: 0, wrong: 0, level: 0, dueAt: now - 1000 },
    b: { correct: 0, wrong: 0, level: 0, lastSeen: now - 2 * day },
    c: { correct: 4, wrong: 0, level: 4, dueAt: now },
    d: { correct: 9, wrong: 0, level: 5, dueAt: now + 100 * day },
    e: { correct: 2, wrong: 0, level: 2, dueAt: now + 2 * day },
  }
  return { forecast: buildReviewForecast(words, stats, { now, days: 7 }), now }
}

test('forecast moves only scheduled words and keeps every day conserved', () => {
  const { forecast } = forecastFixture()
  assert.equal(forecast.days.length, 7)
  assert.equal(forecast.totalWords, 6)
  assert.equal(forecast.scheduledWords, 5)
  assert.equal(forecast.unscheduledWords, 1)
  assert.equal(forecast.hasPlan, true)
  assert.equal(forecast.dueWithinHorizon, 4)
  assert.equal(forecast.days[0].label, '今天')
  assert.equal(forecast.days[1].label, '明天')

  for (const day of forecast.days) {
    assert.equal(day.total, 6)
    assert.equal(day.familiar + day.needsReview + day.unfamiliar, day.total)
  }

  // day 0 reviews the overdue a/b and level-4 c
  assert.equal(forecast.days[0].familiar, 2)
  assert.equal(forecast.days[0].needsReview, 3)
  assert.equal(forecast.days[0].unfamiliar, 1)
  assert.equal(forecast.days[0].reviewed, 3)
  // the word with no plan never drifts into mastery
  assert.ok(forecast.days.every((day) => day.unfamiliar >= 1))
})

test('current distribution uses the four requested level bands', () => {
  const { forecast } = forecastFixture()
  assert.ok(forecast)
  const distribution = summarizeMastery(
    { a: {}, b: {}, c: {}, d: {}, e: {}, f: {} },
    {
      a: { correct: 0, wrong: 0, level: 0 },
      b: { correct: 0, wrong: 0, level: 2 },
      c: { correct: 0, wrong: 0, level: 4 },
      d: { correct: 0, wrong: 0, level: 5 },
      e: { correct: 0, wrong: 0, level: 1 },
    },
  )
  assert.deepEqual(distribution, {
    unfamiliar: 2,
    vague: 2,
    mastered: 1,
    familiar: 1,
    total: 6,
  })
})

test('no plan and empty libraries have honest empty states, not invented curves', () => {
  const now = new Date(2025, 0, 1, 12).getTime()
  const noPlan = buildReviewForecast(
    { x: {}, y: {} },
    { x: { correct: 1, wrong: 0, level: 1 }, y: { correct: 0, wrong: 0, level: 0 } },
    { now },
  )
  assert.equal(noPlan.hasWords, true)
  assert.equal(noPlan.hasPlan, false)
  assert.equal(noPlan.dueWithinHorizon, 0)
  assert.equal(noPlan.days[0].familiar, 0)
  assert.equal(noPlan.days[0].unfamiliar, 1)
  assert.ok(noPlan.days.every((day) => day.needsReview === 1 && day.unfamiliar === 1))

  const empty = buildReviewForecast({}, {}, { now })
  assert.equal(empty.hasWords, false)
  assert.equal(empty.hasPlan, false)
  assert.equal(empty.totalWords, 0)
  assert.ok(empty.days.every((day) => day.total === 0))
})
