import Appearance from '@/sections/Appearance'
import SynonymSettings from '@/sections/SynonymSettings'
import { Database, LibraryBig, SlidersHorizontal, BookOpen, CircleHelp, Download, Upload } from 'lucide-react'
import DataTransfer, {OpenDataFolder} from '@/sections/DataTransfer'
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
      className="settings-card"
      style={{ transitionDelay: '60ms' }}
    >
      <div className="settings-row">
        <div><h3 className="settings-title"><SlidersHorizontal size={18} />自动分组建议</h3>
          <p className="settings-description">每累计 50 次录入，会根据最近录入的词和你的手动形近分组给出建议；采纳后才会调整匹配阈值。</p>
          {enabled && <p className="mt-2 text-xs text-muted-foreground">已录入 {addCount} 次 · 再录入 {untilNext} 次生成下一条建议</p>}
        </div>
        <Switch checked={enabled} onCheckedChange={on => { setLearningEnabled(on); toast.info(on ? '分组建议已开启' : '分组建议已关闭') }} aria-label="自动分组建议开关" />
      </div>

      {traces.length > 0 && (
        <details className="mt-5 border-t pt-4">
          <summary className="cursor-pointer text-sm font-medium">建议记录（{traces.length}）</summary>
          <Separator className="my-4" />
          <div className="mb-2 flex items-center justify-between">
            <Label>历史建议</Label>
            <button
              className="text-xs text-muted-foreground underline-offset-2 transition-colors duration-150 hover:text-destructive hover:underline"
              onClick={() => {
                clearTraces()
                toast.info('建议记录已清空')
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
        </details>
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
    hint: 'fanyi-api.baidu.com · 需自行申请凭据及确认额度',
    appIdLabel: 'APP ID',
    apiKeyLabel: '密钥',
  },
  {
    id: 'youdao-cloud',
    label: '有道智云',
    hint: 'openapi.youdao.com · 需自行申请凭据及确认额度',
    appIdLabel: '应用 ID（appKey）',
    apiKeyLabel: '应用密钥',
  },
]

function providerHint(p: DictProviderConfig): string {
  switch (p.id) {
    case 'youdao-web':
      return '有道网页词典 · 无需配置密钥'
    case 'wiktionary':
      return '英文释义与翻译 · 无需配置密钥'
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
      data-guide="dictionary" className="settings-card"
      style={{ transitionDelay: '120ms' }}
    >
      <h3 className="settings-title"><BookOpen size={18} />在线词典</h3>
      <p className="mt-1 text-sm text-muted-foreground">
        按列表顺序尝试已启用的词典。点击圆点设为首选，使用开关启用或停用。查询需要联网。
      </p>

      <ul className="mt-4 space-y-2">
        {providers.map((p, i) => {
          const keyBased = OPTIONAL_PRESETS.some((x) => x.id === p.id)
          const isCustom = p.id.startsWith('custom-')
          const isPrimary = p.enabled && providers.find(item => item.enabled)?.id === p.id
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
                aria-label={`将 ${p.id === 'youdao-web' ? '网易有道' : p.id === 'wiktionary' ? '维基词典 + MyMemory' : p.label} 设为首选`}
                disabled={isPrimary || !p.enabled}
                onClick={() => {
                  setPrimaryProvider(p.id)
                  toast.success(`「${p.id === 'youdao-web' ? '网易有道' : p.id === 'wiktionary' ? '维基词典 + MyMemory' : p.label}」已设为首选`, {
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
                  {p.id === 'youdao-web' ? '网易有道' : p.id === 'wiktionary' ? '维基词典 + MyMemory' : p.label}
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
                    toast.info(`已移除「${p.id === 'youdao-web' ? '网易有道' : p.id === 'wiktionary' ? '维基词典 + MyMemory' : p.label}」`)
                  }}
                >
                  移除
                </button>
              )}
              <Switch
                checked={p.enabled}
                onCheckedChange={(on) => toggleProvider(p, on)}
                aria-label={`启用 ${p.id === 'youdao-web' ? '网易有道' : p.id === 'wiktionary' ? '维基词典 + MyMemory' : p.label}`}
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
                type="password"
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
              表示凭证（可选）。自定义接口需使用公共 HTTPS 地址。
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
                <Input type="password" value={cKey} onChange={(e) => setCKey(e.target.value)} />
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
  const [pendingImport, setPendingImport] = useState<{ name: string; text: string } | null>(null)
  const shown = draft ?? t

  const wordList = useMemo(() => Object.values(state.words), [state.words])

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
    if (v <= 0.58) return '非常宽松 · 更容易匹配，建议检查分组结果'
    if (v <= 0.68) return '宽松 · 接受较多字形差异'
    if (v <= 0.78) return '适中 · 兼顾匹配范围与相似程度'
    if (v <= 0.88) return '严格 · 需要较高的字形相似度'
    return '非常严格 · 仅接受高度相似的匹配'
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
    <div className="settings-layout">
      <h3 className="settings-category">外观</h3>
      <Appearance />
      <h3 className="settings-category">形近词</h3>
      <section className="settings-card" aria-labelledby="shape-settings-title">
        <div className="settings-row">
          <div><h3 id="shape-settings-title" className="settings-title"><LibraryBig size={18} />形近词分组</h3>
            <p className="settings-description">阈值越高，自动匹配越严格。音标标准化后相同的词仍会归组。修改后适用于新录入的形近词。</p>
          </div>
          <div className="settings-control space-y-3">
            <div className="flex items-baseline justify-between"><Label id="threshold-label">匹配阈值</Label><span className="font-word text-2xl tabular-nums">{shown.toFixed(2)}</span></div>
            <Slider aria-labelledby="threshold-label" value={[shown]} min={0.5} max={0.95} step={0.01}
              onValueChange={([v]) => setDraft(v)} onValueCommit={([v]) => { setThreshold(v); setDraft(null); toast.info(`阈值已调整为 ${v.toFixed(2)}`, { description: '新录入的词将按新阈值归组' }) }} />
            <p className="text-xs text-muted-foreground">{fuzzyLabel(shown)}</p>
          </div>
        </div>
        <div className="settings-detail flex flex-wrap items-center justify-between gap-4">
          <p className="min-w-0 text-sm text-muted-foreground">{preview ? `分组预览：${preview.multi} 个多词组，包含 ${preview.grouped} 个词；共 ${preview.total} 组。` : '录入形近词后，可预览并调整分组。'}</p>
          <AlertDialog><AlertDialogTrigger asChild><Button variant="outline" disabled={wordList.length === 0}>重新分组形近词</Button></AlertDialogTrigger>
            <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>重新分组？</AlertDialogTitle><AlertDialogDescription>将以阈值 {shown.toFixed(2)} 重新计算所有单词的形近关系，保留手动形近组。近义关系与学习记录保持。</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => { recluster(); toast.success('已按当前阈值重新分组') }}>重新分组</AlertDialogAction></AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </section>

      {/* threshold learning */}
      <LearningCard />
      <h3 className="settings-category">近义词</h3>
      <SynonymSettings />

      {/* dict providers */}
      <h3 className="settings-category">单词释义</h3>
      <DictProviderCard />

      <h3 className="settings-category">数据与备份</h3>
      {/* data */}
      <div
        data-guide="backup" className="settings-card"
        style={{ transitionDelay: '180ms' }}
      >
        <h3 className="settings-title"><Database size={18} />数据与备份</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          词库与学习记录保存在本机。导出 JSON 可用于备份或转移到其他设备；导入将替换当前词库。
        </p>
        <div className="backup-top mt-5"><div className="backup-primary-actions flex flex-wrap gap-2">
          <Button variant="outline" className="pressable" onClick={exportJson}>
            <Download size={16} />导出备份
          </Button>
          <Button
            variant="outline"
            className="pressable"
            onClick={() => fileRef.current?.click()}
          >
            <Upload size={16} />导入备份
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept="application/json"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (!file) return
              try { setPendingImport({ name: file.name, text: await file.text() }) }
              catch { toast.error('无法读取备份文件，请重新选择') }
            }}
          />
        </div><OpenDataFolder/></div>
        <AlertDialog open={pendingImport !== null} onOpenChange={open => { if (!open) setPendingImport(null) }}>
          <AlertDialogContent>
            <AlertDialogHeader><AlertDialogTitle>导入备份？</AlertDialogTitle><AlertDialogDescription className="break-all">将导入「{pendingImport?.name}」，替换当前单词、分组和学习记录。当前词库会保存为导入前副本，供之后恢复。</AlertDialogDescription></AlertDialogHeader>
            <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => {
              if (pendingImport && importState(pendingImport.text)) toast.success('备份已导入')
              else toast.error('导入失败：文件格式不正确')
              setPendingImport(null)
            }}>确认导入</AlertDialogAction></AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {!!state.relationArchive?.length && <div className="mt-4 rounded-lg border p-4 text-sm"><p>旧版多重近义关系已整理为每词一个近义组。完整原关系与笔记保存在归档中（{state.relationArchive.length} 项），可随备份保留。</p><Button variant="outline" size="sm" className="mt-2" onClick={() => { const url=URL.createObjectURL(new Blob([JSON.stringify(state.relationArchive,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='lexicon-relation-archive.json';a.click();URL.revokeObjectURL(url) }}>导出旧关系归档</Button></div>}
        <p className="mt-3 text-xs leading-5 text-muted-foreground">桌面版另存每日快照。建议定期导出至其他位置；备份文件可能包含你配置的词典凭据。</p>
        <div className="backup-maintenance mt-6 border-t pt-5"><DataTransfer/><div className="backup-delete">
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              className="pressable text-destructive hover:text-destructive"
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
        </AlertDialog></div></div>
      </div>

      <h3 className="settings-category">关于</h3>
      <section className="settings-card settings-help" aria-labelledby="help-title">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div><h3 id="help-title" className="settings-title"><CircleHelp size={18} />帮助与关于</h3><p className="settings-description">Lexicon v2.0 beta2</p></div>
          <Button variant="outline" onClick={onReplayTour}>互动使用教学</Button>
        </div>
        <p className="mt-4 text-sm leading-6 text-muted-foreground">查词依赖所选服务的网络与可用性。无法查询时，可手动填写释义；已保存的词库和抽查可离线使用。录入时统一检查形近与近义关系；候选接近时由你确认。</p>
      </section>
    </div>
  )
}
