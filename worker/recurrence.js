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
    case 'weekly': {
      const wd=new Date(date+'T00:00:00Z').getUTCDay()
      return Array.isArray(c.weekdays)&&c.weekdays.includes(wd)
    }
    case 'monthly': return Number(c.day)===Number(date.slice(8,10))
    case 'interval': return Number.isInteger(c.days)&&c.days>=1&&c.days<=3650&&age%c.days===0
    default: return false
  }
}
export function validateRule(r){
  if(!r||!['daily','weekly','monthly','interval'].includes(r.repeatType))return false
  const c=r.repeatConfig||{}
  if(r.repeatType==='weekly')return Array.isArray(c.weekdays)&&c.weekdays.length>0&&c.weekdays.length<=7&&
    c.weekdays.every(x=>Number.isInteger(x)&&x>=0&&x<=6)
  if(r.repeatType==='monthly')return Number.isInteger(c.day)&&c.day>=1&&c.day<=31
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
