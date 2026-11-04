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
  const cursor=params.get('cursor')||''
  if(!Number.isInteger(limit)||limit<1||limit>maxPageSize||
    (year&&!/^(19|20|21)\d{2}$/.test(year))||
    (month&&!/^(0[1-9]|1[0-2])$/.test(month))||
    (month&&!year)||cursor.length>55)return null
  let before=null
  if(cursor){
    const match=cursor.match(/^(\d{4}-\d{2}-\d{2})\|([0-9a-f-]{36})$/i)
    if(!match||!validDate(match[1])||!uuid.test(match[2]))return null
    before={end:match[1],goalId:match[2]}
  }
  return {limit,year,month,before}
}
export function candidateGoalPeriods(goals,options,today=tokyoDay()){
  const candidates=[]
  for(const g of goals){
    if(!['monthly','yearly'].includes(g.goal_mode))continue
    // Include the cursor's month/year, then use exact (end,id) keyset
    // comparison to handle multiple goals ending on the same date.
    const before=options.before?nextPeriodKey(g.goal_mode,options.before.end):''
    for(const period of closedGoalPeriods(g,today,options.limit+2,before,options.year,options.month)){
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
  const opts=archiveFilter(request.url)
  if(!opts)return json({error:'invalid_filters'},400)
  const {results:goals}=await db.prepare(`SELECT id,title,goal_mode,start_on,target_on,target_amount
    FROM goals WHERE household_id=?1 AND goal_mode IN ('monthly','yearly')
    AND (visibility='household' OR created_by=?2)
    ORDER BY created_at DESC LIMIT 251`)
    .bind(session.household_id,session.user_id).all()
  // Avoid silently hiding the oldest plan if a household grows unusually large.
  if((goals||[]).length>250)return json({error:'archive_goal_limit_exceeded'},409)
  const periods=candidateGoalPeriods(goals||[],opts)
  const shown=periods.slice(0,opts.limit)
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
  const items=shown.map(period=>{
    const record=saved.get(period.goalId+'|'+period.periodKey)
    return {...period,
      status:record?.status||(record?.legacy_completed_at?'met':'pending'),
      targetAmount:record?.target_amount??period.targetAmount,
      actualAmount:record?.actual_amount??null,
      differenceAmount:record?.difference_amount??null,
      settledAt:record?.settled_at||record?.legacy_completed_at||null}
  })
  const last=shown.at(-1)
  return json({items,nextCursor:periods.length>opts.limit?last.periodEnd+'|'+last.goalId:null})
}
