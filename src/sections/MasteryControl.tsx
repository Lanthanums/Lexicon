import { useId, useState } from 'react'
import { Slider } from '@/components/ui/slider'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import './management-editor.css'

export interface MasteryControlProps {
  /** Current mastery, 0–5. Out-of-range values are clamped for display. */
  value: number
  /**
   * When omitted the control is read-only (plain dots, no popover).
   * In the management editor pass a staging callback so the value only
   * leaves the editor when the workspace is saved.
   */
  onChange?: (value: number) => void
  /** Optional visible label, e.g. a word or "熟练度". */
  label?: string
  className?: string
}

const LEVEL_NAMES = ['未学习', '刚认识', '有点印象', '基本掌握', '熟练', '牢固掌握'] as const

function clampLevel(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(5, Math.round(value)))
}

function Dots({ level }: { level: number }) {
  return (
    <span className="management-mastery-dots" aria-hidden="true">
      {Array.from({ length: 5 }, (_, index) => (
        <span
          key={index}
          className="management-mastery-dot"
          data-on={index < level ? 'true' : 'false'}
          style={{ transitionDelay: `${index * 18}ms` }}
        />
      ))}
    </span>
  )
}

/**
 * Five-dot mastery readout. Without `onChange` it is purely presentational.
 * With `onChange` it becomes a popover containing an animated 0–5 slider
 * (never a numeric select), so the management editor can stage the value.
 */
export default function MasteryControl({ value, onChange, label, className }: MasteryControlProps) {
  const level = clampLevel(value)
  const id = useId()
  const [open, setOpen] = useState(false)
  const editable = typeof onChange === 'function'
  const readableLabel = label ? `${label}，熟练度 ${level}/5，${LEVEL_NAMES[level]}` : `熟练度 ${level}/5，${LEVEL_NAMES[level]}`

  if (!editable) {
    return (
      <span className={cn('management-mastery-readonly', className)} role="img" aria-label={readableLabel} title={readableLabel}>
        <Dots level={level} />

      </span>
    )
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn('management-mastery-trigger', className)}
          aria-label={label ? `调整 ${label} 的熟练度，当前 ${level}/5` : `调整熟练度，当前 ${level}/5`}
          title={readableLabel}
        >
          <Dots level={level} />

        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="management-mastery-popover w-64" aria-labelledby={`${id}-title`}>
        <div className="flex items-baseline justify-between gap-3">
          <p id={`${id}-title`} className="text-sm font-medium">{label ? `${label} · 熟练度` : '熟练度'}</p>
          <p className="text-sm tabular-nums text-muted-foreground" aria-live="polite">
            <span className="font-word text-xl text-foreground">{level}</span> / 5
          </p>
        </div>
        <p className="mt-1 min-h-5 text-xs text-muted-foreground" aria-live="polite">{LEVEL_NAMES[level]}</p>
        <Slider
          className="management-mastery-slider mt-4"
          value={[level]}
          min={0}
          max={5}
          step={1}
          aria-label={label ? `${label} 的熟练度` : '熟练度'}
          aria-valuetext={`${level} 级，${LEVEL_NAMES[level]}`}
          onValueChange={next => onChange?.(clampLevel(next[0] ?? 0))}
        />
        <div className="mt-3 flex justify-between text-[10px] text-muted-foreground" aria-hidden="true">
          <span>0</span><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
          <span className="management-mastery-preview" aria-hidden="true"><Dots level={level} /></span>
          <button type="button" className="text-xs text-primary underline-offset-2 hover:underline" onClick={() => setOpen(false)}>
            完成
          </button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
