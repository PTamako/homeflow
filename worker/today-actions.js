import {json,readBody,validDate} from './security.js'

// Each occurrence has one immutable decision. An occurrence moves only when
// the user deliberately selects a new date; rules/financial targets stay intact.
const hex=/^[a-f0-9-]{36}$/i
const kinds={task:{table:'tasks',date:'due_on',owner:'creator_user_id'},
 shopping:{table:'shopping_items',date:'due_on',owner:'created_by'},
 wish:{table:'wishes',date:'target_on',owner:'created_by'},
 goal:{table:'goals',date:'target_on',owner:'created_by'},
 trip:{table:'trips',date:'start_on',owner:'created_by'}}
const jstToday=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10)
const dateOk=date=>typeof date==='string'&&date.length===10&&validDate(date)

// Read one bounded date window shared by the Today UI and 06:00 notifications.
// Trace predecessors of a postponed target in the same bounded D1 query.
// This correctly handles multiple postponements without a whole-history scan.
export async function actionWindow(db,household,date,end=date){
 const {results}=await db.prepare(`WITH RECURSIVE chain(
   kind,source_id,original_on,action,postponed_to
 ) AS (
   SELECT kind,source_id,original_on,action,postponed_to
   FROM today_plan_actions WHERE household_id=?1
     AND ((original_on>=?2 AND original_on<=?3) OR
          (postponed_to>=?2 AND postponed_to<=?3))
   UNION
   SELECT prev.kind,prev.source_id,prev.original_on,prev.action,
          prev.postponed_to
   FROM today_plan_actions prev JOIN chain
     ON prev.kind=chain.kind AND prev.source_id=chain.source_id
     AND prev.postponed_to=chain.original_on
   WHERE prev.household_id=?1
 )
 SELECT kind,source_id,original_on,action,postponed_to
 FROM chain`).bind(household,date,end).all()
 return results||[]
}
// Decisions from an old source date remain in history, but are no longer active
// after the parent plan's own date is edited.
export function activeActionDate(kind,id,original,actions=[]){
 if(!original)return null
 const byDate=new Map(actions.filter(a=>a.kind===kind&&a.source_id===id)
   .map(a=>[a.original_on,a]))
 let current=original
 for(let i=0;i<=byDate.size;i++){
  const a=byDate.get(current)
  if(!a)return current
  if(a.action!=='postponed'||!a.postponed_to||a.postponed_to<=current)return null
  current=a.postponed_to
 }
 return null
}
export function actionDue(kind,id,original,date,actions=[]){
 return activeActionDate(kind,id,original,actions)===date
}
export function effectiveReminderDate(kind,id,original,date,end,actions=[]){
 const effective=activeActionDate(kind,id,original,actions)
 return effective&&effective>=date&&effective<=end?effective:null
}

function sourceAvailable(kind,row){
 if(kind==='goal')return row.goal_mode==='once'
 if(kind==='task'||kind==='shopping')return !row.completed_at
 if(kind==='wish')return !['completed','cancelled'].includes(row.status)
 if(kind==='trip')return ['planning','active'].includes(row.status)
 return false
}
async function handleAction(request,db,session){
 if(request.method!=='POST')return json({error:'method_not_allowed'},405)
 const body=await readBody(request)
 const kind=body?.kind,id=body?.id,day=body?.on,action=body?.action,to=body?.to
 const config=kinds[kind]
 if(!config||typeof id!=='string'||!hex.test(id)||
    !dateOk(day)||day!==jstToday()||
    !['postponed','skipped'].includes(action)||
    (action==='postponed'&&(!dateOk(to)||to<=day||to>String(Number(day.slice(0,4))+10)+'-12-31'))||
    (action==='skipped'&&to!==undefined&&to!==null))
   return json({error:'invalid_input'},400)
 const h=session.household_id,u=session.user_id
 const table=config.table
 const sql=`SELECT * FROM ${table} WHERE id=?1 AND household_id=?2
   AND deleted_at IS NULL AND (visibility='household' OR ${config.owner}=?3)`
 const row=await db.prepare(sql).bind(id,h,u).first()
 if(!row)return json({error:'not_found'},404)
 const canAct=row[config.owner]===u ||
   ((kind==='task'||kind==='shopping')&&row.assignee_user_id===u&&row.visibility==='household') ||
   (kind==='shopping'&&(row.assigned_to===u||row.second_assignee_user_id===u)&&row.visibility==='household')
 if(!canAct)return json({error:'forbidden'},403)
 if(!sourceAvailable(kind,row)||!row[config.date])return json({error:'already_resolved'},409)
 const {results:decisions}=await db.prepare(`SELECT original_on,action,postponed_to,kind,source_id
   FROM today_plan_actions WHERE household_id=?1 AND kind=?2 AND source_id=?3
   ORDER BY original_on DESC`).bind(h,kind,id).all()
 const current=activeActionDate(kind,id,row[config.date],decisions||[])
 if(current!==day)return json({error:'not_today'},409)
 const result=await db.prepare(`INSERT OR IGNORE INTO today_plan_actions
   (household_id,kind,source_id,original_on,title,action,postponed_to,acted_by)
   VALUES(?1,?2,?3,?4,?5,?6,?7,?8)`)
   .bind(h,kind,id,day,row.title,action,action==='postponed'?to:null,u).run()
 if(!result.meta?.changes)return json({error:'already_handled'},409)
 return json({ok:true,kind,id,on:day,action,postponedTo:action==='postponed'?to:null})
}
async function handleHistory(request,db,session){
 if(request.method!=='GET')return json({error:'method_not_allowed'},405)
 const url=new URL(request.url)
 const limit=Number(url.searchParams.get('limit')||5)
 const raw=url.searchParams.get('cursor')||''
 if(!Number.isInteger(limit)||limit<1||limit>30||raw.length>150)
   return json({error:'invalid_input'},400)
 const split=raw.indexOf('|'),stamp=split>=0?raw.slice(0,split):null,rest=split>=0?raw.slice(split+1):''
 if(raw&&(!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(stamp)||
   !/^\w{3,8}:[a-f0-9-]{36}:\d{4}-\d{2}-\d{2}$/i.test(rest)))
   return json({error:'invalid_cursor'},400)
 const year=url.searchParams.get('year')||'',month=url.searchParams.get('month')||''
 const kind=url.searchParams.get('kind')||''
 if(kind&&!Object.hasOwn(kinds,kind))return json({error:'invalid_filter'},400)
 if((year&&!/^20[0-9]{2}$/.test(year))||(month&&(!year||!/^(0[1-9]|1[0-2])$/.test(month))))
   return json({error:'invalid_filter'},400)
 const h=session.household_id,u=session.user_id
 // A visible source is required, including for past and soft-deleted items.
 const args=[h,u],parts=[]
 for(const [kind,{table,owner}] of Object.entries(kinds)){
  parts.push(`(a.kind='${kind}' AND EXISTS(SELECT 1 FROM ${table} s
    WHERE s.id=a.source_id AND s.household_id=a.household_id
      AND (s.visibility='household' OR s.${owner}=?2)))`)
 }
 let rangeSql=''
 if(year){
   const start=year+'-'+(month||'01')+'-01'
   const end=month?(month==='12'?String(Number(year)+1)+'-01-01':
     year+'-'+String(Number(month)+1).padStart(2,'0')+'-01'):
     String(Number(year)+1)+'-01-01'
   rangeSql='AND a.original_on>=?'+(args.length+1)+' AND a.original_on<?'+(args.length+2)
   args.push(start,end)
 }
 const kindSql=kind?`AND a.kind=?${args.length+1}`:''
 if(kind)args.push(kind)
 const cursorSql=raw?`AND (a.acted_at<?${args.length+1} OR
   (a.acted_at=?${args.length+2} AND
   (a.kind||':'||a.source_id||':'||a.original_on)<?${args.length+3}))`:''
 if(raw)args.push(stamp,stamp,rest)
 args.push(limit+1)
 const {results}=await db.prepare(`SELECT a.kind,a.source_id AS id,a.title,
   a.original_on AS originalOn,a.postponed_to AS postponedTo,a.action,
   a.acted_at AS actedAt
   FROM today_plan_actions a WHERE a.household_id=?1
   AND a.action='skipped' AND (${parts.join(' OR ')})
   ${rangeSql} ${kindSql} ${cursorSql} ORDER BY a.acted_at DESC,
     (a.kind||':'||a.source_id||':'||a.original_on) DESC LIMIT ?${args.length}`)
   .bind(...args).all()
 const rows=results||[],items=rows.slice(0,limit),last=items.at(-1)
 return json({items,nextCursor:rows.length>limit&&last?
   last.actedAt+'|'+last.kind+':'+last.id+':'+last.originalOn:null})
}
export async function todayActionRoute(request,db,path,session){
 if(path==='/api/plans/today-action')return handleAction(request,db,session)
 if(path==='/api/plans/action-history')return handleHistory(request,db,session)
 return json({error:'not_found'},404)
}
