import { Routes, Route } from 'react-router'
import { LibraryProvider } from '@/store/library'
import { Toaster } from '@/components/ui/sonner'
import Home from './pages/Home'

export default function App() {
  return (
    <LibraryProvider>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
      <Toaster position="bottom-center" toastOptions={{ duration: 2600 }} />
    </LibraryProvider>
  )
}
