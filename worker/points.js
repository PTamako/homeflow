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

export function tokyoWeekWindow(now=Date.now()){
  const jst=new Date(now+9*3600000)
  const monday=new Date(Date.UTC(jst.getUTCFullYear(),jst.getUTCMonth(),
    jst.getUTCDate()-((jst.getUTCDay()+6)%7))-9*3600000)
  return {weekOn:new Date(monday.getTime()+9*3600000).toISOString().slice(0,10),
    begin:monday.toISOString(),
    end:new Date(monday.getTime()+7*86400000).toISOString()}
}
export function longestStreak(days){
  const sorted=[...new Set(days)].sort()
  let max=0,current=0,prior=''
  for(const day of sorted){
    const prev=prior?new Date(Date.parse(prior+'T00:00:00Z')+86400000).toISOString().slice(0,10):''
    current=day===prev?current+1:1
    max=Math.max(max,current);prior=day
  }
  return max
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
  const week=tokyoWeekWindow()
  const [own,totals,streakDays]=await Promise.all([
    db.prepare(`SELECT
      COALESCE(SUM(points),0) AS privatePoints,
      COALESCE(SUM(CASE WHEN earned_at>=?3 AND earned_at<?4
        THEN points ELSE 0 END),0) AS privateMonthPoints
      FROM completion_points WHERE household_id=?1 AND earner_user_id=?2
        AND visibility='private'`).bind(h,u,begin,end).first(),
    db.prepare(`SELECT
      (SELECT COALESCE(SUM(points),0) FROM completion_points
        WHERE household_id=?1 AND earner_user_id=?2) AS earned,
      (SELECT COALESCE(SUM(points),0) FROM completion_points
        WHERE household_id=?1 AND earner_user_id=?2 AND kind='routine') AS routineEarned,
      (SELECT COALESCE(SUM(points),0) FROM weekly_challenge_awards
        WHERE household_id=?1 AND user_id=?2) AS bonus,
      (SELECT COUNT(*) FROM weekly_challenge_awards
        WHERE household_id=?1 AND user_id=?2) AS weeksWon,
      (SELECT COALESCE(SUM(points_spent),0) FROM reward_redemptions
        WHERE household_id=?1 AND redeemed_by=?2) AS directSpent,
      (SELECT COALESCE(SUM(c.points),0) FROM reward_group_contributions c
        JOIN reward_group_orders g ON g.id=c.order_id
        WHERE c.household_id=?1 AND c.user_id=?2
          AND g.status<>'cancelled') AS groupSpent,
      (SELECT COUNT(*) FROM completion_points
        WHERE household_id=?1 AND earner_user_id=?2
        AND earned_at>=?3 AND earned_at<?4) AS weekDone,
      (SELECT COUNT(*) FROM completion_points cp
        LEFT JOIN tasks t ON cp.kind='task' AND cp.source_id=t.id
          AND t.household_id=cp.household_id
        LEFT JOIN routines r ON cp.kind='routine' AND cp.source_id=r.id
          AND r.household_id=cp.household_id
        WHERE cp.household_id=?1 AND cp.earner_user_id=?2
          AND EXISTS(SELECT 1 FROM family_profiles fp
            WHERE fp.household_id=cp.household_id AND fp.type='pet'
            AND fp.archived_at IS NULL
            AND fp.id=COALESCE(t.subject_profile_id,r.subject_profile_id))
        ) AS petCare`).bind(h,u,week.begin,week.end).first(),
    db.prepare(`SELECT DISTINCT date(earned_at,'+9 hours') AS day
      FROM completion_points WHERE household_id=?1 AND earner_user_id=?2
        AND date(earned_at,'+9 hours')>=date('now','+9 hours','-90 days')
      ORDER BY day DESC LIMIT 92`).bind(h,u).all()
  ])
  const earned=Number(totals?.earned||0),bonus=Number(totals?.bonus||0)
  const spent=Number(totals?.directSpent||0)+Number(totals?.groupSpent||0),experience=earned+bonus
  const badges=[
    {id:'first',label:'初次出发',icon:'🌱',unlocked:earned>=10},
    {id:'routines',label:'周期达人',icon:'🔁',unlocked:Number(totals?.routineEarned||0)>=50},
    {id:'master',label:'家务达人',icon:'🏅',unlocked:earned>=300},
    {id:'pet',label:'毛孩子守护者',icon:'🐱',unlocked:Number(totals?.petCare||0)>=3},
    {id:'challenge',label:'每周挑战王',icon:'🏆',unlocked:Number(totals?.weeksWon||0)>=1},
    {id:'streak',label:'连续七天',icon:'🔥',
      unlocked:longestStreak((streakDays.results||[]).map(row=>row.day))>=7}
  ]
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
    ownPrivateMonthPoints:Number(own?.privateMonthPoints)||0,
    experience,earnedPoints:earned,weeklyBonusPoints:bonus,spentPoints:spent,
    availablePoints:experience-spent,ownLevel:pointLevel(experience),badges,
    challenge:{weekOn:week.weekOn,completed:Number(totals?.weekDone||0),
      target:10,bonus:30,achieved:Number(totals?.weekDone||0)>=10}
  })
}
