// Wish reminders are opt-in, once per selected target date. They do not
// mark wishes complete or read linked savings balances.
const daysBetween=(date,target)=>Math.round((Date.parse(target+'T00:00:00Z')-
  Date.parse(date+'T00:00:00Z'))/86400000)

export function wishReminders(items,date){
  const reminders=[]
  for(const wish of items||[]){
    if(wish.remind_enabled!==1 || !wish.target_on ||
      wish.status==='completed'||wish.status==='cancelled')continue
    const lead=Number(wish.remind_advance_days)
    if(![0,1,3,7].includes(lead) || daysBetween(date,wish.target_on)!==lead)continue
    reminders.push({kind:'wish',id:wish.id,title:wish.title,
      dueOn:wish.target_on,daysBefore:lead,
      message:lead?'心愿目标日还有 '+lead+' 天':'心愿目标日到了，记得查看计划'})
  }
  return reminders
}
