export interface SynonymSense {
  id: string
  pos: string
  definition: string
  terms: string[]
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
export async function lookupSynonyms(word: string): Promise<SynonymSense[]> {
  const first = normalizeLemma(word)[0]
  if (!/^[a-z]$/.test(first ?? '')) return []
  if (!cache.has(first)) {
    const request = fetch(`/wordnet/${first}.json`).then(async response => {
      if (!response.ok) throw new Error('离线词库未能加载，请检查安装文件是否完整。')
      return await response.json() as SynonymShard
    }).catch(error => { cache.delete(first); throw error })
    cache.set(first, request)
  }
  return sensesFor(word, await cache.get(first)!)
}

/** The API corroborates a lemma relation, not the selected sense or interchangeability. */
export async function verifySynonyms(word: string, key: string, signal: AbortSignal, request: typeof fetch = fetch): Promise<Set<string>> {
  const params = new URLSearchParams({ rel_syn: normalizeLemma(word), max: '1000' })
  if (key.trim()) params.set('key', key.trim())
  const url = 'https://api.datamuse.com/words?' + params.toString()
  const response = await request('/fwd?url=' + encodeURIComponent(url), { signal: AbortSignal.any([signal, AbortSignal.timeout(12000)]) })
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'API 拒绝访问，请检查密钥或稍后重试。' : '联网校验暂时不可用，请稍后重试或切换离线候选。')
  const data: unknown = await response.json()
  if (!Array.isArray(data) || !data.every(row => row && typeof row === 'object' && typeof row.word === 'string')) throw new Error('API 返回了无法识别的结果，本次未完成校验。')
  return new Set(data.map(row => normalizeLemma(row.word)))
}
