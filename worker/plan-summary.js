// Opt-in monthly plan review. One batched aggregate, no Kakebo reads, no
// scheduled writes, and no new D1 tables or row-by-row history downloads.
import {json} from './security.js'

const jstMonth=month=>{
  if(typeof month!=='string'||!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))return null
  const year=Number(month.slice(0,4)),index=Number(month.slice(5,7))-1
  if(year<1900||year>9997)return null
  const start=new Date(Date.UTC(year,index,1)-9*3600000).toISOString()
  const end=new Date(Date.UTC(year,index+1,1)-9*3600000).toISOString()
  return {start,end}
}
export async function planSummaryRoute(request,db,session){
  if(request.method!=='GET')return json({error:'method_not_allowed'},405)
  const month=new URL(request.url).searchParams.get('month')
  const range=jstMonth(month)
  if(!range)return json({error:'invalid_month'},400)
  const h=session.household_id,u=session.user_id,a=range.start,b=range.end
  const statements=[
    db.prepare(`SELECT COUNT(*) AS total FROM tasks WHERE household_id=?1
      AND deleted_at IS NULL AND (visibility='household' OR creator_user_id=?2)
      AND completed_at>=?3 AND completed_at<?4`).bind(h,u,a,b),
    db.prepare(`SELECT COUNT(*) AS total FROM routine_marks m JOIN routines r
      ON r.id=m.routine_id WHERE r.household_id=?1 AND r.deleted_at IS NULL
      AND (r.visibility='household' OR r.created_by=?2)
      AND m.completed_at>=?3 AND m.completed_at<?4`).bind(h,u,a,b),
    db.prepare(`SELECT COUNT(*) AS total FROM shopping_items WHERE household_id=?1 AND deleted_at IS NULL
      AND (visibility='household' OR created_by=?2)
      AND completed_at>=?3 AND completed_at<?4`).bind(h,u,a,b),
    db.prepare(`SELECT COUNT(*) AS total FROM plan_completion_marks m JOIN wishes w
      ON w.id=m.plan_id AND w.household_id=m.household_id
      WHERE m.household_id=?1 AND m.plan_type='wish' AND w.deleted_at IS NULL
      AND (w.visibility='household' OR w.created_by=?2)
      AND m.completed_at>=?3 AND m.completed_at<?4`).bind(h,u,a,b),
    db.prepare(`SELECT COUNT(*) AS total FROM plan_completion_marks m JOIN goals g
      ON g.id=m.plan_id AND g.household_id=m.household_id
      WHERE m.household_id=?1 AND m.plan_type='goal' AND g.deleted_at IS NULL
      AND (g.visibility='household' OR g.created_by=?2)
      AND m.completed_at>=?3 AND m.completed_at<?4`).bind(h,u,a,b),
    db.prepare(`SELECT COUNT(*) AS total FROM trips WHERE household_id=?1 AND deleted_at IS NULL
      AND status='completed' AND (visibility='household' OR created_by=?2)
      AND updated_at>=?3 AND updated_at<?4`).bind(h,u,a,b)
  ]
  const results=await db.batch(statements)
  const keys=['tasks','routines','shopping','wishes','savings','trips']
  const counts={}
  keys.forEach((k,i)=>{counts[k]=Number(results[i]?.results?.[0]?.total||0)})
  const total=Object.values(counts).reduce((a,n)=>a+n,0)
  return json({month,counts,total,
    note:'仅统计当月明确记录完成的事项和核验次数，不含重复推断；历史旧心愿若无完成标记可能不计入。'})
}
