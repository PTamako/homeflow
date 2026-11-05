import {json,readBody,validDate,iso} from './security.js'
import {goalPeriod} from './goal-period.js'
import {verifiedGoalProgress} from './finance.js'
import {jstDayOf} from './today-periods.js'
import {closedGoalPeriods,settleGoalPeriod} from './goal-settlements.js'

const idOk=x=>typeof x==='string'&&/^[0-9a-f-]{36}$/i.test(x)
const tokyoToday=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10)

// Explicitly complete one wish or one savings period. These acknowledgements
// never change balances or write to kakebo; goal periods stay independent.
async function completePlan(request,db,session,env){
  if(request.method!=='POST')return json({error:'method_not_allowed'},405)
  const body=await readBody(request),kind=body?.kind,id=body?.id
  if(!['wish','goal'].includes(kind)||!idOk(id)||typeof body?.completed!=='boolean')
    return json({error:'invalid_input'},400)
  const table=kind==='wish'?'wishes':'goals'
  const row=await db.prepare(`SELECT * FROM ${table} WHERE id=?1 AND household_id=?2 AND deleted_at IS NULL
    AND (visibility='household' OR created_by=?3)`)
    .bind(id,session.household_id,session.user_id).first()
  if(!row)return json({error:'not_found'},404)
  const today=tokyoToday(),stamp=iso()
  let periodKey='once'
  if(kind==='wish'){
    // A target date schedules follow-up; it must not prevent an undated or
    // early-achieved wish from being completed in Plans.
    if(row.status==='cancelled')return json({error:'cancelled_plan'},409)
  }else if((row.goal_mode||'once')==='once'){
    // One-time goals may finish early, but never before their funding period.
    if(row.start_on&&row.start_on>today)return json({error:'not_started'},409)
  }else{
    periodKey=body?.periodKey
    const window=goalPeriod(row,periodKey,today)
    if(!window||window.periodEnd>today)return json({error:'not_due'},409)
  }
  if(kind==='goal'&&(row.goal_mode||'once')!=='once'){
    // Older clients may still call the former mark-complete endpoint.
    // Route them through the same verified period settlement and never allow
    // an unchecked acknowledgement to bypass the stored snapshot.
    if(!body.completed)return json({error:'use_period_recheck'},409)
    const result=await settleGoalPeriod(env,row,periodKey,today,true)
    return json(result,result.ok?200:result.error==='not_due'?409:503)
  }
  const found=await db.prepare(`SELECT completed_at,prior_status FROM plan_completion_marks
    WHERE household_id=?1 AND plan_type=?2 AND plan_id=?3 AND period_key=?4`)
    .bind(session.household_id,kind,id,periodKey).first()
  if(body.completed&&!found){
    // Money is never marked as saved just because the user clicked a button.
    // Verify against the real Kakebo read-only ledger on each completion.
    if(kind==='goal'||kind==='wish'){
      let linked=[]
      if(kind==='wish'){
        const response=await db.prepare(`SELECT * FROM goals WHERE household_id=?1 AND deleted_at IS NULL AND wish_id=?2`)
          .bind(session.household_id,id).all()
        linked=response.results||[]
      }
      const goals=kind==='goal'?[row]:linked
      if(goals.length){
        if(session.role!=='owner')return json({error:'owner_required_for_ledger_verification'},403)
        for(const goal of goals){
          const key=(goal.goal_mode||'once')==='once'?'once':
            goal.goal_mode==='yearly'?today.slice(0,4):today.slice(0,7)
          try{
            const amount=await verifiedGoalProgress(env,goal,kind==='goal'?periodKey:key,today)
            if(!amount.ok)return json({error:amount.error,current:amount.amount,target:amount.target},
              amount.error==='goal_not_funded'?409:503)
          }catch{return json({error:'ledger_verification_unavailable'},503)}
        }
      }
    }
    if(kind==='wish'){
      if(row.status==='completed')return found?json({ok:true,unchanged:true}):json({error:'already_completed'},409)
      await db.batch([
        db.prepare(`INSERT OR IGNORE INTO plan_completion_marks
          (household_id,plan_type,plan_id,period_key,completed_at,completed_by,prior_status)
          VALUES(?1,'wish',?2,'once',?3,?4,?5)`)
          .bind(session.household_id,id,stamp,session.user_id,row.status),
        db.prepare(`UPDATE wishes SET status='completed',updated_at=?1
          WHERE id=?2 AND household_id=?3 AND status NOT IN ('completed','cancelled')`)
          .bind(stamp,id,session.household_id)
      ])
    }else{
      await db.prepare(`INSERT OR IGNORE INTO plan_completion_marks
        (household_id,plan_type,plan_id,period_key,completed_at,completed_by)
        VALUES(?1,'goal',?2,?3,?4,?5)`)
        .bind(session.household_id,id,periodKey,stamp,session.user_id).run()
    }
  }else{
    if(!found)return json({ok:true,unchanged:true})
    if(kind==='wish'){
      await db.batch([
        db.prepare(`UPDATE wishes SET status=?1,updated_at=?2
          WHERE id=?3 AND household_id=?4 AND status='completed'`)
          .bind(['wished','planning','active'].includes(found.prior_status)?found.prior_status:'wished',
            stamp,id,session.household_id),
        db.prepare(`DELETE FROM plan_completion_marks
          WHERE household_id=?1 AND plan_type='wish' AND plan_id=?2 AND period_key='once'`)
          .bind(session.household_id,id)
      ])
    }else await db.prepare(`DELETE FROM plan_completion_marks
      WHERE household_id=?1 AND plan_type='goal' AND plan_id=?2 AND period_key=?3`)
      .bind(session.household_id,id,periodKey).run()
  }
  return json({ok:true,kind,id,periodKey,completed:body.completed})
}

// Date-scoped digest of overdue and today-due plans; period marks are read in
// the same D1 batch. No additional ledger access on page load.
export async function todayPlansRoute(request,db,session,path='/api/plans/today',env){
  if(path==='/api/plans/complete')return completePlan(request,db,session,env)
  if(request.method!=='GET')return json({error:'method_not_allowed'},405)
  const date=new URL(request.url).searchParams.get('date')||tokyoToday()
  if(!validDate(date)||!date)return json({error:'invalid_input'},400)
  const h=session.household_id,u=session.user_id
  const startOfDayUtc=new Date(date+'T00:00:00+09:00').toISOString()
  const batch=await db.batch([
    db.prepare(`SELECT id,title,due_on AS dueOn,completed_at AS completedAt,
      ledger_entry_id AS ledgerEntryId FROM shopping_items
      WHERE household_id=?1 AND deleted_at IS NULL AND (visibility='household' OR created_by=?2)
        AND (completed_at IS NULL OR completed_at>=?4)
        AND due_on IS NOT NULL AND due_on<=?3
      ORDER BY completed_at IS NOT NULL,due_on,id LIMIT 25`).bind(h,u,date,startOfDayUtc),
    db.prepare(`SELECT id,title,target_on AS dueOn,status FROM wishes
      WHERE household_id=?1 AND deleted_at IS NULL AND (visibility='household' OR created_by=?2)
        AND status!='cancelled' AND target_on IS NOT NULL AND target_on<=?3
      ORDER BY target_on,id LIMIT 100`).bind(h,u,date),
    db.prepare(`SELECT id,title,goal_mode,start_on,target_on,target_amount,reserved_amount
      FROM goals WHERE household_id=?1 AND deleted_at IS NULL AND (visibility='household' OR created_by=?2)
        AND ((goal_mode='once' AND target_on IS NOT NULL AND target_on<=?3)
          OR (goal_mode IN ('monthly','yearly') AND start_on<=?3))
      ORDER BY created_at,id LIMIT 100`).bind(h,u,date),
    db.prepare(`SELECT id,title,start_on AS dueOn,end_on AS endOn,destination FROM trips
      WHERE household_id=?1 AND deleted_at IS NULL AND (visibility='household' OR created_by=?2)
        AND status IN ('planning','active') AND start_on IS NOT NULL AND start_on<=?3
      ORDER BY start_on,id LIMIT 25`).bind(h,u,date),
    db.prepare(`SELECT plan_type,plan_id,period_key,completed_at FROM plan_completion_marks
      WHERE household_id=?1 AND (plan_type='goal' OR completed_at>=?2)
      ORDER BY completed_at DESC LIMIT 5000`).bind(h,startOfDayUtc),
    db.prepare(`SELECT goal_id,period_key,status FROM goal_period_settlements
      WHERE household_id=?1 AND status IN ('met','shortfall') LIMIT 5000`).bind(h)
  ])
  const result=[]
  const goalReviews=[]
  const settledByGoal=new Map()
  for(const record of batch[5]?.results||[]){
    if(!settledByGoal.has(record.goal_id))settledByGoal.set(record.goal_id,new Set())
    settledByGoal.get(record.goal_id).add(record.period_key)
  }
  const add=(kind,row,done=false,periodKey)=>result.push({
    kind,id:row.id,title:row.title,dueOn:row.dueOn,
    done,overdue:row.dueOn<date&&!done,
    ...(periodKey?{periodKey}:{}),
    ...(kind==='shopping'?{ledgerEntryId:row.ledgerEntryId||null}:{}),
    ...(row.destination?{destination:row.destination}:{}),
    ...(kind==='trip'&&row.endOn&&row.endOn<date?{tripEnded:true}: {})
  })
  const marksByPlan=new Map()
  for(const mark of batch[4].results||[]){
    const key=mark.plan_type+':'+mark.plan_id
    if(!marksByPlan.has(key))marksByPlan.set(key,new Map())
    marksByPlan.get(key).set(mark.period_key,mark.completed_at)
  }
  for(const row of batch[0].results||[])add('shopping',row,!!row.completedAt)
  for(const row of batch[1].results||[]){
    const completed=marksByPlan.get('wish:'+row.id)?.get('once')
    if(row.status!=='completed'||jstDayOf(completed)===date){
      add('wish',row,row.status==='completed'&&jstDayOf(completed)===date)
    }
  }
  for(const goal of batch[2].results||[]){
    const marked=marksByPlan.get('goal:'+goal.id)||new Map()
    if((goal.goal_mode||'once')==='once'){
      const completed=marked.get('once')
      if(completed){
        if(jstDayOf(completed)===date)add('goal',{...goal,dueOn:goal.target_on},true,'once')
      }else if(goal.reserved_amount<goal.target_amount){
        add('goal',{...goal,dueOn:goal.target_on},false,'once')
      }
    }else{
      // Closed periods belong to settlement history; never carry them forward
      // as ordinary overdue tasks. One summary per goal avoids duplicate rows.
      const closed=closedGoalPeriods(goal,date,1200)
      const settled=settledByGoal.get(goal.id)||new Set()
      const pending=closed.filter(w=>!settled.has(w.periodKey)&&!marked.has(w.periodKey))
      if(pending.length){
        const oldest=pending[pending.length-1]
        goalReviews.push({id:goal.id,kind:'goal',title:goal.title,
          periodKey:oldest.periodKey,dueOn:oldest.periodEnd,
          pendingCount:pending.length,reviewType:'pending',targetAmount:goal.target_amount})
      }else{
        const key=goal.goal_mode==='monthly'?date.slice(0,7):date.slice(0,4)
        const current=goalPeriod(goal,key,date)
        if(current&&current.start<=date&&current.periodEnd>=date){
          const days=Math.round((Date.parse(current.periodEnd+'T00:00:00Z')-
            Date.parse(date+'T00:00:00Z'))/86400000)
          if(days<=3)goalReviews.push({id:goal.id,kind:'goal',title:goal.title,
            periodKey:key,dueOn:current.periodEnd,pendingCount:0,
            reviewType:days===0?'due_today':'due_soon',targetAmount:goal.target_amount})
        }
      }
    }
  }
  for(const row of batch[3].results||[]){
    add('trip',{...row,dueOn:row.endOn&&row.endOn<date?row.endOn:row.dueOn})
  }
  result.sort((a,b)=>Number(a.done)-Number(b.done)||a.dueOn.localeCompare(b.dueOn))
  goalReviews.sort((a,b)=>a.reviewType==='pending'&&b.reviewType!=='pending'?-1:
    b.reviewType==='pending'&&a.reviewType!=='pending'?1:a.dueOn.localeCompare(b.dueOn))
  return json({date,items:result.slice(0,100),goalReviews:goalReviews.slice(0,100)})
}
