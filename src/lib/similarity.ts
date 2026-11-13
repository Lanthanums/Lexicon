/**
 * Orthographic + phonetic similarity for confusable-word clustering.
 *
 * score ∈ [0, 1]; homophones (identical IPA) always score 1.
 */

/** Damerau–Levenshtein distance (optimal string alignment). */
export function editDistance(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  // Optimal string alignment only reads the two preceding rows.
  if (n > m) return editDistance(b, a)
  let older = new Uint32Array(n + 1)
  let previous = Uint32Array.from({ length: n + 1 }, (_, j) => j)
  let current = new Uint32Array(n + 1)
  for (let i = 1; i <= m; i++) {
    current[0] = i
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      current[j] = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        current[j] = Math.min(current[j], older[j - 2] + 1)
      }
    }
    const reusable = older
    older = previous
    previous = current
    current = reusable
  }
  return previous[n]
}

function longestCommonSubstring(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0 || n === 0) return 0
  if (n > m) return longestCommonSubstring(b, a)
  const lengths = new Uint32Array(n + 1)
  let best = 0
  for (let i = 1; i <= m; i++) {
    for (let j = n; j >= 1; j--) {
      lengths[j] = a[i - 1] === b[j - 1] ? lengths[j - 1] + 1 : 0
      if (lengths[j] > best) best = lengths[j]
    }
  }
  return best
}

function commonPrefix(a: string, b: string, offsetA = 0, offsetB = 0): number {
  let length = 0
  while (offsetA + length < a.length && offsetB + length < b.length &&
         a[offsetA + length] === b[offsetB + length]) length++
  return length
}

function commonSuffix(a: string, b: string): number {
  let i = 0
  while (
    i < a.length &&
    i < b.length &&
    a[a.length - 1 - i] === b[b.length - 1 - i]
  )
    i++
  return i
}

/** Strip stress marks / length marks / separators so homophones compare equal. */
export function normalizePhonetic(p?: string): string {
  if (!p) return ''
  return p
    .normalize('NFD')
    .replace(/\p{M}/gu, '') // combining diacritics (e.g. ̯ under aʊ̯)
    .replace(/[ˈˌː.\s\-/[\]()‿͜͡]/g, '')
    .replace(/r$/g, '') // rhotic vs non-rhotic tail tolerance
    .toLowerCase()
}

export interface SimilarityResult {
  score: number
  homophone: boolean
}

export function wordSimilarity(
  a: string,
  b: string,
  phonA?: string,
  phonB?: string,
): SimilarityResult {
  const pa = normalizePhonetic(phonA)
  const pb = normalizePhonetic(phonB)
  const homophone = pa !== '' && pa === pb && a !== b
  if (a === b || homophone) return { score: 1, homophone }

  const maxLen = Math.max(a.length, b.length)
  const levSim = 1 - editDistance(a, b) / maxLen
  const lcsRatio = longestCommonSubstring(a, b) / maxLen
  const prefix = commonPrefix(a, b)
  const edge = (prefix + commonSuffix(a, b)) / (2 * maxLen)

  // Edit similarity sets the floor ("one letter off" in a 5-letter word is
  // already 0.8); shared runs & shared edges push look-alikes higher.
  const blend = 0.62 * levSim + 0.23 * lcsRatio + 0.15 * edge
  // Compare substantial shared beginnings, allowing a single extra letter
  // after the first two characters (e.g. leth- and leath-).
  const sharedStart = prefix < 2 ? prefix : prefix + Math.max(
    commonPrefix(a, b, prefix + 1, prefix),
    commonPrefix(a, b, prefix, prefix + 1),
  )
  const prefixScore = sharedStart >= 4 && sharedStart * 2 >= maxLen
    ? levSim + (1 - levSim) * (sharedStart / maxLen) * 0.6
    : levSim
  const score = Math.max(prefixScore, blend)

  return { score: homophone ? 1 : score, homophone }
}

/** A length mismatch bounds both edit similarity and the blended score. */
export function canMatchShape(a: string, b: string, pa: string, pb: string, threshold: number): boolean {
  if (a === b || (pa && pa === pb)) return true
  // Preserve old long entries; skip quadratic spelling comparison for them.
  if (Math.max(a.length, b.length) > 256) return false
  const max = Math.max(a.length, b.length)
  const ratio = Math.min(a.length, b.length) / max
  return ratio + (1 - ratio) * ratio * 0.6 + Number.EPSILON >= threshold
}

/* ---------------- clustering ---------------- */

interface ClusterInput {
  id: string
  text: string
  phonetic?: string
}

/**
 * Union-find clustering of words by pairwise similarity.
 * `lockedSets` are groups that must stay united (manual groups).
 */
export function clusterWords(
  words: ClusterInput[],
  threshold: number,
  lockedSets: string[][] = [],
): string[][] {
  const index = new Map(words.map((w, i) => [w.id, i]))
  const parent = words.map((_, i) => i)
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]
      x = parent[x]
    }
    return x
  }
  const union = (x: number, y: number) => {
    const rx = find(x)
    const ry = find(y)
    if (rx !== ry) parent[ry] = rx
  }

  // locked (manual) sets first
  for (const set of lockedSets) {
    const ids = set
      .map((id) => index.get(id))
      .filter((i): i is number => i !== undefined)
    for (let i = 1; i < ids.length; i++) union(ids[0], ids[i])
  }

  // Explicitly curated groups retain their members and order.
  const locked = new Set(lockedSets.flat())
  const pronunciations = words.map(word => normalizePhonetic(word.phonetic))
  for (let i = 0; i < words.length; i++) {
    if (locked.has(words[i].id)) continue
    for (let j = i + 1; j < words.length; j++) {
      if (locked.has(words[j].id) || find(i) === find(j) || !canMatchShape(words[i].text, words[j].text, pronunciations[i], pronunciations[j], threshold)) continue
      const { score, homophone } = wordSimilarity(
        words[i].text,
        words[j].text,
        words[i].phonetic,
        words[j].phonetic,
      )
      if (homophone || score >= threshold) union(i, j)
    }
  }

  const buckets = new Map<number, string[]>()
  words.forEach((w, i) => {
    const r = find(i)
    if (!buckets.has(r)) buckets.set(r, [])
    buckets.get(r)!.push(w.id)
  })
  const ordered = new Map(lockedSets.filter(ids => ids.length && index.has(ids[0]))
    .map(ids => [find(index.get(ids[0])!), ids.filter(id => index.has(id))]))
  return [...buckets].map(([root, ids]) => ordered.get(root) ?? ids)
}
