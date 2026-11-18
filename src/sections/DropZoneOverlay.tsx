import { useLayoutEffect, useRef, type RefObject } from 'react'
import { Ban, Layers3, Link2, SpellCheck2 } from 'lucide-react'
import { DROP_KINDS, DROP_LABELS, type DropPlan } from '@/lib/grouping'
import type { GroupKind } from '@/types'

const icons = {shape: SpellCheck2, synonym: Link2, custom: Layers3}
const iconColors = {shape: 'text-blue-800 dark:text-blue-200', synonym: 'text-emerald-800 dark:text-emerald-200', custom: 'text-stone-700 dark:text-stone-200'}

export default function DropZoneOverlay({ active, plans, recommended, toolbar }: {
  active: GroupKind | null
  plans: Record<GroupKind, DropPlan>
  recommended: GroupKind[]
  toolbar: RefObject<HTMLDivElement | null>
}) {
  const overlay = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const element = overlay.current
    if (!element) return
    const controls = toolbar.current
    let frame = 0
    function placeLabels() {
      if (!element) return
      const bounds = element.getBoundingClientRect()
      const covered = controls?.getClientRects().length ? controls.getBoundingClientRect().bottom : 0
      const top = Math.max(bounds.top, covered, 0)
      const bottom = Math.min(bounds.bottom, window.innerHeight)
      const visible = Math.max(0, bottom - top)
      const compact = visible < 112
      const minimal = visible < 54
      const center = Math.max(0, Math.min(bounds.height, top - bounds.top + visible / 2))
      element.dataset.compact = String(compact)
      element.dataset.minimal = String(minimal)
      element.style.setProperty('--drop-visible-center', `${center}px`)
    }
    function schedulePlacement() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(placeLabels)
    }
    placeLabels()
    const observer = new ResizeObserver(schedulePlacement)
    observer.observe(element)
    if (controls) observer.observe(controls)
    window.addEventListener('scroll', schedulePlacement, {passive: true})
    window.addEventListener('resize', schedulePlacement)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('scroll', schedulePlacement)
      window.removeEventListener('resize', schedulePlacement)
    }
  }, [toolbar])

  return <div ref={overlay} className="drop-zone-overlay" data-drop-overlay data-active-kind={active ?? undefined} aria-hidden="true">
    <div className="drop-zone-grid">
      {DROP_KINDS.map(kind => {
        const allowed = plans[kind].allowed
        const Icon = allowed ? icons[kind] : Ban
        return <div key={kind} className="drop-zone" data-drop-zone={kind}
          data-selected={active === kind} data-allowed={allowed}>
          <div className="drop-zone-label">
            <Icon className={allowed ? iconColors[kind] : undefined} size={17} strokeWidth={1.8}/>
            <span>{DROP_LABELS[kind]}</span>
            {recommended.includes(kind) && <small>推荐</small>}
          </div>
        </div>
      })}
    </div>
  </div>
}
