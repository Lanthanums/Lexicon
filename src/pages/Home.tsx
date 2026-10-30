import { lazy, Suspense, useState } from 'react'
import { BookOpen, CalendarDays, LibraryBig, Settings2, SquareCheckBig } from 'lucide-react'
import { LibraryProvider, useLibrary } from '@/store/library'
import LearningNotice from '@/sections/LearningNotice'
import Tour from '@/sections/Tour'
import {createGuideLibrary,GuidedTourContext,markTourDone,tourDone,type GuideTask} from '@/lib/tutorial'

const Welcome = lazy(() => import('@/sections/Welcome'))
const Management = lazy(() => import('@/sections/Management'))
const Quiz = lazy(() => import('@/sections/Quiz'))
const Settings = lazy(() => import('@/sections/Settings'))
const TABS = [
  { id: 'today', label: '今日学习', icon: CalendarDays, sub: '一点点，积累成更多' },
  { id: 'manage', label: '录入与管理词汇', icon: LibraryBig, sub: '一个词库，管理所有单词与关系' },
  { id: 'quiz', label: '综合抽查', icon: SquareCheckBig, sub: '用一次回忆，检查记忆' },
  { id: 'settings', label: '设置与备份', icon: Settings2, sub: '外观、学习偏好与本地数据' },
] as const
type TabId = (typeof TABS)[number]['id']

export default function Home() {
  const { state } = useLibrary()
  const [tab, setTab] = useState<TabId>('today')
  const [visited, setVisited] = useState<Set<TabId>>(new Set(['today']))
  const [autoStartKey, setAutoStartKey] = useState(0)
  const [tourOpen, setTourOpen] = useState(() => !tourDone())
  const [guideTask, setGuideTask] = useState<GuideTask>('overview')
  const [guideLibrary] = useState(createGuideLibrary)
  const active = TABS.find(t => t.id === tab)!
  function navigate(id: TabId) { setVisited(prev => new Set([...prev, id])); setTab(id); if(id!==tab)window.scrollTo({top:0,behavior:'instant'}) }
  function startQuiz() { setAutoStartKey(Date.now()); navigate('quiz') }
  function locate() { navigate('manage') }
  return (
    <GuidedTourContext.Provider value={tourOpen}><div className="min-h-svh lg:pl-60">
      <aside className="border-b bg-card/80 px-4 py-5 lg:fixed lg:inset-y-0 lg:left-0 lg:z-20 lg:flex lg:w-60 lg:flex-col lg:border-b-0 lg:border-r lg:px-5 lg:py-9">
        <div className="flex items-center gap-3 lg:px-2">
          <div className="grid size-10 place-items-center rounded-xl bg-primary text-primary-foreground"><BookOpen size={22} strokeWidth={1.5} /></div>
          <div><h1 className="font-word text-3xl leading-none tracking-tight">Lexicon</h1><p className="mt-2 text-[11px] tracking-[0.18em] text-muted-foreground">让每一个词，各得其所</p></div>
        </div>
        <p className="mb-3 mt-12 hidden px-3 text-[10px] tracking-[0.2em] text-muted-foreground lg:block">YOUR WORD SPACE</p>
        <nav aria-label="主导航" className="mt-5 flex gap-1 overflow-x-auto lg:mt-0 lg:flex-col">
          {TABS.map(t => <button key={t.id} data-guide={`nav-${t.id}`} onClick={() => navigate(t.id)} aria-current={tab === t.id ? 'page' : undefined}
            className={`flex shrink-0 items-center gap-3 rounded-xl px-3 py-3 text-sm transition-colors ${tab === t.id ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
            <t.icon size={18} strokeWidth={1.6} /><span>{t.label}</span>{tab === t.id && <span className="ml-auto hidden size-1.5 rounded-full bg-primary lg:block" />}
          </button>)}
        </nav>
        <div className="mt-auto hidden px-3 pt-10 lg:block"><div className="h-px bg-border" /><p className="mt-5 font-word text-lg italic text-muted-foreground">A word at a time.</p><p className="mt-2 text-xs leading-6 text-muted-foreground">已收藏 {Object.keys(state.words).length} 个单词<br />v2.0 beta2 · 本地保存</p></div>
      </aside>
      <div className="mx-auto w-full px-5 pb-16 pt-7 sm:px-9 lg:px-12 lg:pt-10">
        <header className="mb-8 flex items-center justify-between gap-3 border-b pb-6"><div><p className="mb-2 text-[10px] tracking-[0.2em] text-primary">LEXICON / {String(TABS.indexOf(active) + 1).padStart(2, '0')}</p><h2 className="text-2xl font-medium tracking-tight">{active.label}</h2><p className="mt-2 text-sm text-muted-foreground">{active.sub}</p></div><span className="hidden items-center gap-2 rounded-full border px-3 py-1.5 text-xs text-muted-foreground sm:flex"><span className="size-1.5 rounded-full bg-emerald-600" />{window.lexicon ? '桌面版' : '本地词库'}</span></header>
        <Suspense fallback={<div role="status" className="rounded-2xl border p-10 text-sm text-muted-foreground">正在打开学习空间…</div>}>
          {visited.has('today') && <section data-page hidden={tab !== 'today'} aria-label="今日学习内容">
            <Welcome onStartQuiz={startQuiz} onLocateGroup={locate} />
          </section>}
          {visited.has('manage') && <section data-page hidden={tab !== 'manage'}>{tourOpen ? <LibraryProvider initialState={guideLibrary} persist={false}><div className="guide-practice"><p className="mb-4 rounded-xl border bg-primary/5 px-4 py-3 text-xs text-primary">教学练习 · 使用临时示例，退出后回到你的词库</p><Management guideTask={guideTask} /></div></LibraryProvider> : <Management />}</section>}
          {visited.has('quiz') && <section data-page hidden={tab !== 'quiz'}><Quiz autoStartKey={autoStartKey} /></section>}
          {tab === 'settings' && <div data-page><Settings onReplayTour={() => { setGuideTask('overview'); setTourOpen(true) }} /></div>}
        </Suspense>
        <footer className="mt-12 text-[11px] text-muted-foreground">区分相似，连接相近，记住每一个。</footer>
      </div>
      <LearningNotice onOpenSettings={() => navigate('settings')} />
      <Tour onStepChange={setGuideTask} navigate={navigate} open={tourOpen} onFinish={(completed) => { markTourDone(completed); setTourOpen(false); navigate('today') }} />
    </div></GuidedTourContext.Provider>
  )
}
