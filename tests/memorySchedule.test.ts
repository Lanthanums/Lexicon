import {test} from 'node:test'
import assert from 'node:assert/strict'
import {DAY,recallProbability,stabilityOf,scheduleAnswer,rateMastery,pickScheduled,reviewDueAt} from '../src/lib/memorySchedule'

const now=Date.UTC(2026,9,29,12)
test('forgetting estimate decays with time and reaches 90% at stability',()=>{
  const s=scheduleAnswer(undefined,true,now)
  assert.equal(s.dueAt,now+DAY)
  assert.equal(recallProbability(s,now),1)
  assert.ok(Math.abs(recallProbability(s,now+DAY)-.9)<1e-10)
  assert.ok(recallProbability(s,now+3*DAY)<recallProbability(s,now+DAY))
})
test('spaced successful recall lengthens stability; immediate drills do not inflate it',()=>{
  const first=scheduleAnswer(undefined,true,now)
  const immediate=scheduleAnswer(first,true,now+60_000)
  assert.equal(stabilityOf(immediate),stabilityOf(first))
  const later=scheduleAnswer(first,true,now+DAY)
  assert.ok(stabilityOf(later)>stabilityOf(first))
  assert.ok(later.dueAt!>now+2*DAY)
})
test('lapse schedules five-minute relearning without losing counters or exceeding bounds',()=>{
  const first=scheduleAnswer(undefined,true,now),spaced=scheduleAnswer(first,true,now+DAY)
  const failed=scheduleAnswer(spaced,false,now+4*DAY)
  assert.equal(failed.dueAt,now+4*DAY+300_000)
  assert.equal(failed.correct,2);assert.equal(failed.wrong,1);assert.equal(failed.memory?.lapses,1)
  assert.ok(stabilityOf(failed)<stabilityOf(spaced))
  let s=failed;for(let i=0;i<200;i++)s=scheduleAnswer(s,i%2===0,now+(i+5)*DAY)
  assert.ok(stabilityOf(s)>=.25&&stabilityOf(s)<=365)
  assert.ok(s.memory!.difficulty>=1&&s.memory!.difficulty<=10)
})
test('due, new and advance practice have strict priority, including synonym member groups',()=>{
  const base={correct:1,wrong:0,level:1,lastSeen:now-DAY}
  const entries=[{id:'future',stats:[{...base,dueAt:now+DAY}]},{id:'new',stats:[undefined]},{id:'due',stats:[{...base,dueAt:now-1}]},{id:'group',stats:[{...base,dueAt:now+DAY},{...base,dueAt:now-10}]}]
  const selected=pickScheduled(entries,e=>e.stats,4,now,()=>.999)
  assert.deepEqual(new Set(selected.slice(0,2).map(e=>e.id)),new Set(['due','group']))
  assert.equal(selected[2].id,'new');assert.equal(selected[3].id,'future')
  assert.equal(new Set(selected).size,4)
})
test('legacy due dates are honored and manual mastery never creates answers',()=>{
  const old={correct:8,wrong:2,level:3,lastSeen:now-2*DAY,dueAt:now+5*DAY}
  assert.equal(stabilityOf(old),7);assert.equal(reviewDueAt(old),old.dueAt)
  const rated=rateMastery(old,4,now)
  assert.equal(rated.correct,8);assert.equal(rated.wrong,2);assert.ok(rated.memory)
})
