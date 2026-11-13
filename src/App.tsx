import { Routes, Route } from 'react-router'
import { LibraryProvider } from '@/store/library'
import { Toaster } from '@/components/ui/sonner'
import Home from './pages/Home'
import type { LibraryState } from '@/types'

export default function App({ initialState, snapshotAt, preserveUnreadable }: { initialState?: LibraryState; snapshotAt?: number; preserveUnreadable?: boolean }) {
  return (
    <LibraryProvider initialState={initialState} snapshotAt={snapshotAt} preserveUnreadable={preserveUnreadable}>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
      <Toaster position="bottom-center" toastOptions={{ duration: 2600 }} />
    </LibraryProvider>
  )
}
