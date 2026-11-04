// Calendar-based goal targets. Keep date math in one place so neither
// the UI nor a malicious request can choose overlapping monthly/yearly ranges.
const jstToday=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10)
const validKey=(mode,key)=>mode==='monthly'
  ?typeof key==='string'&&/^\d{4}-(0[1-9]|1[0-2])$/.test(key)
  :mode==='yearly'&&typeof key==='string'&&/^\d{4}$/.test(key)
export function goalPeriod(goal,key,asOf=jstToday()){
  const mode=goal?.goal_mode||'once'
  if(mode==='once'||!validKey(mode,key))return null
  let first,last
  if(mode==='monthly'){
    const year=Number(key.slice(0,4)),month=Number(key.slice(5,7))
    if(year<1900||year>9998)return null
    first=key+'-01'
    last=new Date(Date.UTC(year,month,0)).toISOString().slice(0,10)
  }else{
    const year=Number(key)
    if(year<1900||year>9998)return null
    first=key+'-01-01';last=key+'-12-31'
  }
  const start=goal.start_on&&goal.start_on>first?goal.start_on:first
  const final=goal.target_on&&goal.target_on<last?goal.target_on:last
  if(start>final)return null
  const activeEnd=asOf<final?asOf:final
  return {periodKey:key,start,end:activeEnd,periodEnd:final,
    notStarted:start>activeEnd}
}
