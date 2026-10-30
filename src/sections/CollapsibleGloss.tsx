import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@/lib/utils'

export interface CollapsibleGlossProps {
  /** Gloss text. An empty value shows a quiet placeholder. */
  text: string
  className?: string
}

/**
 * One-line gloss that only offers expand/collapse when the rendered text
 * really overflows its container. Overflow is measured with ResizeObserver
 * (plus a font-load/reflow pass), never inferred from character count.
 */
export default function CollapsibleGloss({ text, className }: CollapsibleGlossProps) {
  const ref = useRef<HTMLSpanElement>(null)
  const [expandedText, setExpandedText] = useState<string|null>(null)
  const expanded=expandedText===text
  const [overflows, setOverflows] = useState(false)
  const display = text.trim() || '（暂无释义）'

  const measure = useCallback(() => {
    const element = ref.current
    if (!element) return
    // While expanded there is no collapsed line to measure; keep the last
    // known state so the collapse affordance does not vanish mid-read.
    if (element.dataset.expanded === 'true') return
    setOverflows(element.scrollWidth > element.clientWidth + 1)
  }, [])

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => window.removeEventListener('resize', measure)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [measure, display])

  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.dataset.expanded = expanded ? 'true' : 'false'
    if (!expanded) {
      // Re-measure after the one-line layout is restored.
      const frame = window.requestAnimationFrame(measure)
      return () => window.cancelAnimationFrame(frame)
    }
  }, [expanded, measure])

  useEffect(() => {
    let cancelled = false
    const fonts = (document as Document & { fonts?: FontFaceSet }).fonts
    fonts?.ready.then(() => { if (!cancelled) measure() }).catch(() => {})
    return () => { cancelled = true }
  }, [measure])

  return (
    <span className={cn('block min-w-0 max-w-full', className)}>
      <span
        ref={ref}
        data-expanded={expanded ? 'true' : 'false'}
        className={cn(
          'block min-w-0 max-w-full text-sm leading-6 text-muted-foreground',
          expanded ? 'whitespace-pre-wrap break-words' : 'truncate',
        )}
      >
        {display}
      </span>
      {overflows && (
        <button
          type="button"
          className="management-gloss-toggle mt-0.5 inline-flex items-center gap-1 rounded-sm text-xs text-primary underline-offset-2 hover:underline"
          aria-expanded={expanded}
          onClick={event => {
            event.stopPropagation()
            setExpandedText(current => current===text?null:text)
          }}
        >
          {expanded ? '收起释义' : '展开释义'}
        </button>
      )}
    </span>
  )
}
