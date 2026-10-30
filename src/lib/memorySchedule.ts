import type { WordStats } from '../types/index'

export const DAY = 86_400_000
const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n))
const LEGACY_DAYS = [1, 3, 7, 14, 30, 60]

/** Exponential forgetting: stability is the number of days to 90% recall.
 * A deliberately small, transparent model; not a fitted FSRS model. */
export function stabilityOf(stat?: WordStats): number {
  if (stat?.memory) return stat.memory.stability
  if (stat?.lastSeen && stat.dueAt && stat.dueAt > stat.lastSeen)
    return clamp((stat.dueAt - stat.lastSeen) / DAY, .1, 365)
  return LEGACY_DAYS[clamp(Math.round(stat?.level ?? 0), 0, 5)]
}

export function recallProbability(stat?: WordStats, now = Date.now()): number {
  if (!stat?.lastSeen) return 0
  return Math.exp(Math.log(.9) * Math.max(0, now - stat.lastSeen) / DAY / stabilityOf(stat))
}

export function reviewDueAt(stat?: WordStats): number | undefined {
  if (!stat?.lastSeen) return undefined
  return stat.dueAt ?? stat.lastSeen + stabilityOf(stat) * DAY
}

/** Due words, then new words, then optional advance practice. */
export function reviewTier(stat?: WordStats, now = Date.now()): number {
  if (!stat?.lastSeen) return 1
  return (reviewDueAt(stat) ?? now) <= now ? 0 : 2
}

export function reviewWeight(stat?: WordStats, now = Date.now()): number {
  return 1 + (1 - recallProbability(stat, now)) * 12 + (stat?.lastResult === false ? 3 : 0)
}

export function scheduleAnswer(previous: WordStats | undefined, correct: boolean, now = Date.now()): WordStats {
  const old = previous ?? { correct: 0, wrong: 0, level: 0 }
  const difficulty = clamp((old.memory?.difficulty ?? 5) + (correct ? -.2 : .8), 1, 10)
  const elapsed = old.lastSeen ? Math.max(0, now - old.lastSeen) / DAY : 0
  const oldStability = stabilityOf(old)
  // Repeating immediately is practice, not evidence for a longer interval.
  const growth = elapsed >= Math.max(.25, oldStability * .2)
    ? 1 + (11 - difficulty) / 5 * (.7 + 2 * (1 - recallProbability(old, now))) : 1
  const stability = correct
    ? (old.lastSeen ? clamp(oldStability * growth, .25, 365) : 1)
    : clamp(oldStability * .35, .25, 365)
  return {
    ...old, correct: old.correct + Number(correct), wrong: old.wrong + Number(!correct),
    level: clamp(old.level + (correct ? 1 : -1), 0, 5), lastSeen: now, lastResult: correct,
    dueAt: now + (correct ? stability * DAY : 5 * 60_000),
    memory: { stability, difficulty, lapses: (old.memory?.lapses ?? 0) + Number(!correct) },
  }
}

/** A manual rating changes the plan, never the answer counters. */
export function rateMastery(previous: WordStats | undefined, level: number, now = Date.now()): WordStats {
  const old = previous ?? {correct:0,wrong:0,level:0}
  const stability = LEGACY_DAYS[clamp(Math.round(level),0,5)]
  return {...old,level,lastSeen:level ? now : old.lastSeen,dueAt:level ? now + stability * DAY : now,
    memory:{stability,difficulty:old.memory?.difficulty ?? 5,lapses:old.memory?.lapses ?? 0}}
}

export function pickScheduled<T>(items: readonly T[], statsOf: (item:T)=>Array<WordStats|undefined>, n:number, now=Date.now(), random= Math.random):T[] {
  const pool=[...items], result:T[]=[]
  while(pool.length && result.length<n){
    const tier=(item:T)=>Math.min(...statsOf(item).map(s=>reviewTier(s,now)),2)
    const best=Math.min(...pool.map(tier))
    const eligible=pool.filter(item=>tier(item)===best)
    const weight=(item:T)=>Math.max(...statsOf(item).map(s=>reviewWeight(s,now)),1)
    let remainder=random()*eligible.reduce((sum,item)=>sum+weight(item),0)
    const chosen=eligible.find(item=>(remainder-=weight(item))<=0) ?? eligible[eligible.length-1]
    result.push(chosen);pool.splice(pool.indexOf(chosen),1)
  }
  return result
}
