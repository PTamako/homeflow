// One urgency order for the combined routine + one-off task list.
// Empty dates are deliberately last; dates are Tokyo-local calendar days.
const date=/^\d{4}-\d{2}-\d{2}$/
function tokyoDay(timestamp){
  const n=Date.parse(String(timestamp||''))
  return Number.isFinite(n)?new Date(n+9*3600000).toISOString().slice(0,10):''
}
export function taskUrgencyKey(kind,item,scope='active'){
  const raw=scope==='history'
    ?kind==='routine'?item.periodOn:(tokyoDay(item.completedAt)||item.dueOn)
    :kind==='routine'?(item.currentStatus==='pending'&&item.currentPeriodOn||item.nextDueOn||item.next_due_on):item.dueOn
  return date.test(String(raw||''))?String(raw):scope==='history'?'0000-01-01':'9999-12-31'
}
export function sortPlanTasks(routines,tasks,scope='active'){
  const entries=[
    ...routines.map(item=>({kind:'routine',item})),
    ...tasks.map(item=>({kind:'task',item}))
  ]
  return entries.sort((a,b)=>{
    const left=taskUrgencyKey(a.kind,a.item,scope)
    const right=taskUrgencyKey(b.kind,b.item,scope)
    const byDate=scope==='history'?right.localeCompare(left):left.localeCompare(right)
    return byDate||a.kind.localeCompare(b.kind)||String(a.item.id).localeCompare(String(b.item.id))
  })
}
