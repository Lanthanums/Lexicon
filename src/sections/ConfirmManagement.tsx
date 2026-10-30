import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

/**
 * ConfirmManagement — reusable destructive-action confirmation popover.
 *
 * Public API (stable for the v2.0 management workspace):
 *   <ConfirmManagement
 *     title="移出「abandon」？"
 *     description="仅从本组解除关系，单词与学习记录都会保留。"
 *     confirmText="移出"                 // optional, default "确认"
 *     onConfirm={() => undoFunction}      // return an undo callback to get an undo snackbar
 *     disabled={false}                    // optional
 *   >
 *     <Button>…</Button>                  // exactly one focusable trigger
 *   </ConfirmManagement>
 *
 * The snackbar description is always the confirmation title, so it names the
 * action the user just performed. When onConfirm returns a function, the
 * snackbar exposes a single "撤销" action that runs it.
 */
export interface ConfirmManagementProps {
  children: ReactNode
  title: string
  description: ReactNode
  confirmText?: string
  onConfirm: () => (() => void) | void
  disabled?: boolean
  align?: 'start' | 'center' | 'end'
  className?: string
}

export default function ConfirmManagement({
  children,
  title,
  description,
  confirmText = '确认',
  onConfirm,
  disabled = false,
  align = 'end',
  className,
}: ConfirmManagementProps) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  if (disabled) {
    return (
      <span className={className} aria-disabled="true" data-disabled="true">
        {children}
      </span>
    )
  }

  function confirm() {
    if (busy) return
    setBusy(true)
    try {
      const undo = onConfirm()
      setOpen(false)
      toast.success('操作已完成', {
        description: title,
        duration: 10000,
        action: undo
          ? {
              label: '撤销',
              onClick: () => {
                try { undo() } catch (error) {
                  toast.error(error instanceof Error ? error.message : '无法撤销，当前数据已保留')
                }
              },
            }
          : undefined,
      })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '操作未完成')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={next => { if (!busy) setOpen(next) }}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent align={align} className={className ? `w-80 max-w-[calc(100vw-2rem)] ${className}` : 'w-80 max-w-[calc(100vw-2rem)]'}>
        <p className="break-words font-medium">{title}</p>
        <div className="mt-2 text-sm leading-5 text-muted-foreground">{description}</div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => setOpen(false)} disabled={busy}>取消</Button>
          <Button size="sm" variant="destructive" onClick={confirm} disabled={busy}>{confirmText}</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
