import type { WordMeaning } from '../types/index'

/*
 * Dictionary glosses (Youdao in particular) arrive as one long run of senses:
 * "肢；大树枝；（某物的）突出部，延伸部分；…；切断……的手足". These helpers split it
 * into senses and group them by part of speech when the word's dictionary meanings
 * allow it. Display only: the stored gloss is never changed.
 */

const OPEN = '（([【〈<《'
const CLOSE = '）)]】〉>》'

/** Split on ；/; and line breaks, but never inside brackets. */
export function splitSenses(text: string): string[] {
  const senses: string[] = []
  let depth = 0
  let current = ''
  for (const char of text) {
    if (OPEN.includes(char)) depth++
    else if (CLOSE.includes(char)) depth = Math.max(0, depth - 1)
    if (depth === 0 && /[；;\n]/.test(char)) {
      if (current.trim()) senses.push(current.trim())
      current = ''
      continue
    }
    current += char
  }
  if (current.trim()) senses.push(current.trim())
  return senses.map(sense => sense.replace(/[。.]+$/, '')).filter(Boolean)
}

export interface SenseGroup { pos?: string; senses: string[] }

const senseKey = (sense: string) => sense.replace(/[\s，,。.]/g, '')

export function senseGroups(gloss: string, meanings: WordMeaning[] = []): SenseGroup[] {
  const senses = splitSenses(gloss)
  const posOf = new Map<string, string>()
  for (const meaning of meanings) {
    const pos = meaning.pos?.trim()
    if (!pos || !meaning.zh) continue
    for (const sense of splitSenses(meaning.zh)) if (!posOf.has(senseKey(sense))) posOf.set(senseKey(sense), pos)
  }
  const distinct = [...new Set(meanings.map(meaning => meaning.pos?.trim()).filter(Boolean))]
  const fallback = distinct.length === 1 ? distinct[0] : undefined
  const groups: SenseGroup[] = []
  const seen = new Set<string>()
  for (const sense of senses) {
    // Glosses joined from several dictionary meanings can repeat a sense.
    if (seen.has(senseKey(sense))) continue
    seen.add(senseKey(sense))
    const previous = groups.at(-1)
    const pos = posOf.get(senseKey(sense)) ?? (posOf.size ? previous?.pos : fallback)
    if (previous && previous.pos === pos) previous.senses.push(sense)
    else groups.push({ pos, senses: [sense] })
  }
  return groups.length ? groups : [{ pos: fallback, senses: [gloss.trim()] }]
}
