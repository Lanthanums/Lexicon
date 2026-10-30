import {useSyncExternalStore} from 'react'
const query='(prefers-reduced-motion: reduce)'
const snapshot=()=>window.matchMedia(query).matches
const subscribe=(callback:()=>void)=>{const media=window.matchMedia(query);media.addEventListener('change',callback);return()=>media.removeEventListener('change',callback)}
export function useReducedMotion(){return useSyncExternalStore(subscribe,snapshot,()=>true)}
