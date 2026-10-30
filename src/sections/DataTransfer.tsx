import { useState } from 'react'
import { toast } from 'sonner'
import { FolderOpen, RotateCcw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useLibrary } from '@/store/library'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'

export function OpenDataFolder(){return window.lexicon?<Button variant="ghost" size="sm" className="backup-folder" onClick={async()=>{
  try{if(await window.lexicon!.openDataFolder())toast.error('无法打开数据文件夹')}
  catch{toast.error('无法打开数据文件夹')}
}}><FolderOpen/>打开数据文件夹</Button>:null}

export default function DataTransfer() {
  const { importState } = useLibrary()
  const [restoring, setRestoring] = useState(false)
  const previous = localStorage.getItem('lexicon-before-import')
  return <>
    <Button variant="outline" size="sm" disabled={!previous} onClick={() => setRestoring(true)} title={!previous?'导入备份后可恢复导入前的词库':undefined}><RotateCcw/>恢复导入前副本</Button>
    <AlertDialog open={restoring} onOpenChange={setRestoring}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>恢复导入前的词库？</AlertDialogTitle><AlertDialogDescription>将替换当前单词、分组和学习记录。当前词库会保存为新的导入前副本。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction onClick={() => {
        if (previous && importState(previous)) toast.success('词库已恢复')
        else toast.error('副本校验失败，当前词库未更改')
      }}>确认恢复</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </>
}
