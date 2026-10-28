import { wordSimilarity } from './similarity'
import type { Word, WordGroup } from '@/types'

export interface ThresholdSuggestion {
  suggested: number
  /** pairwise F1 of the suggested threshold against the current grouping */
  f1: number
  /** number of same-group word pairs the learner could learn from */
  positivePairs: number
}

/**
 * Threshold learner: treats the *current* grouping (including the user's
 * manual groups, which encode real intent) as ground truth, then searches
 * 0.50–0.95 for the threshold whose clustering best reproduces it
 * (pairwise F1). Ties break toward the current threshold.
 *
 * Similarity between every word pair is computed once; each candidate
 * threshold then only does union-find over the matrix, so this stays fast
 * for a few hundred words.
 */
export function suggestThreshold(
  words: Word[],
  _groups: Record<string, WordGroup>,
  current: number,
): ThresholdSuggestion | null {
  const n = words.length
  if (n < 8) return null

  // ground truth: same groupId
  const groupOf = words.map((w) => w.groupId)
  let positivePairs = 0
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (groupOf[i] === groupOf[j]) positivePairs++
  if (positivePairs === 0) return null // no multi-word groups: nothing to learn

  // pairwise similarity, computed once
  const sim: Float64Array = new Float64Array((n * (n - 1)) / 2)
  const homo: Uint8Array = new Uint8Array((n * (n - 1)) / 2)
  const idx = (i: number, j: number): number =>
    i < j ? i * n - (i * (i + 1)) / 2 + (j - i - 1) : idx(j, i)
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const { score, homophone } = wordSimilarity(
        words[i].text,
        words[j].text,
        words[i].phonetic,
        words[j].phonetic,
      )
      sim[idx(i, j)] = homophone ? 1 : score
      homo[idx(i, j)] = homophone ? 1 : 0
    }
  }

  const parent = new Int32Array(n)
  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]
      x = parent[x]
    }
    return x
  }

  let bestT = current
  let bestF1 = -1
  for (let t = 0.5; t <= 0.9501; t += 0.01) {
    for (let i = 0; i < n; i++) parent[i] = i
    const union = (a: number, b: number) => {
      parent[find(a)] = find(b)
    }
    // NOTE: manual groups are deliberately NOT locked here — they are the
    // learning signal. If the user merged words the algorithm would split,
    // only a lower threshold reproduces that, and vice versa for detaches.
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++)
        if (homo[idx(i, j)] || sim[idx(i, j)] >= t) union(i, j)

    let tp = 0
    let fp = 0
    let fn = 0
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const predSame = find(i) === find(j)
        const trueSame = groupOf[i] === groupOf[j]
        if (predSame && trueSame) tp++
        else if (predSame) fp++
        else if (trueSame) fn++
      }
    }
    const f1 = tp === 0 ? 0 : (2 * tp) / (2 * tp + fp + fn)
    // prefer higher F1; on near-ties stay closer to the current threshold
    if (f1 > bestF1 + 1e-9 || (Math.abs(f1 - bestF1) <= 1e-9 && Math.abs(t - current) < Math.abs(bestT - current))) {
      bestF1 = f1
      bestT = Math.round(t * 100) / 100
    }
  }

  return { suggested: bestT, f1: bestF1, positivePairs }
}
