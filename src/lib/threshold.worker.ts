import { suggestThreshold } from './learn'
import type { Word, WordGroup } from '../types/index'
self.onmessage = (event: MessageEvent<{ words: Word[]; groups: Record<string, WordGroup>; threshold: number }>) => {
  const { words, groups, threshold } = event.data
  self.postMessage(suggestThreshold(words, groups, threshold))
}
