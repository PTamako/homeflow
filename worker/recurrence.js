export function addDays(date,days){
  const time=Date.parse(date+'T00:00:00Z')
  return Number.isFinite(time)&&Number.isInteger(days)?new Date(time+days*86400000).toISOString().slice(0,10):''
}

export function canCompleteEarly(rule,date){
  if(!rule?.enabled||rule.repeat_type!=='interval'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||date<rule.anchor_date)return false
  let c={}
  try{c=typeof rule.repeat_config==='string'?JSON.parse(rule.repeat_config):rule.repeat_config||{}}catch{return false}
  return c.anchor==='completion'&&Number.isInteger(c.days)&&c.days>=1&&c.days<=3650
    &&date<(rule.next_due_on||rule.anchor_date)
}

import {isJapaneseWorkday} from './jp-holidays.js'
export function daysBetween(a,b){
  const [y1,m1,d1]=a.split('-').map(Number)
  const [y2,m2,d2]=b.split('-').map(Number)
  return Math.round((Date.UTC(y2,m2-1,d2)-Date.UTC(y1,m1-1,d1))/86400000)
}
export function dueOn(rule,date) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{4}-\d{2}-\d{2}$/.test(rule.anchor_date))return false
  const age=daysBetween(rule.anchor_date,date)
  if(age<0)return false
  const c=typeof rule.repeat_config==='string'?JSON.parse(rule.repeat_config):rule.repeat_config||{}
  switch(rule.repeat_type){
    case 'daily': return true
    case 'workday': return isJapaneseWorkday(date)
    case 'weekly': {
      const wd=new Date(date+'T00:00:00Z').getUTCDay()
      return Array.isArray(c.weekdays)&&c.weekdays.includes(wd) && (!c.excludeJapaneseHolidays||isJapaneseWorkday(date))
    }
    case 'monthly': {
      const [year,month,day]=date.split('-').map(Number)
      if(c.mode==='weekday'){
        // Calendar-week occurrences: 1st Tue is days 1-7, 2nd Tue 8-14, etc.
        // Never invent a 5th occurrence in months that have only four.
        const weekday=new Date(date+'T00:00:00Z').getUTCDay()
        return weekday===c.weekday&&Array.isArray(c.weekNumbers)&&
          c.weekNumbers.includes(Math.floor((day-1)/7)+1)
      }
      const last=new Date(Date.UTC(year,month,0)).getUTCDate()
      // Multiple configured dates may collapse onto the same final calendar day.
      // Emit that date as one occurrence, not duplicate periods.
      const selected=Array.isArray(c.days)?c.days:[c.day]
      return selected.some(chosen=>day===Math.min(chosen,last))
    }
    case 'interval': {
      if(!Number.isInteger(c.days)||c.days<1||c.days>3650)return false
      // The chosen start date is the first scheduled occurrence.
      // Completion-anchored intervals continue from the last resolved date.
      if(c.anchor==='completion')return date>=(rule.next_due_on||rule.anchor_date)
      return age%c.days===0
    }
    default: return false
  }
}
export function validateRule(r){
  if(!r||!['daily','weekly','monthly','interval','workday'].includes(r.repeatType))return false
  const c=r.repeatConfig||{}
  if(r.repeatType==='workday')return true
  if(r.repeatType==='weekly')return Array.isArray(c.weekdays)&&c.weekdays.length>0&&c.weekdays.length<=7&&
    c.weekdays.every(x=>Number.isInteger(x)&&x>=0&&x<=6)&&new Set(c.weekdays).size===c.weekdays.length
  if(r.repeatType==='monthly'){
    if(c.mode==='weekday')
      return Number.isInteger(c.weekday)&&c.weekday>=0&&c.weekday<=6&&
        Array.isArray(c.weekNumbers)&&c.weekNumbers.length>=1&&c.weekNumbers.length<=5&&
        c.weekNumbers.every(n=>Number.isInteger(n)&&n>=1&&n<=5)&&
        new Set(c.weekNumbers).size===c.weekNumbers.length
    if(c.mode!==undefined&&c.mode!=='day')return false
    if(Object.hasOwn(c,'days'))return Array.isArray(c.days)&&c.days.length>=1&&c.days.length<=31&&
      c.days.every(d=>Number.isInteger(d)&&d>=1&&d<=31)&&new Set(c.days).size===c.days.length
    return Number.isInteger(c.day)&&c.day>=1&&c.day<=31
  }
  if(r.repeatType==='interval')return Number.isInteger(c.days)&&c.days>=1&&c.days<=3650
  return true
}
export function nextAnniversary(date,repeatMode,asOf){
  if(repeatMode==='once')return date>=asOf?date:null
  const [y,m,d]=date.split('-').map(Number)
  const [currentYear,currentMonth]=asOf.split('-').map(Number)
  if(repeatMode==='yearly'){
    for(let yy=currentYear;yy<=currentYear+1;yy++){
      const last=new Date(Date.UTC(yy,m,0)).getUTCDate()
      const day=Math.min(d,last)
      const x=yy+'-'+String(m).padStart(2,'0')+'-'+String(day).padStart(2,'0')
      if(x>=asOf)return x
    }
  }
  if(repeatMode==='monthly'){
    for(let i=0;i<14;i++){
      const x=new Date(Date.UTC(currentYear,currentMonth-1+i,1))
      const yy=x.getUTCFullYear(),mm=x.getUTCMonth()+1
      const last=new Date(Date.UTC(yy,mm,0)).getUTCDate()
      const result=yy+'-'+String(mm).padStart(2,'0')+'-'+String(Math.min(d,last)).padStart(2,'0')
      if(result>=asOf)return result
    }
  }
  return null
}

/** Last scheduled occurrence strictly before the viewed date.
 * Computed without D1 reads, and bounded for Workers Free CPU.
 */
export function lastScheduledBefore(rule,date){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^\d{4}-\d{2}-\d{2}$/.test(rule?.anchor_date||'')||
     date<=rule.anchor_date)return null
  const age=daysBetween(rule.anchor_date,date)
  if(rule.repeat_type==='interval'){
    let config={}
    try{config=typeof rule.repeat_config==='string'?JSON.parse(rule.repeat_config):rule.repeat_config||{}}catch{return null}
    if(config.anchor==='completion')return null // next_due_on already carries over.
    const days=Number(config.days)
    if(!Number.isInteger(days)||days<1||days>3650||age<1)return null
    // The anchor itself is the first occurrence, including in period history.
    const scheduled=Math.floor((age-1)/days)*days
    const d=new Date(rule.anchor_date+'T00:00:00Z')
    d.setUTCDate(d.getUTCDate()+scheduled)
    return d.toISOString().slice(0,10)
  }
  // A fifth weekday can be absent for several months. Preserve the genuine
  // most recent occurrence without inventing a fourth/fifth-week fallback.
  let monthlyByWeekday=false
  if(rule.repeat_type==='monthly'){
    try{
      const config=typeof rule.repeat_config==='string'?
        JSON.parse(rule.repeat_config):rule.repeat_config||{}
      monthlyByWeekday=config.mode==='weekday'
    }catch{return null}
  }
  const max=rule.repeat_type==='monthly'?(monthlyByWeekday?400:65):
    rule.repeat_type==='daily'?1:35
  const d=new Date(date+'T00:00:00Z')
  for(let i=1;i<=max&&i<=age;i++){
    d.setUTCDate(d.getUTCDate()-1)
    const day=d.toISOString().slice(0,10)
    if(dueOn(rule,day))return day
  }
  return null
}
export function pendingCarryover(rule,date,lastResolvedOn){
  // A workday-excluding rule never creates a weekend/holiday todo.
  if(rule.repeat_type==='workday'&&!isJapaneseWorkday(date))return null
  let c={}
  try{c=typeof rule.repeat_config==='string'?JSON.parse(rule.repeat_config):rule.repeat_config||{}}catch{return null}
  if(c.excludeJapaneseHolidays&&!isJapaneseWorkday(date))return null
  const previous=lastScheduledBefore(rule,date)
  return previous&&(!lastResolvedOn||lastResolvedOn<previous)?previous:null
}
