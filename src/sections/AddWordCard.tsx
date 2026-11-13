import UnifiedEntry from '@/sections/UnifiedEntry'

export function AddWordCard({ onLocateGroup, active }: { onLocateGroup: (wordId: string) => void; active?: boolean }) {
  return <UnifiedEntry compact visible={active} onLocateWord={onLocateGroup} />
}
