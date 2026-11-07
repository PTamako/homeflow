import {json} from './security.js'

const DEFAULT_POINTS=10
export function pointLevel(score){
  const points=Math.max(0,Number(score)||0)
  const level=1+Math.floor(points/100)
  const progress=points%100
  const title=points>=1000?'家庭守护星':points>=600?'家庭达人':
    points>=300?'可靠帮手':points>=100?'家务搭档':'成长新手'
  return {level,title,progress,nextLevelIn:100-progress}
}

export function tokyoMonthWindow(now=Date.now()){
  const month=new Date(now+9*3600000).toISOString().slice(0,7)
  const [year,value]=month.split('-').map(Number)
  const begin=new Date(Date.UTC(year,value-1,1)-9*3600000).toISOString()
  const end=new Date(Date.UTC(year,value,1)-9*3600000).toISOString()
  return {month,begin,end}
}

// Read-only aggregation; creators/assignees cannot earn points by merely assigning a task.
// The triggers award the logged-in completer, one row per task or routine occurrence.
export async function pointsRoute(request,db,session){
  if(request.method!=='GET')return json({error:'method_not_allowed'},405)
  const h=session.household_id,u=session.user_id
  const {month,begin,end}=tokyoMonthWindow()
  const members=await db.prepare(`SELECT m.user_id AS userId,
      COALESCE((SELECT p.display_name FROM family_profiles p
        WHERE p.household_id=m.household_id AND p.member_user_id=m.user_id
          AND p.archived_at IS NULL ORDER BY p.created_at DESC LIMIT 1),
        u.login_name) AS displayName,
      COALESCE(SUM(CASE WHEN cp.visibility='household' THEN cp.points ELSE 0 END),0) AS sharedPoints,
      COALESCE(SUM(CASE WHEN cp.visibility='household'
        AND cp.earned_at>=?2 AND cp.earned_at<?3 THEN cp.points ELSE 0 END),0) AS monthPoints,
      COALESCE(SUM(CASE WHEN cp.visibility='household' AND cp.kind='routine'
        THEN cp.points ELSE 0 END),0) AS routinePoints
    FROM household_members m JOIN users u ON u.id=m.user_id
    LEFT JOIN completion_points cp ON cp.household_id=m.household_id
      AND cp.earner_user_id=m.user_id
    WHERE m.household_id=?1
    GROUP BY m.user_id,u.login_name
    ORDER BY sharedPoints DESC,monthPoints DESC,m.user_id`).bind(h,begin,end).all()
  const own=await db.prepare(`SELECT
      COALESCE(SUM(points),0) AS privatePoints,
      COALESCE(SUM(CASE WHEN earned_at>=?3 AND earned_at<?4
        THEN points ELSE 0 END),0) AS privateMonthPoints
    FROM completion_points WHERE household_id=?1 AND earner_user_id=?2
      AND visibility='private'`).bind(h,u,begin,end).first()
  return json({
    month,pointsPerCompletion:DEFAULT_POINTS,
    members:(members.results||[]).map(row=>({
      userId:row.userId,displayName:row.displayName,
      sharedPoints:Number(row.sharedPoints)||0,
      monthPoints:Number(row.monthPoints)||0,
      routinePoints:Number(row.routinePoints)||0,
      ...pointLevel(row.sharedPoints)
    })),
    ownPrivatePoints:Number(own?.privatePoints)||0,
    ownPrivateMonthPoints:Number(own?.privateMonthPoints)||0
  })
}
