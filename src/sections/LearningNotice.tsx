import { useCallback, useEffect, useRef, useState } from 'react'
import { useLibrary } from '@/store/library'

const AUTO_DISMISS_MS = 15_000

/**
 * Top-center floating notification for threshold-learning suggestions.
 * Lives apart from the bottom toast stack so it never collides with the
 * add-word confirmations, and stays until acted on (or 15s pass).
 * Outer wrapper owns positioning (-translate-x-1/2); the inner pill owns
 * the enter/exit animation so the two transform concerns never mix.
 */
export default function LearningNotice({
  onOpenSettings,
}: {
  onOpenSettings: () => void
}) {
  const { state, applyTrace, ackTrace } = useLibrary()
  const trace = state.learning.traces.find((t) => !t.applied && !t.ack)
  const [leaving, setLeaving] = useState(false)
  const id = trace?.id
  const ackRef = useRef(ackTrace)
  ackRef.current = ackTrace

  const dismiss = useCallback(() => {
    if (!id) return
    setLeaving(true)
    // let the exit transition play before acknowledging (which unmounts)
    setTimeout(() => ackRef.current(id), 240)
  }, [id])

  useEffect(() => {
    setLeaving(false)
    if (!id) return
    const t = setTimeout(dismiss, AUTO_DISMISS_MS)
    return () => clearTimeout(t)
  }, [id, dismiss])

  if (!trace) return null

  return (
    <div className="pointer-events-none fixed left-1/2 top-4 z-50 -translate-x-1/2">
      <div
        role="status"
        className={`notice-in pointer-events-auto flex max-w-[92vw] items-center gap-3 rounded-full border bg-card/95 py-2 pl-4 pr-2 shadow-lg backdrop-blur ${
          leaving ? '-translate-y-3 opacity-0' : ''
        }`}
      >
        <svg
          className="size-3.5 shrink-0 animate-[spin_3s_linear_infinite] text-fuchsia-500"
          viewBox="0 0 12 12"
          fill="currentColor"
          aria-hidden
        >
          <path d="M6 0l1.4 4.6L12 6 7.4 7.4 6 12 4.6 7.4 0 6l4.6-1.4z" />
        </svg>
        <p className="whitespace-nowrap text-sm">
          模糊度学习建议：阈值{' '}
          <span className="font-word tabular-nums">
            {trace.previous.toFixed(2)} → {trace.suggested.toFixed(2)}
          </span>
        </p>
        <div className="flex shrink-0 items-center gap-1">
          <button
            className="pressable rounded-full bg-primary px-3 py-1 text-xs font-medium text-primary-foreground"
            onClick={() => applyTrace(trace.id)}
          >
            采用
          </button>
          <button
            className="pressable rounded-full px-2.5 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
            onClick={() => {
              ackTrace(trace.id)
              onOpenSettings()
            }}
          >
            去设置查看
          </button>
          <button
            aria-label="关闭通知"
            className="pressable rounded-full p-1 text-muted-foreground transition-colors duration-150 hover:bg-secondary hover:text-foreground"
            onClick={dismiss}
          >
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            >
              <path d="M1.5 1.5l7 7M8.5 1.5l-7 7" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  )
}
