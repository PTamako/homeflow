// Display-only period labels. Keep this independent from the current
// ledger query window (which ends today for an ongoing period).
const iso=(date)=>new Date(date).toISOString().slice(0,10)
export function savingsPeriodDisplay(goal,key,today){
  const mode=goal?.goal_mode
  if(!['monthly','yearly'].includes(mode)||typeof today!=='string'||
     !/^\d{4}-\d{2}-\d{2}$/.test(today))return null
  let first,last
  if(mode==='monthly'){
    if(typeof key!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(key))return null
    const y=Number(key.slice(0,4)),m=Number(key.slice(5,7))
    if(y<1900||y>9998)return null
    first=key+'-01'
    last=iso(Date.UTC(y,m,0))
  }else{
    if(typeof key!=='string'||!/^\d{4}$/.test(key))return null
    const y=Number(key)
    if(y<1900||y>9998)return null
    first=key+'-01-01'
    last=key+'-12-31'
  }
  const start=goal.start_on&&goal.start_on>first?goal.start_on:first
  const end=goal.target_on&&goal.target_on<last?goal.target_on:last
  if(start>end)return null
  const next=iso(Date.parse(end+'T00:00:00Z')+86400000)
  return {
    start,end,
    status:today<start?'未开始':
      today<=end?'进行中 · '+next+' 起可结算':'已截止 · 可核验',
    finished:end<today
  }
}
