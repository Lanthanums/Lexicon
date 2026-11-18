export interface SynonymSense {
  id: string
  pos: string
  definition: string
  terms: string[]
  related?: true
}
export interface SynonymShard {
  lookup: Record<string, string[]>
  senses: Record<string, SynonymSense>
}

export const normalizeLemma = (word: string) => word.trim().toLowerCase().replaceAll('_', ' ').replace(/\s+/g, ' ')

export function sensesFor(word: string, shard: SynonymShard): SynonymSense[] {
  const lemma = normalizeLemma(word)
  const ids = Object.hasOwn(shard.lookup, lemma) ? shard.lookup[lemma] : []
  return ids.map(id => shard.senses[id]).filter(sense => sense && sense.terms.includes(lemma))
}

const cache = new Map<string, Promise<SynonymShard>>()
const loaded = new Map<string, SynonymShard>()

export function cachedSynonymSenses(word: string): SynonymSense[] {
  const shard = loaded.get(normalizeLemma(word)[0])
  return shard ? sensesFor(word, shard) : []
}

export async function lookupSynonyms(word: string): Promise<SynonymSense[]> {
  const first = normalizeLemma(word)[0]
  if (!/^[a-z]$/.test(first ?? '')) return []
  if (!cache.has(first)) {
    const request = fetch(`/wordnet/${first}.json`).then(async response => {
      if (!response.ok) throw new Error('离线词库未能加载，请检查安装文件是否完整。')
      const shard = await response.json() as SynonymShard
      loaded.set(first, shard)
      return shard
    }).catch(error => { cache.delete(first); throw error })
    cache.set(first, request)
  }
  return sensesFor(word, await cache.get(first)!)
}

/** The API corroborates a lemma relation, not the selected sense or interchangeability. */
export async function verifySynonyms(word: string, key: string, signal: AbortSignal, request: typeof fetch = fetch, timeout = 12000): Promise<Set<string>> {
  const params = new URLSearchParams({ rel_syn: normalizeLemma(word), max: '1000' })
  if (key.trim()) params.set('key', key.trim())
  const url = 'https://api.datamuse.com/words?' + params.toString()
  const response = await request('/fwd?url=' + encodeURIComponent(url), { signal: AbortSignal.any([signal, AbortSignal.timeout(timeout)]) })
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'API 拒绝访问，请检查密钥或稍后重试。' : '联网校验暂时不可用，请稍后重试或切换离线候选。')
  const data: unknown = await response.json()
  if (!Array.isArray(data) || !data.every(row => row && typeof row === 'object' && typeof row.word === 'string')) throw new Error('API 返回了无法识别的结果，本次未完成校验。')
  return new Set(data.map(row => normalizeLemma(row.word)))
}

export interface SynonymVerifier {
  /** Shared, cached request per lemma. The caller's signal only stops waiting. */
  verify(word: string, signal?: AbortSignal): Promise<Set<string>>
}

const VERIFY_TIMEOUT = 8000

function waitFor<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

/**
 * One verifier serves one entry batch. Requests start as soon as a word is known,
 * run in parallel, and are reused when planning restarts. After the service fails
 * once, the remaining words fail fast instead of each waiting for a timeout.
 */
export function createSynonymVerifier(key: string, batch: AbortSignal, request: typeof fetch = fetch): SynonymVerifier {
  const results = new Map<string, Promise<Set<string>>>()
  let failure: Error | undefined
  return {
    verify(word, signal) {
      const lemma = normalizeLemma(word)
      let pending = results.get(lemma)
      if (!pending) {
        pending = failure ? Promise.reject(failure) : verifySynonyms(lemma, key, batch, request, VERIFY_TIMEOUT).catch(error => {
          if (!batch.aborted) failure ??= error instanceof Error && !/^(AbortError|TimeoutError)$/.test(error.name)
            ? error : new Error('联网校验超时，本批其余单词已跳过校验。')
          throw failure ?? error
        })
        pending.catch(() => {})
        results.set(lemma, pending)
      }
      return waitFor(pending, signal)
    },
  }
}
