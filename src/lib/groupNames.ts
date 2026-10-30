import type { GroupRef, LibraryState, Word } from '../types/index'

const OPEN: Record<string,string> = {'(':')','（':'）','[':']','【':'】','<':'>','〈':'〉','〔':'〕'}
const PREFIX = /^(?:形近组|近义组|近义词群|自定义组)\s*[·•:：-]?\s*/
const unprefix = (name:string) => name.trim().replace(PREFIX,'')

/** Short label only. The original dictionary definition is never rewritten. */
export function coreGloss(gloss:string): string {
  let text=gloss.trim().replace(/^\d+[.、)）]\s*/, '').replace(/^(?:(?:n|v|vi|vt|adj|adv|prep|conj|pron|interj)\.\s*)+/i,'')
  for(let pass=0;pass<20;pass++) {
    const end=OPEN[text[0]]
    if(!end) break
    const stack:string[]=[]
    let close=-1
    for(let i=0;i<text.length;i++) {
      if(OPEN[text[i]])stack.push(OPEN[text[i]])
      else if(stack.length && text[i]===stack.at(-1)) {stack.pop();if(!stack.length){close=i;break}}
    }
    if(close<0)break
    const remaining=text.slice(close+1).trim().replace(/^[：:，,；;、]\s*/, '')
    if(!remaining)return ''
    text=remaining
  }
  text=text.split(/[；;，,\n]/)[0].trim().replace(/^[：:、\s]+|[。；;\s]+$/g,'')
  if(!text)return ''
  return Array.from(text).length>24?Array.from(text).slice(0,24).join('')+'…':text
}

export function synonymName(name:string,words:Word[],nameSource?:'auto'|'manual'):string {
  const automatic=nameSource==='auto' || /[·•]\s*近义词(?:群|组)?\s*$/.test(name)
  const bare=unprefix(name).replace(/\s*[·•]\s*近义词(?:群|组)?\s*$/, '').trim()
  const label=automatic?coreGloss(bare):bare
  const fallback=words.map(word=>coreGloss(word.gloss)).find(Boolean) || '未命名'
  return '近义组 · '+(label || fallback)
}

export function groupTitle(state:LibraryState,ref:GroupRef):string {
  if(ref.kind==='isolated')return state.words[ref.id]?.text || '单词'
  const group=ref.kind==='shape'?state.groups[ref.id]:ref.kind==='synonym'?state.synonymSets[ref.id]:state.customSets?.[ref.id]
  if(!group)return ref.kind==='shape'?'形近组':ref.kind==='synonym'?'近义组':'自定义组'
  const words=group.wordIds.map(id=>state.words[id]).filter((word):word is Word=>!!word)
  if(ref.kind==='synonym')return synonymName(group.name??'',words,'nameSource' in group?group.nameSource:undefined)
  const rawLabel=unprefix(group.name??'')
  const label=(ref.kind==='custom' && 'nameSource' in group && group.nameSource==='auto' ? coreGloss(rawLabel) : rawLabel) || words.slice(0,3).map(word=>word.text).join(' / ')+(words.length>3?' …':'')
  return (ref.kind==='shape'?'形近组':'自定义组')+' · '+label
}

export function userNotes(notes:string):string {
  return /^来源[：:]\s*Open English WordNet/.test(notes.trim())?'':notes
}
