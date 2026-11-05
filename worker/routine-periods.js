// A routine rule is a template. The dated occurrence is the unit of work.
// No cron materialization: untouched old occurrences are derived on reads.
import {addDays,daysBetween,dueOn,lastScheduledBefore} from './recurrence.js'

export const jstToday=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10)
export const jstDate=(stamp)=>{
  const time=Date.parse(stamp?.includes('T')?stamp:String(stamp||'').replace(' ','T')+'Z')
  return Number.isFinite(time)?new Date(time+9*3600000).toISOString().slice(0,10):''
}
export function routineConfig(rule){
  try{return typeof rule.repeat_config==='string'?JSON.parse(rule.repeat_config):rule.repeat_config||{}}
  catch{return {}}
}
export function routineVersions(rule){
  const c=routineConfig(rule)
  const snapshots=Array.isArray(c._history)?c._history.slice(-40):[]
  const previous=snapshots.filter(x=>x&&typeof x.from==='string'&&typeof x.until==='string')
    .map(x=>({...rule,title:x.title||rule.title,repeat_type:x.repeatType,
      repeat_config:x.repeatConfig,anchor_date:x.anchorDate,
      next_due_on:x.nextDueOn||null,visibility:x.visibility||rule.visibility,
      subject_profile_id:x.subjectProfileId||null,health_record_type:x.healthRecordType||null,
      validFrom:x.from,validUntil:x.until}))
  return [...previous,{...rule,validFrom:c._effectiveFrom||rule.anchor_date,validUntil:null}]
}
export function isCompletionInterval(rule){
  return rule.repeat_type==='interval'&&routineConfig(rule).anchor==='completion'
}
export function nextRoutineDue(rule,date){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{4}-\d{2}-\d{2}$/.test(rule?.anchor_date||''))return null
  const config=routineConfig(rule),anchor=rule.anchor_date
  const effective=config._effectiveFrom||anchor
  if(effective>date)date=effective
  if(rule.repeat_type==='interval'){
    const days=Number(config.days)
    if(!Number.isInteger(days)||days<1||days>3650)return null
    if(config.anchor==='completion')return rule.next_due_on||addDays(anchor,days)
    const distance=daysBetween(anchor,date)
    const cycles=Math.max(1,Math.ceil(distance/days))
    return addDays(anchor,cycles*days)
  }
  const start=date>anchor?date:anchor
  for(let n=0;n<=65;n++){
    const candidate=addDays(start,n)
    if(dueOn(rule,candidate))return candidate
  }
  return null
}
export function previousRoutineDue(rule,before){
  if(!before||before<=rule.anchor_date||isCompletionInterval(rule))return null
  const candidate=lastScheduledBefore(rule,before)
  return candidate&&candidate>=(routineConfig(rule)._effectiveFrom||rule.anchor_date)?candidate:null
}
export function currentRoutinePeriod(rule,date){
  if(date<rule.anchor_date)return null
  if(isCompletionInterval(rule)){
    const due=nextRoutineDue(rule,date)
    return due&&due<=date?due:null
  }
  const candidate=previousRoutineDue(rule,addDays(date,1))
  return candidate&&candidate>=(routineConfig(rule)._effectiveFrom||rule.anchor_date)?candidate:null
}
export function nextEarlyPeriod(rule,date){
  if(!rule||rule.enabled===0||rule.repeat_type==='daily'||date<rule.anchor_date)return null
  const next=nextRoutineDue(rule,date)
  return next&&next>date?next:null
}
export function isClosedRoutinePeriod(rule,periodOn,today){
  if(periodOn>=today)return false
  // Actual-completion intervals have only one unresolved occurrence; prior
  // completions are historical marks, never synthetic missed periods.
  if(isCompletionInterval(rule))return false
  const next=nextRoutineDue(rule,addDays(periodOn,1))
  return !!next&&next<=today
}
export function periodStatus(mark){
  return mark?.completed_at?'completed':mark?.skipped_at?'skipped':'pending'
}
export function historyCandidates(rule,upper,limit){
  if(isCompletionInterval(rule))return []
  const result=[]
  let before=upper
  for(let i=0;i<limit;i++){
    const due=previousRoutineDue(rule,before)
    if(!due||due>=before)break
    result.push(due)
    before=due
  }
  return result
}
