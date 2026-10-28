import { useState } from 'react'
import { toast } from 'sonner'
import { FolderOpen, Import } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLibrary } from '@/store/library'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'

export default function DataTransfer() {
  const { importState } = useLibrary()
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<string | null>(null)
  async function migrate() {
    setBusy(true)
    try { setPending(await window.lexicon!.migrateLegacy()) }
    catch (e) { toast.error('旧版迁移未完成', { description: e instanceof Error ? e.message : String(e), duration: 12000 }) }
    finally { setBusy(false) }
  }
  if (!window.lexicon) return null
  return <div className="rounded-xl border bg-card p-6 shadow-sm">
    <h2 className="font-word text-xl">把旧词库带过来</h2>
    <p className="mt-2 text-sm leading-6 text-muted-foreground">先关闭旧版的 Node.js 控制台，再点下方按钮。迁移助手会在浏览器中读取旧词库；如果没有找到，请把打开的网址复制到以前使用 Lexicon 的浏览器。也可以在旧版设置导出备份，然后在这里导入。</p>
    <div className="mt-4 flex flex-wrap gap-2"><Button onClick={migrate} disabled={busy}><Import size={16} />{busy ? '等待浏览器传回词库…' : '从旧版浏览器迁移'}</Button>{busy && <Button variant="outline" onClick={() => window.lexicon!.cancelMigration()}>取消迁移</Button>}<Button variant="outline" onClick={() => window.lexicon!.openDataFolder()}><FolderOpen size={16} />打开数据与自动备份</Button></div>
    {localStorage.getItem('lexicon-before-import') && <Button variant="link" className="mt-2 px-0" onClick={() => setPending(localStorage.getItem('lexicon-before-import'))}>恢复上一次导入前的词库</Button>}
    <p className="mt-3 text-xs text-muted-foreground">旧版数据保留。读取完成后，需要在这里确认替换；当前词库也会保存恢复副本。</p>
    <AlertDialog open={pending !== null} onOpenChange={open => { if (!open) setPending(null) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>导入这份词库？</AlertDialogTitle><AlertDialogDescription>这将替换桌面版当前的单词、分组和学习记录。导入前会保存当前词库的恢复副本，旧浏览器中的数据不会删除。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>暂不导入</AlertDialogCancel><AlertDialogAction onClick={() => { if (pending && importState(pending)) toast.success('旧词库已迁移'); else toast.error('词库校验失败，原数据保留'); setPending(null) }}>确认导入</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>
}
