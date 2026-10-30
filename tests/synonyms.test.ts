import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { sensesFor, verifySynonyms, type SynonymShard } from '../src/lib/synonyms'

function shard(letter: string): SynonymShard {
  return JSON.parse(readFileSync(new URL(`../public/wordnet/${letter}.json`, import.meta.url), 'utf8'))
}

test('shipped offline shards match the pinned manifest and all references resolve', () => {
  const manifest = JSON.parse(readFileSync(new URL('../public/wordnet/manifest.json', import.meta.url), 'utf8'))
  assert.equal(manifest.commit, 'dc343f2683279ecbb13fab4e2fd778d7b162d287')
  let terms = 0
  const senses = new Set<string>()
  for (const [file, metadata] of Object.entries(manifest.files) as Array<[string, { sha256: string }]>) {
    const raw = readFileSync(new URL('../public/wordnet/' + file, import.meta.url))
    assert.equal(createHash('sha256').update(raw).digest('hex'), metadata.sha256)
    const data: SynonymShard = JSON.parse(raw.toString())
    terms += Object.keys(data.lookup).length
    for (const [word, ids] of Object.entries(data.lookup)) for (const id of ids) {
      assert.ok(data.senses[id].terms.includes(word))
      assert.ok(data.senses[id].definition)
      assert.ok(data.senses[id].terms.length >= 2)
      senses.add(id)
    }
  }
  assert.equal(terms, manifest.terms)
  assert.equal(senses.size, manifest.synsets)
})

test('real WordNet senses preserve polysemy, normalization and literal constructor entries', () => {
  assert.ok(sensesFor(' SERENE ', shard('s')).some(s => s.terms.includes('tranquil')))
  const banks = sensesFor('bank', shard('b'))
  assert.ok(banks.length > 1)
  assert.ok(banks.some(s => s.terms.includes('banking company')))
  assert.ok(banks.some(s => s.terms.includes('rely')))
  assert.ok(!banks.some(s => s.terms.includes('banking company') && s.terms.includes('rely')))
  assert.ok(sensesFor('constructor', shard('c')).some(s => s.terms.includes('builder')))
  assert.deepEqual(sensesFor('zzzz-not-a-lexicon-word', shard('z')), [])
  assert.ok(!sensesFor('hot', shard('h')).some(s => s.terms.includes('cold')))
})

test('API verification uses rel_syn and only reports returned lemmas', async () => {
  let captured = ''
  const request = (async (url: string | URL | Request) => {
    captured = String(url)
    return new Response(JSON.stringify([{ word: 'Tranquil', score: 99 }, { word: 'calm' }]))
  }) as typeof fetch
  const result = await verifySynonyms('SERENE', 'sample-key', new AbortController().signal, request)
  assert.deepEqual([...result], ['tranquil', 'calm'])
  const target = new URL(new URL(captured, 'https://app.example').searchParams.get('url')!)
  assert.equal(target.hostname, 'api.datamuse.com')
  assert.equal(target.searchParams.get('rel_syn'), 'serene')
  assert.equal(target.searchParams.get('key'), 'sample-key')
  assert.ok(!result.has('unagitated'))
})

test('empty, failed, invalid and cancelled API calls never produce approval', async () => {
  const signal = new AbortController().signal
  assert.equal((await verifySynonyms('serene', '', signal, (async () => new Response('[]')) as typeof fetch)).size, 0)
  await assert.rejects(verifySynonyms('serene', '', signal, (async () => new Response('', { status: 503 })) as typeof fetch))
  await assert.rejects(verifySynonyms('serene', '', signal, (async () => new Response('{"error":"quota"}')) as typeof fetch))
  const cancelled = new AbortController(); cancelled.abort()
  await assert.rejects(verifySynonyms('serene', '', cancelled.signal, (async (_url, options) => { options?.signal?.throwIfAborted(); return new Response('[]') }) as typeof fetch))
})
