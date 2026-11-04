import {json,validDate} from './security.js'
import {daysBetween,dueOn,nextAnniversary} from './recurrence.js'
const stringDate=d=>typeof d==='string'&&d.length===10&&validDate(d)
export async function remindersRoute(request,db,session) {
  if(request.method!=='GET')return json({error:'method_not_allowed'},405)
  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
  const date=new URL(request.url).searchParams.get('date')||today
  if(!stringDate(date))return json({error:'invalid_input'},400)
  const hid=session.household_id,u=session.user_id
  const [events,rules,marks,tasks,trips,tripProgress]=await db.batch([
    db.prepare("SELECT id,title,event_date,repeat_mode,advance_days_json FROM anniversaries WHERE household_id=?1 AND (visibility='household' OR created_by=?2) LIMIT 200").bind(hid,u),
    db.prepare("SELECT id,title,anchor_date,repeat_type,repeat_config,next_due_on FROM routines WHERE household_id=?1 AND enabled=1 AND (visibility='household' OR created_by=?2) LIMIT 200").bind(hid,u),
    db.prepare(`SELECT m.routine_id,m.completed_at,m.skipped_at FROM routine_marks m
      JOIN routines r ON r.id=m.routine_id WHERE r.household_id=?1 AND m.occurrence_on=?2
      AND (r.visibility='household' OR r.created_by=?3)`).bind(hid,date,u),
    db.prepare(`SELECT id,title,due_on FROM tasks WHERE household_id=?1 AND deleted_at IS NULL
      AND completed_at IS NULL AND due_on<=?2 AND (visibility='household' OR creator_user_id=?3)
      ORDER BY due_on LIMIT 100`).bind(hid,date,u),
    db.prepare(`SELECT id,title,plan_json,created_by FROM trips
      WHERE household_id=?1 AND status IN ('planning','active')
      AND (visibility='household' OR created_by=?2)
      ORDER BY start_on LIMIT 30`).bind(hid,u),
    db.prepare(`SELECT p.trip_id,p.item_id,p.completed_at FROM trip_progress p
      JOIN trips t ON t.id=p.trip_id WHERE t.household_id=?1
      AND t.status IN ('planning','active') AND (t.visibility='household' OR t.created_by=?2)
      AND p.completed_at IS NOT NULL LIMIT 3000`).bind(hid,u)
  ])
  const announcements=[]
  for(const e of events.results||[]){
    const next=nextAnniversary(e.event_date,e.repeat_mode,date)
    if(!next)continue
    let leads=[]
    try{leads=JSON.parse(e.advance_days_json||'[]')}catch{}
    const ahead=daysBetween(date,next)
    if(leads.includes(ahead))announcements.push({kind:'anniversary',id:e.id,title:e.title,dueOn:next,daysBefore:ahead})
  }
  const completed=new Set((marks.results||[]).filter(x=>x.completed_at||x.skipped_at).map(x=>x.routine_id))
  for(const r of rules.results||[]){
    try{if(dueOn(r,date)&&!completed.has(r.id))announcements.push({kind:'routine',id:r.id,title:r.title,dueOn:date})}catch{}
  }
  for(const t of tasks.results||[])announcements.push({kind:'task',id:t.id,title:t.title,dueOn:t.due_on})
  const finished=new Set((tripProgress.results||[]).map(r=>r.trip_id+':'+r.item_id))
  const plusDays=(date,offset)=>{
    const dt=new Date(date+'T00:00:00Z')
    dt.setUTCDate(dt.getUTCDate()+offset)
    return dt.toISOString().slice(0,10)
  }
  for(const trip of trips.results||[]){
    let plan
    try{plan=trip.plan_json?JSON.parse(trip.plan_json):null}catch{continue}
    if(!plan?.trip)continue
    const dates=new Map()
    for(const day of plan.trip.days||[])
      for(const item of day.items||[])dates.set(item.externalId,{date:day.date,title:item.title})
    for(const task of plan.trip.tasks||[]){
      if(trip.created_by!==u && task.visibility!=='household')continue
      if(task.dueDate && task.dueDate<=date && !finished.has(trip.id+':'+task.externalId))
        announcements.push({kind:'trip',id:trip.id+':'+task.externalId,
          title:trip.title+' · '+task.title,dueOn:task.dueDate})
      if(task.dueDate)dates.set(task.externalId,{date:task.dueDate,title:task.title})
    }
    for(const reminder of plan.trip.reminders||[]){
      const target=dates.get(reminder.target)
      if(!target||!Number.isInteger(reminder.offsetDays))continue
      if(plusDays(target.date,reminder.offsetDays)!==date)continue
      if(finished.has(trip.id+':'+reminder.target))continue
      announcements.push({kind:'trip',id:trip.id+':'+reminder.externalId,
        title:trip.title+' · '+target.title,dueOn:target.date})
    }
  }
  return json({date,items:announcements})
}
