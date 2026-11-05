// Canonical period settlements for recurring savings goals.
// Ledger summaries are read only on a deliberate recheck or a bounded daily cron,
// never as part of Today's ordinary read path.
import {json,readBody} from './security.js'
import {goalPeriod} from './goal-period.js'
import {verifiedGoalProgress} from './finance.js'

export const tokyoDay=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10)
const uuid=x=>typeof x==='string'&&/^[0-9a-f-]{36}$/i.test(x)
const keyOf=(mode,date)=>mode==='monthly'?date.slice(0,7):date.slice(0,4)
const prevKey=(mode,key)=>mode==='yearly'?String(Number(key)-1):
  new Date(Date.UTC(Number(key.slice(0,4)),Number(key.slice(5,7))-2,1)).toISOString().slice(0,7)

// Closed periods only. The final day itself is still open until midnight JST;
// this avoids taking a misleading mid-day snapshot of incomplete transactions.
// 'before' is a keyset cursor; month/year filters never change the saved history.
export function closedGoalPeriods(goal,today=tokyoDay(),limit=5,before='',year='',month=''){
  if(!['monthly','yearly'].includes(goal?.goal_mode)||
    !goal.start_on||goal.start_on>today)return []
  const mode=goal.goal_mode,first=keyOf(mode,goal.start_on)
  const maxDate=goal.target_on&&goal.target_on<today?goal.target_on:today
  let key=keyOf(mode,maxDate),items=[]
  if(before&&key>=before)key=prevKey(mode,before)
  for(let i=0;i<1200&&key>=first&&items.length<limit;i++){
    if(Number(key.slice(0,4))<1900)break
    const window=goalPeriod(goal,key,today)
    if(window&&window.periodEnd<today&&(!year||key.slice(0,4)===year)&&
       (!month||mode==='monthly'&&key.slice(5,7)===month))
      items.push(window)
    key=prevKey(mode,key)
  }
  return items
}

export async function settleGoalPeriod(env,goal,periodKey,today=tokyoDay(),force=false){
  const window=goalPeriod(goal,periodKey,today)
  if(!window||window.notStarted||window.periodEnd>=today)
    return {ok:false,error:'not_due'}
  const db=env.DB,h=goal.household_id
  const existing=await db.prepare(`SELECT status,actual_amount,target_amount,difference_amount
    FROM goal_period_settlements WHERE household_id=?1 AND goal_id=?2 AND period_key=?3`)
    .bind(h,goal.id,periodKey).first()
  if(existing?.status&&existing.status!=='pending'&&!force)
    return {ok:true,unchanged:true,status:existing.status,
      actualAmount:existing.actual_amount,targetAmount:existing.target_amount,
      differenceAmount:existing.difference_amount,periodKey}
  let progress
  try{progress=await verifiedGoalProgress(env,goal,periodKey,today)}
  catch{return {ok:false,error:'ledger_verification_unavailable'}}
  if(!Number.isSafeInteger(progress.amount)||!Number.isSafeInteger(progress.target)||
     !['goal_not_funded',null].includes(progress.error))
    return {ok:false,error:progress.error||'ledger_verification_unavailable'}
  const status=progress.ok?'met':'shortfall'
  const difference=progress.target-progress.amount
  if(!Number.isSafeInteger(difference))
    return {ok:false,error:'ledger_invalid_response'}
  const settledAt=new Date().toISOString()
  const statements=[
    db.prepare(`INSERT INTO goal_period_settlements
      (household_id,goal_id,period_key,period_start,period_end,target_amount,
       actual_amount,difference_amount,status,settled_at,updated_at)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,CURRENT_TIMESTAMP)
      ON CONFLICT(household_id,goal_id,period_key) DO UPDATE SET
      period_start=excluded.period_start,period_end=excluded.period_end,
      target_amount=excluded.target_amount,actual_amount=excluded.actual_amount,
      difference_amount=excluded.difference_amount,status=excluded.status,
      settled_at=excluded.settled_at,updated_at=CURRENT_TIMESTAMP`)
      .bind(h,goal.id,periodKey,progress.start,progress.end,progress.target,
        progress.amount,difference,status,settledAt)
  ]
  if(status==='met'){
    statements.push(db.prepare(`INSERT OR IGNORE INTO plan_completion_marks
      (household_id,plan_type,plan_id,period_key,completed_at,completed_by)
      VALUES(?1,'goal',?2,?3,?4,?5)`)
      .bind(h,goal.id,periodKey,settledAt,goal.created_by))
  }else{
    statements.push(db.prepare(`DELETE FROM plan_completion_marks
      WHERE household_id=?1 AND plan_type='goal' AND plan_id=?2 AND period_key=?3`)
      .bind(h,goal.id,periodKey))
  }
  await db.batch(statements)
  return {ok:true,status,periodKey,actualAmount:progress.amount,
    targetAmount:progress.target,differenceAmount:difference,
    periodStart:progress.start,periodEnd:progress.end,settledAt,
    calculationBasis:'household_net_cashflow_estimate'}
}

// One short history page is generated from the calendar, then annotated with
// the snapshots / legacy completion marks from ONE D1 read. Missing snapshots
// remain "pending" rather than being silently treated as failures.
export async function goalPeriodsRoute(request,env,path,session){
  const match=path.match(/^\/api\/goals\/([0-9a-f-]{36})\/periods(?:\/(settle))?$/i)
  if(!match||!uuid(match[1]))return json({error:'not_found'},404)
  const db=env.DB,h=session.household_id,u=session.user_id
  const goal=await db.prepare(`SELECT * FROM goals WHERE id=?1 AND household_id=?2 AND deleted_at IS NULL
    AND (visibility='household' OR created_by=?3)`).bind(match[1],h,u).first()
  if(!goal)return json({error:'not_found'},404)
  if(!['monthly','yearly'].includes(goal.goal_mode))
    return json({error:'not_recurring'},409)
  const today=tokyoDay()
  if(match[2]==='settle'){
    if(request.method!=='POST')return json({error:'method_not_allowed'},405)
    if(session.role!=='owner')return json({error:'forbidden'},403)
    const body=await readBody(request)
    const key=body?.periodKey
    const window=goalPeriod(goal,key,today)
    if(!window||window.periodEnd>=today)return json({error:'not_due'},409)
    const result=await settleGoalPeriod(env,goal,key,today,true)
    return json(result,result.ok?200:503)
  }
  if(request.method!=='GET')return json({error:'method_not_allowed'},405)
  const params=new URL(request.url).searchParams
  const limit=params.has('limit')?Number(params.get('limit')):5
  const cursor=params.get('cursor')||'',year=params.get('year')||'',month=params.get('month')||''
  if(!Number.isInteger(limit)||limit<1||limit>30||
    (cursor&&!/^\d{4}(?:-(?:0[1-9]|1[0-2]))?$/.test(cursor))||
    (year&&!/^(19|20|21)\d{2}$/.test(year))||
    (month&&!/^(0[1-9]|1[0-2])$/.test(month))||
    (month&&(goal.goal_mode!=='monthly'||!year))||
    (cursor&&cursor.length!==(goal.goal_mode==='monthly'?7:4)))
    return json({error:'invalid_filters'},400)
  const windows=closedGoalPeriods(goal,today,limit+1,cursor,year,month)
  const hasMore=windows.length>limit,shown=windows.slice(0,limit)
  if(!shown.length)return json({items:[],nextCursor:null})
  const keys=shown.map(x=>x.periodKey)
  const placeholders=keys.map((_,i)=>'?'+(i+3)).join(',')
  const {results}=await db.prepare(`SELECT k.period_key,s.period_start,s.period_end,
    s.target_amount,s.actual_amount,s.difference_amount,s.status,s.settled_at,
    m.completed_at AS legacy_completed_at
    FROM (SELECT period_key FROM goal_period_settlements WHERE household_id=?1
       AND goal_id=?2 AND period_key IN (${placeholders})
       UNION SELECT period_key FROM plan_completion_marks WHERE household_id=?1
       AND plan_type='goal' AND plan_id=?2 AND period_key IN (${placeholders})) k
    LEFT JOIN goal_period_settlements s ON s.household_id=?1 AND s.goal_id=?2 AND s.period_key=k.period_key
    LEFT JOIN plan_completion_marks m ON m.household_id=?1 AND m.plan_type='goal' AND m.plan_id=?2 AND m.period_key=k.period_key`)
    .bind(h,goal.id,...keys).all()
  const saved=new Map((results||[]).map(x=>[x.period_key||null,x]))
  return json({items:shown.map(w=>{
    const s=saved.get(w.periodKey)
    const status=s?.status|| (s?.legacy_completed_at?'met':'pending')
    return {periodKey:w.periodKey,start:w.start,end:w.periodEnd,
      status,targetAmount:s?.target_amount??goal.target_amount,
      actualAmount:s?.actual_amount??null,differenceAmount:s?.difference_amount??null,
      settledAt:s?.settled_at||s?.legacy_completed_at||null,
      legacy:!s?.status&&!!s?.legacy_completed_at,
      calculationBasis:'household_net_cashflow_estimate'}
  }),nextCursor:hasMore?shown.at(-1).periodKey:null})
}

// Bound cron: a single goals scan, up to 12 recent closed periods per goal,
// at most 8 remote ledger summaries per execution; never runs in preview.
export async function runGoalSettlementSchedule(env){
  if(env.APP_ENV!=='production'||typeof env.KAKEBO_LEDGER_SERVICE?.fetch!=='function')
    return {skipped:'ledger_or_production_unavailable'}
  const today=tokyoDay()
  const {results}=await env.DB.prepare(`SELECT * FROM goals
    WHERE deleted_at IS NULL AND goal_mode IN ('monthly','yearly') AND start_on<?1
    ORDER BY created_at DESC LIMIT 60`).bind(today).all()
  let processed=0,settled=0,failed=0
  const failures={}
  for(const goal of results||[]){
    if(processed>=8)break
    const windows=closedGoalPeriods(goal,today,12).reverse()
    if(!windows.length)continue
    const keys=windows.map(w=>w.periodKey)
    const {results:records}=await env.DB.prepare(`SELECT period_key,status
      FROM goal_period_settlements WHERE household_id=?1 AND goal_id=?2
      AND period_key IN (${keys.map((_,i)=>'?'+(i+3)).join(',')})`)
      .bind(goal.household_id,goal.id,...keys).all()
    const done=new Set((records||[]).filter(r=>r.status!=='pending').map(r=>r.period_key))
    const {results:legacy}=await env.DB.prepare(`SELECT period_key FROM plan_completion_marks
      WHERE household_id=?1 AND plan_type='goal' AND plan_id=?2
      AND period_key IN (${keys.map((_,i)=>'?'+(i+3)).join(',')})`)
      .bind(goal.household_id,goal.id,...keys).all()
    for(const m of legacy||[])done.add(m.period_key)
    for(const window of windows){
      if(processed>=8)break
      if(done.has(window.periodKey))continue
      processed++
      try{
        const outcome=await settleGoalPeriod(env,goal,window.periodKey,today)
        if(outcome?.ok)settled++
        else{failed++;const reason=String(outcome?.error||'unknown');failures[reason]=(failures[reason]||0)+1}
      }catch{failed++;failures.unexpected=(failures.unexpected||0)+1}
    }
  }
  return {attempted:processed,settled,failed,failures}
}
