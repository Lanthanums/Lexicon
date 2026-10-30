import { Monitor, Moon, Sun } from 'lucide-react'
import { toast } from 'sonner'
import { setAppearance, useAppearance } from '@/lib/appearance'

const choices = [
  { value: 'system', preview: 'preview-system', label: '跟随系统', description: '随设备自动切换', icon: Monitor },
  { value: 'light', preview: 'preview-light', label: '浅色', description: '温暖纸色，清晰阅读', icon: Sun },
  { value: 'dark', preview: 'preview-dark', label: '深色', description: '柔和暗色，专注学习', icon: Moon },
] as const

export default function Appearance() {
  const { appearance, resolved } = useAppearance()
  return <section className="settings-card settings-appearance" aria-labelledby="appearance-title">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div><h3 id="appearance-title" className="settings-title"><Sun size={18} />外观</h3><p className="settings-description">选择适合你的阅读环境。默认跟随系统，切换后立即生效。</p></div>
      <span className="rounded-full bg-muted px-3 py-1 text-xs text-muted-foreground">当前为{resolved === 'dark' ? '深色' : '浅色'}</span>
    </div>
    <div role="group" aria-label="主题模式" className="mt-5 grid gap-3 sm:grid-cols-3">
      {choices.map(({ value, preview, label, description, icon: Icon }) => <button key={value} type="button" aria-pressed={appearance === value}
        onClick={() => { if (!setAppearance(value)) toast.error('外观设置未保存，请检查设备存储') }}
        className={`appearance-choice ${appearance === value ? 'is-selected' : ''}`}>
        <span aria-hidden="true" className={`appearance-preview ${preview}`}><span className="preview-sidebar" /><span className="preview-content"><i /><i /><i /></span></span>
        <span className="mt-3 flex items-center gap-2 text-sm font-medium"><Icon size={16} />{label}<span className="selection-dot ml-auto" /></span>
        <span className="mt-1 block text-xs text-muted-foreground">{description}</span>
      </button>)}
    </div>
  </section>
}
