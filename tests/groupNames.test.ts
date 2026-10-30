import {test} from 'node:test'
import assert from 'node:assert/strict'
import {coreGloss,synonymName,userNotes} from '../src/lib/groupNames'
import type {Word} from '../src/types/index'
const gloss='（尤指《圣经》中耶稣所讲的）（道德或宗教）寓言'
const word:Word={id:'p',text:'parable',gloss,meanings:[],groupId:'p',addedAt:1,source:'api'}
test('real dictionary qualifiers produce a concise group title and never rewrite the definition',()=>{
 assert.equal(coreGloss(gloss),'寓言');assert.equal(synonymName(gloss+' · 近义词',[word]),'近义组 · 寓言');assert.equal(word.gloss,gloss)
 assert.equal(synonymName('近义组 · 寓言',[word]),'近义组 · 寓言')
})
test('nested balanced qualifiers and POS prefixes are handled; unmatched prefixes and explicit human labels survive',()=>{
 assert.equal(coreGloss('n. (especially (religious) stories) （道德）寓言；故事'),'寓言')
 assert.equal(coreGloss('【法律】（美）产权，财产'),'产权')
 assert.equal(coreGloss('(未闭合的限定语'),'('+'未闭合的限定语')
 assert.equal(synonymName('旅行中的表达',[word],'manual'),'近义组 · 旅行中的表达')
 assert.equal(userNotes('来源：Open English WordNet 2025 · id\n义项：example'),'')
 assert.equal(userNotes('来源：我的课堂笔记'),'来源：我的课堂笔记')
})
