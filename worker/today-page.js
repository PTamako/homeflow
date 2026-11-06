import {json,validDate} from './security.js'
import {tasksRoute} from './tasks.js'
import {lifeRoute} from './life.js'
import {todayPlansRoute} from './plan-today.js'

const categories=new Set(['all','task','routine','shopping','wish','goal','trip'])
const planKinds=new Set(['shopping','wish','goal','trip'])
const dayNow=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10)
const jstStamp=stamp=>{
 const t=Date.parse(stamp?.includes('T')?stamp:stamp?.replace(' ','T')+'Z')
 return Number.isFinite(t)?new Date(t+9*3600000).toISOString().slice(0,10):''
}
const due=row=>row.task?.dueOn||row.routine?.currentPeriodOn||
 row.routine?.occurrenceOn||row.plan?.dueOn||'9999-12-31'
export const compareTodayRows=(a,b)=>Number(a.done)-Number(b.done)||
 due(a).localeCompare(due(b))||a.key.localeCompare(b.key)
const cursorKey=(date,category,row)=>[date,category,Number(row.done),due(row),row.key].join('|')
const cursorParts=value=>{
 if(!value||value.length>220)return null
 const parts=value.split('|')
 if(parts.length!==5||!/^\d{4}-\d{2}-\d{2}$/.test(parts[0])||
   !categories.has(parts[1])||!['0','1'].includes(parts[2])||
   !/^\d{4}-\d{2}-\d{2}$/.test(parts[3])||
   !/^(?:task|routine|plan):[a-z0-9:_-]+$/.test(parts[4]))return null
 return parts
}
const internalGet=(path)=>new Request('https://homeflow.internal'+path)
async function body(response){
 if(!response.ok)throw Error('source_unavailable')
 return response.json()
}
// One authenticated server page, not a client-side slice of several capped
// responses. The scanners are ID-keyset bounded in D1; no source has a hidden
// 50/100/250 row ceiling. Every row is visibility-scoped before being merged.
export async function todayPageRoute(request,db,session){
 if(request.method!=='GET')return json({error:'method_not_allowed'},405)
 const params=new URL(request.url).searchParams
 const date=params.get('date')||dayNow()
 const category=params.get('category')||'all'
 const cursor=params.get('cursor')||''
 const limit=Number(params.get('limit')||5)
 const parts=cursor?cursorParts(cursor):null
 if(!validDate(date)||!date||!categories.has(category)||limit!==5||
    (cursor&&(!parts||parts[0]!==date||parts[1]!==category)))
   return json({error:'invalid_input'},400)
 const encoded=encodeURIComponent(date)
 const [tasks,routines,plans]=await Promise.all([
  tasksRoute(internalGet('/api/tasks?status=all&today='+encoded),db,'/api/tasks',session,null,
    {fullToday:true}).then(body),
  lifeRoute(internalGet('/api/routines/today?date='+encoded),db,'/api/routines/today',session,null,
    {fullToday:true}).then(body),
  todayPlansRoute(internalGet('/api/plans/today?date='+encoded),db,session,'/api/plans/today',
    null,{fullToday:true}).then(body)
 ])
 const rows=[]
 for(const task of tasks.tasks||[]){
  const done=!!task.completedAt
  if(done?jstStamp(task.completedAt)!==date:!task.dueOn||task.dueOn>date)continue
  rows.push({key:'task:'+task.id,kind:'task',title:task.title,done,task})
 }
 for(const routine of routines.items||[]){
  rows.push({key:'routine:'+routine.id+':'+(routine.occurrenceOn||''),
    kind:'routine',title:routine.title,done:!!routine.mark?.completed_at,routine})
 }
 for(const plan of plans.items||[]){
  if(!planKinds.has(plan.kind))continue
  rows.push({key:'plan:'+plan.kind+':'+plan.id+(plan.periodKey?':'+plan.periodKey:''),
    kind:plan.kind,title:plan.title,done:!!plan.done,plan})
 }
 rows.sort(compareTodayRows)
 const filtered=category==='all'?rows:rows.filter(row=>row.kind===category)
 const total=filtered.length,completed=filtered.filter(row=>row.done).length
 const pointer=parts?{key:parts[4],done:parts[2]==='1',
  task:{dueOn:parts[3]}}:null
 // The cursor is an exclusive global sort boundary across all six kinds.
 const candidates=pointer?filtered.filter(row=>compareTodayRows(row,pointer)>0):filtered
 const items=candidates.slice(0,limit)
 const last=items.at(-1)
 const nextCursor=candidates.length>limit&&last?cursorKey(date,category,last):null
 return json({date,category,items,nextCursor,total,completed,
  categories:[...new Set(rows.map(row=>row.kind))],
  entryKeys:rows.map(row=>row.key)})
}
