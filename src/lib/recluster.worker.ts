import { clusterWords } from './similarity'
import type { Word } from '../types'

self.onmessage = (event: MessageEvent<{
  words: Pick<Word, 'id' | 'text' | 'phonetic'>[]
  threshold: number
  locked: string[][]
}>) => {
  const { words, threshold, locked } = event.data
  self.postMessage(clusterWords(words, threshold, locked))
}
