import { useEffect, useState, type ReactElement } from 'react'
import { Button } from '@/components/ui/button'

const TOUR_KEY = 'lexicon-tour-done-v1'

export function tourDone(): boolean {
  try {
    return !!localStorage.getItem(TOUR_KEY)
  } catch {
    return true
  }
}

export function markTourDone() {
  try {
    localStorage.setItem(TOUR_KEY, '1')
  } catch {
    /* private mode — just don't persist */
  }
}

interface Step {
  title: string
  points: string[]
  icon: ReactElement
}

const stroke = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

const STEPS: Step[] = [
  {
    title: '今日 · 每天从一个词开始',
    points: [
      '每日一词：在线时是当天的 Word of the Day（英英释义），离线时从你的词库里挑一个',
      '输入框快速录入新词，自动查释义、自动匹配形近 / 同音词',
      '日历记录复习打卡，「开始复习」一键进入今日抽查',
    ],
    icon: (
      <svg viewBox="0 0 24 24" className="size-7" {...stroke}>
        <rect x="3" y="4.5" width="18" height="16" rx="3" />
        <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
        <path d="M9 15l2 2 4-4.5" />
      </svg>
    ),
  },
  {
    title: '词库 · 形近词自动成组',
    points: [
      '录入一个单词，会自动检索词库里已有的形近词并归为一组，卡片按「形近组 1 / 2 / 3…」编号',
      '归组的模糊度可以在设置里调节，也可以手动归组、手动建组、单独成组',
      '点开任意单词查看详情：编辑释义、换通道重新获取、查看复习记录',
    ],
    icon: (
      <svg viewBox="0 0 24 24" className="size-7" {...stroke}>
        <rect x="3" y="3" width="8" height="8" rx="2" />
        <rect x="13" y="3" width="8" height="8" rx="2" />
        <rect x="3" y="13" width="8" height="8" rx="2" />
        <path d="M17 13v8M13 17h8" />
      </svg>
    ),
  },
  {
    title: '抽查 · 三种方式记牢它',
    points: [
      '看中文选英文、看英文选中文、听写拼写——按组出题，形近词互为干扰项',
      '答对答错累计为每个词的掌握度（0–5 级），错词会更频繁地出现',
      '主页会根据掌握度画出未来 14 天的记忆保持率预测',
    ],
    icon: (
      <svg viewBox="0 0 24 24" className="size-7" {...stroke}>
        <circle cx="12" cy="12" r="9" />
        <circle cx="12" cy="12" r="4.5" />
        <circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    title: '设置 · 按你的习惯调',
    points: [
      '查词 API 可排优先级：默认网易有道，备选免费链路，也可接入自己的百度 / 有道智云密钥',
      '归类模糊度支持智能学习：每积累一批数据会给出建议值，一键采纳',
      '词库存在浏览器本地，记得定期导出 JSON 备份；本导览可从设置页随时重看',
    ],
    icon: (
      <svg viewBox="0 0 24 24" className="size-7" {...stroke}>
        <circle cx="12" cy="12" r="3.2" />
        <path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1" />
      </svg>
    ),
  },
]

export default function Tour({
  open,
  onFinish,
}: {
  open: boolean
  onFinish: () => void
}) {
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (open) setStep(0)
  }, [open])
  if (!open) return null

  const s = STEPS[step]
  const last = step === STEPS.length - 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-background/70 p-4 backdrop-blur-sm"
      onClick={onFinish}
      role="dialog"
      aria-modal="true"
      aria-label="新手导览"
    >
      <div
        className="tour-pop w-full max-w-md rounded-2xl border bg-card p-7 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div key={step} className="tour-step">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            {s.icon}
          </div>
          <h2 className="font-word mt-4 text-xl font-semibold tracking-tight">
            {s.title}
          </h2>
          <ul className="mt-3 space-y-2">
            {s.points.map((p, i) => (
              <li
                key={i}
                className="flex gap-2 text-sm leading-relaxed text-muted-foreground"
              >
                <span className="mt-[9px] size-1 shrink-0 rounded-full bg-primary/60" />
                {p}
              </li>
            ))}
          </ul>
        </div>

        <div className="mt-6 flex items-center justify-between">
          <button
            className="text-xs text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
            onClick={onFinish}
          >
            跳过
          </button>
          <div className="flex items-center gap-1.5">
            {STEPS.map((_, i) => (
              <button
                key={i}
                aria-label={`第 ${i + 1} 步`}
                onClick={() => setStep(i)}
                className={`h-1.5 rounded-full transition-all duration-200 ease-(--ease-out-strong) ${
                  i === step
                    ? 'w-5 bg-primary'
                    : 'w-1.5 bg-border hover:bg-muted-foreground/40'
                }`}
              />
            ))}
          </div>
          <div className="flex gap-2">
            {step > 0 && (
              <Button
                variant="ghost"
                size="sm"
                className="pressable"
                onClick={() => setStep((v) => v - 1)}
              >
                上一步
              </Button>
            )}
            <Button
              size="sm"
              className="pressable"
              onClick={() => (last ? onFinish() : setStep((v) => v + 1))}
            >
              {last ? '开始体验' : '下一步'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
