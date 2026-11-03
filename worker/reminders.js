import {json,validDate} from './security.js'
import {daysBetween,dueOn,nextAnniversary} from './recurrence.js'
const stringDate=d=>typeof d==='string'&&d.length===10&&validDate(d)
export async function remindersRoute(request,db,session) {
  if(request.method!=='GET')return json({error:'method_not_allowed'},405)
  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
  const date=new URL(request.url).searchParams.get('date')||today
  if(!stringDate(date))return json({error:'invalid_input'},400)
  const hid=session.household_id,u=session.user_id
  const [events,rules,marks,tasks]=await db.batch([
    db.prepare("SELECT id,title,event_date,repeat_mode,advance_days_json FROM anniversaries WHERE household_id=?1 AND (visibility='household' OR created_by=?2) LIMIT 200").bind(hid,u),
    db.prepare("SELECT id,title,anchor_date,repeat_type,repeat_config FROM routines WHERE household_id=?1 AND enabled=1 AND (visibility='household' OR created_by=?2) LIMIT 200").bind(hid,u),
    db.prepare(`SELECT m.routine_id,m.completed_at,m.skipped_at FROM routine_marks m
      JOIN routines r ON r.id=m.routine_id WHERE r.household_id=?1 AND m.occurrence_on=?2
      AND (r.visibility='household' OR r.created_by=?3)`).bind(hid,date,u),
    db.prepare(`SELECT id,title,due_on FROM tasks WHERE household_id=?1 AND deleted_at IS NULL
      AND completed_at IS NULL AND due_on<=?2 AND (visibility='household' OR creator_user_id=?3)
      ORDER BY due_on LIMIT 100`).bind(hid,date,u)
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
  return json({date,items:announcements})
}
