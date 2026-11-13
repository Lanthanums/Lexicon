import assert from 'node:assert/strict'
import { test } from 'node:test'
import { canMatchShape, clusterWords, editDistance, normalizePhonetic, wordSimilarity } from '../src/lib/similarity'

test('linear-memory edit distance preserves transpositions in both directions', () => {
  assert.equal(editDistance('abdc', 'abcd'), 1)
  assert.equal(editDistance('ab', 'bac'), 2)
  assert.equal(editDistance('bac', 'ab'), 2)
  assert.equal(editDistance('a'.repeat(20000), 'ab'), 19999)
})

test('shape pruning never excludes valid scores or homophones', () => {
  const words = ['a', 'abb', 'affluent', 'effluent', 'lethal', 'leather', 'catholic', 'cat', 'a'.repeat(20)]
  for (const a of words) for (const b of words) {
    for (const threshold of [.5, .7, .85, .95]) {
      if (wordSimilarity(a,b).score >= threshold) assert.equal(canMatchShape(a,b,'','',threshold), true)
    }
  }
  const pronunciation = normalizePhonetic('/səʊ/')
  assert.equal(canMatchShape('sew', 'so', pronunciation, pronunciation, .95), true)
})

test('curated groups retain their precise order and are not joined by a bridging word', () => {
  const words = ['adopt', 'adept', 'adapt', 'adapts', 'adapting'].map(text => ({ id: text, text }))
  const locked = [['adept', 'adopt'], ['adapts', 'adapt']]
  const groups = clusterWords(words, .5, locked)
  assert.equal(groups.length, 3)
  for (const group of locked) assert.ok(groups.some(ids => JSON.stringify(ids) === JSON.stringify(group)))
})
