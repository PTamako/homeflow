import {householdWalletSql,pointYearPredicate} from './points-wallet.js'
import {contributionAssignmentDeltaSql,contributionWeeklySql} from './contribution.js'
import {json} from './security.js'

const DEFAULT_POINTS=5
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

// Read-only aggregation. All actually earned household credits (except lottery)
// count toward contribution, including +/- funded task bounties and weekly bonuses.
// A pending assignment reserves wallet funds but does NOT change contribution.
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
      COALESCE(SUM(CASE WHEN cp.visibility='household' AND ${pointYearPredicate('cp.earned_at')} THEN cp.points ELSE 0 END),0)
      +COALESCE((SELECT SUM(a.delta) FROM completion_point_adjustments a WHERE a.household_id=m.household_id AND a.earner_user_id=m.user_id AND a.visibility='household' AND ${pointYearPredicate('a.earned_at')}),0)
      +COALESCE((SELECT SUM(j.points) FROM dual_completion_splits j WHERE j.household_id=m.household_id AND j.user_id=m.user_id AND j.visibility='household' AND ${pointYearPredicate('j.earned_at')}),0)
      +COALESCE((SELECT SUM(s.points) FROM shopping_completion_points s WHERE s.household_id=m.household_id AND s.earner_user_id=m.user_id AND s.visibility='household' AND ${pointYearPredicate('s.earned_at')}),0)
      +COALESCE((SELECT SUM(j.points) FROM shopping_joint_credits j WHERE j.household_id=m.household_id AND j.user_id=m.user_id AND j.visibility='household' AND ${pointYearPredicate('j.earned_at')}),0)  +COALESCE((SELECT SUM(gr.points) FROM goal_completion_rewards gr WHERE gr.household_id=m.household_id AND gr.user_id=m.user_id AND ${pointYearPredicate('gr.awarded_at')}),0)
      +COALESCE((SELECT SUM(tr.points) FROM trip_completion_rewards tr WHERE tr.household_id=m.household_id AND tr.user_id=m.user_id AND tr.visibility='household' AND ${pointYearPredicate('tr.awarded_at')}),0)
      +COALESCE((SELECT SUM(ma.points) FROM monthly_achievement_credits ma WHERE ma.household_id=m.household_id AND ma.user_id=m.user_id AND ma.month_on>=strftime('%Y-01','now','+9 hours')),0)
      +${contributionWeeklySql('m.household_id','m.user_id')}
      +${contributionAssignmentDeltaSql('m.household_id','m.user_id')}
      AS sharedPoints,
      COALESCE(SUM(CASE WHEN cp.visibility='household'
        AND cp.earned_at>=?2 AND cp.earned_at<?3 THEN cp.points ELSE 0 END),0)
      +COALESCE((SELECT SUM(a.delta) FROM completion_point_adjustments a WHERE a.household_id=m.household_id AND a.earner_user_id=m.user_id AND a.visibility='household' AND a.earned_at>=?2 AND a.earned_at<?3),0)
      +COALESCE((SELECT SUM(j.points) FROM dual_completion_splits j WHERE j.household_id=m.household_id AND j.user_id=m.user_id AND j.visibility='household' AND j.earned_at>=?2 AND j.earned_at<?3),0)
      +COALESCE((SELECT SUM(s.points) FROM shopping_completion_points s WHERE s.household_id=m.household_id AND s.earner_user_id=m.user_id AND s.visibility='household' AND s.earned_at>=?2 AND s.earned_at<?3),0)
      +COALESCE((SELECT SUM(j.points) FROM shopping_joint_credits j WHERE j.household_id=m.household_id AND j.user_id=m.user_id AND j.visibility='household' AND j.earned_at>=?2 AND j.earned_at<?3),0)  +COALESCE((SELECT SUM(gr.points) FROM goal_completion_rewards gr WHERE gr.household_id=m.household_id AND gr.user_id=m.user_id AND gr.awarded_at>=?2 AND gr.awarded_at<?3),0)
      +COALESCE((SELECT SUM(tr.points) FROM trip_completion_rewards tr WHERE tr.household_id=m.household_id AND tr.user_id=m.user_id AND tr.visibility='household' AND tr.awarded_at>=?2 AND tr.awarded_at<?3),0)
      +COALESCE((SELECT SUM(ma.points) FROM monthly_achievement_credits ma WHERE ma.household_id=m.household_id AND ma.user_id=m.user_id AND ma.month_on=strftime('%Y-%m',?2,'+9 hours')),0)
      +${contributionWeeklySql('m.household_id','m.user_id','?2','?3')}
      +${contributionAssignmentDeltaSql('m.household_id','m.user_id','?2','?3')}
      AS monthPoints,
      COALESCE(SUM(CASE WHEN cp.visibility='household' AND cp.kind='routine' AND ${pointYearPredicate('cp.earned_at')}
        THEN cp.points ELSE 0 END),0)
      +COALESCE((SELECT SUM(a.delta) FROM completion_point_adjustments a WHERE a.household_id=m.household_id AND a.earner_user_id=m.user_id AND a.visibility='household' AND a.kind='routine' AND ${pointYearPredicate('a.earned_at')}),0)
      +COALESCE((SELECT SUM(j.points) FROM dual_completion_splits j WHERE j.household_id=m.household_id AND j.user_id=m.user_id AND j.kind='routine' AND j.visibility='household' AND ${pointYearPredicate('j.earned_at')}),0) AS routinePoints,
      -- Each member's spendable wallet is the exact same ledger expression
      -- used by redemptions; lottery changes wallet, never contribution scores.
      MAX(0,${householdWalletSql('m.household_id','m.user_id')}) AS availablePoints
    FROM household_members m JOIN users u ON u.id=m.user_id
    LEFT JOIN completion_points cp ON cp.household_id=m.household_id
      AND cp.earner_user_id=m.user_id
    WHERE m.household_id=?1
    GROUP BY m.user_id,u.login_name
    ORDER BY sharedPoints DESC,monthPoints DESC,m.user_id`).bind(h,begin,end).all()
  const week=tokyoWeekWindow()
  const [own,totals,streakDays,monthProgress,monthAwards]=await Promise.all([
    db.prepare(`SELECT
      COALESCE(SUM(points),0)
      +COALESCE((SELECT SUM(a.delta) FROM completion_point_adjustments a WHERE a.household_id=?1 AND a.earner_user_id=?2 AND a.visibility='private' AND ${pointYearPredicate('a.earned_at')}),0)
      +COALESCE((SELECT SUM(s.points) FROM shopping_completion_points s WHERE s.household_id=?1 AND s.earner_user_id=?2 AND s.visibility='private' AND ${pointYearPredicate('s.earned_at')}),0)
      +COALESCE((SELECT SUM(tr.points) FROM trip_completion_rewards tr WHERE tr.household_id=?1 AND tr.user_id=?2 AND tr.visibility='private' AND ${pointYearPredicate('tr.awarded_at')}),0) AS privatePoints,
      COALESCE(SUM(CASE WHEN earned_at>=?3 AND earned_at<?4
        THEN points ELSE 0 END),0)
      +COALESCE((SELECT SUM(a.delta) FROM completion_point_adjustments a WHERE a.household_id=?1 AND a.earner_user_id=?2 AND a.visibility='private' AND a.earned_at>=?3 AND a.earned_at<?4),0)
      +COALESCE((SELECT SUM(s.points) FROM shopping_completion_points s WHERE s.household_id=?1 AND s.earner_user_id=?2 AND s.visibility='private' AND s.earned_at>=?3 AND s.earned_at<?4),0)
      +COALESCE((SELECT SUM(tr.points) FROM trip_completion_rewards tr WHERE tr.household_id=?1 AND tr.user_id=?2 AND tr.visibility='private' AND tr.awarded_at>=?3 AND tr.awarded_at<?4),0) AS privateMonthPoints
      FROM completion_points WHERE household_id=?1 AND earner_user_id=?2
        AND visibility='private' AND ${pointYearPredicate('earned_at')}`).bind(h,u,begin,end).first(),
    db.prepare(`SELECT
      (SELECT COALESCE(SUM(points),0) FROM completion_points
        WHERE household_id=?1 AND earner_user_id=?2 AND ${pointYearPredicate('earned_at')})
      + (SELECT COALESCE(SUM(delta),0) FROM completion_point_adjustments WHERE household_id=?1 AND earner_user_id=?2 AND ${pointYearPredicate('earned_at')})
      + (SELECT COALESCE(SUM(points),0) FROM shopping_completion_points WHERE household_id=?1 AND earner_user_id=?2 AND ${pointYearPredicate('earned_at')})
      + (SELECT COALESCE(SUM(points),0) FROM shopping_joint_credits WHERE household_id=?1 AND user_id=?2 AND ${pointYearPredicate('earned_at')})
      + (SELECT COALESCE(SUM(points),0) FROM dual_completion_splits WHERE household_id=?1 AND user_id=?2 AND ${pointYearPredicate('earned_at')})
      + (SELECT COALESCE(SUM(points),0) FROM trip_completion_rewards WHERE household_id=?1 AND user_id=?2 AND ${pointYearPredicate('awarded_at')}) AS earned,
      (SELECT COALESCE(SUM(points),0) FROM completion_points
        WHERE household_id=?1 AND earner_user_id=?2
          AND visibility='household' AND ${pointYearPredicate('earned_at')})
      + (SELECT COALESCE(SUM(delta),0) FROM completion_point_adjustments WHERE household_id=?1 AND earner_user_id=?2 AND visibility='household' AND ${pointYearPredicate('earned_at')})
      + (SELECT COALESCE(SUM(points),0) FROM shopping_completion_points WHERE household_id=?1 AND earner_user_id=?2 AND visibility='household' AND ${pointYearPredicate('earned_at')})
      + (SELECT COALESCE(SUM(points),0) FROM shopping_joint_credits WHERE household_id=?1 AND user_id=?2 AND visibility='household' AND ${pointYearPredicate('earned_at')})
      + (SELECT COALESCE(SUM(points),0) FROM dual_completion_splits WHERE household_id=?1 AND user_id=?2 AND visibility='household' AND ${pointYearPredicate('earned_at')})
      + (SELECT COALESCE(SUM(points),0) FROM trip_completion_rewards WHERE household_id=?1 AND user_id=?2 AND visibility='household' AND ${pointYearPredicate('awarded_at')}) AS householdEarned,
      (SELECT COALESCE(SUM(points),0) FROM completion_points
        WHERE household_id=?1 AND earner_user_id=?2 AND kind='routine' AND ${pointYearPredicate('earned_at')})
      + (SELECT COALESCE(SUM(delta),0) FROM completion_point_adjustments WHERE household_id=?1 AND earner_user_id=?2 AND kind='routine' AND ${pointYearPredicate('earned_at')})
      + (SELECT COALESCE(SUM(points),0) FROM dual_completion_splits WHERE household_id=?1 AND user_id=?2 AND kind='routine' AND ${pointYearPredicate('earned_at')}) AS routineEarned,
      (SELECT COALESCE(SUM(points),0) FROM goal_completion_rewards WHERE household_id=?1 AND user_id=?2 AND ${pointYearPredicate('awarded_at')}) AS savingsBonus,
      (SELECT COALESCE(SUM(points),0) FROM trip_completion_rewards WHERE household_id=?1 AND user_id=?2 AND ${pointYearPredicate('awarded_at')}) AS travelBonus,
      (SELECT COALESCE(SUM(points),0) FROM monthly_achievement_credits WHERE household_id=?1 AND user_id=?2 AND month_on>=strftime('%Y-01','now','+9 hours')) AS achievementBonus,
      (SELECT COALESCE(SUM(prize_points+COALESCE(prize_bonus_points,0)-
        CASE WHEN ticket_coupon_id IS NULL THEN cost_points ELSE 0 END),0) FROM household_lottery_draws
        WHERE household_id=?1 AND user_id=?2 AND ${pointYearPredicate('created_at')}) AS lotteryNetPoints,
      (SELECT COUNT(*) FROM completion_points WHERE household_id=?1 AND earner_user_id=?2 AND kind='routine' AND ${pointYearPredicate('earned_at')}) AS routineDone,
      (SELECT COALESCE(SUM(points),0) FROM weekly_challenge_awards
        WHERE household_id=?1 AND user_id=?2 AND ${pointYearPredicate('awarded_at')}) AS bonus,
      (SELECT COUNT(*) FROM weekly_challenge_awards
        WHERE household_id=?1 AND user_id=?2 AND ${pointYearPredicate('awarded_at')}) AS weeksWon,
      (SELECT COALESCE(SUM(points_spent),0) FROM reward_redemptions
        WHERE household_id=?1 AND redeemed_by=?2 AND ${pointYearPredicate('created_at')}) AS directSpent,
      (SELECT COALESCE(SUM(c.points),0) FROM reward_group_contributions c
        JOIN reward_group_orders g ON g.id=c.order_id
        WHERE c.household_id=?1 AND c.user_id=?2
          AND g.status<>'cancelled' AND ${pointYearPredicate('c.created_at')}) AS groupSpent,
      (SELECT COUNT(*) FROM completion_points
        WHERE household_id=?1 AND earner_user_id=?2
        AND visibility='household' AND earned_at>=?3 AND earned_at<?4 AND ${pointYearPredicate('earned_at')}) AS weekDone,
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
        ) AS petCare,
      ${householdWalletSql('?1','?2')} AS availableNow`).bind(h,u,week.begin,week.end).first(),
    db.prepare(`SELECT DISTINCT date(earned_at,'+9 hours') AS day
      FROM completion_points WHERE household_id=?1 AND earner_user_id=?2
        AND date(earned_at,'+9 hours')>=date('now','+9 hours','-90 days')
      ORDER BY day DESC LIMIT 92`).bind(h,u).all(),
    db.prepare(`SELECT task_done AS taskDone,routine_done AS routineDone,
      pet_care_done AS petCare,longest_streak AS longestStreak,
      weekly_wins AS weeksWon FROM monthly_achievement_progress
      WHERE household_id=?1 AND user_id=?2 AND month_on=?3`)
      .bind(h,u,month).first(),
    db.prepare(`SELECT badge_id AS badgeId,points FROM monthly_achievement_credits
      WHERE household_id=?1 AND user_id=?2 AND month_on=?3`)
      .bind(h,u,month).all()
  ])
  const earned=Number(totals?.earned||0),bonus=Number(totals?.bonus||0)
  const savingsBonus=Number(totals?.savingsBonus||0)
  const achievementBonus=Number(totals?.achievementBonus||0)
  const spent=Number(totals?.directSpent||0)+Number(totals?.groupSpent||0)
  const experience=earned+bonus+savingsBonus+achievementBonus
  const awarded=new Set((monthAwards.results||[]).map(row=>row.badgeId))
  const badge=(id,label,icon,target,progress,rewardPoints)=>({
    id,label,icon,target,progress:Math.max(0,Number(progress)||0),
    rewardPoints,unlocked:awarded.has(id)
  })
  const badges=[
    badge('first','初次出发','🌱',1,monthProgress?.taskDone,5),
    badge('routines','周期达人','🔁',5,monthProgress?.routineDone,10),
    badge('challenge','每周挑战王','🏆',1,monthProgress?.weeksWon,15),
    badge('master','家务达人','🏅',30,monthProgress?.taskDone,20),
    badge('pet','毛孩子守护者','🐱',15,monthProgress?.petCare,25),
    badge('streak','连续十四天','🔥',14,monthProgress?.longestStreak,25)
  ]
  return json({
    month,pointsPerCompletion:DEFAULT_POINTS,
    pointRules:{shopping:2,routine:5,goal:0,goalPeriodMet:50,wish:0,onceUnassigned:5,onceAssigned:5,travelPerPersonPerDay:10},
    members:(members.results||[]).map(row=>({
      userId:row.userId,displayName:row.displayName,
      sharedPoints:Number(row.sharedPoints)||0,
      monthPoints:Number(row.monthPoints)||0,
      routinePoints:Number(row.routinePoints)||0,
      availablePoints:Math.max(0,Number(row.availablePoints)||0),
      ...pointLevel(row.sharedPoints)
    })),
    ownPrivatePoints:Number(own?.privatePoints)||0,
    ownPrivateMonthPoints:Number(own?.privateMonthPoints)||0,
    experience,earnedPoints:earned,weeklyBonusPoints:bonus,
    savingsBonusPoints:savingsBonus,travelBonusPoints:Number(totals?.travelBonus||0),achievementBonusPoints:achievementBonus,
    lotteryNetPoints:Number(totals?.lotteryNetPoints||0),spentPoints:spent,
    availablePoints:Math.max(0,Number(totals?.availableNow||0)),
    householdEarnedPoints:Number((members.results||[]).find(row=>row.userId===u)?.sharedPoints||0),
    ownLevel:pointLevel(experience),badges,
    challenge:{weekOn:week.weekOn,completed:Number(totals?.weekDone||0),
      target:10,bonus:30,achieved:Number(totals?.weekDone||0)>=10}
  })
}
