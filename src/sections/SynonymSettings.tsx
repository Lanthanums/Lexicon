import { useState } from 'react'
import { Layers3 } from 'lucide-react'
import { toast } from 'sonner'
import { useLibrary } from '@/store/library'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

export default function SynonymSettings() {
  const { state, updateSynonymSettings } = useLibrary()
  const mode = state.settings.synonymMode ?? 'offline'
  const [key, setKey] = useState(state.settings.synonymApiKey ?? '')
  return <section className="settings-card" aria-labelledby="synonym-settings-title">
    <div className="settings-row">
      <div><h3 id="synonym-settings-title" className="settings-title"><Layers3 size={18} />近义词候选</h3><p className="settings-description">录入时按义项匹配近义关系；多个候选分值接近时，再由你选择。</p></div>
      <div className="settings-control settings-control-select"><Label htmlFor="synonym-mode" className="sr-only">近义词模式</Label><select id="synonym-mode" className="settings-select" value={mode} onChange={e => updateSynonymSettings({ synonymMode: e.target.value as 'offline' | 'verified' })}>
        <option value="offline">离线词库 + 用户候选</option><option value="verified">离线词库 + API 联网校验</option>
      </select></div>
    </div>
    <div className="settings-detail">
      <p className="text-sm leading-6 text-muted-foreground">{mode === 'offline' ? '近义关系检索完全离线，不调用联网校验。查义完成后，优先匹配已有词群或尚未归组的词。' : '查找候选时，仅将当前英文词发送至 Datamuse，核对离线候选是否出现在其近义结果中。联网结果不保证当前义项可以互换，候选接近时请你选择；联网校验失败时，可手动确认归组。'}</p>
      {mode === 'verified' && <div className="mt-4">
        <Label htmlFor="synonym-api-key">Datamuse API key（可选）</Label>
        <div className="mt-2 flex flex-wrap gap-2"><Input id="synonym-api-key" type="password" maxLength={256} autoComplete="off" className="min-w-0 flex-1 basis-48" placeholder="服务要求密钥时填写" value={key} onChange={e => setKey(e.target.value)} /><Button variant="outline" onClick={() => { updateSynonymSettings({ synonymApiKey: key.trim() }); toast.success('近义词 API 设置已保存') }}>保存密钥</Button></div>
        <p className="mt-2 text-xs leading-5 text-muted-foreground">密钥保存在本机，导出备份时也会包含。服务额度与密钥要求以 Datamuse 官方说明为准。</p>
      </div>}
      <p className="mt-3 text-xs leading-5 text-muted-foreground">离线数据：Open English WordNet 2025，CC BY 4.0；源自 Princeton WordNet。<a className="ml-1 text-primary underline underline-offset-2" href="/wordnet/LICENSE-OEWN.txt" download="Open-English-WordNet-LICENSE.txt">下载许可文本</a></p>
    </div>
  </section>
}
