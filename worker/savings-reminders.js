// Savings notices are derived from existing goal/settlement rows. They do not
// change financial balances, create completion marks or call the Kakebo ledger.
import {goalPeriod} from './goal-period.js'
import {closedGoalPeriods} from './goal-settlements.js'
import {jstDayOf} from './today-periods.js'

const dayOffset=(date,days)=>
  new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10)
const daysBetween=(start,end)=>Math.round((Date.parse(end+'T00:00:00Z')-
  Date.parse(start+'T00:00:00Z'))/86400000)
const yen=value=>'¥'+Number(value||0).toLocaleString('ja-JP')
const key=(id,period)=>id+':'+period
const validStatus=status=>status==='met'||status==='shortfall'

// The calendar is the only source for reminder timing:
// once: due date; monthly: three days before; yearly: seven days before.
// Outstanding reminders remain visible in "待提醒" every day. Push delivery
// happens only on the first day after closing and at most weekly thereafter.
// Confirmed settlement results notify on the *next* JST morning.
export function savingsReminders(goals,date,settlements=[],completionMarks=[]){
  const settled=new Map(settlements.map(row=>[key(row.goal_id,row.period_key),row]))
  const marked=new Set(completionMarks.map(row=>key(row.plan_id,row.period_key)))
  const reminders=[]
  for(const goal of goals||[]){
    const mode=goal.goal_mode||'once'
    if(mode==='once'){
      if(goal.target_on===date&&!marked.has(key(goal.id,'once'))){
        reminders.push({kind:'goal',id:goal.id,title:goal.title,
          dueOn:goal.target_on,periodKey:'once',stage:'due',
          message:'累计储值目标今日到期 · 目标 '+yen(goal.target_amount)})
      }
      continue
    }
    if(mode!=='monthly'&&mode!=='yearly')continue
    const currentKey=mode==='monthly'?date.slice(0,7):date.slice(0,4)
    const current=goalPeriod(goal,currentKey,date)
    const closed=closedGoalPeriods(goal,date,12)
    const unresolved=closed.filter(w=>!marked.has(key(goal.id,w.periodKey))&&
      !validStatus(settled.get(key(goal.id,w.periodKey))?.status))
    const oldest=unresolved.at(-1)
    if(oldest){
      const elapsed=daysBetween(oldest.periodEnd,date)
      // Visible until reconciled, but only the first day and every seventh day push.
      reminders.push({kind:'goal',id:goal.id,title:goal.title,
        dueOn:oldest.periodEnd,periodKey:oldest.periodKey,stage:'pending',
        priority:'important',notifyToday:elapsed>=1&&(elapsed-1)%7===0,
        message:oldest.periodKey+' 期已截止，等待账目核验'+
          (unresolved.length>1?' · '+unresolved.length+' 期待核验':'')})
    }else if(current&&!current.notStarted){
      const lead=mode==='monthly'?3:7
      const remaining=daysBetween(date,current.periodEnd)
      if(remaining>=0&&remaining<=lead){
        reminders.push({kind:'goal',id:goal.id,title:goal.title,
          dueOn:current.periodEnd,periodKey:currentKey,stage:'advance',
          daysBefore:remaining,notifyToday:remaining===lead,
          message:currentKey+' 期即将截止 · 目标 '+yen(goal.target_amount)})
      }
    }
    const yesterday=dayOffset(date,-1)
    // Only the latest twelve closed periods are relevant to the Today inbox.
    for(const w of closed){
      const result=settled.get(key(goal.id,w.periodKey))
      if(!validStatus(result?.status)||jstDayOf(result.settled_at)!==yesterday)continue
      const remaining=Number(result.difference_amount||0)
      const status=result.status==='met'?'本期已达标':
        remaining>0?'本期未达标 · 不足 '+yen(remaining):
        '本期未达标'
      reminders.push({kind:'goal',id:goal.id,title:goal.title,
        dueOn:w.periodEnd,periodKey:w.periodKey,stage:'result',
        priority:result.status==='shortfall'?'important':'normal',
        message:w.periodKey+' '+status})
    }
  }
  return reminders
}
