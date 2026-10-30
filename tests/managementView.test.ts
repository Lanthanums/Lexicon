import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { LibraryState } from '../src/types/index'
import { deriveManagementView, filterManagementCards, managementWords, searchManagement } from '../src/lib/managementView'

const state: LibraryState = {
  words: {
    a: { id: 'a', text: 'adapt', gloss: '适应', meanings: [], groupId: 'shape', addedAt: 10, source: 'manual' },
    b: { id: 'b', text: 'adopt', gloss: '采用', meanings: [], groupId: 'shape', addedAt: 20, source: 'manual' },
    c: { id: 'c', text: 'alone', gloss: '独自', meanings: [], groupId: 'single', addedAt: 30, source: 'manual' },
  },
  groups: {
    shape: { id: 'shape', kind: 'single', wordIds: ['a', 'b'], manual: true, createdAt: 1 },
    single: { id: 'single', kind: 'confusable', wordIds: ['c'], manual: true, createdAt: 1 },
  },
  synonymSets: { syn: { id: 'syn', name: '改变', notes: '', wordIds: ['a', 'b'], createdAt: 1 } },
  stats: {}, settings: { threshold: 0.7, dictProviders: [] }, learning: { enabled: true, addCount: 0, traces: [] }, activity: {},
}

test('valid member counts derive both relationships without relying on legacy kind', () => {
  const view = deriveManagementView(state)
  assert.equal(view.relations.a.shapeId, 'shape')
  assert.equal(view.relations.a.synonymId, 'syn')
  assert.equal(view.relations.a.isolated, false)
  assert.equal(view.relations.c.isolated, true)
  assert.equal(view.cards.length, 3)
})

test('filters include every selected relationship and never label dual members isolated', () => {
  const view = deriveManagementView(state)
  assert.deepEqual(filterManagementCards(view.cards, { shape: false, synonym: true, isolated: false }).map(c => c.id), ['syn'])
  assert.deepEqual(filterManagementCards(view.cards, { shape: false, synonym: false, isolated: true }).flatMap(c => c.words.map(w => w.id)), ['c'])
})

test('card timestamp uses newest member and list A-Z is one row per word', () => {
  const view = deriveManagementView(state)
  assert.equal(view.cards.find(c => c.id === 'shape')?.latestAddedAt, 20)
  assert.deepEqual(managementWords(view.cards, 'az').map(w => w.id), ['a', 'b', 'c'])
})

test('search matches group name, English and Chinese gloss', () => {
  assert.deepEqual(searchManagement(state, '改变').map(w => w.id), ['a', 'b'])
  assert.deepEqual(searchManagement(state, 'ADO').map(w => w.id), ['a', 'b'])
  assert.deepEqual(searchManagement(state, '独自').map(w => w.id), ['c'])
  assert.deepEqual(searchManagement(state, ' '), [])
})
