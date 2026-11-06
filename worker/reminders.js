import {json,validDate,readBody} from './security.js'
import {daysBetween,dueOn,nextAnniversary} from './recurrence.js'
import {BIRTHDAY_PROFILES_SQL,mergeProfileBirthdays} from './birthdays.js'
import {savingsReminders} from './savings-reminders.js'
import {wishReminders} from './wish-reminders.js'

// Reuse exactly the same identity for Cron records and pending-list de-duplication.
export const reminderDeliveryKey=event=>[event.kind,event.id,
  ...(event.kind==='goal'?[event.periodKey,event.stage]:[]),
  event.dueOn,event.daysBefore??0].join(':')
const stringDate=d=>typeof d==='string'&&d.length===10&&validDate(d)
const addDays=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10)
const validLead=n=>[0,1,3,7].includes(n)
const validHour=n=>Number.isInteger(n)&&n>=0&&n<=23
const itemIdOk=x=>typeof x==='string'&&x.length>0&&x.length<=200&&!/[\x00-\x1f]/.test(x)
const idOk=x=>typeof x==='string'&&/^[0-9a-f-]{36}$/i.test(x)
const priorityOk=x=>['normal','important'].includes(x)
export async function remindersRoute(request,db,session) {
  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
  const url=new URL(request.url)
  if(url.pathname==='/api/reminders/preferences'){
    if(request.method!=='PUT')return json({error:'method_not_allowed'},405)
    const body=await readBody(request)
    const hasQuiet=Object.hasOwn(body||{},'quietStartHour')||Object.hasOwn(body||{},'quietEndHour')
    const quietStart=body?.quietStartHour??null,quietEnd=body?.quietEndHour??null
    if(!validLead(body?.advanceDays)||
      (hasQuiet&&!((quietStart===null&&quietEnd===null)||
        (validHour(quietStart)&&validHour(quietEnd)&&quietStart!==quietEnd)))||
      (hasQuiet&&(!Object.hasOwn(body,'quietStartHour')||!Object.hasOwn(body,'quietEndHour'))))
      return json({error:'invalid_input'},400)
    await db.prepare('INSERT INTO reminder_preferences '+
      '(household_id,user_id,advance_days,quiet_start_hour,quiet_end_hour) VALUES(?1,?2,?3,?4,?5) '+
      'ON CONFLICT(household_id,user_id) DO UPDATE SET '+
      'advance_days=excluded.advance_days,'+
      'quiet_start_hour=CASE WHEN ?6=1 THEN excluded.quiet_start_hour ELSE reminder_preferences.quiet_start_hour END,'+
      'quiet_end_hour=CASE WHEN ?6=1 THEN excluded.quiet_end_hour ELSE reminder_preferences.quiet_end_hour END,'+
      'updated_at=CURRENT_TIMESTAMP')
      .bind(session.household_id,session.user_id,body.advanceDays,quietStart,quietEnd,hasQuiet?1:0).run()
    return json({ok:true,advanceDays:body.advanceDays,
      ...(hasQuiet?{quietStartHour:quietStart,quietEndHour:quietEnd}:{})})
  }
  if(url.pathname==='/api/reminders/item'){
    if(!['GET','PUT','DELETE'].includes(request.method))return json({error:'method_not_allowed'},405)
    const body=request.method==='GET'?
      {kind:url.searchParams.get('kind'),id:url.searchParams.get('id')}:
      await readBody(request)
    const kind=body?.kind,id=body?.id
    if(!['task','routine','shopping','trip'].includes(kind)||!itemIdOk(id)||
      (request.method==='PUT'&&(!validLead(body?.advanceDays)||!priorityOk(body?.priority))))
      return json({error:'invalid_input'},400)
    const hid=session.household_id,u=session.user_id
    let allowed=false
    if(kind==='task'){
      allowed=!!await db.prepare("SELECT id FROM tasks WHERE id=?1 AND household_id=?2 AND deleted_at IS NULL AND (visibility='household' OR creator_user_id=?3)")
        .bind(id,hid,u).first()
    }else if(kind==='routine'){
      allowed=!!await db.prepare("SELECT id FROM routines WHERE id=?1 AND household_id=?2 AND deleted_at IS NULL AND (visibility='household' OR created_by=?3)")
        .bind(id,hid,u).first()
    }else if(kind==='shopping'){
      allowed=!!await db.prepare("SELECT id FROM shopping_items WHERE id=?1 AND household_id=?2 AND deleted_at IS NULL AND (visibility='household' OR created_by=?3)")
        .bind(id,hid,u).first()
    }else{
      const cut=id.indexOf(':'),tripId=id.slice(0,cut),externalId=id.slice(cut+1)
      if(cut>0&&idOk(tripId)&&externalId){
        const trip=await db.prepare("SELECT created_by,plan_json FROM trips WHERE id=?1 AND household_id=?2 AND deleted_at IS NULL AND (visibility='household' OR created_by=?3)")
          .bind(tripId,hid,u).first()
        if(trip){
          try{
            const plan=JSON.parse(trip.plan_json||'{}')?.trip
            const candidates=[...(plan?.tasks||[]),...(plan?.reminders||[]),
              ...(plan?.days||[]).flatMap(d=>d.items||[])]
            allowed=candidates.some(x=>x.externalId===externalId&&
              (trip.created_by===u||x.visibility==='household'))
          }catch{}
        }
      }
    }
    if(!allowed)return json({error:'not_found'},404)
    if(request.method==='GET'){
      // Only queried when the user opens a plan's reminder editor.
      const [record,base]=await db.batch([
        db.prepare('SELECT advance_days,priority FROM reminder_item_preferences WHERE household_id=?1 AND user_id=?2 AND kind=?3 AND item_id=?4')
          .bind(hid,u,kind,id),
        db.prepare('SELECT advance_days FROM reminder_preferences WHERE household_id=?1 AND user_id=?2')
          .bind(hid,u)
      ])
      const saved=record.results?.[0]||null
      const defaultDays=validLead(base.results?.[0]?.advance_days)?base.results[0].advance_days:0
      return json({kind,id,customized:!!saved,defaultDays,
        advanceDays:validLead(saved?.advance_days)?saved.advance_days:defaultDays,
        priority:priorityOk(saved?.priority)?saved.priority:'normal'})
    }
    if(request.method==='DELETE'){
      await db.prepare('DELETE FROM reminder_item_preferences WHERE household_id=?1 AND user_id=?2 AND kind=?3 AND item_id=?4')
        .bind(hid,u,kind,id).run()
      return json({ok:true,reset:true})
    }
    await db.prepare('INSERT INTO reminder_item_preferences (household_id,user_id,kind,item_id,advance_days,priority) '+
      'VALUES(?1,?2,?3,?4,?5,?6) '+
      'ON CONFLICT(household_id,user_id,kind,item_id) DO UPDATE SET '+
      'advance_days=excluded.advance_days,priority=excluded.priority,updated_at=CURRENT_TIMESTAMP')
      .bind(hid,u,kind,id,body.advanceDays,body.priority).run()
    return json({ok:true,kind,id,advanceDays:body.advanceDays,priority:body.priority})
  }
  if(url.pathname==='/api/reminders/snooze'){
    if(!['POST','DELETE'].includes(request.method))return json({error:'method_not_allowed'},405)
    const body=await readBody(request)
    const kind=body?.kind,itemId=body?.id,until=body?.untilOn
    const days=stringDate(until)?daysBetween(today,until):-1
    if(!['task','routine','anniversary','trip'].includes(kind)||
       typeof itemId!=='string'||itemId.length<1||itemId.length>200||
       /[\x00-\x1f]/.test(itemId)||
       (request.method==='POST'&&(days<0||days>365)))
      return json({error:'invalid_input'},400)
    if(request.method==='DELETE'){
      await db.prepare('DELETE FROM reminder_snoozes WHERE household_id=?1 AND user_id=?2 AND kind=?3 AND item_id=?4')
        .bind(session.household_id,session.user_id,kind,itemId).run()
      return json({ok:true,cancelled:true})
    }
    await db.prepare('INSERT INTO reminder_snoozes '+
      '(household_id,user_id,kind,item_id,until_on,updated_at) '+
      'VALUES(?1,?2,?3,?4,?5,CURRENT_TIMESTAMP) '+
      'ON CONFLICT(household_id,user_id,kind,item_id) '+
      'DO UPDATE SET until_on=excluded.until_on,updated_at=CURRENT_TIMESTAMP')
      .bind(session.household_id,session.user_id,kind,itemId,until).run()
    return json({ok:true,kind,id:itemId,untilOn:until})
  }
  if(request.method!=='GET')return json({error:'method_not_allowed'},405)
  const date=url.searchParams.get('date')||today
  if(!stringDate(date))return json({error:'invalid_input'},400)
  const hid=session.household_id,u=session.user_id
  // Pending inbox is a display filter; the 06:00 scheduler must keep the complete list.
  const pendingOnly=url.searchParams.get('pending')==='1'
  const includeGoals=pendingOnly||url.searchParams.get('goals')==='1'
  const [events,rules,marks,tasks,shopping,trips,tripProgress,birthdayProfiles,snoozes,preference,itemPrefs,deliveredNotices]=await db.batch([
    db.prepare("SELECT id,title,event_date,repeat_mode,advance_days_json FROM anniversaries WHERE household_id=?1 AND deleted_at IS NULL AND (visibility='household' OR created_by=?2) LIMIT 200").bind(hid,u),
    db.prepare("SELECT id,title,anchor_date,repeat_type,repeat_config,next_due_on FROM routines WHERE household_id=?1 AND enabled=1 AND deleted_at IS NULL AND remind_enabled=1 AND (visibility='household' OR created_by=?2) AND (assigned_to=?2 OR assigned_to IS NULL) LIMIT 200").bind(hid,u),
    db.prepare(`SELECT m.routine_id,m.occurrence_on,m.completed_at,m.skipped_at FROM routine_marks m
      JOIN routines r ON r.id=m.routine_id WHERE r.household_id=?1 AND r.deleted_at IS NULL
      AND m.occurrence_on>=?2 AND m.occurrence_on<=?3
      AND (r.visibility='household' OR r.created_by=?4)`).bind(hid,date,addDays(date,7),u),
    db.prepare(`SELECT id,title,due_on FROM tasks WHERE household_id=?1 AND deleted_at IS NULL
      AND completed_at IS NULL AND remind_enabled=1 AND due_on<=?2 AND (visibility='household' OR creator_user_id=?3) AND (assignee_user_id=?3 OR assignee_user_id IS NULL)
      ORDER BY due_on LIMIT 100`).bind(hid,addDays(date,7),u),
    db.prepare(`SELECT id,title,due_on FROM shopping_items WHERE household_id=?1 AND deleted_at IS NULL
      AND completed_at IS NULL AND due_on IS NOT NULL AND due_on<=?2
      AND (visibility='household' OR created_by=?3) AND (assigned_to=?3 OR assigned_to IS NULL)
      ORDER BY due_on LIMIT 100`).bind(hid,addDays(date,7),u),
    db.prepare(`SELECT id,title,plan_json,created_by FROM trips
      WHERE household_id=?1 AND deleted_at IS NULL AND status IN ('planning','active')
      AND (visibility='household' OR created_by=?2)
      ORDER BY start_on LIMIT 30`).bind(hid,u),
    db.prepare(`SELECT p.trip_id,p.item_id,p.completed_at FROM trip_progress p
      JOIN trips t ON t.id=p.trip_id WHERE t.household_id=?1 AND t.deleted_at IS NULL
      AND t.status IN ('planning','active') AND (t.visibility='household' OR t.created_by=?2)
      AND p.completed_at IS NOT NULL LIMIT 3000`).bind(hid,u),
    db.prepare(BIRTHDAY_PROFILES_SQL).bind(hid),
    db.prepare('SELECT kind,item_id,until_on FROM reminder_snoozes WHERE household_id=?1 AND user_id=?2 AND until_on>=?3 LIMIT 500')
      .bind(hid,u,date),
    db.prepare('SELECT advance_days,quiet_start_hour,quiet_end_hour FROM reminder_preferences WHERE household_id=?1 AND user_id=?2').bind(hid,u),
    db.prepare('SELECT kind,item_id,advance_days,priority FROM reminder_item_preferences WHERE household_id=?1 AND user_id=?2 LIMIT 500').bind(hid,u),
    // Query only the current recipient's scheduled notices, using the existing daily index.
    ...(pendingOnly?[db.prepare(`SELECT dedupe_key FROM notification_inbox
      WHERE household_id=?1 AND recipient_user_id=?2 AND local_day=?3
        AND dedupe_key LIKE 'scheduled:%'`).bind(hid,u,date)]:[])
  ])
  const leadDays=validLead(preference.results?.[0]?.advance_days)?preference.results[0].advance_days:0
  const overrides=new Map((itemPrefs.results||[]).map(x=>[x.kind+':'+x.item_id,x]))
  const forItem=(kind,id)=>{
    const found=overrides.get(kind+':'+id)
    return {days:validLead(found?.advance_days)?found.advance_days:leadDays,
      priority:priorityOk(found?.priority)?found.priority:'normal'}
  }
  const announcements=[]
  for(const e of mergeProfileBirthdays(events.results,birthdayProfiles.results)){
    const next=nextAnniversary(e.event_date,e.repeat_mode,date)
    if(!next)continue
    let leads=[]
    try{leads=JSON.parse(e.advance_days_json||'[]')}catch{}
    const ahead=daysBetween(date,next)
    if(leads.includes(ahead))announcements.push({kind:'anniversary',id:e.id,title:e.title,dueOn:next,daysBefore:ahead})
  }
  const completed=new Set((marks.results||[]).filter(x=>x.completed_at||x.skipped_at)
    .map(x=>x.routine_id+':'+x.occurrence_on))
  for(const r of rules.results||[]){
    try{
      const opts=forItem('routine',r.id)
      if(dueOn(r,date)){
        if(!completed.has(r.id+':'+date))announcements.push({kind:'routine',id:r.id,title:r.title,dueOn:date,priority:opts.priority})
      }else if(opts.days>0&&dueOn(r,addDays(date,opts.days))&&
        !completed.has(r.id+':'+addDays(date,opts.days))){
        announcements.push({kind:'routine',id:r.id,title:r.title,
          dueOn:addDays(date,opts.days),daysBefore:opts.days,priority:opts.priority})
      }
    }catch{}
  }
  for(const t of tasks.results||[]){
    const ahead=daysBetween(date,t.due_on)
    const opts=forItem('task',t.id)
    if(ahead<=0||ahead===opts.days)
      announcements.push({kind:'task',id:t.id,title:t.title,dueOn:t.due_on,priority:opts.priority,
        ...(ahead>0?{daysBefore:ahead}:{})})
  }
  for(const item of shopping.results||[]){
    const ahead=daysBetween(date,item.due_on)
    const opts=forItem('shopping',item.id)
    if(ahead<=0||ahead===opts.days)
      announcements.push({kind:'shopping',id:item.id,title:item.title,dueOn:item.due_on,
        priority:opts.priority,...(ahead>0?{daysBefore:ahead}:{})})
  }
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
      if(task.dueDate&&!finished.has(trip.id+':'+task.externalId)){
        const ahead=daysBetween(date,task.dueDate)
        const itemId=trip.id+':'+task.externalId
        const opts=forItem('trip',itemId)
        if(ahead<=0||ahead===opts.days)
          announcements.push({kind:'trip',id:itemId,priority:opts.priority,
            title:trip.title+' · '+task.title,dueOn:task.dueDate,
            ...(ahead>0?{daysBefore:ahead}:{})})
      }
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
  // The normal reminders/settings API keeps its existing query budget.
  // Only Today's pending tab and the 06:00 scheduled pass include savings.
  if(includeGoals){
    const {results:goals=[]}=await db.prepare(`SELECT id,title,goal_mode,start_on,target_on,target_amount
      FROM goals WHERE household_id=?1 AND deleted_at IS NULL
      AND (visibility='household' OR created_by=?2)
      AND (start_on IS NULL OR start_on<=?3)
      AND (goal_mode IN ('monthly','yearly') OR (goal_mode='once' AND target_on=?3))
      ORDER BY created_at DESC LIMIT 60`).bind(hid,u,date).all()
    if(goals.length){
      const ids=goals.map(x=>x.id)
      const placeholders=ids.map((_,i)=>'?'+(i+2)).join(',')
      const [settlements,marks]=await db.batch([
        db.prepare(`SELECT goal_id,period_key,status,difference_amount,settled_at
          FROM goal_period_settlements WHERE household_id=?1 AND goal_id IN (${placeholders})
          ORDER BY period_key DESC LIMIT 1000`).bind(hid,...ids),
        db.prepare(`SELECT plan_id,period_key FROM plan_completion_marks
          WHERE household_id=?1 AND plan_type='goal' AND plan_id IN (${placeholders})
          LIMIT 1000`).bind(hid,...ids)
      ])
      const goalNotices=savingsReminders(goals,date,
        settlements.results||[],marks.results||[])
      // Cron sends on configured dates; the pending UI retains ongoing alerts
      // without creating a new phone push or unread record every day.
      announcements.push(...(pendingOnly?goalNotices:
        goalNotices.filter(event=>event.notifyToday!==false)))
    }
  }
  if(includeGoals){
    // A single bounded indexed query, scoped to visible and enabled wishes.
    // Missing dates, completed/cancelled and reminder-disabled wishes never
    // enter the notification inbox.
    const {results:wishes=[]}=await db.prepare(`SELECT id,title,target_on,status,remind_enabled,remind_advance_days
      FROM wishes WHERE household_id=?1 AND deleted_at IS NULL
        AND remind_enabled=1 AND target_on>=?3 AND target_on<=?4
        AND status NOT IN ('completed','cancelled')
        AND (visibility='household' OR created_by=?2)
      ORDER BY target_on,id LIMIT 100`).bind(hid,u,date,addDays(date,7)).all()
    announcements.push(...wishReminders(wishes,date))
  }
  const suppressed=new Set((snoozes.results||[]).map(x=>x.kind+':'+x.item_id))
  const deliveredKeys=new Set((deliveredNotices?.results||[]).map(x=>x.dedupe_key))
  const pref=preference.results?.[0]||{}
  return json({date,advanceDays:leadDays,
    quietHours:{start:pref.quiet_start_hour??null,end:pref.quiet_end_hour??null},
    itemPreferences:(itemPrefs.results||[]).map(x=>({kind:x.kind,id:x.item_id,
      advanceDays:x.advance_days,priority:x.priority})),
    snoozed:(snoozes.results||[]).map(x=>({kind:x.kind,id:x.item_id,untilOn:x.until_on})),
    items:announcements.filter(x=>!suppressed.has(x.kind+':'+x.id)&&
      (!pendingOnly||!deliveredKeys.has('scheduled:'+
        reminderDeliveryKey(x))))})
}
