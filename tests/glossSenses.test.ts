import { test } from 'node:test'
import assert from 'node:assert/strict'
import { senseGroups, splitSenses } from '../src/lib/glossSenses'

const limbGloss = '肢；大树枝；（某物的）突出部，延伸部分；十字形四个分支中的一个；弓把的上部（或下部）；（日月等天体的）边缘；冠檐，萼檐；（管状花的）瓣片；（四分仪等科学仪器上测量角度的）分度弧；切断……的手足；从……上截下树枝'
const limbMeanings = [
  { pos: 'n.', en: '', zh: '肢；大树枝；（某物的）突出部，延伸部分；十字形四个分支中的一个；弓把的上部（或下部）；（日月等天体的）边缘；冠檐，萼檐；（管状花的）瓣片；（四分仪等科学仪器上测量角度的）分度弧' },
  { pos: 'v.', en: '', zh: '切断……的手足；从……上截下树枝' },
]

test('a long dictionary gloss splits into senses without breaking inside brackets', () => {
  const senses = splitSenses(limbGloss)
  assert.equal(senses.length, 11)
  assert.equal(senses[0], '肢')
  assert.equal(senses[2], '（某物的）突出部，延伸部分')
  assert.deepEqual(splitSenses('（a；b）c；d。'), ['（a；b）c', 'd'])
  assert.deepEqual(splitSenses('  '), [])
})

test('senses are grouped by part of speech from the dictionary meanings', () => {
  const groups = senseGroups(limbGloss, limbMeanings)
  assert.deepEqual(groups.map(group => [group.pos, group.senses.length]), [['n.', 9], ['v.', 2]])
  // A single part of speech applies to every sense; no meanings means no labels.
  assert.deepEqual(senseGroups('前景；可能性', [{ pos: 'n.', en: '', zh: '前景' }]).map(group => group.pos), ['n.'])
  assert.deepEqual(senseGroups('手动补充释义').map(group => [group.pos, group.senses]), [[undefined, ['手动补充释义']]])
})

test('repeated senses from joined meanings appear once', () => {
  const groups = senseGroups('雪崩，山崩；突然出现的大量事物；雪崩，山崩', [{ pos: 'n.', en: '', zh: '雪崩，山崩；突然出现的大量事物' }])
  assert.deepEqual(groups.flatMap(group => group.senses), ['雪崩，山崩', '突然出现的大量事物'])
})
