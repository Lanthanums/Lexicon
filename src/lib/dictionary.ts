import type { DictProviderConfig, WordMeaning } from '@/types'
import { md5 } from 'js-md5'

/**
 * Layered word lookup over configurable providers, tried in order:
 *
 *  - youdao-web   Youdao web dictionary via dev proxy (fast, no key)
 *  - baidu        Baidu translate API (needs appId + key, via /fwd proxy)
 *  - youdao-cloud Youdao zhiyun API (needs appKey + secret, via /fwd proxy)
 *  - custom       user-defined endpoint template (via /fwd proxy)
 *  - wiktionary   Wiktionary + dictionaryapi + MyMemory (free, slow, no key)
 *
 * The /fwd dev-server middleware forwards arbitrary URLs server-side,
 * which bypasses CORS for the registered/commercial APIs.
 */

export interface LookupResult {
  text: string
  phonetic?: string
  gloss: string
  meanings: WordMeaning[]
}

const POS_ZH: Record<string, string> = {
  noun: 'n.',
  verb: 'v.',
  adjective: 'adj.',
  adverb: 'adv.',
  pronoun: 'pron.',
  preposition: 'prep.',
  conjunction: 'conj.',
  interjection: 'int.',
  exclamation: 'int.',
  determiner: 'det.',
  article: 'art.',
  numeral: 'num.',
  auxiliary: 'aux.',
}

function posAbbrev(pos: string): string {
  return POS_ZH[pos.trim().toLowerCase()] ?? pos
}

/** fetch with a hard timeout so a slow network fails fast into fallbacks */
async function fetchWithTimeout(
  url: string,
  ms: number,
  signal?: AbortSignal,
): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), ms)
  const onAbort = () => ctrl.abort()
  signal?.addEventListener('abort', onAbort)
  if (signal?.aborted) ctrl.abort()
  try {
    return await fetch(url, { signal: ctrl.signal })
  } finally {
    clearTimeout(t)
    signal?.removeEventListener('abort', onAbort)
  }
}

const stripHtml = (s: string) =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim()

/* ---------- source 0: Youdao web dictionary (fast, via dev proxy) ---------- */

interface YoudaoTr {
  pos?: string
  tran?: string
}
interface YoudaoResp {
  ec?: {
    word?: {
      ukphone?: string
      usphone?: string
      trs?: YoudaoTr[]
      'return-phrase'?: string
    }
  }
  web_trans?: {
    'web-translation'?: Array<{
      trans?: Array<{ value?: string; summary?: { line?: string[] } }>
    }>
  }
}

interface YoudaoResult {
  phonetic?: string
  gloss: string
  meanings: WordMeaning[]
}

/**
 * Youdao's web dictionary endpoint — ~0.5s from CN networks and returns IPA
 * plus Chinese glosses with POS. It rejects cross-origin browser requests,
 * so it is reached through the dev-server proxy at /youdao.
 *
 * Network failures THROW (so the caller can tell "offline" apart from
 * "no entry"); a response without the ec section falls back to the
 * web_trans network translations before declaring a miss.
 */
async function youdaoLookup(
  word: string,
  signal?: AbortSignal,
): Promise<YoudaoResult | null> {
  const res = await fetchWithTimeout(
    `/youdao/jsonapi_s?doctype=json&jsonversion=4&q=${encodeURIComponent(word)}`,
    8000,
    signal,
  )
  if (!res.ok) throw new Error(`Youdao request failed (${res.status})`)
  const data = (await res.json()) as YoudaoResp
  const w = data.ec?.word
  const meanings: WordMeaning[] = (w?.trs ?? [])
    .filter((t) => t.tran && t.tran.trim())
    // drop proper-noun noise like "（Rode）人名，英、法、德…译作"罗德""
    .filter((t) => !/人名|译作|姓氏|地名/.test(t.tran!))
    .slice(0, 4)
    .map((t) => ({
      pos: t.pos?.trim() ?? '',
      en: '',
      zh: t.tran!.trim(),
    }))
  if (meanings.length > 0) {
    const phone = w?.ukphone || w?.usphone
    return {
      phonetic: phone ? `/${phone}/` : undefined,
      gloss: meanings
        .slice(0, 2)
        .map((m) => m.zh!)
        .join('；'),
      meanings,
    }
  }
  // fallback: web_trans network translations (skip work titles like 《火线对峙》)
  const webValues: string[] = []
  for (const entry of data.web_trans?.['web-translation'] ?? []) {
    for (const t of entry.trans ?? []) {
      const v = t.value?.trim()
      if (!v || v.length > 8) continue
      if (t.summary?.line?.some((l) => l.includes('《'))) continue
      if (!webValues.includes(v)) webValues.push(v)
      if (webValues.length >= 3) break
    }
    if (webValues.length >= 3) break
  }
  if (webValues.length === 0) return null
  return {
    gloss: webValues.join('；'),
    meanings: webValues.map((v) => ({ pos: '', en: '', zh: v })),
  }
}

/* ---------- /fwd generic dev-proxy helpers ---------- */

async function fwdFetch(
  url: string,
  ms: number,
  signal?: AbortSignal,
): Promise<Response> {
  return fetchWithTimeout(`/fwd?url=${encodeURIComponent(url)}`, ms, signal)
}

async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text),
  )
  return [...new Uint8Array(buf)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}

/* ---------- provider: baidu translate ---------- */

async function baiduLookup(
  word: string,
  cfg: DictProviderConfig,
  signal?: AbortSignal,
): Promise<LookupResult | null> {
  if (!cfg.appId || !cfg.apiKey) return null
  const salt = String(Date.now())
  const sign = md5(cfg.appId + word + salt + cfg.apiKey)
  const url =
    `https://fanyi-api.baidu.com/api/trans/vip/translate?q=${encodeURIComponent(word)}` +
    `&from=en&to=zh&appid=${cfg.appId}&salt=${salt}&sign=${sign}`
  const res = await fwdFetch(url, 8000, signal)
  if (!res.ok) return null
  const data = (await res.json()) as {
    trans_result?: Array<{ src: string; dst: string }>
    error_code?: string
  }
  const dst = data.trans_result?.[0]?.dst?.trim()
  if (!dst) return null
  return {
    text: word,
    gloss: dst,
    meanings: [{ pos: '', en: '', zh: dst }],
  }
}

/* ---------- provider: youdao zhiyun (registered) ---------- */

async function youdaoCloudLookup(
  word: string,
  cfg: DictProviderConfig,
  signal?: AbortSignal,
): Promise<LookupResult | null> {
  if (!cfg.appId || !cfg.apiKey) return null
  const salt = crypto.randomUUID?.() ?? String(Date.now())
  const curtime = String(Math.floor(Date.now() / 1000))
  const input =
    word.length <= 20
      ? word
      : word.slice(0, 10) + String(word.length) + word.slice(-10)
  const sign = await sha256Hex(cfg.appId + input + salt + curtime + cfg.apiKey)
  const url =
    `https://openapi.youdao.com/api?q=${encodeURIComponent(word)}&from=en&to=zh-CHS` +
    `&appKey=${encodeURIComponent(cfg.appId)}&salt=${salt}&sign=${sign}&signType=v3&curtime=${curtime}`
  const res = await fwdFetch(url, 8000, signal)
  if (!res.ok) return null
  const data = (await res.json()) as {
    errorCode?: string
    translation?: string[]
    basic?: { phonetic?: string; explains?: string[] }
  }
  if (data.errorCode !== '0' || !data.translation?.[0]) return null
  const gloss = data.translation[0].trim()
  const meanings: WordMeaning[] = (data.basic?.explains ?? [])
    .slice(0, 4)
    .map((e) => {
      const m = /^([a-z]+\.|abbr\.)\s*(.+)$/i.exec(e.trim())
      return m
        ? { pos: m[1], en: '', zh: m[2].trim() }
        : { pos: '', en: '', zh: e.trim() }
    })
  if (meanings.length === 0) meanings.push({ pos: '', en: '', zh: gloss })
  return {
    text: word,
    phonetic: data.basic?.phonetic ? `/${data.basic.phonetic}/` : undefined,
    gloss,
    meanings,
  }
}

/* ---------- provider: custom endpoint ---------- */

function getPath(obj: unknown, path: string): unknown {
  let cur = obj
  for (const key of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined
    cur = (cur as Record<string, unknown>)[key]
  }
  return cur
}

async function customLookup(
  word: string,
  cfg: DictProviderConfig,
  signal?: AbortSignal,
): Promise<LookupResult | null> {
  if (!cfg.endpoint) return null
  const url = cfg.endpoint
    .replace('{word}', encodeURIComponent(word))
    .replace('{appid}', encodeURIComponent(cfg.appId ?? ''))
    .replace('{key}', encodeURIComponent(cfg.apiKey ?? ''))
  const res = await fwdFetch(url, 8000, signal)
  if (!res.ok) return null
  const ct = res.headers.get('content-type') ?? ''
  let gloss = ''
  if (ct.includes('json')) {
    const data = (await res.json()) as unknown
    if (cfg.glossPath) {
      const v = getPath(data, cfg.glossPath)
      if (typeof v === 'string') gloss = v.trim()
    }
    if (!gloss) {
      // try a few common shapes before giving up
      for (const p of [
        'translation',
        'dst',
        'data.translation',
        'result',
        'text',
      ]) {
        const v = getPath(data, p)
        if (typeof v === 'string' && v.trim()) {
          gloss = v.trim()
          break
        }
        if (Array.isArray(v) && typeof v[0] === 'string') {
          gloss = v[0].trim()
          break
        }
      }
    }
  } else {
    gloss = (await res.text()).trim()
  }
  if (!gloss) return null
  return {
    text: word,
    gloss,
    meanings: [{ pos: '', en: '', zh: gloss }],
  }
}

/* ---------- provider: wiktionary chain (slow fallback) ---------- */

/** session circuit breaker for the wiktionary hosts ONLY: en.wiktionary.org
    is unreachable from some networks (DNS poisoning) and dictionaryapi.dev
    can hang for 20s+ — after the first hard network failure, skip the
    wiktionary sub-requests for the rest of this session. MyMemory is a
    different host and stays live either way. */
let wiktionaryDown = false

/**
 * Fallback chain. Every sub-source is optional and fails soft:
 *
 *  - wiktionaryMeanings: null = definitive miss (404), undefined = host
 *    unreachable, array = definitions
 *  - MyMemory gloss is always attempted on its own, so a word can still be
 *    added (gloss-only) when wiktionary is blocked but MyMemory works
 *  - only a definitive 404 miss with no usable gloss reports "not found"
 */
async function wiktionaryChain(
  text: string,
  signal?: AbortSignal,
): Promise<LookupResult | null> {
  const [meanings, phonA, phonB] = await Promise.all([
    wiktionaryMeanings(text, signal),
    dictApiPhonetic(text, signal),
    wiktionaryIpa(text, signal),
  ])
  if (meanings === null) return null // wiktionary reachable: no such word
  const phonetic = phonA ?? phonB

  const gloss = await translateZh(text, signal)
  if (meanings && meanings.length > 0) {
    const defZh = await Promise.all(
      meanings.slice(0, 3).map((m) => translateZh(m.en, signal)),
    )
    meanings.forEach((m, i) => {
      if (defZh[i]) m.zh = defZh[i]
    })
    return {
      text,
      phonetic,
      gloss: gloss || meanings[0].zh || meanings[0].en,
      meanings,
    }
  }
  // wiktionary unreachable → MyMemory alone still yields the Chinese gloss
  if (gloss) return { text, phonetic, gloss, meanings: [] }
  return null
}

/* ---------- source 1: Wiktionary REST definitions ---------- */

interface WiktDef {
  definition: string
  examples?: string[]
}
interface WiktEntry {
  partOfSpeech: string
  language: string
  definitions?: WiktDef[]
}

/**
 * null  = definitive miss (HTTP 404 — host reachable, no such word)
 * undefined = host unreachable (trips the session circuit breaker)
 */
async function wiktionaryMeanings(
  word: string,
  signal?: AbortSignal,
): Promise<WordMeaning[] | null | undefined> {
  if (wiktionaryDown) return undefined
  let res: Response
  try {
    res = await fetchWithTimeout(
      `https://en.wiktionary.org/api/rest_v1/page/definition/${encodeURIComponent(word)}`,
      4000,
      signal,
    )
  } catch (e) {
    if (signal?.aborted) throw e // caller cancelled — don't trip the breaker
    wiktionaryDown = true
    return undefined
  }
  if (res.status === 404) return null
  if (!res.ok) {
    wiktionaryDown = true
    return undefined
  }
  const data = (await res.json()) as Record<string, WiktEntry[]>
  const entries = data.en ?? []
  const meanings: WordMeaning[] = []
  for (const e of entries) {
    const pos = posAbbrev(e.partOfSpeech ?? '')
    for (const d of (e.definitions ?? []).slice(0, 2)) {
      if (meanings.length >= 4) break
      const en = stripHtml(d.definition)
      if (en) meanings.push({ pos, en })
    }
    if (meanings.length >= 4) break
  }
  return meanings
}

/* ---------- source 2: dictionaryapi.dev phonetic (optional) ---------- */

interface DictApiEntry {
  phonetic?: string
  phonetics?: Array<{ text?: string }>
  meanings?: Array<{
    partOfSpeech: string
    definitions: Array<{ definition: string }>
  }>
}

async function dictApiPhonetic(
  word: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  try {
    const res = await fetchWithTimeout(
      `https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`,
      2500,
      signal,
    )
    if (!res.ok) return undefined
    const entries = (await res.json()) as DictApiEntry[]
    const e = entries[0]
    return (
      e?.phonetic ?? e?.phonetics?.find((p) => p.text && p.text.trim())?.text
    )
  } catch {
    return undefined
  }
}

/* ---------- source 3: IPA from Wiktionary wikitext ---------- */

async function wiktionaryIpa(
  word: string,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (wiktionaryDown) return undefined
  try {
    const url =
      `https://en.wiktionary.org/w/api.php?action=parse&page=${encodeURIComponent(word)}` +
      `&prop=wikitext&format=json&formatversion=2&origin=*`
    const res = await fetchWithTimeout(url, 4000, signal)
    if (!res.ok) return undefined
    const data = (await res.json()) as { parse?: { wikitext?: string } }
    const wt = data.parse?.wikitext
    if (!wt) return undefined
    // {{IPA|en|/ˈflaʊ.ə(ɹ)/|/ˈflaʊ.ɚ/}} — take the first IPA transcription
    const m = wt.match(/\{\{\s*IPA\s*\|\s*en\s*\|([^}]+)\}\}/i)
    if (!m) return undefined
    const cand = m[1]
      .split('|')
      .map((s) => s.trim())
      .find((s) => /^[/[]/.test(s) && !s.includes('='))
    return cand
  } catch {
    return undefined
  }
}

/* ---------- source 4: MyMemory Chinese gloss ---------- */

async function translateZh(text: string, signal?: AbortSignal): Promise<string> {
  try {
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(
      text,
    )}&langpair=en|zh-CN`
    const res = await fetchWithTimeout(url, 8000, signal)
    if (!res.ok) return ''
    const data = (await res.json()) as {
      responseData?: { translatedText?: string }
    }
    const t = data.responseData?.translatedText?.trim() ?? ''
    // MyMemory signals quota/limit problems inside the text itself, and on
    // a miss it sometimes echoes the source word back — both mean "no gloss"
    if (!t || /QUERY LENGTH LIMIT|MYMEMORY WARNING|INVALID/i.test(t)) return ''
    if (t.toLowerCase() === text.trim().toLowerCase()) return ''
    return t
  } catch {
    return ''
  }
}

/* ---------- public API ---------- */

/** Re-fetch just the Chinese gloss for a word already in the library. */
export async function fetchGloss(
  word: string,
  signal?: AbortSignal,
  providers?: DictProviderConfig[],
): Promise<string> {
  const r = await lookupWithProviders(word, signal, providers).catch(() => null)
  return r?.gloss ?? ''
}

export class WordNotFoundError extends Error {
  constructor(word: string) {
    super(`No dictionary entry for "${word}"`)
    this.name = 'WordNotFoundError'
  }
}

/** every enabled provider failed on the network level — worth retrying */
export class WordLookupNetworkError extends Error {
  constructor(word: string) {
    super(`All dictionary providers failed for "${word}"`)
    this.name = 'WordLookupNetworkError'
  }
}

const DEFAULT_CHAIN: DictProviderConfig[] = [
  { id: 'youdao-web', label: '', enabled: true },
  { id: 'wiktionary', label: '', enabled: true },
]

async function runProvider(
  p: DictProviderConfig,
  word: string,
  signal?: AbortSignal,
): Promise<LookupResult | null> {
  switch (p.id) {
    case 'youdao-web': {
      const yd = await youdaoLookup(word, signal)
      return yd
        ? { text: word, phonetic: yd.phonetic, gloss: yd.gloss, meanings: yd.meanings }
        : null
    }
    case 'baidu':
      return baiduLookup(word, p, signal)
    case 'youdao-cloud':
      return youdaoCloudLookup(word, p, signal)
    case 'wiktionary':
      return wiktionaryChain(word, signal)
    default:
      // custom providers get their own id
      return customLookup(word, p, signal)
  }
}

async function lookupWithProviders(
  raw: string,
  signal?: AbortSignal,
  providers?: DictProviderConfig[],
): Promise<LookupResult> {
  const text = raw.trim().toLowerCase()
  if (!text) throw new WordNotFoundError(raw)
  const chain = (providers?.length ? providers : DEFAULT_CHAIN).filter(
    (p) => p.enabled,
  )
  let sawMiss = false
  let sawError = false
  for (const p of chain) {
    if (signal?.aborted) break
    // one retry for the fast primary provider — transient hiccups are common
    const attempts = p.id === 'youdao-web' ? 2 : 1
    for (let i = 0; i < attempts; i++) {
      if (signal?.aborted) break
      try {
        const r = await runProvider(p, text, signal)
        if (r) return r
        sawMiss = true // provider answered, but has no entry
        break
      } catch (e) {
        if (signal?.aborted) break
        sawError = true // network-level failure — try again / next provider
        void e
      }
    }
  }
  // every provider errored and none gave a definitive "no entry":
  // this is a network problem, not a missing word
  if (sawError && !sawMiss) throw new WordLookupNetworkError(text)
  throw new WordNotFoundError(text)
}

const lookupCache = new Map<string, { at: number; result: LookupResult }>()

export async function lookupWord(
  raw: string,
  signal?: AbortSignal,
  providers?: DictProviderConfig[],
): Promise<LookupResult> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  const key = JSON.stringify([raw.trim().toLowerCase(), providers])
  const cached = lookupCache.get(key)
  if (cached && Date.now() - cached.at < 86400000) return structuredClone(cached.result)
  const result = await lookupWithProviders(raw, signal, providers)
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError')
  if (lookupCache.size >= 500) lookupCache.delete(lookupCache.keys().next().value!)
  lookupCache.set(key, { at: Date.now(), result })
  return structuredClone(result)
}
