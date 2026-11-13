import {json,readBody,validDate,iso} from './security.js'
import {goalPeriod} from './goal-period.js'
import {verifiedGoalProgress} from './finance.js'
import {jstDayOf} from './today-periods.js'
import {closedGoalPeriods,settleGoalPeriod} from './goal-settlements.js'
import {actionWindow,actionDue} from './today-actions.js'
import {readTodayRows} from './today-source-read.js'

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
  // All savings completion and undo paths are finance operations, including the legacy endpoint.
  if(kind==='goal'&&session.role!=='owner')return json({error:'forbidden'},403)
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
    if(!window||window.periodEnd>=today)return json({error:'not_due'},409)
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
  // Retried completion is a no-op, never a request to undo the record.
  if(body.completed&&found)return json({ok:true,kind,id,periodKey,completed:true,unchanged:true})
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
export async function todayPlansRoute(request,db,session,path='/api/plans/today',env,options={}){
  if(path==='/api/plans/complete')return completePlan(request,db,session,env)
  if(request.method!=='GET')return json({error:'method_not_allowed'},405)
  const date=new URL(request.url).searchParams.get('date')||tokyoToday()
  if(!validDate(date)||!date)return json({error:'invalid_input'},400)
  const h=session.household_id,u=session.user_id
  const startOfDayUtc=new Date(date+'T00:00:00+09:00').toISOString()
  // Load only the plan sources visible to this user and this date first.
  // Completion marks and settlements are then scoped to those returned IDs:
  // an old household archive must not be scanned on every Today visit.
  const sources=[
    {sql:"SELECT id,title,due_on AS dueOn,completed_at AS completedAt,\n      ledger_entry_id AS ledgerEntryId FROM shopping_items\n      WHERE household_id=?1 AND deleted_at IS NULL AND (visibility='household' OR created_by=?2)\n        AND (completed_at IS NULL OR completed_at>=?4)\n        AND due_on IS NOT NULL AND (due_on=?3 OR completed_at>=?4 OR id IN (\n          SELECT source_id FROM today_plan_actions WHERE household_id=?1 AND kind='shopping'\n          AND action='postponed' AND postponed_to=?3))",order:"\n      ORDER BY completed_at IS NOT NULL,due_on,id LIMIT 100",bindings:[h,u,date,startOfDayUtc]},
    {sql:"SELECT id,title,target_on AS dueOn,status FROM wishes\n      WHERE household_id=?1 AND deleted_at IS NULL AND (visibility='household' OR created_by=?2)\n        AND status!='cancelled' AND target_on IS NOT NULL AND (target_on=?3 OR id IN (\n          SELECT source_id FROM today_plan_actions WHERE household_id=?1 AND kind='wish'\n            AND action='postponed' AND postponed_to=?3) OR\n          (status='completed' AND id IN(SELECT plan_id FROM plan_completion_marks\n            WHERE household_id=?1 AND plan_type='wish' AND completed_at>=?4)))",order:"\n      ORDER BY target_on,id LIMIT 100",bindings:[h,u,date,startOfDayUtc]},
    {sql:"SELECT id,title,goal_mode,start_on,target_on,target_amount,reserved_amount\n      FROM goals WHERE household_id=?1 AND deleted_at IS NULL AND (visibility='household' OR created_by=?2)\n        AND ((goal_mode='once' AND target_on IS NOT NULL AND (target_on=?3 OR id IN (\n          SELECT source_id FROM today_plan_actions WHERE household_id=?1 AND kind='goal'\n          AND action='postponed' AND postponed_to=?3) OR id IN (\n          SELECT plan_id FROM plan_completion_marks WHERE household_id=?1 AND\n            plan_type='goal' AND period_key='once' AND completed_at>=?4)))\n          OR (goal_mode IN ('monthly','yearly') AND start_on<=?3))",order:"\n      ORDER BY created_at,id LIMIT 100",bindings:[h,u,date,startOfDayUtc]},
    {sql:"SELECT id,title,start_on AS dueOn,end_on AS endOn,destination FROM trips\n      WHERE household_id=?1 AND deleted_at IS NULL AND (visibility='household' OR created_by=?2)\n        AND status IN ('planning','active') AND start_on IS NOT NULL AND\n          (start_on=?3 OR id IN (SELECT source_id FROM today_plan_actions\n            WHERE household_id=?1 AND kind='trip' AND action='postponed' AND postponed_to=?3))",order:"\n      ORDER BY start_on,id LIMIT 50",bindings:[h,u,date]}
  ]
  const sourceBatch=options.fullToday
    ? await Promise.all(sources.map(async spec=>({
        results:await readTodayRows(db,spec.sql,spec.bindings)
      })))
    : await db.batch(sources.map(spec=>db.prepare(spec.sql+spec.order).bind(...spec.bindings)))
  const actionRows=await actionWindow(db,h,date)
  const goalIds=(sourceBatch[2].results||[]).map(row=>row.id)
  const wishIds=(sourceBatch[1].results||[]).map(row=>row.id)
  // Separate goal and wish lookups let D1 use the covering primary-key
  // indexes (household_id,plan_type,plan_id) instead of scanning the entire
  // household date index for an OR expression.
  // Chunk IN clauses even when the combined Today feed has hundreds of plans.
  const chunks=(ids,size=60)=>Array.from({length:Math.ceil(ids.length/size)},(_,i)=>
    ids.slice(i*size,(i+1)*size))
  const markStatements=[]
  for(const ids of chunks(goalIds))markStatements.push(db.prepare(`SELECT plan_type,plan_id,period_key,completed_at
    FROM plan_completion_marks WHERE household_id=?1 AND plan_type='goal'
      AND plan_id IN (${ids.map(()=>'?').join(',')})`).bind(h,...ids))
  for(const ids of chunks(wishIds))markStatements.push(db.prepare(`SELECT plan_type,plan_id,period_key,completed_at
    FROM plan_completion_marks WHERE household_id=?1 AND plan_type='wish'
      AND plan_id IN (${ids.map(()=>'?').join(',')})
      AND completed_at>=?${ids.length+2}`).bind(h,...ids,startOfDayUtc))
  const settlementStatements=[]
  for(const ids of chunks(goalIds))settlementStatements.push(db.prepare(`SELECT goal_id,period_key,status
    FROM goal_period_settlements WHERE household_id=?1
      AND goal_id IN (${ids.map(()=>'?').join(',')})
      AND status IN ('met','shortfall')`).bind(h,...ids))
  const statements=[...markStatements,...settlementStatements]
  const pages=statements.length?await db.batch(statements):[]
  const batch=[...sourceBatch,
    {results:pages.slice(0,markStatements.length).flatMap(p=>p.results||[])},
    {results:pages.slice(markStatements.length).flatMap(p=>p.results||[])}]
  const result=[]
  const goalReviews=[]
  const settledByGoal=new Map()
  for(const record of batch[5]?.results||[]){
    if(!settledByGoal.has(record.goal_id))settledByGoal.set(record.goal_id,new Set())
    settledByGoal.get(record.goal_id).add(record.period_key)
  }
  const add=(kind,row,done=false,periodKey)=>{
    if(!done&&!actionDue(kind,row.id,row.dueOn,date,actionRows))return
    result.push({
    kind,id:row.id,title:row.title,dueOn:done?row.dueOn:date,
    done,overdue:false,
    ...(periodKey?{periodKey}:{}),
    ...(kind==='shopping'?{ledgerEntryId:row.ledgerEntryId||null}:{}),
    ...(row.destination?{destination:row.destination}:{}),
    ...(kind==='trip'&&row.endOn&&row.endOn<date?{tripEnded:true}: {})
  })
  }
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
  for(const row of batch[3].results||[])add('trip',row)
  result.sort((a,b)=>Number(a.done)-Number(b.done)||a.dueOn.localeCompare(b.dueOn))
  goalReviews.sort((a,b)=>a.reviewType==='pending'&&b.reviewType!=='pending'?-1:
    b.reviewType==='pending'&&a.reviewType!=='pending'?1:a.dueOn.localeCompare(b.dueOn))
  // Source reads are already bounded; do not silently truncate a second time.
  // The UI still displays five at a time.
  return json({date,items:result,goalReviews:goalReviews.slice(0,100)})
}
