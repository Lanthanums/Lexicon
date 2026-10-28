import assert from 'node:assert/strict'
import { test } from 'node:test'
import { normalizeState } from '../src/lib/state'
import type { LibraryState } from '../src/types/index'
const defaults: LibraryState = { words: {}, groups: {}, stats: {}, synonymSets: {}, settings: { threshold: 0.7, dictProviders: [] }, learning: { enabled: true, addCount: 0, traces: [] }, activity: {} }
const legacy = { words: { a: { id: 'a', text: 'accept', gloss: '接受', meanings: [], groupId: 'g', addedAt: 1, source: 'manual' } }, groups: { g: { id: 'g', wordIds: ['a'], manual: false, createdAt: 1 } }, stats: { a: { correct: 2, wrong: 1, level: 1, lastSeen: 123 } } }
test('legacy backup keeps IDs, definitions, group links and review history', () => {
  const result = normalizeState(legacy, defaults)
  assert.deepEqual(result.words, legacy.words)
  assert.deepEqual(result.stats, legacy.stats)
  assert.deepEqual(result.synonymSets, {})
  assert.equal(result.settings.threshold, 0.7)
})
test('invalid relationship fails before current data can be replaced', () => {
  assert.throws(() => normalizeState({ ...legacy, groups: { g: { ...legacy.groups.g, wordIds: ['missing'] } } }, defaults))
  assert.throws(() => normalizeState({ ...legacy, groups: {} }, defaults))
  assert.throws(() => normalizeState({ ...legacy, synonymSets: { s: { id: 's', name: 'x', notes: '', wordIds: ['nope'], createdAt: 1 } } }, defaults))
})
test('malformed stats, settings and learning records are rejected', () => {
  for (const patch of [{ stats: { a: { correct: '2', wrong: 0, level: 0 } } }, { settings: { threshold: 3 } }, { settings: { dictProviders: [{ id: 'custom', label: 'bad', enabled: 'yes' }] } }, { learning: { enabled: true, addCount: 0, traces: [null] } }]) assert.throws(() => normalizeState({ ...legacy, ...patch }, defaults))
})
test('v2 relationships, due dates and per-word notes survive round trip', () => {
  const v2 = { ...legacy, words: { a: { ...legacy.words.a, usageNote: 'take something offered', example: 'I accept your offer.' } }, groups: { g: { ...legacy.groups.g, kind: 'single' } }, synonymSets: { s: { id: 's', name: 'accept', notes: 'draft', wordIds: ['a'], createdAt: 2 } }, stats: { a: { ...legacy.stats.a, dueAt: 100000 } } }
  const result = normalizeState(JSON.parse(JSON.stringify(v2)), defaults)
  assert.deepEqual(result.words, v2.words)
  assert.deepEqual(result.synonymSets, v2.synonymSets)
  assert.equal(result.stats.a.dueAt, 100000)
})
