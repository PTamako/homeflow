import {householdWalletSql} from './points-wallet.js'
import {json} from './security.js'

// Read-only reconstruction of the original points ledger, including prior years.
// No client-supplied SQL fragments, no new tables, and no destructive reset job.
const source=(table,a,user,visibility,amount,category,label,stamp,extra='')=>
 `SELECT ${user} AS userId,${visibility} AS visibility,${amount} AS amount,
   CASE WHEN ${visibility}='household' THEN ${amount} ELSE 0 END AS contribution,
   '${category}' AS category,${label} AS label,${stamp} AS stamp
   FROM ${table} ${a} WHERE ${a}.household_id=?1 ${extra}`

export const annualPointLedgerSql=()=>{
 const lines=[
  // Present the actual credit per completed task, not an artificial +10/-5 pair.
  // The canonical base, adjustment and negative dual split remain intact in D1.
  `SELECT c.earner_user_id AS userId,c.visibility,
    (c.points+COALESCE(a.delta,0)+COALESCE(d.points,0)) AS amount,
    CASE WHEN c.visibility='household'
      THEN c.points+COALESCE(a.delta,0)+COALESCE(d.points,0) ELSE 0 END AS contribution,
    'complete' AS category,
    CASE WHEN c.kind='routine'
      THEN COALESCE((SELECT title FROM routines WHERE id=c.source_id AND household_id=c.household_id),'周期任务')
      ELSE COALESCE((SELECT title FROM tasks WHERE id=c.source_id AND household_id=c.household_id),'一次性任务') END AS label,
    c.earned_at AS stamp
    FROM completion_points c
    LEFT JOIN completion_point_adjustments a ON a.household_id=c.household_id
      AND a.kind=c.kind AND a.source_id=c.source_id AND a.occurrence_on=c.occurrence_on
    LEFT JOIN dual_completion_splits d ON d.household_id=c.household_id
      AND d.kind=c.kind AND d.source_id=c.source_id AND d.occurrence_on=c.occurrence_on
      AND d.user_id=c.earner_user_id AND d.points<0
    WHERE c.household_id=?1`,
  // The second participant receives a separate +2.5 credit under the real task title.
  source('dual_completion_splits','d','d.user_id','d.visibility','d.points','complete',
   "CASE WHEN d.kind='routine' THEN COALESCE((SELECT title FROM routines WHERE id=d.source_id AND household_id=d.household_id),'周期任务') ELSE COALESCE((SELECT title FROM tasks WHERE id=d.source_id AND household_id=d.household_id),'一次性任务') END",'d.earned_at','AND d.points>0'),
  // A verified shared purchase shows its real +1 / +1 distribution, not +2/-1/+1.
  `SELECT s.earner_user_id AS userId,s.visibility,
    (s.points+COALESCE(j.points,0)) AS amount,
    CASE WHEN s.visibility='household' THEN s.points+COALESCE(j.points,0) ELSE 0 END AS contribution,
    'shopping' AS category,
    COALESCE((SELECT title FROM shopping_items WHERE id=s.shopping_id AND household_id=s.household_id),'购物计划完成') AS label,
    s.earned_at AS stamp
    FROM shopping_completion_points s
    LEFT JOIN shopping_joint_credits j ON j.household_id=s.household_id
      AND j.shopping_id=s.shopping_id AND j.user_id=s.earner_user_id AND j.points<0
    WHERE s.household_id=?1`,
  source('shopping_joint_credits','j','j.user_id','j.visibility','j.points','shopping',
   "COALESCE((SELECT title FROM shopping_items WHERE id=j.shopping_id AND household_id=j.household_id),'购物计划完成')",'j.earned_at','AND j.points>0'),
  source('weekly_challenge_awards','w','w.user_id',"'household'",'w.points','weekly',"'每周挑战奖励'",'w.awarded_at'),
  source('goal_completion_rewards','g','g.user_id',"'household'",'g.points','savings',"'储值计划达标'",'g.awarded_at'),
  source('trip_completion_rewards','t','t.user_id','t.visibility','t.points','trip',"'旅行完成奖励'",'t.awarded_at'),
  source('monthly_achievement_credits','a','a.user_id',"'household'",'a.points','achievement',"'月度成就奖励'",'a.awarded_at'),
  source('household_lottery_draws','l','l.user_id',"'household'",'l.prize_points+l.prize_bonus_points','lottery_prize',"'抽奖中奖'",'l.created_at','AND l.prize_points+l.prize_bonus_points>0'),
  // Prize and ticket cost are separate so spent totals and yearly balance reconcile.
  `SELECT l.user_id AS userId,'household' AS visibility,
    -CASE WHEN l.ticket_coupon_id IS NULL THEN l.cost_points ELSE 0 END AS amount,
    0 AS contribution,'lottery_cost' AS category,'抽奖消耗' AS label,l.created_at AS stamp
    FROM household_lottery_draws l WHERE l.household_id=?1`,
  // A multi-quantity redemption writes one row per unit for atomic inventory,
  // but the ledger presents that purchase as ONE event (and one pagination slot).
  // The stable first 36 characters identify the original request UUID; a later
  // purchase of the same reward has a different UUID and remains separate.
  `SELECT r.redeemed_by AS userId,'household' AS visibility,-SUM(r.points_spent)+COALESCE(SUM(d.discount_points),0) AS amount,
    0 AS contribution,'redeem' AS category,
    '兑换：'||r.title_snapshot||
      CASE WHEN COUNT(*)>1 THEN ' ×'||COUNT(*) ELSE '' END AS label,
    MAX(r.created_at) AS stamp
    FROM reward_redemptions r LEFT JOIN reward_coupon_discounts d ON d.redemption_id=r.id
    WHERE r.household_id=?1
    GROUP BY r.household_id,r.redeemed_by,SUBSTR(r.client_request_id,1,36),
      r.reward_id,r.title_snapshot,r.icon_snapshot`,
  `SELECT c.user_id AS userId,'household' AS visibility,-c.points AS amount,
    0 AS contribution,'pool' AS category,'合力兑换：'||g.title_snapshot AS label,c.created_at AS stamp
    FROM reward_group_contributions c
    JOIN reward_group_orders g ON g.id=c.order_id AND g.household_id=c.household_id
    WHERE c.household_id=?1 AND
      (g.status<>'cancelled' OR datetime(g.cancelled_at)>=datetime(?3))`,
  // Assignment reservations affect the wallet before a task is completed.
  // Contribution only changes after a qualifying completion in the same year.
  `SELECT t.assignee_user_id AS userId,'household' AS visibility,t.bonus_points AS amount,
    CASE WHEN datetime(t.completed_at)>=datetime(?2) AND datetime(t.completed_at)<datetime(?3)
      THEN t.bonus_points ELSE 0 END AS contribution,
    'bounty' AS category,'指定任务奖励：'||t.title AS label,CASE WHEN t.completed_at IS NOT NULL THEN t.completed_at ELSE t.created_at END AS stamp
    FROM tasks t WHERE t.household_id=?1 AND t.visibility='household'
      AND t.deleted_at IS NULL AND t.bonus_points>0 AND t.second_assignee_user_id IS NULL
      AND t.assignee_user_id IS NOT NULL AND t.assignee_user_id<>t.creator_user_id
      AND t.completed_at IS NOT NULL AND t.completed_by=t.assignee_user_id`,
  `SELECT t.creator_user_id AS userId,'household' AS visibility,-t.bonus_points AS amount,
    CASE WHEN datetime(t.completed_at)>=datetime(?2) AND datetime(t.completed_at)<datetime(?3)
      THEN -t.bonus_points ELSE 0 END AS contribution,
    'reserved' AS category,'指定任务积分：'||t.title AS label,CASE WHEN t.completed_at IS NOT NULL THEN t.completed_at ELSE t.created_at END AS stamp
    FROM tasks t WHERE t.household_id=?1 AND t.visibility='household'
      AND t.deleted_at IS NULL AND t.bonus_points>0 AND t.second_assignee_user_id IS NULL
      AND t.assignee_user_id IS NOT NULL AND t.assignee_user_id<>t.creator_user_id
      AND (t.completed_at IS NULL OR t.completed_by=t.assignee_user_id)`,
  `SELECT a.userId AS userId,'household' AS visibility,t.bonus_points/2.0 AS amount,
    CASE WHEN datetime(t.completed_at)>=datetime(?2) AND datetime(t.completed_at)<datetime(?3)
      THEN t.bonus_points/2.0 ELSE 0 END AS contribution,
    'bounty' AS category,'双人指定奖励：'||t.title AS label,CASE WHEN t.completed_at IS NOT NULL THEN t.completed_at ELSE t.created_at END AS stamp
    FROM tasks t JOIN (
      SELECT id,household_id,assignee_user_id AS userId FROM tasks
      UNION ALL SELECT id,household_id,second_assignee_user_id AS userId FROM tasks
    ) a ON a.id=t.id AND a.household_id=t.household_id
    WHERE t.household_id=?1 AND t.visibility='household' AND t.deleted_at IS NULL
      AND t.bonus_points>0 AND t.second_assignee_user_id IS NOT NULL
      AND t.completed_at IS NOT NULL
      AND t.completed_by IN(t.assignee_user_id,t.second_assignee_user_id)`,
  `SELECT t.creator_user_id AS userId,'household' AS visibility,-t.bonus_points AS amount,
    CASE WHEN datetime(t.completed_at)>=datetime(?2) AND datetime(t.completed_at)<datetime(?3)
      THEN -t.bonus_points ELSE 0 END AS contribution,
    'reserved' AS category,'双人指定积分：'||t.title AS label,CASE WHEN t.completed_at IS NOT NULL THEN t.completed_at ELSE t.created_at END AS stamp
    FROM tasks t WHERE t.household_id=?1 AND t.visibility='household'
      AND t.deleted_at IS NULL AND t.bonus_points>0 AND t.second_assignee_user_id IS NOT NULL
      AND (t.completed_at IS NULL OR t.completed_by IN(t.assignee_user_id,t.second_assignee_user_id))`,
  `SELECT a.assignee_user_id AS userId,'household' AS visibility,a.bonus_points AS amount,
    CASE WHEN datetime(m.completed_at)>=datetime(?2) AND datetime(m.completed_at)<datetime(?3)
      THEN a.bonus_points ELSE 0 END AS contribution,
    'bounty' AS category,'周期指派奖励：'||r.title AS label,CASE WHEN m.completed_at IS NOT NULL THEN m.completed_at ELSE a.created_at END AS stamp
    FROM routine_occurrence_assignments a
    JOIN routines r ON r.id=a.routine_id AND r.household_id=a.household_id
    JOIN routine_marks m ON m.routine_id=a.routine_id AND m.occurrence_on=a.occurrence_on
    WHERE a.household_id=?1 AND r.visibility='household' AND r.deleted_at IS NULL
      AND a.bonus_points>0 AND a.second_assignee_user_id IS NULL AND r.created_by<>a.assignee_user_id
      AND m.completed_at IS NOT NULL AND m.completed_by=a.assignee_user_id`,
  `SELECT r.created_by AS userId,'household' AS visibility,-a.bonus_points AS amount,
    CASE WHEN datetime(m.completed_at)>=datetime(?2) AND datetime(m.completed_at)<datetime(?3)
      THEN -a.bonus_points ELSE 0 END AS contribution,
    'reserved' AS category,'周期指派积分：'||r.title AS label,CASE WHEN m.completed_at IS NOT NULL THEN m.completed_at ELSE a.created_at END AS stamp
    FROM routine_occurrence_assignments a
    JOIN routines r ON r.id=a.routine_id AND r.household_id=a.household_id
    LEFT JOIN routine_marks m ON m.routine_id=a.routine_id AND m.occurrence_on=a.occurrence_on
    WHERE a.household_id=?1 AND r.visibility='household' AND r.deleted_at IS NULL
      AND a.bonus_points>0 AND a.second_assignee_user_id IS NULL AND r.created_by<>a.assignee_user_id
      AND ((m.completed_at IS NULL AND m.skipped_at IS NULL) OR
           (m.completed_at IS NOT NULL AND m.completed_by=a.assignee_user_id))`,
  `SELECT a.userId AS userId,'household' AS visibility,rp.bonus_points/2.0 AS amount,
    CASE WHEN datetime(m.completed_at)>=datetime(?2) AND datetime(m.completed_at)<datetime(?3)
      THEN rp.bonus_points/2.0 ELSE 0 END AS contribution,
    'bounty' AS category,'双人周期奖励：'||r.title AS label,rp.created_at AS stamp
    FROM routine_occurrence_assignments rp
    JOIN routines r ON r.id=rp.routine_id AND r.household_id=rp.household_id
    JOIN routine_marks m ON m.routine_id=rp.routine_id AND m.occurrence_on=rp.occurrence_on
    JOIN (
      SELECT routine_id,household_id,occurrence_on,assignee_user_id AS userId FROM routine_occurrence_assignments
      UNION ALL SELECT routine_id,household_id,occurrence_on,second_assignee_user_id AS userId FROM routine_occurrence_assignments
    ) a ON a.routine_id=rp.routine_id AND a.household_id=rp.household_id AND a.occurrence_on=rp.occurrence_on
    WHERE rp.household_id=?1 AND r.visibility='household' AND r.deleted_at IS NULL
      AND rp.bonus_points>0 AND rp.second_assignee_user_id IS NOT NULL
      AND m.completed_at IS NOT NULL AND m.completed_by IN(rp.assignee_user_id,rp.second_assignee_user_id)`,
  `SELECT r.created_by AS userId,'household' AS visibility,-a.bonus_points AS amount,
    CASE WHEN datetime(m.completed_at)>=datetime(?2) AND datetime(m.completed_at)<datetime(?3)
      THEN -a.bonus_points ELSE 0 END AS contribution,
    'reserved' AS category,'双人周期积分：'||r.title AS label,CASE WHEN m.completed_at IS NOT NULL THEN m.completed_at ELSE a.created_at END AS stamp
    FROM routine_occurrence_assignments a
    JOIN routines r ON r.id=a.routine_id AND r.household_id=a.household_id
    LEFT JOIN routine_marks m ON m.routine_id=a.routine_id AND m.occurrence_on=a.occurrence_on
    WHERE a.household_id=?1 AND r.visibility='household' AND r.deleted_at IS NULL
      AND a.bonus_points>0 AND a.second_assignee_user_id IS NOT NULL
      AND ((m.completed_at IS NULL AND m.skipped_at IS NULL) OR
           (m.completed_at IS NOT NULL AND m.completed_by IN(a.assignee_user_id,a.second_assignee_user_id)))`
 ]
 // Cloudflare D1 limits the number of terms in each compound SELECT.
 // Group the ledger sources into small subqueries to keep every UNION under
 // D1's limit, while preserving all entries and original row-level filters.
 const groups=[]
 for(let i=0;i<lines.length;i+=5)
   groups.push('SELECT * FROM ('+lines.slice(i,i+5).join(' UNION ALL ')+')')
 return groups.join(' UNION ALL ')
}

// Grouping is a *presentation-only* projection. Keep the original ledger intact
// for annual earned/spent totals, but render one row per lottery draw (rather
// than separate prize and ticket rows occupying two pagination slots).
export const pointsDisplayLedgerSql=raw=>`WITH ledger AS (${raw}),
display AS (
  SELECT userId,visibility,amount,contribution,category,label,stamp,
    NULL AS prizeKind,NULL AS ticketCost,NULL AS prizePoints,NULL AS eventId
  FROM ledger WHERE category NOT IN ('lottery_cost','lottery_prize')
  UNION ALL
  SELECT l.user_id AS userId,'household' AS visibility,
    l.prize_points+l.prize_bonus_points-
      CASE WHEN l.ticket_coupon_id IS NULL THEN l.cost_points ELSE 0 END AS amount,0 AS contribution,
    'lottery' AS category,
    CASE WHEN l.special_prize_kind='ticket' THEN '好运箱 · 免费抽奖券'
      WHEN l.special_prize_kind='shop' THEN '好运箱 · 商城95折券'
      WHEN l.special_prize_kind='wish' THEN '好运箱 · 心愿加速券'
      WHEN l.prize_kind='empty' THEN '空手而归'
      WHEN l.prize_kind='double' THEN '好运箱 · 传说翻倍'
      WHEN l.prize_kind='five' AND l.prize_bonus_points=1 THEN '好运箱 · 幸运小赚'
      ELSE '好运箱 · 中奖' END AS label,
    l.created_at AS stamp,
    COALESCE(l.special_prize_kind,CASE WHEN l.prize_kind='five' AND l.prize_bonus_points=1
      THEN 'six' ELSE l.prize_kind END) AS prizeKind,
    CASE WHEN l.ticket_coupon_id IS NULL THEN l.cost_points ELSE 0 END AS ticketCost,
    l.prize_points+l.prize_bonus_points AS prizePoints,l.id AS eventId
  FROM household_lottery_draws l WHERE l.household_id=?1
  UNION ALL
  SELECT c.user_id,'household',0,0,
    CASE c.kind WHEN 'ticket' THEN 'coupon_ticket_use'
      WHEN 'shop' THEN 'coupon_shop_use' ELSE 'coupon_wish_use' END,
    CASE c.kind WHEN 'ticket' THEN '使用免费抽奖券'
      WHEN 'shop' THEN '使用商城95折券'
      ELSE '心愿加速券 · ¥100' END,
    c.used_at,NULL,NULL,NULL,c.id
  FROM lottery_coupons c WHERE c.household_id=?1 AND c.used_at IS NOT NULL
  UNION ALL
  SELECT c.user_id,'household',0,0,
    CASE c.kind WHEN 'ticket' THEN 'coupon_ticket_expire'
      WHEN 'shop' THEN 'coupon_shop_expire' ELSE 'coupon_wish_expire' END,
    CASE c.kind WHEN 'ticket' THEN '免费抽奖券到期'
      WHEN 'shop' THEN '商城95折券到期'
      ELSE '心愿加速券到期' END,
    datetime(c.expires_on,'+1 day','-9 hours'),NULL,NULL,NULL,c.id
  FROM lottery_coupons c WHERE c.household_id=?1 AND c.used_at IS NULL
    AND c.expires_on<date('now','+9 hours')
)`
const POINTS_CATEGORY_FILTERS=Object.freeze({
 all:'1=1',
 task:"category IN ('complete','bounty','reserved')",
 shopping:"category='shopping'",
 lottery:"(category='lottery' OR category LIKE 'coupon_%')",
 // Only marketplace coupon events belong in the Shop tab. Free tickets and wish
 // coupons remain visible in the Lottery tab and the unfiltered yearly ledger.
 shop:"category IN ('redeem','pool','coupon_shop_use','coupon_shop_expire')",
 achievement:"category IN ('weekly','achievement')",
 saving:"category IN ('savings','trip')"
})

const validYear=(text,current)=>/^\d{4}$/.test(text)&&Number(text)>=2026&&Number(text)<=current
export function jstYearWindow(year){
 const start=new Date(Date.UTC(year-1,11,31,15)).toISOString()
 const end=new Date(Date.UTC(year,11,31,15)).toISOString()
 return {start,end}
}

export async function pointsHistoryRoute(request,db,session){
 if(request.method!=='GET')return json({error:'method_not_allowed'},405)
 const url=new URL(request.url)
 const current=new Date(Date.now()+9*3600000).getUTCFullYear()
 const selected=url.searchParams.get('year')||String(current)
 const pageText=url.searchParams.get('page')||'1'
 const requestedMember=url.searchParams.get('member')||''
 const selectedCategory=url.searchParams.get('category')||'all'
 if(!validYear(selected,current)||!/^\d{1,5}$/.test(pageText)||
   Number(pageText)<1||Number(pageText)>9999||
   (requestedMember.length>100)||!Object.hasOwn(POINTS_CATEGORY_FILTERS,selectedCategory))
   return json({error:'invalid_input'},400)
 const year=Number(selected),page=Number(pageText),{start,end}=jstYearWindow(year)
 const h=session.household_id,u=session.user_id
 const raw=annualPointLedgerSql()
 const display=pointsDisplayLedgerSql(raw)
 const categoryRule=POINTS_CATEGORY_FILTERS[selectedCategory]
 const period=`datetime(stamp)>=datetime(?2) AND datetime(stamp)<datetime(?3)
    AND (visibility='household' OR userId=?4)`
 const [members,totals,history,count]=await Promise.all([
  db.prepare(`SELECT m.user_id AS userId,
    COALESCE((SELECT fp.display_name FROM family_profiles fp
      WHERE fp.household_id=m.household_id AND fp.member_user_id=m.user_id
        AND fp.archived_at IS NULL ORDER BY fp.created_at DESC LIMIT 1),users.login_name) AS displayName,
    MAX(0,${householdWalletSql('m.household_id','m.user_id','?2','?3')}) AS endingPoints
    FROM household_members m JOIN users ON users.id=m.user_id
    WHERE m.household_id=?1 ORDER BY m.user_id`).bind(h,start,end).all(),
  db.prepare(`WITH ledger AS (${raw})
    SELECT userId,
      COALESCE(SUM(CASE WHEN amount>0 THEN amount ELSE 0 END),0) AS earned,
      COALESCE(-SUM(CASE WHEN amount<0 THEN amount ELSE 0 END),0) AS spent,
      COALESCE(SUM(CASE WHEN visibility='household' THEN contribution ELSE 0 END),0) AS contribution,
      COALESCE(SUM(CASE WHEN visibility='private' THEN amount ELSE 0 END),0) AS privatePoints,
      COALESCE(SUM(CASE WHEN category IN('lottery_cost','lottery_prize') THEN amount ELSE 0 END),0) AS lotteryNet
    FROM ledger WHERE ${period} GROUP BY userId`).bind(h,start,end,u).all(),
  db.prepare(`${display}
    SELECT userId,visibility,amount,contribution,category,label,stamp,
      prizeKind,ticketCost,prizePoints,eventId
    FROM display WHERE ${period} AND (?5='' OR userId=?5)
      AND ${categoryRule}
    ORDER BY datetime(stamp) DESC,category DESC,label DESC,eventId DESC
    LIMIT 5 OFFSET ?6`).bind(h,start,end,u,requestedMember,(page-1)*5).all(),
  db.prepare(`${display}
    SELECT COUNT(*) AS total FROM display WHERE ${period}
      AND (?5='' OR userId=?5) AND ${categoryRule}`)
      .bind(h,start,end,u,requestedMember).first()
 ])
 const byUser=new Map((totals.results||[]).map(x=>[x.userId,x]))
 const rows=(members.results||[]).map(member=>{
  const t=byUser.get(member.userId)||{}
  return {userId:member.userId,displayName:member.displayName,
    contributionPoints:Number(t.contribution)||0,
    earnedPoints:Number(t.earned)||0,spentPoints:Number(t.spent)||0,
    lotteryNetPoints:Number(t.lotteryNet)||0,
    privatePoints:member.userId===u?Number(t.privatePoints)||0:null,
    endingPoints:Math.max(0,Number(member.endingPoints)||0),
    expiredPoints:year<current?Math.max(0,Number(member.endingPoints)||0):null}
 })
 const total=Number(count?.total)||0
 return json({year,currentYear:current,members:rows,memberFilter:requestedMember,
   categoryFilter:selectedCategory,
   entries:(history.results||[]).map(x=>({
     ...x,amount:Number(x.amount),contribution:Number(x.contribution),
     ticketCost:x.ticketCost===null?null:Number(x.ticketCost),
     prizePoints:x.prizePoints===null?null:Number(x.prizePoints)
   })),
   page,pageSize:5,total,totalPages:Math.max(1,Math.ceil(total/5))})
}
