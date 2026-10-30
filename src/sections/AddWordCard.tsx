import UnifiedEntry from '@/sections/UnifiedEntry'
import { useLibrary } from '@/store/library'

export function AddWordCard({ onLocateGroup }: { onLocateGroup: (groupId: string) => void }) {
  const { state } = useLibrary()
  return <UnifiedEntry compact onLocateWord={id => onLocateGroup(state.words[id]?.groupId ?? id)} />
}
