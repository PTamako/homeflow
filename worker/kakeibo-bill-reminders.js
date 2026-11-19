// HomeFlow hourly Cron consumes only the private, read-only Kakeibo Service
// Binding and strictly targets the linked owner of each fee. No Pages API calls.
// A fixed cost is due tomorrow; a variable invoice is due TODAY.
const civilDate=d=>typeof d==='string'&&/^20\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(d)&&
 new Date(d+'T00:00:00Z').toISOString().slice(0,10)===d
const after=d=>new Date(Date.parse(d+'T00:00:00Z')+86400000).toISOString().slice(0,10)
const uuid=/^[a-f0-9-]{36}$/i
const safeName=x=>typeof x==='string'&&x.trim().length>=1&&x.trim().length<=120&&!/[\x00-\x1f]/.test(x)
const yen=x=>Number.isSafeInteger(Number(x))&&Number(x)>0&&Number(x)<=10000000
 ?' · ¥'+Number(x).toLocaleString('ja-JP'):''
export function projectKakeiboBillReminderEvents(result,member,day){
 if(!civilDate(day)||!result||result.recipientId!==member.user_id||
   result.householdId!==member.household_id||!Array.isArray(result.items))return []
 const tomorrow=after(day)
 const events=[]
 for(const entry of result.items.slice(0,200)){
  if(!entry||!['fixed','variable'].includes(entry.kind)||!uuid.test(entry.planId||'')&&
      !/^[a-f0-9]{32}$/i.test(entry.planId||'')||
    !safeName(entry.name)||!civilDate(entry.dueOn))continue
  const fixed=entry.kind==='fixed'
  if(entry.dueOn!==(fixed?tomorrow:day))continue
  const suffix=yen(entry.amountJpy)
  const title=(fixed?'明日确认固定费 · ':'今日确认变动费 · ')+entry.name
  const message=fixed?
   '明天（'+entry.dueOn+'）记账。请在记账本「固定金额」核对后确认'+suffix:
   '今天（'+day+'）请核对账单金额与记账日期，必要时在19:30自动记账前修正'+suffix
  events.push({kind:'system',id:'kakeibo:'+entry.kind+':'+entry.planId+
    ':'+(fixed?entry.dueOn:entry.periodMonth||day),dueOn:entry.dueOn,
    daysBefore:fixed?1:0,title:title.slice(0,80),message:message.slice(0,160),
    priority:'normal'})
 }
 return events
}
// Bill-confirmation notifications start at 06:00 JST and are checked every
// two hours until 22:00. Keep the shared hourly Cron unchanged: other
// reminders still need quiet-hour catch-up at odd hours.
export function shouldCheckKakeiboBillsAtHour(jstHour){
 return Number.isInteger(jstHour)&&jstHour>=6&&jstHour<=22&&(jstHour-6)%2===0
}
export async function kakeiboBillReminderEvents(env,member,day){
 if(!env?.KAKEBO_LEDGER_SERVICE?.fetch||!uuid.test(member?.user_id||'')||
   typeof member?.household_id!=='string'||!civilDate(day))return []
 const query=new URLSearchParams({day,recipientUserId:member.user_id,
   householdId:member.household_id})
 try{
  const request=new Request('https://private-ledger.invalid/api/internal/bill-confirmation-reminders?'+query)
  const response=await env.KAKEBO_LEDGER_SERVICE.fetch(request)
  if(!response?.ok)return []
  const data=await response.json()
  return projectKakeiboBillReminderEvents(data,member,day)
 }catch{return []}
}
