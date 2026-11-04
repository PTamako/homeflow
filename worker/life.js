import {iso,json,readBody,sha256,shortText,validDate} from './security.js'
import {BIRTHDAY_PROFILES_SQL,mergeProfileBirthdays} from './birthdays.js'
import {listFilters,listPage} from './list-pagination.js'
import {dueOn,nextAnniversary,pendingCarryover,validateRule,canCompleteEarly,addDays} from './recurrence.js'

const catalog={
  anniversaries:{columns:['title','event_date','repeat_mode','advance_days_json','note','subject_profile_id']},
  routines:{columns:['title','repeat_type','repeat_config','anchor_date','assigned_to','subject_profile_id','health_record_type','remind_enabled']},
  wishes:{columns:['title','wish_type','status','estimated_amount','currency','note','target_on']},
  goals:{columns:['title','target_amount','reserved_amount','currency','target_on','wish_id','goal_mode','start_on']},
  shopping_items:{columns:['title','quantity','due_on']},
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
      const config=b.repeatType==='workday'?{weekdays:[1,2,3,4,5],excludeJapaneseHolidays:true}:(b.repeatConfig||{})
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
      return [title,b.wishType,b.status||'wished',b.estimatedAmount||0,b.currency||'JPY',trim(b.note,2000),b.targetOn||null]
    case 'goals':
      if(!Number.isSafeInteger(b.targetAmount)||b.targetAmount<=0||b.targetAmount>100000000000||!validMoney(b.reservedAmount??0)||!JPY(b.currency||'JPY')||
        (b.targetOn&&!ymd(b.targetOn))||(b.wishId&&!hexId(b.wishId)))return null
      const goalMode=b.goalMode||'once',startOn=b.startOn||null
      if(!['once','monthly','yearly'].includes(goalMode)||
         (startOn&&!ymd(startOn))||(goalMode!=='once'&&!startOn)||
         (startOn&&b.targetOn&&startOn>b.targetOn))return null
      return [title,b.targetAmount,b.reservedAmount||0,b.currency||'JPY',
        b.targetOn||null,b.wishId||null,goalMode,startOn]
    case 'shopping_items':
      if(!Number.isSafeInteger(b.quantity)||b.quantity<1||b.quantity>9999)return null
      if(b.dueOn&&!ymd(b.dueOn))return null
      return [title,b.quantity,b.dueOn||null]
    case 'memories':
      if(!ymd(b.happenedOn))return null
      if(b.linkedType&&!['trip','wish','profile','anniversary'].includes(b.linkedType))return null
      if(b.linkedId&&!hexId(b.linkedId))return null
      return [title,trim(b.story,8000),b.happenedOn,b.linkedType||null,b.linkedId||null]
    default:return null
  }
}
async function validLinks(db,table,data,session){
  const hid=session.household_id
  if(table==='anniversaries'&&data[5]){
    return !!await db.prepare('SELECT 1 FROM family_profiles WHERE household_id=?1 AND id=?2 AND archived_at IS NULL').bind(hid,data[5]).first()
  }
  if(table==='routines'){
    if(data[4] && !await db.prepare('SELECT 1 FROM household_members WHERE household_id=?1 AND user_id=?2').bind(hid,data[4]).first())return false
    if(data[5]){
      const profile=await db.prepare('SELECT type FROM family_profiles WHERE household_id=?1 AND id=?2 AND archived_at IS NULL')
        .bind(hid,data[5]).first()
      if(!profile || (data[6]&&profile.type!=='pet'))return false
    }else if(data[6])return false
  }
  if(table==='goals'&&data[5]){
    const wish=await db.prepare('SELECT created_by,visibility FROM wishes WHERE id=?1 AND household_id=?2').bind(data[5],hid).first()
    if(!wish || (wish.visibility==='private'&&wish.created_by!==session.user_id))return false
  }
  if(table==='memories'&&data[4]){
    const tab={trip:'trips',wish:'wishes',profile:'family_profiles',anniversary:'anniversaries'}[data[3]]
    if(!tab)return false
    const isProfile=tab==='family_profiles'
    const sql=isProfile
      ? 'SELECT 1 FROM family_profiles WHERE id=?1 AND household_id=?2 AND archived_at IS NULL'
      : "SELECT 1 FROM "+tab+" WHERE id=?1 AND household_id=?2 AND (visibility='household' OR created_by=?3)"
    const item=await db.prepare(sql).bind(...(isProfile?[data[4],hid]:[data[4],hid,session.user_id])).first()
    if(!item)return false
  }
  return true
}
async function view(db,table,session,detailId=null){
  const name=table==='shopping_items'?'shopping_items':table
  const {results}=await db.prepare('SELECT * FROM '+name+' WHERE household_id=?1 AND (visibility=?2 OR created_by=?3) '+
    (detailId?'AND id=?4 ':'')+
    (table==='shopping_items'?'ORDER BY CASE WHEN completed_at IS NULL THEN 0 ELSE 1 END,created_at DESC LIMIT 200':'ORDER BY created_at DESC LIMIT 200'))
    .bind(...(detailId?[session.household_id,'household',session.user_id,detailId]:[session.household_id,'household',session.user_id])).all()
  return results||[]
}
async function getObject(db,table,id,session){
  return db.prepare('SELECT * FROM '+table+
    " WHERE id=?1 AND household_id=?2 AND (visibility='household' OR created_by=?3)")
    .bind(id,session.household_id,session.user_id).first()
}
export async function lifeRoute(request,db,path,session){
  const parts=path.split('/').filter(Boolean),kind=parts[1],table=plural[kind]
  if(!table||!catalog[table])return json({error:'not_found'},404)
  const id=parts[2]
  if(table==='anniversaries'&&id==='upcoming'&&request.method==='GET'){
    const now=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
    // One D1 batch: existing custom anniversaries + live family profile birthdays.
    // No second saved birthday record, so editing a profile cannot leave stale reminders.
    const [events,profiles]=await db.batch([
      db.prepare("SELECT * FROM anniversaries WHERE household_id=?1 AND (visibility='household' OR created_by=?2) ORDER BY created_at DESC LIMIT 200")
        .bind(session.household_id,session.user_id),
      db.prepare(BIRTHDAY_PROFILES_SQL).bind(session.household_id)
    ])
    return json({items:mergeProfileBirthdays(events.results,profiles.results)
      .map(e=>({...e,nextOn:nextAnniversary(e.event_date,e.repeat_mode,now)}))
      .filter(e=>e.nextOn).sort((a,b)=>a.nextOn.localeCompare(b.nextOn))})
  }
  if(table==='routines'&&id==='today'&&request.method==='GET'){
    const date=new URL(request.url).searchParams.get('date')||new Date(Date.now()+9*3600000).toISOString().slice(0,10)
    if(!ymd(date))return bad()
    const [all,marks]=await db.batch([
      db.prepare(`SELECT r.*,
        (SELECT m.occurrence_on FROM routine_marks m
         WHERE m.routine_id=r.id AND m.occurrence_on<=?3
           AND (m.completed_at IS NOT NULL OR m.skipped_at IS NOT NULL)
         ORDER BY m.occurrence_on DESC LIMIT 1) AS last_resolved_on
        FROM routines r WHERE r.household_id=?1 AND r.enabled=1
          AND (r.visibility='household' OR r.created_by=?2) LIMIT 250`)
        .bind(session.household_id,session.user_id,date),
      db.prepare(`SELECT m.routine_id,m.occurrence_on,m.completed_at,m.skipped_at
        FROM routine_marks m JOIN routines r ON r.id=m.routine_id
        WHERE r.household_id=?1 AND m.occurrence_on=?2
          AND (r.visibility='household' OR r.created_by=?3)`)
        .bind(session.household_id,date,session.user_id)
    ])
    const saved=new Map((marks.results||[]).map(x=>[x.routine_id,x]))
    // One row per routine: today is a fresh occurrence; prior completed marks
    // never leak into today. Unfinished earlier due dates can carry forward.
    const items=[]
    for(const r of all.results||[]){
      const due=dueOn(r,date),mark=saved.get(r.id)||null
      const carriedFrom=due||mark?null:pendingCarryover(r,date,r.last_resolved_on)
      if(due||mark||carriedFrom)items.push({...r,mark,carriedFrom})
    }
    return json({date,items})
  }
  if(id&&parts[3]==='mark'&&table==='routines'&&request.method==='POST'){
    const body=await readBody(request)
    if(!ymd(body?.date)||!['completed','skipped','open'].includes(body?.status))return bad()
    const rule=await getObject(db,table,id,session)
    if(!rule)return json({error:'not_found'},404)
    // An early completion is allowed only for actual-completion-anchored
    // intervals, on the current JST date. It is not an early due occurrence.
    const currentJstDay=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
    const early=body.early===true&&body.status==='completed'&&body.date===currentJstDay&&canCompleteEarly(rule,body.date)
    if(!dueOn(rule,body.date)&&!early){
      const [existing,lastResolved]=await db.batch([
        db.prepare('SELECT completed_at,skipped_at FROM routine_marks WHERE routine_id=?1 AND occurrence_on=?2')
          .bind(id,body.date),
        db.prepare(`SELECT occurrence_on AS last_resolved_on FROM routine_marks
          WHERE routine_id=?1 AND occurrence_on<=?2
          AND (completed_at IS NOT NULL OR skipped_at IS NOT NULL)
          ORDER BY occurrence_on DESC LIMIT 1`).bind(id,body.date)
      ])
      if(!(existing.results||[]).length &&
          !pendingCarryover(rule,body.date,lastResolved.results?.[0]?.last_resolved_on||null))
        return json({error:'not_found'},404)
    }
    if(rule.visibility==='private' && rule.created_by!==session.user_id)return json({error:'forbidden'},403)
    const stamp=iso()
    const st=db.prepare(`INSERT INTO routine_marks(routine_id,occurrence_on,completed_at,completed_by,skipped_at)
      VALUES(?1,?2,?3,?4,?5)
      ON CONFLICT(routine_id,occurrence_on) DO UPDATE SET completed_at=excluded.completed_at,
      completed_by=excluded.completed_by,skipped_at=excluded.skipped_at`)
      .bind(id,body.date,body.status==='completed'?stamp:null,body.status==='completed'?session.user_id:null,
        body.status==='skipped'?stamp:null)
    // Completion and its pet-care record are committed together. The unique index
    // keeps repeated requests and multi-device taps from creating duplicate history.
    const statements=[st]
    if(body.status==='completed'&&rule.subject_profile_id&&rule.health_record_type){
      statements.push(db.prepare(`INSERT INTO pet_health_records
        (id,household_id,profile_id,created_by,visibility,record_type,event_on,note,
         source_routine_id,source_occurrence_on)
        SELECT ?1,?2,p.id,?3,?4,?5,?6,?7,?8,?6 FROM family_profiles p
        WHERE p.id=?9 AND p.household_id=?2 AND p.type='pet' AND p.archived_at IS NULL
        ON CONFLICT(source_routine_id,source_occurrence_on)
        DO UPDATE SET deleted_at=NULL`)
        .bind(crypto.randomUUID(),session.household_id,session.user_id,rule.visibility,
          rule.health_record_type,body.date,rule.title,id,rule.subject_profile_id))
    }else if(body.status!=='completed'){
      // Undoing or skipping a day removes only the auto-generated record,
      // never an independent health record entered manually.
      statements.push(db.prepare(`UPDATE pet_health_records SET deleted_at=CURRENT_TIMESTAMP
        WHERE household_id=?1 AND source_routine_id=?2 AND source_occurrence_on=?3
          AND deleted_at IS NULL`).bind(session.household_id,id,body.date))
    }
    let config={}
    try{config=JSON.parse(rule.repeat_config||'{}')}catch{}
    if(rule.repeat_type==='interval' && config.anchor==='completion'){
      if(body.status==='completed'){
        statements.push(db.prepare('UPDATE routines SET next_due_on=?1,updated_at=?2 WHERE id=?3 AND household_id=?4')
          .bind(addDays(body.date,config.days),stamp,id,session.household_id))
      }else if(body.status==='open'){
        // Undo restores the schedule based on the most recent *earlier*
        // completed occurrence, or the original baseline if none exists.
        statements.push(db.prepare(`UPDATE routines SET next_due_on=date(
          COALESCE((SELECT MAX(m.occurrence_on) FROM routine_marks m
            WHERE m.routine_id=?1 AND m.occurrence_on<?2 AND m.completed_at IS NOT NULL),anchor_date),
          '+'||?3||' days'),updated_at=?4 WHERE id=?1 AND household_id=?5`)
          .bind(id,body.date,config.days,stamp,session.household_id))
      }
    }
    if(statements.length>1)await db.batch(statements)
    else await st.run()
    return json({ok:true})
  }
  if(id&&parts[3]==='toggle'&&table==='shopping_items'&&request.method==='POST'){
    const item=await getObject(db,table,id,session)
    if(!item)return json({error:'not_found'},404)
    const body=await readBody(request)
    if(typeof body?.completed!=='boolean')return bad()
    await db.prepare(`UPDATE shopping_items SET completed_at=?1,completed_by=?2,
      ledger_entry_id=CASE WHEN ?1 IS NULL THEN NULL ELSE ledger_entry_id END
      WHERE id=?3 AND household_id=?4 AND (visibility='household' OR created_by=?5)`)
      .bind(body.completed?iso():null,body.completed?session.user_id:null,id,session.household_id,session.user_id).run()
    return json({ok:true})
  }
  if(!id&&request.method==='GET'){
    const filters=listFilters(request.url)
    if(filters?.invalid)return bad()
    if(filters)return json(await listPage(db,table,session,filters))
    const items=await view(db,table,session)
    return json({items:table==='routines'?items.filter(x=>x.enabled!==0):items})
  }
  if(!id&&request.method==='POST'){
    const b=await readBody(request)
    const vals=normalized(table,b,session)
    if(!vals||!await validLinks(db,table,vals,session))return bad()
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
  if(id && request.method==='PATCH'){
    const current=await getObject(db,table,id,session)
    if(!current)return json({error:'not_found'},404)
    if(current.created_by!==session.user_id)return json({error:'forbidden'},403)
    const b=await readBody(request)
    const vals=normalized(table,b,session)
    if(!vals||!await validLinks(db,table,vals,session))return bad()
    // Updated-at CAS where supported, column snapshot CAS on original tables
    // without updated_at. No migrations or additional D1 reads required.
    const revisioned=['routines','anniversaries','wishes','goals'].includes(table)
    const snapshotColumns=table==='shopping_items'?
      ['title','quantity','due_on','completed_at','ledger_entry_id']:
      table==='memories'?['title','story','happened_on','visibility','linked_type','linked_id']:[]
    if(revisioned&&b.expectedUpdatedAt&&b.expectedUpdatedAt!==current.updated_at)
      return json({error:'plan_edit_conflict',currentUpdatedAt:current.updated_at},409)
    if(snapshotColumns.length&&b.expectedSnapshot!==undefined&&
       b.expectedSnapshot!==JSON.stringify(snapshotColumns.map(c=>current[c]??null)))
      return json({error:'plan_edit_conflict'},409)
    const fields=['visibility',...catalog[table].columns,...(revisioned?['updated_at']:[])]
    const args=[visibilityOf(b,session),...vals,...(revisioned?[iso()]:[]),id,session.household_id,session.user_id]
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
    if(table==='routines'){
      // Preserve historical completion marks even after removing the plan.
      await db.prepare('UPDATE routines SET enabled=0,updated_at=?1 WHERE id=?2 AND household_id=?3 AND created_by=?4')
        .bind(iso(),id,session.household_id,session.user_id).run()
      return json({ok:true,archived:true})
    }
    if(table==='wishes'){
      // Keep existing savings and trip records. Removing a wish merely unlinks
      // its optional goal/trip: never silently delete linked financial records.
      await db.batch([
        db.prepare('UPDATE goals SET wish_id=NULL WHERE wish_id=?1 AND household_id=?2').bind(id,session.household_id),
        db.prepare('UPDATE trips SET wish_id=NULL WHERE wish_id=?1 AND household_id=?2').bind(id,session.household_id),
        db.prepare('DELETE FROM wishes WHERE id=?1 AND household_id=?2 AND created_by=?3')
          .bind(id,session.household_id,session.user_id)
      ])
      return json({ok:true,unlinked:true})
    }
    try{
      await db.prepare('DELETE FROM '+table+' WHERE id=?1 AND household_id=?2 AND created_by=?3')
        .bind(id,session.household_id,session.user_id).run()
      return json({ok:true})
    }catch{return json({error:'linked_records_require_unlink'},409)}
  }
  return json({error:'not_found'},404)
}
