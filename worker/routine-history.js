// Compact active snapshots and virtual per-period history. Existing D1 rows
// are authoritative; untouched expired periods are derived, never written.
import {listFilters,monthWindow} from './list-pagination.js'
import {addDays} from './recurrence.js'
import {currentRoutinePeriod,historyCandidates,isClosedRoutinePeriod,jstDate,jstToday,
  nextEarlyPeriod,nextRoutineDue,periodStatus,isCompletionInterval,routineVersions} from './routine-periods.js'
import {json} from './security.js'

const statusOf=mark=>mark?periodStatus(mark):'pending'
const markerKey=(id,on)=>id+'|'+on
const markDate=(m)=>m?.completed_at?jstDate(m.completed_at):''
const weekDayMs=date=>Date.parse(date+'T00:00:00Z')

export async function enrichRoutineList(db,routines,day=jstToday()){
  if(!routines.length)return []
  const ids=routines.map(r=>r.id)
  const current=new Map(routines.map(r=>[r.id,currentRoutinePeriod(r,day)]))
  const early=new Map(routines.map(r=>[r.id,nextEarlyPeriod(r,day)]))
  const dates=[...new Set([...current.values(),...early.values()].filter(Boolean))]
  const conditions=dates.length?('m.occurrence_on IN ('+dates.map(()=>'?').join(',')+') OR '):''
  const start=new Date(day+'T00:00:00+09:00').toISOString()
  const end=new Date(weekDayMs(day)+86400000-9*3600000).toISOString()
  const sql='SELECT m.routine_id,m.occurrence_on,m.completed_at,m.skipped_at FROM routine_marks m WHERE '+
    'm.routine_id IN ('+ids.map(()=>'?').join(',')+') AND ('+conditions+
    '(m.completed_at>=? AND m.completed_at<?)) ORDER BY m.occurrence_on DESC LIMIT 750'
  const {results}=await db.prepare(sql).bind(...ids,...dates,start,end).all()
  const marks=new Map((results||[]).map(m=>[markerKey(m.routine_id,m.occurrence_on),m]))
  return routines.map(r=>{
    const period=current.get(r.id)||null,next=nextRoutineDue(r,day),earlyOn=early.get(r.id)||null
    const mark=period?marks.get(markerKey(r.id,period))||null:null
    const lastToday=(results||[]).find(m=>m.routine_id===r.id&&markDate(m)===day&&m.completed_at)
    const activePending=period&&statusOf(mark)==='pending'
    const earlyMark=earlyOn?marks.get(markerKey(r.id,earlyOn)):null
    const canEarly=!!earlyOn&&!activePending&&!lastToday&&!earlyMark
    const following=earlyOn&&earlyMark?.completed_at?nextRoutineDue(r,addDays(earlyOn,1)):null
    return {...r,currentPeriodOn:period,currentMark:mark,currentStatus:statusOf(mark),
      nextDueOn:activePending?period:(following||earlyOn||next),
      earlyPeriodOn:canEarly?earlyOn:null,
      completedToday:!!lastToday,
      completedTodayMark:lastToday||null}
  })
}

export async function routineHistory(db,request,session){
  const filters=listFilters(request.url)
  if(!filters||filters.invalid||filters.scope==='unscheduled')
    return json({error:'invalid_input'},400)
  const today=jstToday()
  const range=monthWindow(filters.year,filters.month)
  const cursor=filters.cursor
  const upper=range?range.end:addDays(today,1)
  const before=cursor&&addDays(cursor.date,1)<upper?addDays(cursor.date,1):upper
  const {results}=await db.prepare(`SELECT * FROM routines WHERE household_id=?1
    AND (visibility='household' OR created_by=?2)
    ORDER BY created_at DESC LIMIT 250`).bind(session.household_id,session.user_id).all()
  const rules=results||[]
  if(!rules.length)return json({items:[],nextCursor:null})
  const candidates=[]
  const maxPerRule=filters.limit+3
  // Rule revisions live in repeat_config; historical dates remain unchanged
  // after a user edits the frequency, weekday, title, or pet association.
  const versions=rules.flatMap(rule=>routineVersions(rule).filter(v=>
    v.visibility==='household'||rule.created_by===session.user_id))
  for(const rule of versions){
    const stop=rule.validUntil||(rule.enabled===0?jstDate(rule.updated_at):null)||
      (rule.deleted_at?jstDate(rule.deleted_at):null)
    const capped=stop&&stop<before?stop:before
    for(const due of historyCandidates(rule,capped,maxPerRule)){
      if(due>=rule.validFrom&&(!rule.validUntil||due<rule.validUntil))
        candidates.push({rule,due})
    }
    // Only actually completed future occurrences enter the archive.
    if(!cursor){
      const upcoming=nextRoutineDue(rule,today)
      if(upcoming&&upcoming>today&&upcoming>=rule.validFrom&&
        (!rule.validUntil||upcoming<rule.validUntil)&&
        (!range||(upcoming>=range.start&&upcoming<range.end)))
        candidates.push({rule,due:upcoming})
    }
  }
  const dates=[...new Set(candidates.map(c=>c.due))]
  const completionIds=[...new Set(versions.filter(isCompletionInterval).map(r=>r.id))]
  if(!dates.length&&!completionIds.length)return json({items:[],nextCursor:null})
  const dateClause=dates.length?'m.occurrence_on IN ('+dates.map(()=>'?').join(',')+')':'0'
  const completionClause=completionIds.length?
    'm.routine_id IN ('+completionIds.map(()=>'?').join(',')+') AND m.occurrence_on<=?':'0'
  const cutoff=cursor?cursor.date:addDays(today,3651)
  const {results:markRows}=await db.prepare(`SELECT m.routine_id,m.occurrence_on,m.completed_at,m.skipped_at
    FROM routine_marks m JOIN routines r ON r.id=m.routine_id
    WHERE r.household_id=? AND (r.visibility='household' OR r.created_by=?)
      AND (${dateClause} OR (${completionClause}))
    ORDER BY m.occurrence_on DESC LIMIT 1500`)
    .bind(session.household_id,session.user_id,...dates,...completionIds,
      ...(completionIds.length?[cutoff]:[])).all()
  const marks=new Map((markRows||[]).map(m=>[markerKey(m.routine_id,m.occurrence_on),m]))
  // Completion-anchored intervals cannot safely infer old uncompleted cycles.
  // Their real completed/skipped periods are taken directly from marks.
  const byId=new Map(rules.map(r=>[r.id,routineVersions(r)]))
  for(const mark of markRows||[]){
    const matches=byId.get(mark.routine_id)||[]
    const rule=matches.find(v=>mark.occurrence_on>=v.validFrom&&
      (!v.validUntil||mark.occurrence_on<v.validUntil))||matches.at(-1)
    if(rule&&isCompletionInterval(rule)&&
      (rule.visibility==='household'||rule.created_by===session.user_id)&&
      !candidates.some(c=>c.rule.id===rule.id&&c.due===mark.occurrence_on))
      candidates.push({rule,due:mark.occurrence_on})
  }
  const rows=[]
  for(const {rule,due} of candidates){
    if((range&&(due<range.start||due>=range.end))||
      (cursor&&(due>cursor.date||(due===cursor.date&&rule.id>=cursor.id))))continue
    const mark=marks.get(markerKey(rule.id,due))
    const state=statusOf(mark)
    const pastVersion=!!rule.validUntil&&rule.validUntil<=today&&due<rule.validUntil
    if(state==='pending'&&!pastVersion&&!isClosedRoutinePeriod(rule,due,today))continue
    rows.push({id:rule.id,periodOn:due,title:rule.title,repeat_type:rule.repeat_type,
      repeat_config:rule.repeat_config,subject_profile_id:rule.subject_profile_id,
      health_record_type:rule.health_record_type,visibility:rule.visibility,
      created_by:rule.created_by,status:state==='pending'?'missed':state,
      completedAt:mark?.completed_at||null,completedOn:markDate(mark),
      skippedAt:mark?.skipped_at||null})
  }
  rows.sort((a,b)=>b.periodOn.localeCompare(a.periodOn)||b.id.localeCompare(a.id))
  const seen=new Set(),unique=rows.filter(row=>{
    const key=markerKey(row.id,row.periodOn)
    if(seen.has(key))return false
    seen.add(key);return true
  })
  const items=unique.slice(0,filters.limit),last=items.at(-1)
  return json({items,nextCursor:unique.length>filters.limit&&last?last.periodOn+'|'+last.id:null})
}

export async function routinePeriodDetail(db,rule,on,session){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(on))return json({error:'invalid_input'},400)
  const variants=routineVersions(rule)
  const version=variants.find(v=>on>=v.validFrom&&(!v.validUntil||on<v.validUntil))||
    variants.at(-1)
  if(!version||(version.visibility==='private'&&rule.created_by!==session.user_id))
    return json({error:'not_found'},404)
  const mark=await db.prepare(`SELECT occurrence_on,completed_at,skipped_at FROM routine_marks
    WHERE routine_id=?1 AND occurrence_on=?2`).bind(rule.id,on).first()
  const state=statusOf(mark)
  const closed=!!version.validUntil&&version.validUntil<=jstToday()&&on<version.validUntil
  if(state==='pending'&&!closed&&!isClosedRoutinePeriod(version,on,jstToday()))
    return json({error:'period_not_archived'},409)
  return json({item:{id:rule.id,periodOn:on,title:version.title,
    repeat_type:version.repeat_type,repeat_config:version.repeat_config,
    subject_profile_id:version.subject_profile_id,health_record_type:version.health_record_type,
    status:state==='pending'?'missed':state,completedAt:mark?.completed_at||null,
    completedOn:markDate(mark),skippedAt:mark?.skipped_at||null,created_by:rule.created_by}})
}
