import { useLayoutEffect, useRef, type ReactNode } from 'react'
import type { ManagementCard } from '@/lib/managementView'

export default function MasonryCards({ cards, renderCard }: {
  cards: ManagementCard[]
  renderCard: (card: ManagementCard) => ReactNode
}) {
  const containerRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const items = Array.from(container.children) as HTMLElement[]

    function pack() {
      if (!container || !container.clientWidth) return
      const style = getComputedStyle(container)
      const columns = Number(style.getPropertyValue('--masonry-columns'))
      const gap = parseFloat(style.rowGap)
      // The CSS applies the final column width before measuring, including at
      // breakpoints and on the initial mount.
      const heights = items.map(item => item.getBoundingClientRect().height)
      const bottoms = Array<number>(columns).fill(0)

      items.forEach((item, index) => {
        const shortest = Math.min(...bottoms)
        // Treat subpixel differences between columns as ties and fill from the left.
        const column = bottoms.findIndex(bottom => bottom <= shortest + 0.5)
        item.style.setProperty('--masonry-column', String(column))
        item.style.setProperty('--masonry-top', `${bottoms[column]}px`)
        bottoms[column] += heights[index] + gap
      })

      container.style.height = `${Math.max(0, Math.max(...bottoms) - gap)}px`
      container.dataset.packed = 'true'
    }

    pack()
    let width = container.clientWidth
    const observer = new ResizeObserver(entries => {
      const nextWidth = container.clientWidth
      if (nextWidth !== width || entries.some(entry => entry.target !== container)) pack()
      width = nextWidth
    })
    observer.observe(container)
    items.forEach(item => observer.observe(item, { box: 'border-box' }))
    return () => observer.disconnect()
  }, [cards])

  return <div ref={containerRef} className="management-masonry">{cards.map(renderCard)}</div>
}
