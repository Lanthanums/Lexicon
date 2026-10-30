import {useEffect,useMemo,useState} from 'react'
import {Bar,BarChart,CartesianGrid,ResponsiveContainer,Tooltip,XAxis,YAxis} from 'recharts'
import type {LibraryState} from '@/types'
import {dayKey} from '@/store/library'
import {reviewDueAt} from '@/lib/memorySchedule'
import {useReducedMotion} from '@/lib/motion'

export default function ActivityChart({state}:{state:LibraryState}){
  const [range,setRange]=useState(14),reduced=useReducedMotion()
  const [now,setNow]=useState(()=>Date.now())
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),60_000);return()=>clearInterval(timer)},[])
  const today=dayKey(new Date(now))
  const days=useMemo(()=>Array.from({length:range},(_,index)=>{
    const date=new Date(today+'T12:00:00');date.setDate(date.getDate()-(range-1-index))
    const key=dayKey(date)
    return {key,label:`${date.getMonth()+1}/${date.getDate()}`,...(state.activity[key]??{added:0,reviewed:0})}
  }),[range,state.activity,today])
  const totalAdded=days.reduce((sum,d)=>sum+d.added,0), totalReviewed=days.reduce((sum,d)=>sum+d.reviewed,0)
  const activeDays=days.filter(d=>d.added||d.reviewed).length
  const words=Object.values(state.words)
  const due=words.filter(w=>{const at=reviewDueAt(state.stats[w.id]);return at!==undefined&&at<=now}).length
  const unseen=words.filter(w=>!state.stats[w.id]?.lastSeen).length
  return <div className="min-w-0 space-y-5" data-testid="home-activity">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h3 className="text-base font-medium">学习足迹</h3><p className="mt-1 text-xs text-muted-foreground">每一天的录入与复习</p></div><div className="inline-flex rounded-lg border bg-background p-1" role="group" aria-label="统计时间范围">{[14,30].map(n=><button key={n} className={`rounded-md px-3 py-1 text-xs transition-colors ${range===n?'bg-muted text-foreground':'text-muted-foreground hover:text-foreground'}`} aria-pressed={range===n} onClick={()=>setRange(n)}>近 {n} 天</button>)}</div></div>
    <div className="grid grid-cols-3 gap-3">{[{label:'录入单词',value:totalAdded,unit:'词'},{label:'完成复习',value:totalReviewed,unit:'次'},{label:'学习天数',value:activeDays,unit:'天'}].map(item=><div key={item.label} className="min-w-0 rounded-xl bg-background p-3"><p className="text-xs text-muted-foreground">{item.label}</p><p className="mt-2 font-word text-2xl tabular-nums">{item.value}<span className="ml-1 font-sans text-[10px] text-muted-foreground">{item.unit}</span></p></div>)}</div>
    <div className="flex items-center justify-between text-xs text-muted-foreground"><span>次数 / 词数</span><div className="flex gap-4"><span><i className="mr-1.5 inline-block size-2 rounded-sm bg-primary"/>录入</span><span><i className="mr-1.5 inline-block size-2 rounded-sm bg-emerald-600 dark:bg-emerald-400"/>复习</span></div></div>
    <div className="h-56 min-w-0 w-full" role="img" aria-label={`近${range}天录入${totalAdded}词，复习${totalReviewed}次，学习${activeDays}天`}>
      <ResponsiveContainer width="100%" height="100%" debounce={80}><BarChart data={days} margin={{top:8,right:8,left:-12,bottom:8}} barGap={2}>
        <CartesianGrid vertical={false} stroke="hsl(var(--border))" strokeDasharray="3 5"/>
        <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{fontSize:11,fill:'hsl(var(--muted-foreground))'}} minTickGap={28} tickMargin={10}/>
        <YAxis allowDecimals={false} axisLine={false} tickLine={false} width={42} tick={{fontSize:11,fill:'hsl(var(--muted-foreground))'}}/>
        <Tooltip cursor={{fill:'hsl(var(--muted))',opacity:.5}} content={({active,payload,label})=>active&&payload?.length?<div className="rounded-xl border bg-card px-4 py-3 shadow-lg text-xs"><p className="mb-2 font-medium">{label}</p>{payload.map(p=><p key={p.dataKey} className="my-1 flex gap-5"><span style={{color:p.color}}>{p.name}</span><span className="ml-auto tabular-nums">{p.value} {p.dataKey==='added'?'词':'次'}</span></p>)}</div>:null}/>
        <Bar dataKey="added" name="录入" fill="hsl(var(--primary))" radius={[3,3,0,0]} maxBarSize={16} isAnimationActive={!reduced} animationDuration={500}/>
        <Bar dataKey="reviewed" name="复习" fill="hsl(158 42% 47%)" radius={[3,3,0,0]} maxBarSize={16} isAnimationActive={!reduced} animationDuration={500}/>
      </BarChart></ResponsiveContainer>
    </div>
    {!activeDays&&<p className="text-center text-xs text-muted-foreground">录入第一个词，开始留下你的学习足迹。</p>}
    <div className="grid grid-cols-3 gap-3 border-t pt-5">{[{label:'尚未学习',value:unseen},{label:'到期复习',value:due},{label:'今日复习',value:state.activity[today]?.reviewed??0}].map(item=><div key={item.label} className="min-w-0"><p className="font-word text-2xl text-primary tabular-nums">{item.value}</p><p className="mt-1 text-[11px] text-muted-foreground">{item.label}</p></div>)}</div>
  </div>
}
