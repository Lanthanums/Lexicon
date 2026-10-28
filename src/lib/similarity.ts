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
  const d: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  )
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + cost,
      )
      if (
        i > 1 &&
        j > 1 &&
        a[i - 1] === b[j - 2] &&
        a[i - 2] === b[j - 1]
      ) {
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1)
      }
    }
  }
  return d[m][n]
}

function longestCommonSubstring(a: string, b: string): number {
  const m = a.length
  const n = b.length
  if (m === 0 || n === 0) return 0
  let prev = new Array<number>(n + 1).fill(0)
  let best = 0
  for (let i = 1; i <= m; i++) {
    const cur = new Array<number>(n + 1).fill(0)
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1
        if (cur[j] > best) best = cur[j]
      }
    }
    prev = cur
  }
  return best
}

function commonPrefix(a: string, b: string): number {
  let i = 0
  while (i < a.length && i < b.length && a[i] === b[i]) i++
  return i
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
  if (a === b) return { score: 1, homophone: false }

  const maxLen = Math.max(a.length, b.length)
  const levSim = 1 - editDistance(a, b) / maxLen
  const lcsRatio = longestCommonSubstring(a, b) / maxLen
  const edge =
    (commonPrefix(a, b) + commonSuffix(a, b)) / (2 * maxLen)

  // Edit similarity sets the floor ("one letter off" in a 5-letter word is
  // already 0.8); shared runs & shared edges push look-alikes higher.
  const blend = 0.62 * levSim + 0.23 * lcsRatio + 0.15 * edge
  const score = Math.max(levSim, blend)

  return { score: homophone ? 1 : score, homophone }
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

  for (let i = 0; i < words.length; i++) {
    for (let j = i + 1; j < words.length; j++) {
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
  return [...buckets.values()]
}
