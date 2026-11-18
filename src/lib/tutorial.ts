import { createContext } from 'react'
import type { LibraryState } from '@/types'

const KEY = 'lexicon-guide-v3'
export const GuidedTourContext = createContext(false)
export function tourDone() { try { return !!localStorage.getItem(KEY) } catch { return true } }
export function markTourDone(completed = true) { try { localStorage.setItem(KEY, completed ? 'complete' : 'dismissed') } catch { /* optional preference */ } }
export type GuidePage = 'today' | 'manage' | 'quiz' | 'settings'
export const GUIDE_STEPS = [
  { id:'overview', title:'先认识你的词汇空间', text:'四个分块，串起收藏、整理、回忆和保存。接下来只练几个容易错过的小技巧。' },
  { id:'word', title:'拖动一个词，松手前选择关系', text:'把 scout 拖到 stout / spout 卡片的左侧「形近组」区域，松手加入该组。' },
  { id:'card', title:'拖动卡片空白处，合并整组', text:'把 adapt / adopt 整张卡片拖到 accept / receive 卡片的右侧「自定义组」区域，松手合并。合并后可撤销。' },
  { id:'sort', title:'拖动三横线，调整顺序', text:'在编辑器里，按住 stout 左侧的三横线，直接拖到下一行。也可以聚焦手柄，用上下方向键调整。' },
  { id:'mastery', title:'五个点，也藏着一个滑条', text:'点击 stout 右侧的五个点，再滑动调整熟练度。正常使用时，保存编辑才生效；手动调整不会增加答题次数。' },
  { id:'finish', title:'可以开始自己的积累了', text:'教学练习会随退出丢弃。以后想重看，从设置里的「互动使用教学」重新打开即可。' },
] as const
export type GuideTask = typeof GUIDE_STEPS[number]['id']

/** Temporary examples for the real management UI; never saved or imported. */
export function createGuideLibrary(): LibraryState {
  const state: LibraryState = { words:{},groups:{},synonymSets:{},customSets:{},stats:{},activity:{},settings:{threshold:0.7,synonymMode:'offline',dictProviders:[]},learning:{enabled:false,addCount:0,traces:[]} }
  const definitions: Record<string,string> = { scout:'侦察；侦察员', stout:'结实的', spout:'喷口；喷出', adapt:'适应', adopt:'采用；收养', accept:'接受', receive:'收到' }
  for (const [i,text] of Object.keys(definitions).entries()) {
    const id='guide-'+text, gid=['stout','spout'].includes(text)?'guide-letters':['adapt','adopt'].includes(text)?'guide-shape':id
    state.words[id]={id,text,gloss:definitions[text],meanings:[],source:'manual',groupId:gid,addedAt:100-i}
    state.groups[gid]??={id:gid,wordIds:[],manual:true,createdAt:100-i}
    state.groups[gid].wordIds.push(id)
    state.stats[id]={level:2,correct:0,wrong:0}
  }
  state.synonymSets['guide-near']={id:'guide-near',name:'接受与接收',notes:'',wordIds:['guide-accept','guide-receive'],createdAt:90}
  return state
}
