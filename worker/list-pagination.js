// Date/status filtering and keyset paging: one bounded D1 query per request.
const datePattern=/^\d{4}-\d{2}-\d{2}$/
const uuidPattern=/^[0-9a-f-]{36}$/i

export function listFilters(url) {
  const p=new URL(url).searchParams
  if(!['limit','scope','year','month','cursor'].some(key=>p.has(key)))return null
  const limit=p.has('limit')?Number(p.get('limit')):5
  const scope=p.get('scope')||'all'
  const year=p.get('year')||''
  const month=p.get('month')||''
  const raw=p.get('cursor')||''
  if(!Number.isInteger(limit)||limit<1||limit>30||
    !['all','active','history','unscheduled'].includes(scope)||
    (year&&!/^(19|20|21)\d{2}$/.test(year))||
    (month&&!/^(0?[1-9]|1[0-2])$/.test(month))||
    (month&&!year)||raw.length>120)return {invalid:true}
  let cursor=null
  if(raw) {
    const split=raw.lastIndexOf('|')
    const date=raw.slice(0,split),id=raw.slice(split+1)
    if(split<10||!datePattern.test(date.slice(0,10))||
      date.length>36||!uuidPattern.test(id))return {invalid:true}
    cursor={date,id}
  }
  return {limit,scope,year,month:month?month.padStart(2,'0'):'',cursor}
}

export function monthWindow(year,month){
  if(!year)return null
  const start=year+'-'+(month||'01')+'-01'
  const end=month
    ?new Date(Date.UTC(Number(year),Number(month),1)).toISOString().slice(0,10)
    :(Number(year)+1)+'-01-01'
  return {start,end}
}

export async function listPage(db,table,session,filters,options={}){
  const sortColumn=options.sortColumn||(table==='anniversaries'?'event_date':
    table==='memories'?'happened_on':
    table==='shopping_items'&&filters.scope==='history'?'completed_at':
    filters.scope==='history'&&['wishes','goals','routines'].includes(table)?'updated_at':'created_at')
  // SQL identifiers/expressions are selected server-side, never from request parameters.
  if(!['created_at','completed_at','happened_on','event_on','start_on','event_date','updated_at'].includes(sortColumn))
    throw Error('invalid_sort_column')
  const ascending=filters.scope==='active'&&
    ['shopping_items','wishes','goals','anniversaries'].includes(table)
  const tokyoDate="date('now','+9 hours')"
  const monthlyEnd="date('now','+9 hours','start of month','+1 month','-1 day')"
  const yearlyEnd="date('now','+9 hours','start of year','+1 year','-1 day')"
  const goalDue=`CASE WHEN goal_mode='monthly' THEN
      CASE WHEN start_on>${tokyoDate} THEN start_on
        ELSE MIN(COALESCE(target_on,'9999-12-31'),${monthlyEnd}) END
    WHEN goal_mode='yearly' THEN
      CASE WHEN start_on>${tokyoDate} THEN start_on
        ELSE MIN(COALESCE(target_on,'9999-12-31'),${yearlyEnd}) END
    ELSE COALESCE(target_on,'9999-12-31') END`
  const orderKey=ascending?table==='shopping_items'?"COALESCE(due_on,'9999-12-31')":
    table==='wishes'?"COALESCE(target_on,'9999-12-31')":
    table==='goals'?goalDue:
    // One-off anniversaries use their event date; recurring future occurrences
    // are served by the /anniversaries/upcoming endpoint.
    "COALESCE(event_date,'9999-12-31')":sortColumn
  const clauses=["household_id=?1","deleted_at IS NULL","(visibility='household' OR created_by=?2)"]
  const args=[session.household_id,session.user_id]
  const push=(clause,...vals)=>{
    const start=args.length+1
    args.push(...vals)
    clauses.push(clause.replace(/\{(\d+)\}/g,(_,i)=>'?'+(start+Number(i))))
  }
  const localDate=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
  if(table==='shopping_items'){
    // Completion belongs to history immediately, even when the receipt was linked today.
    // Never defer the status transition until the next JST calendar day.
    if(filters.scope==='active')clauses.push('completed_at IS NULL')
    if(filters.scope==='history')clauses.push('completed_at IS NOT NULL')
  }else if(table==='anniversaries'){
    // Recurring annual/monthly events always have a future occurrence.
    // Only one-off events in the past belong to this archive.
    if(filters.scope==='history')push("(repeat_mode='once' AND event_date<{0})",localDate)
    if(filters.scope==='active')push("(repeat_mode!='once' OR event_date>={0})",localDate)
  }else if(table==='wishes'){
    if(filters.scope==='active')clauses.push("status NOT IN ('completed','cancelled')")
    if(filters.scope==='history')clauses.push("status IN ('completed','cancelled')")
  }else if(table==='goals'){
    // One-time goals archive when confirmed; recurring goals archive after
    // their final target date, while each period remains available by key.
    const doneMark="EXISTS (SELECT 1 FROM plan_completion_marks pcm WHERE "+
      "pcm.household_id=goals.household_id AND pcm.plan_type='goal' "+
      "AND pcm.plan_id=goals.id AND pcm.period_key='once')"
    if(filters.scope==='active')
      clauses.push("((goal_mode='once' AND reserved_amount<target_amount AND NOT ("+doneMark+")) OR "+
        "(goal_mode!='once' AND (target_on IS NULL OR target_on>=?"+(args.length+1)+")))")
    if(filters.scope==='history')
      clauses.push("((goal_mode='once' AND (reserved_amount>=target_amount OR "+doneMark+")) OR "+
        "(goal_mode!='once' AND target_on IS NOT NULL AND target_on<?"+(args.length+1)+"))")
    if(filters.scope==='active'||filters.scope==='history')args.push(localDate)
  }else if(table==='routines'){
    if(filters.scope==='active')clauses.push('enabled=1')
    if(filters.scope==='history')clauses.push('enabled=0')
  }
  const window=monthWindow(filters.year,filters.month)
  if(window)push(sortColumn+'>={0} AND '+sortColumn+'<{1}',window.start,window.end)
  if(filters.cursor)
    push('('+orderKey+(ascending?'>':'<')+'{0} OR ('+
      orderKey+'={1} AND id'+(ascending?'>':'<')+'{2}))',
      filters.cursor.date,filters.cursor.date,filters.cursor.id)
  const sql='SELECT *'+(ascending?', '+orderKey+' AS urgency_sort_key':'')+
    ' FROM '+table+' WHERE '+clauses.join(' AND ')+
    ' ORDER BY '+orderKey+(ascending?' ASC,id ASC':' DESC,id DESC')+
    ' LIMIT ?'+(args.length+1)
  const {results}=await db.prepare(sql).bind(...args,filters.limit+1).all()
  const rows=results||[]
  const hasMore=rows.length>filters.limit
  const items=rows.slice(0,filters.limit)
  const last=items[items.length-1]
  const nextCursor=hasMore&&last?
    (ascending?last.urgency_sort_key:last[sortColumn])+'|'+last.id:null
  return {items,nextCursor}
}
