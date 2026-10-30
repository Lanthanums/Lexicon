import type { LibraryState, SynonymSet } from '../types/index'

/** Keep the legacy storage format; singleton shape buckets are storage only. */
export function reconcileRelations(input: LibraryState, migrate = false): LibraryState {
  const state = structuredClone(input)
  const memberships = new Map<string, string>()
  for (const [id, group] of Object.entries(state.groups)) {
    group.wordIds = [...new Set(group.wordIds)].filter(wid => !!state.words[wid])
    if (group.wordIds.length < 2) continue
    group.kind = 'confusable'
    for (const wid of group.wordIds) {
      if (memberships.has(wid)) throw new Error('一个词只能属于一个形近组，请先移出原组')
      memberships.set(wid, id)
    }
  }
  for (const [id, group] of Object.entries(state.groups)) {
    if (group.wordIds.length > 1) continue
    group.wordIds = group.wordIds.filter(wid => !memberships.has(wid))
    if (!group.wordIds.length) { delete state.groups[id]; continue }
    const wid = group.wordIds[0]
    memberships.set(wid, id); group.kind = 'single'
  }
  for (const word of Object.values(state.words)) {
    let gid = memberships.get(word.id)
    if (!gid) {
      gid = 'single-' + word.id
      state.groups[gid] = { id: gid, wordIds: [word.id], kind: 'single', manual: false, createdAt: word.addedAt }
    }
    word.groupId = gid
  }
  const assigned = new Set<string>()
  const archive: SynonymSet[] = [...(state.relationArchive ?? [])]
  // The newest legacy relation wins; retain full conflicting notes/membership in the archive.
  const groups = Object.values(state.synonymSets).sort((a,b) => b.createdAt-a.createdAt || a.id.localeCompare(b.id))
  state.synonymSets = {}
  for (const original of groups) {
    const ids = [...new Set(original.wordIds)].filter(id => !!state.words[id])
    const conflicting = ids.some(id => assigned.has(id))
    if (conflicting && !migrate) throw new Error('一个词只能属于一个近义组，请先移出原组')
    if (conflicting && !archive.some(g => g.id === original.id && JSON.stringify(g) === JSON.stringify(original))) archive.push(original)
    const kept = ids.filter(id => !assigned.has(id))
    // Old drafts with one member retain their text, but are not active relations.
    if (kept.length < 2) {
      if (migrate && !archive.some(g => g.id === original.id)) archive.push(original)
      continue
    }
    state.synonymSets[original.id] = { ...original, wordIds: kept }
    kept.forEach(id => assigned.add(id))
  }
  const customAssigned = new Set<string>()
  state.customSets = { ...(state.customSets ?? {}) }
  for (const [id, group] of Object.entries(state.customSets)) {
    group.wordIds = [...new Set(group.wordIds)].filter(wid => !!state.words[wid])
    if (group.wordIds.length < 2) { delete state.customSets[id]; continue }
    for (const wid of group.wordIds) {
      if (customAssigned.has(wid)) throw new Error('一个词只能属于一个自定义组，请先移出原组')
      customAssigned.add(wid)
    }
  }
  if (archive.length) state.relationArchive = archive
  return state
}

export function undoPatch(before: LibraryState, after: LibraryState, current: LibraryState): LibraryState {
  const restored = structuredClone(current)
  for (const section of ['words','groups','synonymSets','customSets','stats'] as const) {
    const keys = new Set([...Object.keys(before[section] ?? {}), ...Object.keys(after[section] ?? {})])
    for (const id of keys) {
      const prior = before[section]?.[id], next = after[section]?.[id]
      if (JSON.stringify(prior) === JSON.stringify(next)) continue
      if (JSON.stringify(current[section]?.[id]) !== JSON.stringify(next)) throw new Error('相关词条已发生其他更改，无法安全撤销；当前数据已保留')
      if (section === 'customSets') restored.customSets ??= {}
      if (prior === undefined) delete restored[section]![id]
      else (restored[section] as Record<string, unknown>)[id] = structuredClone(prior)
    }
  }
  return reconcileRelations(restored)
}

/** Preserve deleted content without overwriting later relationship edits. */
export function restoreDeletedWord(before: LibraryState, current: LibraryState, id: string): LibraryState {
  const original = before.words[id]
  if (!original || current.words[id] || Object.values(current.words).some(w => w.text === original.text)) {
    throw new Error('已存在同名词或该词已恢复，请在管理页检查；后续编辑已保留。')
  }
  const next = structuredClone(current)
  const groupId = `recovered-${id}`
  next.words[id] = { ...structuredClone(original), groupId }
  next.groups[groupId] = { id: groupId, wordIds: [id], kind: 'single', manual: true, createdAt: Date.now() }
  if (before.stats[id]) next.stats[id] = structuredClone(before.stats[id])
  return next
}
