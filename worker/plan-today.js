import {json,validDate} from './security.js'

// A date-scoped digest of user-visible plans. Today's recurring occurrences and
// regular tasks are already provided by /routines/today and /tasks; do not
// repeat them here. One batched D1 read, no kakeibo queries on Today.
export async function todayPlansRoute(request,db,session){
  if(request.method!=='GET')return json({error:'method_not_allowed'},405)
  const date=new URL(request.url).searchParams.get('date')||
    new Date(Date.now()+9*3600000).toISOString().slice(0,10)
  if(!validDate(date)||!date)return json({error:'invalid_input'},400)
  const h=session.household_id,u=session.user_id
  // Retain purchases completed today in the checklist with a strikethrough;
  // their completion marks will not be carried into tomorrow.
  const startOfDayUtc=new Date(date+'T00:00:00+09:00').toISOString()
  const batch=await db.batch([
    db.prepare(`SELECT id,title,due_on AS dueOn,completed_at AS completedAt FROM shopping_items
      WHERE household_id=?1 AND (visibility='household' OR created_by=?2)
        AND (completed_at IS NULL OR completed_at>=?4)
        AND due_on IS NOT NULL AND due_on<=?3
      ORDER BY completed_at IS NOT NULL,due_on,id LIMIT 25`).bind(h,u,date,startOfDayUtc),
    db.prepare(`SELECT id,title,target_on AS dueOn FROM wishes
      WHERE household_id=?1 AND (visibility='household' OR created_by=?2)
        AND status NOT IN ('completed','cancelled')
        AND target_on IS NOT NULL AND target_on<=?3
      ORDER BY target_on,id LIMIT 25`).bind(h,u,date),
    db.prepare(`SELECT id,title,target_on AS dueOn FROM goals
      WHERE household_id=?1 AND (visibility='household' OR created_by=?2)
        AND reserved_amount<target_amount AND target_on IS NOT NULL AND target_on<=?3
      ORDER BY target_on,id LIMIT 25`).bind(h,u,date),
    db.prepare(`SELECT id,title,start_on AS dueOn,destination FROM trips
      WHERE household_id=?1 AND (visibility='household' OR created_by=?2)
        AND status IN ('planning','active')
        AND start_on IS NOT NULL AND start_on<=?3
        AND (end_on IS NULL OR end_on>=?3)
      ORDER BY start_on,id LIMIT 25`).bind(h,u,date)
  ])
  const types=['shopping','wish','goal','trip']
  const items=batch.flatMap((group,i)=>(group.results||[]).map(row=>({
    kind:types[i],id:row.id,title:row.title,dueOn:row.dueOn,
    done:!!row.completedAt,overdue:row.dueOn<date&&!row.completedAt,
    ...(row.destination?{destination:row.destination}:{})
  })))
  return json({date,items})
}
