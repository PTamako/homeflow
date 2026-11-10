// Historical *periods* of recurring savings goals are distinct from the
// ongoing plan. One bounded goals read plus one small snapshot read; no Kakebo
// access or per-goal D1 fan-out when browsing the Plans archive.
import {json,validDate} from './security.js'
import {closedGoalPeriods,tokyoDay} from './goal-settlements.js'

const maxPageSize=30
const uuid=/^[0-9a-f-]{36}$/i
const nextPeriodKey=(mode,date)=>{
  if(mode==='yearly')return String(Number(date.slice(0,4))+1)
  const y=Number(date.slice(0,4)),m=Number(date.slice(5,7))
  return new Date(Date.UTC(y,m,1)).toISOString().slice(0,7)
}
export function archiveFilter(url){
  const params=new URL(url).searchParams
  const limit=params.has('limit')?Number(params.get('limit')):5
  const year=params.get('year')||'',month=params.get('month')||''
  const outcome=params.get('outcome')||'all'
  const cursor=params.get('cursor')||''
  if(!Number.isInteger(limit)||limit<1||limit>maxPageSize||
    (year&&!/^(19|20|21)\d{2}$/.test(year))||
    (month&&!/^(0[1-9]|1[0-2])$/.test(month))||
    (month&&!year)||!['all','completed','skipped','missed'].includes(outcome)||
    cursor.length>55)return null
  let before=null
  if(cursor){
    const match=cursor.match(/^(\d{4}-\d{2}-\d{2})\|([0-9a-f-]{36})$/i)
    if(!match||!validDate(match[1])||!uuid.test(match[2]))return null
    before={end:match[1],goalId:match[2]}
  }
  return {limit,year,month,outcome,before}
}
export function candidateGoalPeriods(goals,options,today=tokyoDay()){
  const candidates=[]
  for(const g of goals){
    if(!['monthly','yearly'].includes(g.goal_mode))continue
    // Include the cursor's month/year, then use exact (end,id) keyset
    // comparison to handle multiple goals ending on the same date.
    const before=options.before?nextPeriodKey(g.goal_mode,options.before.end):''
    for(const period of closedGoalPeriods(g,today,options.limit+2,before,options.year,
      g.goal_mode==='monthly'?options.month:'')){
      // Yearly periods end in their final calendar month, not a monthly period key.
      if(options.month&&period.periodEnd.slice(5,7)!==options.month)continue
      if(options.before&&(period.periodEnd>options.before.end||
         (period.periodEnd===options.before.end&&g.id>=options.before.goalId)))continue
      candidates.push({
        goalId:g.id,title:g.title,goalMode:g.goal_mode,
        periodKey:period.periodKey,periodStart:period.start,periodEnd:period.periodEnd,
        targetAmount:g.target_amount
      })
    }
  }
  candidates.sort((a,b)=>b.periodEnd.localeCompare(a.periodEnd)||b.goalId.localeCompare(a.goalId))
  return candidates.slice(0,options.limit+1)
}
export async function goalPeriodArchiveRoute(request,db,session){
  if(request.method!=='GET')return json({error:'method_not_allowed'},405)
  // Shared period history is visible to household members. Estimates remain
  // restricted to the household owner or the creator of that savings goal.
  const opts=archiveFilter(request.url)
  if(!opts)return json({error:'invalid_filters'},400)
  // Goal-period results never have a skipped state. Avoid reading the
  // household's goals and settlements when the skipped-only tab is selected.
  if(opts.outcome==='skipped')return json({items:[],nextCursor:null})
  const {results:goals}=await db.prepare(`SELECT id,title,created_by,goal_mode,start_on,target_on,target_amount
    FROM goals WHERE household_id=?1 AND deleted_at IS NULL AND goal_mode IN ('monthly','yearly')
    AND (visibility='household' OR created_by=?2)
    ORDER BY created_at DESC LIMIT 251`)
    .bind(session.household_id,session.user_id).all()
  // Avoid silently hiding the oldest plan if a household grows unusually large.
  if((goals||[]).length>250)return json({error:'archive_goal_limit_exceeded'},409)
  const financeVisible=new Set((goals||[]).filter(g=>
    session.role==='owner'||g.created_by===session.user_id).map(g=>g.id))
  // Period status is stored in separate settlement/legacy tables. Fetch
  // enough candidate keys in ONE bounded batch to filter before paging.
  const scanLimit=opts.outcome==='all'?opts.limit:Math.max(60,opts.limit*12)
  const periods=candidateGoalPeriods(goals||[],{...opts,limit:scanLimit})
  const shown=periods.slice(0,scanLimit)
  if(!shown.length)return json({items:[],nextCursor:null})
  const values=shown.map((_,i)=>`(?${i*2+2},?${i*2+3})`).join(',')
  const binds=shown.flatMap(x=>[x.goalId,x.periodKey])
  // Read only requested snapshots and legacy marks, never all ledger entries.
  const {results:records}=await db.prepare(`
    WITH requested(goal_id,period_key) AS (VALUES ${values})
    SELECT r.goal_id,r.period_key,s.status,s.target_amount,
      s.actual_amount,s.difference_amount,s.settled_at,
      m.completed_at AS legacy_completed_at
    FROM requested r
    LEFT JOIN goal_period_settlements s
      ON s.household_id=?1 AND s.goal_id=r.goal_id AND s.period_key=r.period_key
    LEFT JOIN plan_completion_marks m
      ON m.household_id=?1 AND m.plan_type='goal'
      AND m.plan_id=r.goal_id AND m.period_key=r.period_key`)
    .bind(session.household_id,...binds).all()
  const saved=new Map((records||[]).map(x=>[x.goal_id+'|'+x.period_key,x]))
  const annotated=shown.map(period=>{
    const record=saved.get(period.goalId+'|'+period.periodKey)
    return {...period,
      status:record?.status||(record?.legacy_completed_at?'met':'pending'),
      targetAmount:record?.target_amount??period.targetAmount,
      actualAmount:financeVisible.has(period.goalId)?record?.actual_amount??null:null,
      differenceAmount:financeVisible.has(period.goalId)?record?.difference_amount??null:null,
      settledAt:record?.settled_at||record?.legacy_completed_at||null}
  })
  const matching=annotated.filter(period=>opts.outcome==='all'||
    (opts.outcome==='completed'&&period.status==='met')||
    (opts.outcome==='missed'&&['shortfall','pending'].includes(period.status)))
  // No goal settlement currently has a skipped outcome; skips of a goal
  // belong to /plans/action-history and should not be fabricated here.
  const items=matching.slice(0,opts.limit)
  const next=matching.length>opts.limit?items.at(-1):
    periods.length>scanLimit?shown.at(-1):null
  return json({items,nextCursor:next?next.periodEnd+'|'+next.goalId:null})
}
