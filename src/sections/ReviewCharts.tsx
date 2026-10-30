import {useReducedMotion} from '@/lib/motion'
import { useMemo } from 'react'
import {
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { CalendarClock, ChartPie as PieChartIcon, Info, TrendingUp } from 'lucide-react'
import { useLibrary } from '@/store/library'
import { Badge } from '@/components/ui/badge'
import {
  buildReviewForecast,
  summarizeMastery,
  type ForecastDay,
  type MasteryBand,
} from '@/lib/reviewForecast'

/**
 * Warm, theme-agnostic mid tones: readable on both the cream light card and
 * the charcoal dark card without reading CSS variables from SVG attributes.
 */
const COLOR: Record<MasteryBand, string> = {
  unfamiliar: '#9b9186',
  vague: '#d3a03e',
  mastered: '#c26632',
  familiar: '#4c8d6c',
}

const BAND_META: Array<{ key: MasteryBand; name: string; hint: string }> = [
  { key: 'unfamiliar', name: '陌生', hint: '等级 0 · 含尚未学习的词' },
  { key: 'vague', name: '有印象', hint: '等级 1–2' },
  { key: 'mastered', name: '已掌握', hint: '等级 3–4' },
  { key: 'familiar', name: '已熟识', hint: '等级 5' },
]

const AXIS_TICK = { fill: '#8d8378', fontSize: 11 }

function ForecastTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: ForecastDay }>
}) {
  const day = payload?.[0]?.payload
  if (!active || !day) return null
  return (
    <div className="min-w-44 rounded-lg border bg-background/95 p-3 text-xs shadow-xl backdrop-blur">
      <p className="font-medium">
        {day.label}
        <span className="ml-2 font-normal text-muted-foreground">{day.key}</span>
      </p>
      <div className="mt-2 space-y-1.5">
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: COLOR.familiar }}
            />
            已熟识
          </span>
          <span className="tabular-nums">{day.familiar}</span>
        </div>
        <div className="flex items-center justify-between gap-4">
          <span className="flex items-center gap-1.5">
            <span
              className="size-2 rounded-full"
              style={{ backgroundColor: COLOR.mastered }}
            />
            需巩固
          </span>
          <span className="tabular-nums">{day.needsReview}</span>
        </div>
        <div className="flex items-center justify-between gap-4 text-muted-foreground">
          <span>陌生 / 未学</span>
          <span className="tabular-nums">{day.unfamiliar}</span>
        </div>
        <div className="flex items-center justify-between gap-4 border-t pt-1.5 font-medium">
          <span>当日合计</span>
          <span className="tabular-nums">{day.total} 词</span>
        </div>
        <p className="text-muted-foreground">
          当日计划复习 {day.reviewed} 词
        </p>
      </div>
    </div>
  )
}

interface PieDatum {
  key: MasteryBand
  name: string
  value: number
  color: string
}

function PieTooltip({
  active,
  payload,
  total,
}: {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: PieDatum }>
  total: number
}) {
  const item = payload?.[0]?.payload
  if (!active || !item) return null
  const percent = total > 0 ? Math.round((item.value / total) * 100) : 0
  return (
    <div className="rounded-lg border bg-background/95 px-3 py-2 text-xs shadow-xl backdrop-blur">
      <p className="flex items-center gap-1.5 font-medium">
        <span
          className="size-2 rounded-full"
          style={{ backgroundColor: item.color }}
        />
        {item.name}
      </p>
      <p className="mt-1.5 tabular-nums text-muted-foreground">
        {item.value} 词 · {percent}%
      </p>
    </div>
  )
}

function LegendDot({ color, label, hint }: { color: string; label: string; hint: string }) {
  return (
    <span className="inline-flex items-center gap-1.5" title={hint}>
      <span className="size-2 rounded-full" style={{ backgroundColor: color }} />
      <span>{label}</span>
    </span>
  )
}

function ChartEmpty({
  icon: Icon,
  title,
  text,
}: {
  icon: typeof Info
  title: string
  text: string
}) {
  return (
    <div className="flex h-56 flex-col items-center justify-center rounded-xl border border-dashed bg-background/40 px-6 text-center">
      <Icon className="size-7 text-primary/50" strokeWidth={1.5} />
      <p className="mt-3 text-sm font-medium">{title}</p>
      <p className="mt-1.5 max-w-xs text-xs leading-5 text-muted-foreground">{text}</p>
    </div>
  )
}

export default function ReviewCharts() {
  const { state } = useLibrary()
  const reduced=useReducedMotion()

  const distribution = useMemo(
    () => summarizeMastery(state.words, state.stats),
    [state.words, state.stats],
  )
  const forecast = useMemo(
    () => buildReviewForecast(state.words, state.stats),
    [state.words, state.stats],
  )

  const pieData = useMemo<PieDatum[]>(
    () =>
      BAND_META.map((band) => ({
        key: band.key,
        name: band.name,
        value: distribution[band.key],
        color: COLOR[band.key],
      })),
    [distribution],
  )

  const hasPie = distribution.total > 0
  const hasForecast = forecast.hasWords && forecast.hasPlan

  return (
    <section aria-labelledby="review-charts-title" className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h3 id="review-charts-title" className="flex items-center gap-2 text-sm font-medium">
            <TrendingUp className="size-4 text-primary" strokeWidth={1.7} />
            掌握构成与未来 7 天
          </h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">
            看看你的积累，以及未来一周的复习趋势。
          </p>
        </div>
        <Badge variant="outline" className="shrink-0 font-normal">
          预计趋势
        </Badge>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        {/* forecast */}
        <div className="min-w-0 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">已熟识与需巩固词数</p>
              <p className="mt-1 text-xs text-muted-foreground">
                按日终统计，单位：词。
              </p>
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              <LegendDot
                color={COLOR.familiar}
                label="已熟识"
                hint="等级 5"
              />
              <LegendDot
                color={COLOR.mastered}
                label="需巩固"
                hint="等级 1–4，含已掌握"
              />
            </div>
          </div>

          {!forecast.hasWords ? (
            <ChartEmpty
              icon={CalendarClock}
              title="还没有可推演的单词"
              text="录入单词并完成第一次复习后，这里会显示未来 7 天的掌握构成。"
            />
          ) : !hasForecast ? (
            <ChartEmpty
              icon={CalendarClock}
              title="还没有复习计划"
              text="完成一次复习后，可按到期计划查看预计变化。"
            />
          ) : (
            <>
              {forecast.dueWithinHorizon === 0 ? (
                <p className="mt-3 rounded-lg bg-background px-3 py-2 text-xs leading-5 text-muted-foreground">
                  未来 7 天暂无到期复习，预计构成保持不变。
                </p>
              ) : null}
              <div className="mt-3 h-56 w-full" role="img" aria-label="未来七天已熟识与需巩固词数折线图">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart
                    data={forecast.days}
                    margin={{ top: 8, right: 12, bottom: 0, left: -16 }}
                  >
                    <CartesianGrid
                      strokeDasharray="3 3"
                      vertical={false}
                      stroke="rgba(141, 131, 120, 0.28)"
                    />
                    <XAxis
                      dataKey="label"
                      tick={AXIS_TICK}
                      tickLine={false}
                      axisLine={{ stroke: 'rgba(141, 131, 120, 0.35)' }}
                      dy={6}
                    />
                    <YAxis
                      tick={AXIS_TICK}
                      tickLine={false}
                      axisLine={false}
                      width={38}
                      allowDecimals={false}
                      domain={[0, Math.max(1, forecast.totalWords)]}
                    />
                    <Tooltip
                      cursor={{ stroke: 'rgba(141, 131, 120, 0.45)', strokeDasharray: '3 3' }}
                      content={<ForecastTooltip />}
                    />
                    <Line
                      type="linear"
                      dataKey="familiar"
                      name="已熟识"
                      stroke={COLOR.familiar}
                      strokeWidth={2.2}
                      dot={{ r: 3, fill: COLOR.familiar, strokeWidth: 0 }}
                      activeDot={{ r: 4.5 }}
                      animationDuration={450} isAnimationActive={!reduced}
                    />
                    <Line
                      type="linear"
                      dataKey="needsReview"
                      name="需巩固"
                      stroke={COLOR.mastered}
                      strokeWidth={2.2}
                      dot={{ r: 3, fill: COLOR.mastered, strokeWidth: 0 }}
                      activeDot={{ r: 4.5 }}
                      animationDuration={450} isAnimationActive={!reduced}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="mt-3 border-t pt-3 text-xs text-muted-foreground">未来一周有 {forecast.dueWithinHorizon} 个词待复习。</p>
            </>
          )}
        </div>

        {/* pie */}
        <div className="min-w-0 rounded-2xl border bg-card p-4 shadow-sm sm:p-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-medium">当前掌握构成</p>
              <p className="mt-1 text-xs text-muted-foreground">
                你已经记住了多少？
              </p>
            </div>
            <Badge variant="secondary" className="shrink-0 tabular-nums font-normal">
              {distribution.total} 词
            </Badge>
          </div>

          {!hasPie ? (
            <ChartEmpty
              icon={PieChartIcon}
              title="还没有可统计的单词"
              text="当前词库为空。录入单词后，这里会显示陌生、有印象、已掌握、已熟识的比例。"
            />
          ) : (
            <>
              <div className="relative mt-2 h-52 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius="58%"
                      outerRadius="84%"
                      paddingAngle={2}
                      startAngle={90}
                      endAngle={-270}
                      stroke="none"
                      animationDuration={500} isAnimationActive={!reduced}
                    >
                      {pieData.map((entry) => (
                        <Cell key={entry.key} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip content={<PieTooltip total={distribution.total} />} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                  <span className="font-word text-3xl leading-none tabular-nums">
                    {distribution.total}
                  </span>
                  <span className="mt-1 text-[11px] text-muted-foreground">个单词</span>
                </div>
              </div>
              <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-2 border-t pt-3 text-xs">
                {pieData.map((item) => {
                  const percent =
                    distribution.total > 0
                      ? Math.round((item.value / distribution.total) * 100)
                      : 0
                  return (
                    <li
                      key={item.key}
                      className="flex min-w-0 items-center justify-between gap-2"
                      title={BAND_META.find((band) => band.key === item.key)?.hint}
                    >
                      <span className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                        <span
                          className="size-2 shrink-0 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="truncate">{item.name}</span>
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {item.value}
                        <span className="ml-1 text-muted-foreground">{percent}%</span>
                      </span>
                    </li>
                  )
                })}
              </ul>
              <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-5 text-muted-foreground">
                <Info className="mt-0.5 size-3 shrink-0" />
                0 陌生（含未学）· 1–2 有印象 · 3–4 已掌握 · 5 已熟识
              </p>
            </>
          )}
        </div>
      </div>

    </section>
  )
}
