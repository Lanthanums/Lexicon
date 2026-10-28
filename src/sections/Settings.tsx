import DataTransfer from '@/sections/DataTransfer'
import { memo, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { useLibrary } from '@/store/library'
import { clusterWords } from '@/lib/similarity'
import type { DictProviderConfig } from '@/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Slider } from '@/components/ui/slider'
import { Switch } from '@/components/ui/switch'
import { Separator } from '@/components/ui/separator'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'

/* ---------------- threshold learning ---------------- */

function fmtTraceTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

const LearningCard = memo(function LearningCard() {
  const {
    state,
    setLearningEnabled,
    applyTrace,
    removeTrace,
    clearTraces,
  } = useLibrary()
  const { enabled, addCount, traces } = state.learning
  const untilNext = 50 - (addCount % 50)

  return (
    <div
      className="stagger-in rounded-xl border bg-card p-6 shadow-sm"
      style={{ transitionDelay: '60ms' }}
    >
      <div className="flex items-center justify-between gap-3">
        <h2 className="font-word text-xl tracking-tight">模糊度智能学习</h2>
        <Switch
          checked={enabled}
          onCheckedChange={(on) => {
            setLearningEnabled(on)
            toast.info(on ? '模糊度学习已开启' : '模糊度学习已关闭')
          }}
          aria-label="模糊度智能学习开关"
        />
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        每积累 50 次形近词录入，在后台采样最近最多 300 个形近词，参考你的手动分组给出阈值建议。普通单词与近义关系不参与计算。
      </p>
      {enabled && (
        <p className="mt-2 text-xs text-muted-foreground">
          已观察 {addCount} 次录入 · 距离下次学习还有 {untilNext} 次
        </p>
      )}

      {traces.length > 0 && (
        <>
          <Separator className="my-4" />
          <div className="mb-2 flex items-center justify-between">
            <Label>学习痕迹（{traces.length}）</Label>
            <button
              className="text-xs text-muted-foreground underline-offset-2 transition-colors duration-150 hover:text-destructive hover:underline"
              onClick={() => {
                clearTraces()
                toast.info('学习痕迹已清空')
              }}
            >
              清空
            </button>
          </div>
          <ul className="space-y-2">
            {traces.map((tr) => {
              const delta = tr.suggested - tr.previous
              return (
                <li
                  key={tr.id}
                  className="flex items-center gap-3 rounded-lg border px-3 py-2.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-sm">
                      建议{' '}
                      <span className="font-word font-medium tabular-nums">
                        {tr.suggested.toFixed(2)}
                      </span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        当时 {tr.previous.toFixed(2)}（
                        {delta > 0 ? '+' : ''}
                        {delta.toFixed(2)}）
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {fmtTraceTime(tr.at)} · {tr.wordCount} 词 / {tr.groupCount}{' '}
                      组 · 拟合度 {(tr.f1 * 100).toFixed(0)}%
                    </div>
                  </div>
                  {tr.applied ? (
                    <span className="shrink-0 text-xs text-primary">已采用</span>
                  ) : (
                    <button
                      className="shrink-0 text-xs text-primary underline-offset-2 hover:underline"
                      onClick={() => applyTrace(tr.id)}
                    >
                      采用
                    </button>
                  )}
                  <button
                    className="shrink-0 text-xs text-muted-foreground underline-offset-2 transition-colors duration-150 hover:text-destructive hover:underline"
                    onClick={() => removeTrace(tr.id)}
                    aria-label="删除此痕迹"
                  >
                    删除
                  </button>
                </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
})

/* ---------------- dict provider settings ---------------- */

/** key-requiring presets the user can opt into */
const OPTIONAL_PRESETS: Array<{
  id: string
  label: string
  hint: string
  appIdLabel: string
  apiKeyLabel: string
}> = [
  {
    id: 'baidu',
    label: '百度翻译',
    hint: 'fanyi-api.baidu.com · 免费额度 · 需注册开放平台',
    appIdLabel: 'APP ID',
    apiKeyLabel: '密钥',
  },
  {
    id: 'youdao-cloud',
    label: '有道智云',
    hint: 'openapi.youdao.com · 免费额度 · 需注册智云账号',
    appIdLabel: '应用 ID（appKey）',
    apiKeyLabel: '应用密钥',
  },
]

function providerHint(p: DictProviderConfig): string {
  switch (p.id) {
    case 'youdao-web':
      return '免费 · 快速 · 无需注册'
    case 'wiktionary':
      return '免费 · 较慢 · 无需注册'
    case 'baidu':
      return p.appId ? '已配置密钥' : OPTIONAL_PRESETS[0].hint
    case 'youdao-cloud':
      return p.appId ? '已配置密钥' : OPTIONAL_PRESETS[1].hint
    default:
      return p.endpoint ?? '自定义接口'
  }
}

const DictProviderCard = memo(function DictProviderCard() {
  const {
    state,
    updateDictProvider,
    addDictProvider,
    removeDictProvider,
    setPrimaryProvider,
  } = useLibrary()
  const providers = state.settings.dictProviders

  const [keyTarget, setKeyTarget] = useState<{
    id: string
    label: string
    appIdLabel: string
    apiKeyLabel: string
  } | null>(null)
  const [appId, setAppId] = useState('')
  const [apiKey, setApiKey] = useState('')

  const [customOpen, setCustomOpen] = useState(false)
  const [cLabel, setCLabel] = useState('')
  const [cEndpoint, setCEndpoint] = useState('')
  const [cAppId, setCAppId] = useState('')
  const [cKey, setCKey] = useState('')
  const [cGlossPath, setCGlossPath] = useState('')

  const missingPresets = OPTIONAL_PRESETS.filter(
    (preset) => !providers.some((p) => p.id === preset.id),
  )

  function openKeyDialog(presetId: string) {
    const preset = OPTIONAL_PRESETS.find((x) => x.id === presetId)
    const existing = providers.find((p) => p.id === presetId)
    if (!preset) return
    setKeyTarget({ ...preset })
    setAppId(existing?.appId ?? '')
    setApiKey(existing?.apiKey ?? '')
  }

  function saveKeys() {
    if (!keyTarget) return
    if (!appId.trim() || !apiKey.trim()) {
      toast.error('请填写完整的 ID 与密钥')
      return
    }
    const existing = providers.some((p) => p.id === keyTarget.id)
    if (existing) {
      updateDictProvider(keyTarget.id, {
        appId: appId.trim(),
        apiKey: apiKey.trim(),
        enabled: true,
      })
    } else {
      addDictProvider({
        id: keyTarget.id,
        label: keyTargetLabel(keyTarget.id),
        enabled: true,
        appId: appId.trim(),
        apiKey: apiKey.trim(),
      })
    }
    toast.success(`「${keyTarget.label}」已启用`)
    setKeyTarget(null)
  }

  function keyTargetLabel(id: string): string {
    return OPTIONAL_PRESETS.find((x) => x.id === id)?.label ?? id
  }

  function toggleProvider(p: DictProviderConfig, on: boolean) {
    // enabling a key-based provider without keys → ask for them first
    const needsKeys = OPTIONAL_PRESETS.some((x) => x.id === p.id)
    if (on && needsKeys && (!p.appId || !p.apiKey)) {
      openKeyDialog(p.id)
      return
    }
    updateDictProvider(p.id, { enabled: on })
  }

  function saveCustom() {
    if (!cEndpoint.trim() || !cEndpoint.includes('{word}')) {
      toast.error('接口地址必须包含 {word} 占位符')
      return
    }
    addDictProvider({
      id: 'custom-' + Date.now().toString(36),
      label: cLabel.trim() || '自定义 API',
      enabled: true,
      endpoint: cEndpoint.trim(),
      appId: cAppId.trim() || undefined,
      apiKey: cKey.trim() || undefined,
      glossPath: cGlossPath.trim() || undefined,
    })
    toast.success('自定义 API 已添加')
    setCustomOpen(false)
    setCLabel('')
    setCEndpoint('')
    setCAppId('')
    setCKey('')
    setCGlossPath('')
  }

  return (
    <div
      className="stagger-in rounded-xl border bg-card p-6 shadow-sm"
      style={{ transitionDelay: '120ms' }}
    >
      <h2 className="font-word text-xl tracking-tight">查词 API</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        排在第一位的是首选（默认通道），其余按顺序作为备选。点左侧圆点可把任意已启用的通道设为首选；拨动开关即可启用或停用，不影响优先级顺序。
      </p>

      <ul className="mt-4 space-y-2">
        {providers.map((p, i) => {
          const keyBased = OPTIONAL_PRESETS.some((x) => x.id === p.id)
          const isCustom = p.id.startsWith('custom-')
          const isPrimary = i === 0
          return (
            <li
              key={p.id}
              className={`flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors duration-200 ${
                isPrimary ? 'border-primary/35 bg-primary/[0.03]' : ''
              }`}
            >
              <button
                type="button"
                title={
                  isPrimary
                    ? '当前首选（默认通道）'
                    : p.enabled
                      ? '设为首选'
                      : '启用后才能设为首选'
                }
                aria-label={`将 ${p.label} 设为首选`}
                disabled={isPrimary || !p.enabled}
                onClick={() => {
                  setPrimaryProvider(p.id)
                  toast.success(`「${p.label}」已设为首选`, {
                    description: '其余已启用的通道按顺序作为备选',
                  })
                }}
                className={`flex size-4 shrink-0 items-center justify-center rounded-full border transition-all duration-150 ${
                  isPrimary
                    ? 'border-primary'
                    : p.enabled
                      ? 'pressable border-muted-foreground/40 hover:border-primary/70'
                      : 'cursor-not-allowed border-muted-foreground/25 opacity-50'
                }`}
              >
                {isPrimary && (
                  <span className="size-2 rounded-full bg-primary" />
                )}
              </button>
              <span className="w-5 shrink-0 text-center font-word text-sm text-muted-foreground tabular-nums">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-sm font-medium">
                  {p.label}
                  {isPrimary && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-normal text-primary">
                      首选
                    </span>
                  )}
                  {!p.enabled && (
                    <span className="rounded bg-secondary px-1.5 py-0.5 text-[10px] font-normal text-muted-foreground">
                      已停用
                    </span>
                  )}
                </div>
                <div className="truncate text-xs text-muted-foreground">
                  {providerHint(p)}
                </div>
              </div>
              {keyBased && (
                <button
                  className="shrink-0 text-xs text-primary underline-offset-2 hover:underline"
                  onClick={() => openKeyDialog(p.id)}
                >
                  {p.appId ? '修改密钥' : '配置密钥'}
                </button>
              )}
              {isCustom && (
                <button
                  className="shrink-0 text-xs text-destructive underline-offset-2 hover:underline"
                  onClick={() => {
                    removeDictProvider(p.id)
                    toast.info(`已移除「${p.label}」`)
                  }}
                >
                  移除
                </button>
              )}
              <Switch
                checked={p.enabled}
                onCheckedChange={(on) => toggleProvider(p, on)}
                aria-label={`启用 ${p.label}`}
              />
            </li>
          )
        })}
      </ul>

      <div className="mt-3 flex flex-wrap gap-2">
        {missingPresets.map((preset) => (
          <Button
            key={preset.id}
            variant="outline"
            size="sm"
            className="pressable"
            onClick={() => openKeyDialog(preset.id)}
          >
            + {preset.label}
          </Button>
        ))}
        <Button
          variant="outline"
          size="sm"
          className="pressable"
          onClick={() => setCustomOpen(true)}
        >
          + 自定义 API
        </Button>
      </div>

      {/* key dialog for registered providers */}
      <Dialog
        open={keyTarget !== null}
        onOpenChange={(o) => !o && setKeyTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>配置「{keyTarget?.label}」</DialogTitle>
            <DialogDescription>
              填入开放平台分配的凭证，保存后自动启用并插入到备选链中。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>{keyTarget?.appIdLabel}</Label>
              <Input
                value={appId}
                onChange={(e) => setAppId(e.target.value)}
                placeholder="例如 20240101000xxxxxx"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{keyTarget?.apiKeyLabel}</Label>
              <Input
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="应用密钥"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="pressable"
              onClick={() => setKeyTarget(null)}
            >
              取消
            </Button>
            <Button className="pressable" onClick={saveKeys}>
              保存并启用
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* custom provider dialog */}
      <Dialog open={customOpen} onOpenChange={setCustomOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>添加自定义查词 API</DialogTitle>
            <DialogDescription>
              接口地址中用 {'{word}'} 表示单词，{'{appid}'} 与 {'{key}'}{' '}
              表示凭证（可选）。请求经本地服务器中转，不受跨域限制。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>名称</Label>
              <Input
                value={cLabel}
                onChange={(e) => setCLabel(e.target.value)}
                placeholder="例如 我的词典 API"
              />
            </div>
            <div className="space-y-1.5">
              <Label>接口地址模板</Label>
              <Input
                value={cEndpoint}
                onChange={(e) => setCEndpoint(e.target.value)}
                placeholder="https://api.example.com/dict?w={word}&appid={appid}&key={key}"
                className="font-mono text-xs"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>App ID（可选）</Label>
                <Input value={cAppId} onChange={(e) => setCAppId(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>密钥（可选）</Label>
                <Input value={cKey} onChange={(e) => setCKey(e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>释义字段路径（可选）</Label>
              <Input
                value={cGlossPath}
                onChange={(e) => setCGlossPath(e.target.value)}
                placeholder="例如 data.translation，留空则自动尝试常见字段"
                className="font-mono text-xs"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="pressable"
              onClick={() => setCustomOpen(false)}
            >
              取消
            </Button>
            <Button className="pressable" onClick={saveCustom}>
              添加
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
})

export default function Settings({
  onReplayTour,
}: {
  onReplayTour?: () => void
}) {
  const { state, setThreshold, recluster, importState, clearAll } = useLibrary()
  const t = state.settings.threshold
  const fileRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState<number | null>(null)
  const shown = draft ?? t

  const wordList = useMemo(() => Object.values(state.words).filter(w => state.groups[w.groupId]?.kind !== 'single'), [state.words, state.groups])

  /** live preview of what the *draft* threshold would produce */
  const preview = useMemo(() => {
    if (wordList.length === 0) return null
    const locked = Object.values(state.groups)
      .filter((g) => g.manual && g.wordIds.length > 1)
      .map((g) => g.wordIds)
    const clusters = clusterWords(
      wordList.map((w) => ({ id: w.id, text: w.text, phonetic: w.phonetic })),
      shown,
      locked,
    )
    return {
      total: clusters.length,
      multi: clusters.filter((c) => c.length > 1).length,
      grouped: clusters.filter((c) => c.length > 1).flat().length,
    }
  }, [wordList, state.groups, shown])

  function fuzzyLabel(v: number): string {
    if (v <= 0.58) return '非常宽松 — 稍像就归组'
    if (v <= 0.68) return '宽松 — 差一两个字母即归组'
    if (v <= 0.78) return '适中 — 推荐的平衡区间'
    if (v <= 0.88) return '严格 — 只归非常相似的词'
    return '非常严格 — 几乎只差一个字母'
  }

  function exportJson() {
    const blob = new Blob([JSON.stringify(state, null, 2)], {
      type: 'application/json',
    })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `lexicon-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="mx-auto max-w-lg space-y-5">
      {/* threshold */}
      <div className="stagger-in rounded-xl border bg-card p-6 shadow-sm">
        <h2 className="font-word text-xl tracking-tight">形近词归类模糊度</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          控制录入新词时自动归组的宽松程度。同音词（音标相同）不受阈值影响，始终归为一组。
        </p>

        <div className="mt-6 space-y-3">
          <div className="flex items-baseline justify-between">
            <Label>相似度阈值</Label>
            <span className="font-word text-2xl tabular-nums">
              {shown.toFixed(2)}
            </span>
          </div>
          <Slider
            value={[shown]}
            min={0.5}
            max={0.95}
            step={0.01}
            onValueChange={([v]) => setDraft(v)}
            onValueCommit={([v]) => {
              setThreshold(v)
              setDraft(null)
              toast.info(`阈值已调整为 ${v.toFixed(2)}`, {
                description: '新录入的词将按新阈值归组',
              })
            }}
          />
          <p className="text-xs text-muted-foreground">{fuzzyLabel(shown)}</p>

          {preview && (
            <div className="rounded-lg bg-muted px-4 py-3 text-sm text-muted-foreground">
              按当前阈值重新聚类：共 {preview.total} 组，其中{' '}
              {preview.multi} 个形近组（覆盖 {preview.grouped} 个词）。
            </div>
          )}

          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                className="pressable w-full"
                disabled={wordList.length === 0}
              >
                按当前阈值重新分组全部单词
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>重新分组？</AlertDialogTitle>
                <AlertDialogDescription>
                  将以阈值 {shown.toFixed(2)}{' '}
                  对词库中所有单词重新计算形近词分组。手动归组的关系会被保留，其余自动分组将被重算。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel className="pressable">
                  取消
                </AlertDialogCancel>
                <AlertDialogAction
                  className="pressable"
                  onClick={() => {
                    recluster()
                    toast.success('已按当前阈值重新分组')
                  }}
                >
                  重新分组
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {/* threshold learning */}
      <LearningCard />

      {/* dict providers */}
      <DictProviderCard />

      <DataTransfer />
      {/* data */}
      <div
        className="stagger-in rounded-xl border bg-card p-6 shadow-sm"
        style={{ transitionDelay: '180ms' }}
      >
        <h2 className="font-word text-xl tracking-tight">数据</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          词库保存在当前设备。桌面版额外保留每日自动备份，也可随时导出 JSON。
        </p>
        <div className="mt-4 flex gap-2">
          <Button variant="outline" className="pressable flex-1" onClick={exportJson}>
            导出备份
          </Button>
          <Button
            variant="outline"
            className="pressable flex-1"
            onClick={() => fileRef.current?.click()}
          >
            导入备份
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              if (!file) return
              const text = await file.text()
              if (Object.keys(state.words).length && !window.confirm('导入会替换当前词库与学习记录。当前数据会保留恢复副本，是否继续？')) { e.target.value = ''; return }
              if (importState(text)) toast.success('备份已导入')
              else toast.error('导入失败：文件格式不正确')
              e.target.value = ''
            }}
          />
        </div>

        <Separator className="my-5" />

        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              className="pressable w-full text-destructive hover:text-destructive"
            >
              清空全部数据
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>清空词库？</AlertDialogTitle>
              <AlertDialogDescription>
                将删除全部 {Object.keys(state.words).length} 个单词、分组与练习记录，且无法恢复。建议先导出备份。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel className="pressable">取消</AlertDialogCancel>
              <AlertDialogAction
                className="pressable bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  clearAll()
                  toast.info('词库已清空')
                }}
              >
                全部清空
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      {/* onboarding tour replay */}
      <div
        className="stagger-in flex items-center justify-between rounded-xl border bg-card p-6 shadow-sm"
        style={{ transitionDelay: '220ms' }}
      >
        <div>
          <h2 className="font-word text-xl tracking-tight">新手导览</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            四个页面的功能速览，随时可以再看一遍。
          </p>
        </div>
        <Button variant="outline" className="pressable" onClick={onReplayTour}>
          重看导览
        </Button>
      </div>

      {/* about */}
      <div
        className="stagger-in rounded-xl border bg-card p-6 shadow-sm"
        style={{ transitionDelay: '240ms' }}
      >
        <h2 className="font-word text-xl tracking-tight">关于查词</h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          默认首选网易有道网页词典（经本地服务器中转，亚秒级返回音标与中文释义）；英文维基词典
          + MyMemory 翻译的免费兜底链路在部分网络下不可达，因此默认关闭，需要时可在上方「查词
          API」中手动开启，或启用百度翻译 / 有道智云（需自行注册开放平台获取免费额度）、接入任意自定义接口。网络不可用或查不到时，可手动填写释义加入；离线状态下已保存的词库与测验功能完全可用。
        </p>
      </div>
    </div>
  )
}
