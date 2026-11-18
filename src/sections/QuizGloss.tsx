import { useLayoutEffect, useRef, useState } from 'react'
import type { WordMeaning } from '@/types'
import { senseGroups } from '@/lib/glossSenses'

/*
 * Shown verbatim at prompt size, a long dictionary gloss becomes a wall of text.
 * These views render a headline sense plus a calm list of the rest, grouped by
 * part of speech (see lib/glossSenses).
 */

/** Leading register or domain labels such as （法律） or <正式> are set quieter. */
export function Sense({ text }: { text: string }) {
  const match = text.match(/^((?:[（(<〈【][^）)>〉】]*[）)>〉】]\s*)+)(.+)$/)
  if (!match) return <>{text}</>
  return <><span className="quiz-sense-label">{match[1]}</span>{match[2]}</>
}

function headlineSize(text: string): string {
  const length = Array.from(text).length
  if (length <= 6) return 'quiz-headline-xl'
  if (length <= 14) return 'quiz-headline-lg'
  if (length <= 26) return 'quiz-headline-md'
  return 'quiz-headline-sm'
}

/** Prompt view: the first sense as a headline, remaining senses listed by part of speech. */
export function GlossPrompt({ gloss, meanings }: { gloss: string; meanings?: WordMeaning[] }) {
  const groups = senseGroups(gloss, meanings)
  const [head, ...firstRest] = groups[0].senses
  const rows = [{ pos: undefined as string | undefined, senses: firstRest }, ...groups.slice(1)].filter(row => row.senses.length)
  const withPos = groups.some(group => group.pos)
  const [expanded, setExpanded] = useState(false)
  const [overflowing, setOverflowing] = useState(false)
  const details = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = details.current
    if (!element || expanded) return
    // Offer "show all" only when a clamped row actually hides text.
    const measure = () => setOverflowing([...element.querySelectorAll<HTMLElement>('.quiz-gloss-senses')]
      .some(row => row.scrollHeight > row.clientHeight + 1))
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [expanded, gloss])
  const collapsible = overflowing || expanded
  return <div className="quiz-prompt-text" data-with-pos={withPos || undefined}>
    <div className="quiz-gloss-row quiz-gloss-head">
      {withPos && <span className="quiz-gloss-pos">{groups[0].pos && <span className="quiz-pos">{groups[0].pos}</span>}</span>}
      <p className={headlineSize(head)}><Sense text={head} /></p>
    </div>
    {rows.length > 0 && <div ref={details} className="quiz-gloss-details" data-collapsed={expanded ? undefined : 'true'}>
      {rows.map((row, index) => <div key={index} className="quiz-gloss-row">
        {withPos && <span className="quiz-gloss-pos">{row.pos && <span className="quiz-pos">{row.pos}</span>}</span>}
        <p className="quiz-gloss-senses">
          {row.senses.map((sense, i) => <span key={i} className="quiz-gloss-sense"><Sense text={sense} /></span>)}
        </p>
      </div>)}
    </div>}
    {collapsible && <button type="button" className="quiz-gloss-toggle" onClick={() => setExpanded(open => !open)} aria-expanded={expanded}>
      {expanded ? '收起义项' : `展开全部 ${groups.reduce((sum, group) => sum + group.senses.length, 0)} 个义项`}
    </button>}
  </div>
}

/** Compact view for answer options and review cards: one line of emphasis, the rest muted and clamped. */
export function GlossCompact({ gloss, meanings, className = '' }: { gloss: string; meanings?: WordMeaning[]; className?: string }) {
  const groups = senseGroups(gloss, meanings)
  const senses = groups.flatMap(group => group.senses)
  return <span className={'quiz-gloss-compact ' + className} title={gloss}>
    {groups[0].pos && <span className="quiz-pos mr-1.5">{groups[0].pos}</span>}
    <span className="quiz-gloss-compact-head"><Sense text={senses[0] ?? gloss} /></span>
    {senses.length > 1 && <span className="quiz-gloss-compact-rest">；{senses.slice(1).join('；')}</span>}
  </span>
}
