import {goalPeriod} from './goal-period.js'

export const jstDayOf=stamp=>{
  if(typeof stamp!=='string'||!stamp)return ''
  const normalized=stamp.includes('T')?stamp:stamp.replace(' ','T')+'Z'
  const t=Date.parse(normalized)
  return Number.isFinite(t)?new Date(t+9*3600000).toISOString().slice(0,10):''
}

// Iterate periods without extra D1 queries. Return at most one unresolved
// recurring period per goal: resolving it reveals the next missing period.
export function earliestUnfinishedGoalPeriod(goal,today,completedKeys=new Set()){
  if(!goal||!['monthly','yearly'].includes(goal.goal_mode)||
     typeof goal.start_on!=='string'||goal.start_on>today)return null
  const mode=goal.goal_mode
  const initial=mode==='monthly'?goal.start_on.slice(0,7):goal.start_on.slice(0,4)
  const final=mode==='monthly'?today.slice(0,7):today.slice(0,4)
  if(!/^\d{4}(-\d{2})?$/.test(initial))return null
  let key=initial
  // 1900–9998 dates are valid, but each request needs only the earliest
  // unresolved period; stop after a bounded number of calendar periods.
  for(let i=0;i<1200&&key<=final;i++){
    const window=goalPeriod(goal,key,today)
    if(window?.periodEnd<=today&&!completedKeys.has(key))
      return {periodKey:key,dueOn:window.periodEnd}
    if(mode==='yearly')key=String(Number(key)+1)
    else {
      const [y,m]=key.split('-').map(Number)
      key=new Date(Date.UTC(y,m,1)).toISOString().slice(0,7)
    }
  }
  return null
}
