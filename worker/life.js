import {iso,json,readBody,sha256,shortText,validDate} from './security.js'
import {BIRTHDAY_PROFILES_SQL,mergeProfileBirthdays} from './birthdays.js'
import {listFilters,listPage} from './list-pagination.js'
import {sortPlanTasks,taskUrgencyKey} from '../src/plan-task-sort.mjs'
import {nextAnniversary,validateRule,addDays,intervalStartsOnAnchor} from './recurrence.js'
import {currentRoutinePeriod,nextEarlyPeriod,isCompletionInterval,jstDate,jstToday,routineVersions} from './routine-periods.js'
import {enrichRoutineList,routineHistory,routinePeriodDetail} from './routine-history.js'
import {isJapaneseWorkday} from './jp-holidays.js'
import {readTodayRows} from './today-source-read.js'
import {routineAssignmentRoute} from './routine-assignments.js'

const catalog={
  anniversaries:{columns:['title','event_date','repeat_mode','advance_days_json','note','subject_profile_id']},
  routines:{columns:['title','repeat_type','repeat_config','anchor_date','assigned_to','subject_profile_id','health_record_type','remind_enabled']},
  wishes:{columns:['title','wish_type','status','estimated_amount','currency','note','target_on','remind_enabled','remind_advance_days']},
  goals:{columns:['title','target_amount','reserved_amount','currency','target_on','wish_id','goal_mode','start_on']},
  shopping_items:{columns:['title','quantity','due_on','assigned_to','second_assignee_user_id']},
  memories:{columns:['title','story','happened_on','linked_type','linked_id']},
}
const plural={anniversaries:'anniversaries',routines:'routines',wishes:'wishes',goals:'goals',shopping:'shopping_items',memories:'memories'}
const bad=()=>json({error:'invalid_input'},400)
const validText=(x,max=150)=>typeof x==='string'&&x.trim().length>=1&&x.trim().length<=max
const validMoney=(x,max=100000000000)=>Number.isSafeInteger(x)&&x>=0&&x<=max
const ymd=x=>typeof x==='string'&&x!==''&&validDate(x)
const hexId=x=>typeof x==='string'&&/^[0-9a-f-]{36}$/.test(x)
const visibilityOf=(b,s)=>['private','household'].includes(b?.visibility)?b.visibility:'private'
const trim=(x,max)=>String(x||'').trim().slice(0,max)
const JPY=x=>/^[A-Z]{3}$/.test(String(x||''))
function normalized(table,b,s){
  if(!b||!validText(b.title))return null
  const title=trim(b.title,150)
  switch(table){
    case 'anniversaries':
      if(!ymd(b.eventDate)||!['once','yearly','monthly'].includes(b.repeatMode))return null
      if(b.subjectProfileId && !hexId(b.subjectProfileId))return null
      const lead=Array.isArray(b.advanceDays)?b.advanceDays:[7,1,0]
      if(lead.length>10||!lead.every(x=>Number.isInteger(x)&&x>=0&&x<=365))return null
      return [title,b.eventDate,b.repeatMode,JSON.stringify([...new Set(lead)]),trim(b.note,1000),b.subjectProfileId||null]
    case 'routines': {
      const repeatType=b.repeatType==='workday'?'weekly':b.repeatType
      const input=b.repeatConfig||{}
      // Keep version metadata exclusively server-owned.
      const config=b.repeatType==='workday'?{weekdays:[1,2,3,4,5],excludeJapaneseHolidays:true}:
        repeatType==='weekly'?{weekdays:input.weekdays,excludeJapaneseHolidays:input.excludeJapaneseHolidays===true}:
        repeatType==='monthly'?(input.mode==='weekday'?
          {mode:'weekday',weekday:input.weekday,weekNumbers:input.weekNumbers}:
          Array.isArray(input.days)?{mode:'day',days:input.days}:{day:input.day}):
        repeatType==='interval'?{days:input.days,anchor:input.anchor==='completion'?'completion':'fixed',
          ...(typeof input.startOnAnchor==='boolean'?{startOnAnchor:input.startOnAnchor}:{})}:{}
      if(!ymd(b.anchorDate)||!validateRule({repeatType,repeatConfig:config}))return null
      if(b.assignedTo && !hexId(b.assignedTo))return null
      if(b.subjectProfileId && !hexId(b.subjectProfileId))return null
      const careType=b.healthRecordType||null
      if(careType&&!['deworm','vaccination','vet','medication','grooming','other'].includes(careType))return null
      return [title,repeatType,JSON.stringify(config),b.anchorDate,b.assignedTo||null,b.subjectProfileId||null,careType,b.remindEnabled===false?0:1]
    }
    case 'wishes':
      if(!['trip','purchase','activity','other'].includes(b.wishType)||!validMoney(b.estimatedAmount??0)||!JPY(b.currency||'JPY'))return null
      if(b.status && !['wished','planning','active','completed','cancelled'].includes(b.status))return null
      if(b.targetOn&&!ymd(b.targetOn))return null
      if(b.remindEnabled!==undefined&&typeof b.remindEnabled!=='boolean')return null
      const wishLead=b.remindAdvanceDays??0
      if(![0,1,3,7].includes(wishLead)||(b.remindEnabled===true&&!b.targetOn))return null
      return [title,b.wishType,b.status||'wished',b.estimatedAmount||0,b.currency||'JPY',
        trim(b.note,2000),b.targetOn||null,b.remindEnabled===true?1:0,wishLead]
    case 'goals':
      if(!Number.isSafeInteger(b.targetAmount)||b.targetAmount<=0||b.targetAmount>100000000000||!validMoney(b.reservedAmount??0)||!JPY(b.currency||'JPY')||
        (b.targetOn&&!ymd(b.targetOn))||(b.wishId&&!hexId(b.wishId)))return null
      const goalMode=b.goalMode||'once',startOn=b.startOn||null
      if(!['once','monthly','yearly'].includes(goalMode)||
         (startOn&&!ymd(startOn))||(goalMode!=='once'&&!startOn)||
         (startOn&&b.targetOn&&startOn>b.targetOn))return null
      return [title,b.targetAmount,b.reservedAmount||0,b.currency||'JPY',
        b.targetOn||null,b.wishId||null,goalMode,startOn]
    case 'shopping_items': {
      if(!Number.isSafeInteger(b.quantity)||b.quantity<1||b.quantity>9999)return null
      if(b.dueOn&&!ymd(b.dueOn))return null
      const first=b.assignedTo||null,second=b.secondAssigneeUserId||null
      if((first&&!hexId(first))||(second&&(!first||!hexId(second)||second===first)))return null
      if(second&&visibilityOf(b,s)!=='household')return null
      return [title,b.quantity,b.dueOn||null,first,second]
    }
    case 'memories':
      if(!ymd(b.happenedOn))return null
      if(b.linkedType&&!['trip','wish','profile','anniversary'].includes(b.linkedType))return null
      if(b.linkedId&&!hexId(b.linkedId))return null
      return [title,trim(b.story,8000),b.happenedOn,b.linkedType||null,b.linkedId||null]
    default:return null
  }
}
async function validLinks(db,table,data,session,requestedVisibility='private'){
  const hid=session.household_id
  if(table==='anniversaries'&&data[5]){
    return !!await db.prepare('SELECT 1 FROM family_profiles WHERE household_id=?1 AND id=?2 AND archived_at IS NULL').bind(hid,data[5]).first()
  }
  if(table==='routines'){
    if(requestedVisibility==='private'&&data[4]&&data[4]!==session.user_id)return false
    if(data[4] && !await db.prepare('SELECT 1 FROM household_members WHERE household_id=?1 AND user_id=?2').bind(hid,data[4]).first())return false
    if(data[5]){
      const profile=await db.prepare('SELECT type FROM family_profiles WHERE household_id=?1 AND id=?2 AND archived_at IS NULL')
        .bind(hid,data[5]).first()
      if(!profile || (data[6]&&profile.type!=='pet'))return false
    }else if(data[6])return false
  }
  if(table==='shopping_items'){
    if(requestedVisibility==='private'&&
      (data[4]||data[3]&&data[3]!==session.user_id))return false
    for(const userId of [data[3],data[4]].filter(Boolean)){
      if(!await db.prepare('SELECT 1 FROM household_members WHERE household_id=?1 AND user_id=?2')
        .bind(hid,userId).first())return false
    }
  }
  if(table==='goals'&&data[5]){
    const wish=await db.prepare('SELECT created_by,visibility FROM wishes WHERE id=?1 AND household_id=?2 AND deleted_at IS NULL').bind(data[5],hid).first()
    if(!wish || (wish.visibility==='private'&&wish.created_by!==session.user_id))return false
  }
  if(table==='memories'&&data[4]){
    const tab={trip:'trips',wish:'wishes',profile:'family_profiles',anniversary:'anniversaries'}[data[3]]
    if(!tab)return false
    const isProfile=tab==='family_profiles'
    const sql=isProfile
      ? 'SELECT 1 FROM family_profiles WHERE id=?1 AND household_id=?2 AND archived_at IS NULL'
      : "SELECT visibility FROM "+tab+" WHERE id=?1 AND household_id=?2 AND deleted_at IS NULL AND (visibility='household' OR created_by=?3)"
    const item=await db.prepare(sql).bind(...(isProfile?[data[4],hid]:[data[4],hid,session.user_id])).first()
    if(!item)return false
    // A household-visible memory must never disclose a title or metadata from
    // a private wish/trip/anniversary. Reuse the existing reference lookup.
    if(!isProfile&&requestedVisibility==='household'&&item.visibility==='private')
      return false
  }
  return true
}
async function view(db,table,session,detailId=null){
  const name=table==='shopping_items'?'shopping_items':table
  const {results}=await db.prepare('SELECT * FROM '+name+' WHERE household_id=?1 AND deleted_at IS NULL AND (visibility=?2 OR created_by=?3) '+
    (detailId?'AND id=?4 ':'')+
    (table==='shopping_items'?'ORDER BY CASE WHEN completed_at IS NULL THEN 0 ELSE 1 END,created_at DESC LIMIT 200':'ORDER BY created_at DESC LIMIT 200'))
    .bind(...(detailId?[session.household_id,'household',session.user_id,detailId]:[session.household_id,'household',session.user_id])).all()
  return results||[]
}
async function getObject(db,table,id,session){
  return db.prepare('SELECT * FROM '+table+
    " WHERE id=?1 AND household_id=?2 AND deleted_at IS NULL AND (visibility='household' OR created_by=?3)")
    .bind(id,session.household_id,session.user_id).first()
}
export async function lifeRoute(request,db,path,session,onComplete=null,options={}){
  const parts=path.split('/').filter(Boolean),kind=parts[1],table=plural[kind]
  if(!table||!catalog[table])return json({error:'not_found'},404)
  const id=parts[2]
  if(table==='anniversaries'&&id==='upcoming'&&request.method==='GET'){
    const now=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
    // One D1 batch: existing custom anniversaries + live family profile birthdays.
    // No second saved birthday record, so editing a profile cannot leave stale reminders.
    const [events,profiles]=await db.batch([
      db.prepare("SELECT * FROM anniversaries WHERE household_id=?1 AND deleted_at IS NULL AND (visibility='household' OR created_by=?2) ORDER BY created_at DESC LIMIT 200")
        .bind(session.household_id,session.user_id),
      db.prepare(BIRTHDAY_PROFILES_SQL).bind(session.household_id)
    ])
    return json({items:mergeProfileBirthdays(events.results,profiles.results)
      .map(e=>({...e,nextOn:nextAnniversary(e.event_date,e.repeat_mode,now)}))
      .filter(e=>e.nextOn).sort((a,b)=>a.nextOn.localeCompare(b.nextOn))})
  }
  if(table==='routines'&&id==='period-history'&&request.method==='GET')
    return routineHistory(db,request,session)
  if(table==='routines'&&id==='today'&&request.method==='GET'){
    const date=new URL(request.url).searchParams.get('date')||jstToday()
    if(!ymd(date))return bad()
    const sourceSql=`SELECT r.* FROM routines r
      WHERE r.household_id=?1 AND r.enabled=1 AND r.deleted_at IS NULL
        AND (r.visibility='household' OR r.created_by=?2)`
    const bindings=[session.household_id,session.user_id]
    const {results}=options.fullToday
      ? {results:await readTodayRows(db,sourceSql,bindings)}
      : await db.prepare(sourceSql+' LIMIT 250').bind(...bindings).all()
    // Enrichment has an IN-list and mark-window limit; chunk large households
    // instead of silently losing routine marks after the 250th template.
    const rules=[]
    if(options.fullToday){
      for(let i=0;i<(results||[]).length;i+=40)
        rules.push(...await enrichRoutineList(db,results.slice(i,i+40),date))
    }else rules.push(...await enrichRoutineList(db,results||[],date))
    const items=[]
    for(const r of rules){
      let config={}
      try{config=JSON.parse(r.repeat_config||'{}')}catch{}
      if(config.excludeJapaneseHolidays&&!isJapaneseWorkday(date))continue
      const current=r.currentPeriodOn,mark=r.currentMark
      const doneCurrent=!!mark?.completed_at&&jstDate(mark.completed_at)===date
      const recent=r.completedTodayMark?.occurrence_on<=date?r.completedTodayMark:null
      const pending=current===date&&r.currentStatus==='pending'
      if(!pending&&!doneCurrent&&!recent)continue
      const selected=pending||doneCurrent?mark:recent
      items.push({...r,mark:selected||null,
        occurrenceOn:pending||doneCurrent?current:(recent?.occurrence_on||current),
        recordOn:selected?.occurrence_on||null,
        carriedFrom:null})
    }
    return json({date,items})
  }
  if(id&&parts[3]==='assignment'&&table==='routines')
    return routineAssignmentRoute(request,db,session,id,options)
  if(id&&parts[3]==='mark'&&table==='routines'&&request.method==='POST'){
    const body=await readBody(request)
    if(!ymd(body?.date)||!['completed','skipped','open'].includes(body?.status))return bad()
    const rule=await getObject(db,table,id,session)
    if(!rule)return json({error:'not_found'},404)
    if(rule.visibility==='private'&&rule.created_by!==session.user_id)
      return json({error:'forbidden'},403)
    const actual=body.date,scheduled=currentRoutinePeriod(rule,actual)
    const current=scheduled===actual?scheduled:null
    const earlyOn=nextEarlyPeriod(rule,actual)
    // The scheduled period and actual completion date are independent.
    const periodOn=body.periodOn||(body.early===true?earlyOn:current)||actual
    const recordOn=body.recordOn||periodOn
    if(!ymd(periodOn)||!ymd(recordOn))return bad()
    if(recordOn!==periodOn&&body.status!=='open'&&body.status!=='completed'&&body.status!=='skipped')
      return bad()
    const early=body.early===true&&body.status==='completed'&&actual===jstToday()&&
      earlyOn===periodOn
    const assignment=await db.prepare(`SELECT assignee_user_id,second_assignee_user_id,bonus_points
      FROM routine_occurrence_assignments WHERE household_id=?1 AND routine_id=?2
      AND occurrence_on=?3`).bind(session.household_id,id,periodOn).first()
    const effectiveAssignee=assignment?.assignee_user_id||rule.assigned_to
    const secondary=assignment?.second_assignee_user_id||null
    const canComplete=!effectiveAssignee||session.user_id===effectiveAssignee||
      session.user_id===secondary
    if(body.status==='completed'&&!canComplete)
      return json({error:'assigned_to_other_member'},403)
    if(body.status!=='completed'&&!canComplete&&rule.created_by!==session.user_id)
      return json({error:'forbidden'},403)
    const existing=await db.prepare(`SELECT completed_at,skipped_at FROM routine_marks
      WHERE routine_id=?1 AND occurrence_on=?2`).bind(id,recordOn).first()
    if(recordOn!==periodOn){
      // This key is the actual completion date of a pre-v2 overdue mark.
      // Validate it belongs to the requested scheduled period.
      const older=routineVersions(rule).find(v=>periodOn>=v.validFrom&&
        (!v.validUntil||periodOn<v.validUntil))||rule
      const original=currentRoutinePeriod(older,recordOn)
      if(!existing||original!==periodOn)return json({error:'legacy_mark_mismatch'},409)
    }
    if(periodOn!==current&&!early&&!existing)return json({error:'period_not_current'},409)
    if(early&&current&&current!==periodOn){
      const prior=await db.prepare(`SELECT completed_at,skipped_at FROM routine_marks
        WHERE routine_id=?1 AND occurrence_on=?2`).bind(id,current).first()
      if(!prior?.completed_at&&!prior?.skipped_at)
        return json({error:'resolve_previous_period_first'},409)
    }
    if(body.status==='completed'&&existing?.completed_at)return json({ok:true,unchanged:true})
    if(body.status==='skipped'&&existing?.skipped_at)return json({ok:true,unchanged:true})
    if(body.status==='open'&&!existing)return json({ok:true,unchanged:true})
    if(early&&!existing){
      const begin=new Date(actual+'T00:00:00+09:00').toISOString()
      const finish=new Date(addDays(actual,1)+'T00:00:00+09:00').toISOString()
      const completedToday=await db.prepare(`SELECT 1 FROM routine_marks
        WHERE routine_id=?1 AND completed_at>=?2 AND completed_at<?3 LIMIT 1`)
        .bind(id,begin,finish).first()
      if(completedToday)return json({error:'already_completed_today'},409)
    }
    const stamp=iso()
    // API date is the actual local completion date, including deterministic
    // time-travel test requests. Normal app requests always use today.
    const completedStamp=actual===jstToday()?stamp:new Date(actual+'T12:00:00+09:00').toISOString()
    const statements=[db.prepare(`INSERT INTO routine_marks
      (routine_id,occurrence_on,completed_at,completed_by,skipped_at)
      VALUES(?1,?2,?3,?4,?5)
      ON CONFLICT(routine_id,occurrence_on) DO UPDATE SET
        completed_at=excluded.completed_at,completed_by=excluded.completed_by,
        skipped_at=excluded.skipped_at
      WHERE excluded.completed_at IS NULL OR routine_marks.completed_at IS NULL`)
      .bind(id,recordOn,body.status==='completed'?completedStamp:null,
        body.status==='completed'?session.user_id:null,
        body.status==='skipped'?stamp:null)]
    if(body.status==='skipped'){
      // Skip earns no base or extra points and releases reserved bonus.
      statements.push(db.prepare(`DELETE FROM routine_occurrence_assignments
        WHERE household_id=?1 AND routine_id=?2 AND occurrence_on=?3`)
        .bind(session.household_id,id,periodOn))
    }
    if(body.status==='completed'&&rule.subject_profile_id&&rule.health_record_type){
      statements.push(db.prepare(`INSERT INTO pet_health_records
        (id,household_id,profile_id,created_by,visibility,record_type,event_on,note,
         source_routine_id,source_occurrence_on)
        SELECT ?1,?2,p.id,?3,?4,?5,?6,?7,?8,?9
        FROM family_profiles p
        WHERE p.id=?10 AND p.household_id=?2 AND p.type='pet' AND p.archived_at IS NULL
        ON CONFLICT(source_routine_id,source_occurrence_on)
        DO UPDATE SET deleted_at=NULL,event_on=excluded.event_on,
          note=excluded.note,record_type=excluded.record_type`)
        .bind(crypto.randomUUID(),session.household_id,session.user_id,rule.visibility,
          rule.health_record_type,actual,rule.title,id,recordOn,rule.subject_profile_id))
    }else if(body.status!=='completed'){
      statements.push(db.prepare(`UPDATE pet_health_records SET deleted_at=CURRENT_TIMESTAMP
        WHERE household_id=?1 AND source_routine_id=?2 AND source_occurrence_on=?3
          AND deleted_at IS NULL`).bind(session.household_id,id,recordOn))
    }
    if(isCompletionInterval(rule)){
      const config=JSON.parse(rule.repeat_config||'{}')
      if(body.status==='completed'||body.status==='skipped'){
        statements.push(db.prepare(`UPDATE routines SET next_due_on=?1,updated_at=?2
          WHERE id=?3 AND household_id=?4`)
          .bind(addDays(actual,config.days),stamp,id,session.household_id))
      }else if(body.status==='open'){
        statements.push(db.prepare(`UPDATE routines SET next_due_on=COALESCE(
          (SELECT date(MAX(date(COALESCE(m.completed_at,m.skipped_at),'+9 hours')),
            '+'||?3||' days') FROM routine_marks m
            WHERE m.routine_id=?1 AND m.occurrence_on<>?2
              AND (m.completed_at IS NOT NULL OR m.skipped_at IS NOT NULL)),
          ?6),updated_at=?4
          WHERE id=?1 AND household_id=?5`)
          .bind(id,recordOn,config.days,stamp,session.household_id,
            intervalStartsOnAnchor(rule)?rule.anchor_date:addDays(rule.anchor_date,config.days)))
      }
    }
    const results=await db.batch(statements)
    if(body.status==='completed'&&Number(results?.[0]?.meta?.changes||0)>0)
      onComplete?.({kind:'routine',id:rule.id,title:rule.title,
        creatorId:rule.created_by,assigneeId:effectiveAssignee,secondAssigneeId:secondary,
        visibility:rule.visibility,completedAt:stamp,periodOn})
    return json({ok:true,periodOn,completedOn:body.status==='completed'?actual:null})
  }
  if(id&&parts[3]==='confirm'&&table==='shopping_items'&&request.method==='POST'){
    const item=await getObject(db,table,id,session)
    if(!item)return json({error:'not_found'},404)
    if(item.completed_at)return json({ok:true,unchanged:true})
    if(item.assigned_to&&session.user_id!==item.assigned_to&&
       session.user_id!==item.second_assignee_user_id)
      return json({error:'assigned_to_other_member'},403)
    // A confirmed Kakebo expense link is mandatory; this never fabricates a purchase.
    const stamp=iso()
    const done=await db.prepare(`UPDATE shopping_items SET
      completed_at=?1,completed_by=?2
      WHERE id=?3 AND household_id=?4 AND deleted_at IS NULL AND completed_at IS NULL
        AND (assigned_to IS NULL OR ?2 IN (assigned_to,second_assignee_user_id))
        AND EXISTS(SELECT 1 FROM shopping_expense_links
          WHERE shopping_id=?3 AND household_id=?4)`)
      .bind(stamp,session.user_id,id,session.household_id).run()
    if(!Number(done.meta?.changes))return json({error:'verified_receipt_required'},409)
    onComplete?.({kind:'shopping',id,title:item.title,creatorId:item.created_by,
      assigneeId:item.assigned_to,secondAssigneeId:item.second_assignee_user_id,
      visibility:item.visibility,completedAt:stamp})
    return json({ok:true,completed:true})
  }
  if(id&&parts[3]==='toggle'&&table==='shopping_items'&&request.method==='POST'){
    const item=await getObject(db,table,id,session)
    if(!item)return json({error:'not_found'},404)
    const body=await readBody(request)
    if(typeof body?.completed!=='boolean')return bad()
    // Shopping completion is exclusively derived from a verified Kakebo
    // expense. The old checkbox must not create unsupported "purchased" rows.
    if(body.completed)return json({error:'link_ledger_to_complete'},409)
    if(item.ledger_entry_id)return json({error:'unlink_ledger_to_reopen'},409)
    // Legacy manual checkmarks can still be cleared safely without losing
    // any genuine ledger reference; do not allow new manual completions.
    await db.prepare(`UPDATE shopping_items SET completed_at=NULL,completed_by=NULL
      WHERE id=?1 AND household_id=?2 AND (visibility='household' OR created_by=?3)
        AND ledger_entry_id IS NULL`)
      .bind(id,session.household_id,session.user_id).run()
    return json({ok:true})
  }
  if(!id&&request.method==='GET'){
    const filters=listFilters(request.url)
    if(filters?.invalid)return bad()
    if(filters){
      if(table==='routines'&&filters.scope==='active'&&
        new URL(request.url).searchParams.get('order')==='due'){
        // A recurring rule's next occurrence is computed from its recurrence and
        // completion marks, so sorting by created_at would not reflect urgency.
        // Reuse one bounded rule query and one batched mark lookup, with no writes.
        const {results}=await db.prepare(`SELECT * FROM routines
          WHERE household_id=?1 AND deleted_at IS NULL AND enabled=1
            AND (visibility='household' OR created_by=?2)
          ORDER BY created_at DESC LIMIT 250`)
          .bind(session.household_id,session.user_id).all()
        const ordered=sortPlanTasks(await enrichRoutineList(db,results||[]),[],'active')
          .map(entry=>entry.item)
        const after=filters.cursor?ordered.filter(row=>{
          const due=taskUrgencyKey('routine',row,'active')
          return due>filters.cursor.date||(due===filters.cursor.date&&row.id>filters.cursor.id)
        }):ordered
        const items=after.slice(0,filters.limit),last=items.at(-1)
        return json({items,nextCursor:after.length>filters.limit&&last?
          taskUrgencyKey('routine',last,'active')+'|'+last.id:null})
      }
      const page=await listPage(db,table,session,filters)
      if(table==='routines'&&filters.scope==='active')
        page.items=await enrichRoutineList(db,page.items)
      if(table==='wishes'&&page.items.length){
        // A wish and its linked savings goal can live in opposite status tabs
        // or on different five-row pages. Resolve associations independently
        // of the currently loaded goals list, respecting both visibility ACLs.
        const placeholders=page.items.map((_,i)=>'?'+(i+3)).join(',')
        const {results:related}=await db.prepare(`SELECT * FROM goals
          WHERE household_id=?1 AND deleted_at IS NULL
            AND (visibility='household' OR created_by=?2)
            AND wish_id IN (${placeholders})
          ORDER BY created_at DESC LIMIT 150`)
          .bind(session.household_id,session.user_id,...page.items.map(w=>w.id)).all()
        const byWish=new Map()
        for(const goal of related||[])if(!byWish.has(goal.wish_id))byWish.set(goal.wish_id,goal)
        page.items=page.items.map(w=>({...w,linkedGoal:byWish.get(w.id)||null}))
      }
      return json(page)
    }
    const items=await view(db,table,session)
    return json({items:table==='routines'?
      await enrichRoutineList(db,items.filter(x=>x.enabled!==0)):items})
  }
  if(!id&&request.method==='POST'){
    const b=await readBody(request)
    const vals=normalized(table,b,session)
    if(!vals||!await validLinks(db,table,vals,session,visibilityOf(b,session)))return bad()
    if(table==='routines'&&vals[4]&&vals[4]!==session.user_id)
      return json({error:'assign_recurring_occurrence_instead'},400)
    if(table==='wishes'&&b.status==='completed')
      return json({error:'complete_wish_via_verified_action'},409)
    const spec=catalog[table].columns
    const columns=['id','household_id','created_by','visibility',...spec]
    const query='INSERT INTO '+table+' ('+columns.join(',')+') VALUES('+columns.map((_,i)=>'?'+(i+1)).join(',')+')'
    const id=crypto.randomUUID(),visibility=visibilityOf(b,session)
    if(table==='wishes'&&b.createSavingsGoal===true){
      // Create both records atomically using the existing goals.wish_id link.
      if(!Number.isSafeInteger(b.estimatedAmount)||b.estimatedAmount<=0||
         b.estimatedAmount>100000000000||(b.goalTargetOn&&!ymd(b.goalTargetOn))||
         (b.goalStartOn&&!ymd(b.goalStartOn))||
         (b.goalStartOn&&b.goalTargetOn&&b.goalStartOn>b.goalTargetOn))return bad()
      const goalId=crypto.randomUUID()
      await db.batch([
        db.prepare(query).bind(id,session.household_id,session.user_id,visibility,...vals),
        db.prepare("INSERT INTO goals (id,household_id,created_by,visibility,title,target_amount,reserved_amount,currency,target_on,wish_id,goal_mode,start_on) VALUES(?1,?2,?3,?4,?5,?6,0,?7,?8,?9,'once',?10)")
          .bind(goalId,session.household_id,session.user_id,visibility,
            trim(b.title+' · 储值计划',150),b.estimatedAmount,b.currency||'JPY',
            b.goalTargetOn||b.targetOn||null,id,b.goalStartOn||new Date(Date.now()+9*3600000).toISOString().slice(0,10))
      ])
      return json({ok:true,id,goalId},201)
    }
    await db.prepare(query).bind(id,session.household_id,session.user_id,visibility,...vals).run()
    return json({ok:true,id},201)
  }
  if(id&&!hexId(id))return bad()
  if(table==='routines'&&id&&parts[3]==='period'&&request.method==='GET'){
    const rule=await getObject(db,table,id,session)
    if(!rule)return json({error:'not_found'},404)
    return routinePeriodDetail(db,rule,new URL(request.url).searchParams.get('on')||'',session)
  }
  // Exact one-record lookup is used only when a Today item opens its plan
  // beyond the first five list rows. Keep visibility/household checks in SQL.
  if(id&&request.method==='GET'){
    const item=await getObject(db,table,id,session)
    if(!item)return json({error:'not_found'},404)
    if(table==='wishes'){
      const {results}=await db.prepare(`SELECT * FROM goals WHERE household_id=?1 AND deleted_at IS NULL AND wish_id=?2
        AND (visibility='household' OR created_by=?3) LIMIT 20`)
        .bind(session.household_id,id,session.user_id).all()
      return json({item,linkedGoals:results||[]})
    }
    if(table==='goals'){
      const {results}=await db.prepare(`SELECT period_key FROM plan_completion_marks
        WHERE household_id=?1 AND plan_type='goal' AND plan_id=?2 LIMIT 120`)
        .bind(session.household_id,id).all()
      return json({item,completedPeriods:(results||[]).map(r=>r.period_key)})
    }
    return json({item})
  }
  if(id && request.method==='PATCH'){
    const current=await getObject(db,table,id,session)
    if(!current)return json({error:'not_found'},404)
    if(current.created_by!==session.user_id)return json({error:'forbidden'},403)
    const b=await readBody(request)
    if(table==='wishes'&&b){
      // Legacy clients may omit reminder settings; editing the title must not disable them.
      b.remindEnabled??=current.remind_enabled===1
      b.remindAdvanceDays??=current.remind_advance_days??0
    }
    const vals=normalized(table,b,session)
    if(!vals||!await validLinks(db,table,vals,session,visibilityOf(b,session)))return bad()
    if(table==='shopping_items'&&current.completed_at&&
       (vals[3]!==current.assigned_to||vals[4]!==current.second_assignee_user_id))
      return json({error:'completed_assignment_locked'},409)
    if(table==='routines'&&vals[4]&&vals[4]!==session.user_id&&
      vals[4]!==current.assigned_to)
      return json({error:'assign_recurring_occurrence_instead'},400)
    if(table==='wishes'&&b.status==='completed'&&current.status!=='completed')
      return json({error:'complete_wish_via_verified_action'},409)
    // Updated-at CAS where supported, column snapshot CAS on original tables
    // without updated_at. No migrations or additional D1 reads required.
    const revisioned=['routines','anniversaries','wishes','goals'].includes(table)
    const snapshotColumns=table==='shopping_items'?
      ['title','quantity','due_on','completed_at','ledger_entry_id','assigned_to','second_assignee_user_id']:
      table==='memories'?['title','story','happened_on','visibility','linked_type','linked_id']:[]
    if(revisioned&&b.expectedUpdatedAt&&b.expectedUpdatedAt!==current.updated_at)
      return json({error:'plan_edit_conflict',currentUpdatedAt:current.updated_at},409)
    if(snapshotColumns.length&&b.expectedSnapshot!==undefined&&
       b.expectedSnapshot!==JSON.stringify(snapshotColumns.map(c=>current[c]??null)))
      return json({error:'plan_edit_conflict'},409)
    let resetDue=false,nextDueValue=null
    if(table==='routines'){
      let oldConfig={},nextConfig={}
      try{oldConfig=JSON.parse(current.repeat_config||'{}')}catch{}
      try{nextConfig=JSON.parse(vals[2]||'{}')}catch{}
      const {_history,_effectiveFrom,...oldRuleConfig}=oldConfig
      const comparable=(type,c)=>type==='weekly'?
        {weekdays:c.weekdays,excludeJapaneseHolidays:c.excludeJapaneseHolidays===true}:
        type==='monthly'?(c.mode==='weekday'?
          {mode:'weekday',weekday:c.weekday,weekNumbers:c.weekNumbers}:
          {days:[...(Array.isArray(c.days)?c.days:[c.day])].sort((a,b)=>a-b)}):
        type==='interval'?{days:c.days,anchor:c.anchor||'fixed',startOnAnchor:c.startOnAnchor}:{}
      const configChanged=JSON.stringify(comparable(vals[1],nextConfig))!==
        JSON.stringify(comparable(current.repeat_type,oldRuleConfig))
      const changed=vals[0]!==current.title||vals[1]!==current.repeat_type||
        vals[3]!==current.anchor_date||configChanged||
        vals[5]!==current.subject_profile_id||vals[6]!==current.health_record_type||
        visibilityOf(b,session)!==current.visibility
      const scheduleChanged=vals[1]!==current.repeat_type||
        vals[3]!==current.anchor_date||configChanged
      if(changed){
        const day=jstToday(),start=oldConfig._effectiveFrom||current.anchor_date
        const previous=Array.isArray(oldConfig._history)?oldConfig._history.slice(-39):[]
        if(start<day)previous.push({
          from:start,until:day,title:current.title,repeatType:current.repeat_type,
          repeatConfig:oldRuleConfig,anchorDate:current.anchor_date,nextDueOn:current.next_due_on,
          subjectProfileId:current.subject_profile_id,healthRecordType:current.health_record_type,
          visibility:current.visibility
        })
        nextConfig._history=previous
        nextConfig._effectiveFrom=day
      }else{
        if(Array.isArray(oldConfig._history))nextConfig._history=oldConfig._history
        if(oldConfig._effectiveFrom)nextConfig._effectiveFrom=oldConfig._effectiveFrom
      }
      vals[2]=JSON.stringify(nextConfig)
      if(scheduleChanged){
        resetDue=true
        nextDueValue=vals[1]==='interval'&&nextConfig.anchor==='completion'?
          (intervalStartsOnAnchor({...current,anchor_date:vals[3],repeat_config:nextConfig})?
            vals[3]:addDays(vals[3],Number(nextConfig.days))):null
      }
    }
    const fields=['visibility',...catalog[table].columns,...(resetDue?['next_due_on']:[]),
      ...(revisioned?['updated_at']:[])]
    const args=[visibilityOf(b,session),...vals,...(resetDue?[nextDueValue]:[]),
      ...(revisioned?[iso()]:[]),id,session.household_id,session.user_id]
    let condition=''
    if(revisioned){
      condition=' AND updated_at=?'+(args.length+1)
      args.push(current.updated_at)
    }else for(const col of snapshotColumns){
      condition+=' AND '+col+' IS ?'+(args.length+1)
      args.push(current[col]??null)
    }
    const sql='UPDATE '+table+' SET '+fields.map((c,i)=>c+'=?'+(i+1)).join(',')+
      ' WHERE id=?'+(fields.length+1)+' AND household_id=?'+(fields.length+2)+' AND created_by=?'+(fields.length+3)+condition
    const written=await db.prepare(sql).bind(...args).run()
    if(!written.meta?.changes)return json({error:'plan_edit_conflict'},409)
    return json({ok:true})
  }
  if(id&&request.method==='DELETE'){
    const current=await getObject(db,table,id,session)
    if(!current)return json({error:'not_found'},404)
    if(current.created_by!==session.user_id)return json({error:'forbidden'},403)
    // Preserve all linked finances, media, milestones and histories.
    const result=await db.prepare('UPDATE '+table+
      ' SET deleted_at=?1 WHERE id=?2 AND household_id=?3 AND created_by=?4 AND deleted_at IS NULL')
      .bind(iso(),id,session.household_id,session.user_id).run()
    return result.meta?.changes?json({ok:true,trashed:true}):json({error:'not_found'},404)
  }
  return json({error:'not_found'},404)
}
