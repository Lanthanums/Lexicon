import type { LibraryState, Word } from '@/types'
import { groupTitle, userNotes } from './groupNames'

export type RelationFilter = 'shape' | 'synonym' | 'custom' | 'isolated'
export type ManagementFilters = Record<RelationFilter, boolean>
export type ManagementSort = 'newest' | 'oldest' | 'az' | 'za'

export interface WordRelations {
  shapeId?: string
  synonymId?: string
  customId?: string
  isolated: boolean
}

export interface ManagementCard {
  id: string
  kind: RelationFilter
  name: string
  notes?: string
  words: Word[]
  latestAddedAt: number
}

export interface ManagementView {
  relations: Record<string, WordRelations>
  cards: ManagementCard[]
}

export function deriveManagementView(state: LibraryState): ManagementView {
  const relations: Record<string, WordRelations> = Object.fromEntries(
    Object.keys(state.words).map(id => [id, { isolated: true }]),
  )
  const cards: ManagementCard[] = []
  for (const group of Object.values(state.groups)) {
    const words = group.wordIds.map(id => state.words[id]).filter((word): word is Word => !!word)
    if (words.length < 2) continue
    words.forEach(word => { relations[word.id] = { ...relations[word.id], shapeId: group.id, isolated: false } })
    cards.push({ id: group.id, kind: 'shape', name: groupTitle(state,{kind:'shape',id:group.id}), words, latestAddedAt: Math.max(...words.map(w => w.addedAt)) })
  }
  for (const group of Object.values(state.synonymSets)) {
    const words = group.wordIds.map(id => state.words[id]).filter((word): word is Word => !!word)
    if (words.length < 2) continue
    words.forEach(word => { relations[word.id] = { ...relations[word.id], synonymId: group.id, isolated: false } })
    cards.push({ id: group.id, kind: 'synonym', name: groupTitle(state,{kind:'synonym',id:group.id}), notes: userNotes(group.notes), words, latestAddedAt: Math.max(...words.map(w => w.addedAt)) })
  }
  for (const group of Object.values(state.customSets ?? {})) {
    const words = group.wordIds.map(id => state.words[id]).filter((word): word is Word => !!word)
    if (words.length < 2) continue
    words.forEach(word => { relations[word.id] = {...relations[word.id], customId:group.id, isolated:false} })
    cards.push({id:group.id,kind:'custom',name:groupTitle(state,{kind:'custom',id:group.id}),notes:userNotes(group.notes),words,latestAddedAt:Math.max(...words.map(w=>w.addedAt))})
  }
  for (const word of Object.values(state.words)) {
    if (!relations[word.id]?.isolated) continue
    cards.push({ id: word.id, kind: 'isolated', name: word.text, words: [word], latestAddedAt: word.addedAt })
  }
  return { relations, cards }
}

export function filterManagementCards(cards: ManagementCard[], filters: ManagementFilters): ManagementCard[] {
  return cards.filter(card => filters[card.kind])
}

export function sortManagementCards(cards: ManagementCard[], sort: ManagementSort): ManagementCard[] {
  return [...cards].sort((a, b) => {
    if (sort === 'az' || sort === 'za') {
      const result = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
      return (sort === 'az' ? result : -result) || a.id.localeCompare(b.id)
    }
    return (sort === 'newest' ? b.latestAddedAt - a.latestAddedAt : a.latestAddedAt - b.latestAddedAt) || a.id.localeCompare(b.id)
  })
}

export function managementWords(cards: ManagementCard[], sort: ManagementSort): Word[] {
  const words = [...new Map(cards.flatMap(card => card.words).map(word => [word.id, word])).values()]
  return words.sort((a, b) => {
    if (sort === 'az' || sort === 'za') return (sort === 'az' ? 1 : -1) * a.text.localeCompare(b.text) || a.id.localeCompare(b.id)
    return (sort === 'newest' ? b.addedAt - a.addedAt : a.addedAt - b.addedAt) || a.id.localeCompare(b.id)
  })
}

export function searchManagement(state: LibraryState, query: string): Word[] {
  const q = query.trim().toLocaleLowerCase()
  if (!q) return []
  const groupNames = (id: string) => [
    ...Object.values(state.groups).filter(g=>g.wordIds.length>1 && g.wordIds.includes(id)).map(g=>groupTitle(state,{kind:'shape',id:g.id})),
    ...Object.values(state.synonymSets).filter(g=>g.wordIds.includes(id)).map(g=>groupTitle(state,{kind:'synonym',id:g.id})),
    ...Object.values(state.customSets??{}).filter(g=>g.wordIds.includes(id)).map(g=>groupTitle(state,{kind:'custom',id:g.id})),
  ].join(' ')
  return Object.values(state.words).filter(word =>
    `${word.text} ${word.gloss} ${word.meanings.map(m => `${m.en} ${m.zh ?? ''}`).join(' ')} ${groupNames(word.id)}`.toLocaleLowerCase().includes(q),
  ).sort((a, b) => a.text.localeCompare(b.text))
}
