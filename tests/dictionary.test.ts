import assert from 'node:assert/strict'
import { test } from 'node:test'
import { lookupWord, retryDefinition, WordNotFoundError } from '../src/lib/dictionary'

const youdaoOnly = [{ id: 'youdao-web', label: 'Youdao', enabled: true }]

function youdaoEntry(headword: string, gloss: string) {
  return {
    'return-phrase': { l: { i: headword } },
    ukphone: 'njuːˈmætɪk',
    trs: [{ tr: [{ l: { i: [gloss] } }] }],
  }
}

test('parses a matching Youdao array entry and keeps its phonetic and part of speech', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    input: 'Pneumatic',
    ec: { word: [youdaoEntry('pneumatic', 'adj. 气动的；充气的')] },
    simple: { word: [{ 'return-phrase': 'pneumatic' }] },
  }))

  const result = await lookupWord('pneumatic', undefined, youdaoOnly)
  assert.equal(result.phonetic, '/njuːˈmætɪk/')
  assert.deepEqual(result.meanings, [{ pos: 'adj.', en: '', zh: '气动的；充气的' }])
})

test('uses a lemma entry when Youdao explicitly lists the queried inflection', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({
    input: 'runners',
    ec: { word: [{ ...youdaoEntry('runner', 'n. 跑步者'), wfs: [{ wf: { value: 'runners' } }] }] },
  }))
  assert.equal((await lookupWord('runners', undefined, youdaoOnly)).gloss, '跑步者')
})

test('rejects unrelated Youdao headwords and web-only translations, even with a correct query echo', async t => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async (input: string) => {
    const request = new URL(input, 'https://lexicon.invalid')
    if (!request.pathname.startsWith('/youdao/')) return new Response(null, { status: 404 })
    const word = request.searchParams.get('q')
    const web = { 'web-translation': [{ key: 'locoism', trans: [{ value: '疯草病' }] }] }
    if (word === 'locoism') return Response.json({ input: word, web_trans: web })
    return Response.json({
      input: word,
      ec: { word: [youdaoEntry('locoism', 'n. 疯草病')] },
      web_trans: web,
    })
  })

  await assert.rejects(lookupWord('hydraulic', undefined, youdaoOnly), WordNotFoundError)
  await assert.rejects(lookupWord('locoism', undefined, youdaoOnly), WordNotFoundError)
  assert.equal(fetchMock.mock.calls.filter(call => call.arguments[0].startsWith('/youdao/')).length, 2)
})

test('backup keeps adjective and noun translations when the standalone translation is unavailable', async t => {
  t.mock.method(globalThis, 'fetch', async (input: string) => {
    const request = new URL(input, 'https://lexicon.invalid')
    const upstream = request.pathname === '/fwd' ? new URL(request.searchParams.get('url')!) : request
    if (upstream.hostname === 'api.dictionaryapi.dev') {
      return Response.json([{
        word: 'pneumatic',
        phonetic: '/njuːˈmætɪk/',
        meanings: [
          { partOfSpeech: 'noun', definitions: [{ definition: 'An air-filled tyre.' }, { definition: 'A vehicle with these tyres.' }] },
          { partOfSpeech: 'adjective', definitions: [{ definition: 'Operated by compressed air.' }] },
        ],
      }])
    }
    if (upstream.hostname === 'api.mymemory.translated.net') {
      const text = upstream.searchParams.get('q')
      const translatedText = text === 'An air-filled tyre.' ? '充气轮胎' :
        text === 'Operated by compressed air.' ? '用压缩空气驱动的' : ''
      return Response.json({ responseData: { translatedText } })
    }
    return new Response(null, { status: 404 })
  })
  const result = await retryDefinition('pneumatic', youdaoOnly)
  assert.equal(result.gloss, '充气轮胎；用压缩空气驱动的')
  assert.equal(result.phonetic, '/njuːˈmætɪk/')
})
