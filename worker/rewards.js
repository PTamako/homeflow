import {householdWalletSql,pointYearPredicate,pointYearStartSql} from './points-wallet.js'
import {iso,json,readBody,shortText} from './security.js'

// Prior-year partially funded joint orders are closed without reviving expired balances.
export async function expireOldRewardPools(db){
  const {results=[]}=await db.prepare(`SELECT DISTINCT household_id AS householdId
    FROM reward_group_orders WHERE status='collecting'
      AND datetime(created_at)<${pointYearStartSql} LIMIT 500`).all()
  let expiredPools=0
  const changedHouseholds=[]
  for(const row of results){
    const updated=await db.prepare(`UPDATE reward_group_orders
      SET status='cancelled',cancelled_at=CURRENT_TIMESTAMP
      WHERE household_id=?1 AND status='collecting'
        AND datetime(created_at)<${pointYearStartSql}`).bind(row.householdId).run()
    if(updated.meta?.changes){
      expiredPools+=Number(updated.meta.changes)
      changedHouseholds.push(row.householdId)
    }
  }
  return {expiredPools,changedHouseholds}
}
const icons=new Set(['🎁','🍦','🎬','🍖','🛋️','🐱','☕','🌸','🎮','🎟️','🧹','🎉'])
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// An optional linked wish may only receive a virtual allowance when its
// household-visible or personally-owned one-time JPY goal is active.
// Different reward endpoints use different parameter positions for the user.
const goalJoins=(user,goal,wish)=>`LEFT JOIN goals g ON g.id=${goal} AND g.household_id=r.household_id
  AND g.wish_id=${wish} AND g.goal_mode='once' AND g.currency='JPY'
  AND g.deleted_at IS NULL AND (g.visibility='household' OR g.created_by=${user})
 LEFT JOIN wishes w ON w.id=${wish} AND w.household_id=r.household_id
  AND w.id=g.wish_id AND w.currency='JPY' AND w.deleted_at IS NULL
  AND w.status IN ('wished','planning','active')
  AND (w.visibility='household' OR w.created_by=${user})`
const getList=async(db,household)=>{
  const {results}=await db.prepare(`SELECT r.id,r.title,r.description,r.icon,r.points,r.stock,r.active,
    r.builtin,r.created_by AS createdBy,r.goal_credit_yen AS goalCreditYen,
    ((SELECT COUNT(*) FROM reward_redemptions x WHERE x.reward_id=r.id)+
     (SELECT COUNT(*) FROM reward_group_orders g WHERE g.reward_id=r.id
       AND g.status<>'cancelled')) AS redeemedCount
    FROM reward_items r WHERE r.household_id=?1
    ORDER BY r.active DESC,r.builtin DESC,r.created_at,r.id LIMIT 100`)
    .bind(household).all()
  return (results||[]).map(r=>({...r,points:Number(r.points),
    stock:r.stock===null?null:Number(r.stock),redeemedCount:Number(r.redeemedCount),
    goalCreditYen:Number(r.goalCreditYen)||0,
    active:!!r.active,builtin:!!r.builtin}))
}
const validReward=b=>{
  if(!b||typeof b.title!=='string'||b.title.trim().length<1||b.title.trim().length>60||
    typeof b.description!=='string'&&b.description!==undefined||
    typeof b.description==='string'&&b.description.length>150||
    !Number.isSafeInteger(b.points)||b.points<10||b.points>10000||
    (b.stock!==null&&b.stock!==undefined&&(!Number.isInteger(b.stock)||b.stock<0||b.stock>9999))||
    (b.icon!==undefined&&!icons.has(b.icon))||
    (b.active!==undefined&&typeof b.active!=='boolean')||
    (b.goalCreditYen!==undefined&&(!Number.isSafeInteger(b.goalCreditYen)||
      b.goalCreditYen<0||b.goalCreditYen>100000)))return null
  return {title:b.title.trim(),description:shortText(b.description||'',150),
    icon:b.icon||'🎁',points:b.points,stock:b.stock??null,active:b.active!==false,
    goalCreditYen:b.goalCreditYen??0}
}
export async function rewardsRoute(request,db,path,session){
  const h=session.household_id,u=session.user_id
  if(path==='/api/rewards/wish-goals'&&request.method==='GET'){
    const {results=[]}=await db.prepare(`SELECT w.id AS wishId,w.title AS wishTitle,
      g.id AS goalId,g.title AS goalTitle,g.target_amount AS targetAmount
      FROM wishes w JOIN goals g ON g.wish_id=w.id AND g.household_id=w.household_id
      WHERE w.household_id=?1 AND w.deleted_at IS NULL
        AND w.status IN ('wished','planning','active') AND w.currency='JPY'
        AND (w.visibility='household' OR w.created_by=?2)
        AND g.deleted_at IS NULL AND g.currency='JPY' AND g.goal_mode='once'
        AND (g.visibility='household' OR g.created_by=?2)
      ORDER BY w.created_at DESC,g.created_at DESC LIMIT 100`).bind(h,u).all()
    return json({items:results})
  }
  if(path==='/api/rewards'&&request.method==='GET'){
    const params=new URL(request.url).searchParams
    const redemptionText=params.get('redemptionPage')||'1'
    const groupText=params.get('groupPage')||'1'
    if(!/^[1-9][0-9]{0,3}$/.test(redemptionText)||!/^[1-9][0-9]{0,3}$/.test(groupText))
      return json({error:'invalid_page'},400)
    const redemptionPage=Number(redemptionText),groupPage=Number(groupText),pageSize=5
    const [rewards,history,orders,contributions,redemptionTotal,groupTotal]=await Promise.all([
      getList(db,h),
      db.prepare(`SELECT MIN(x.id) AS id,x.reward_id AS rewardId,x.redeemed_by AS redeemedBy,
        COALESCE((SELECT p.display_name FROM family_profiles p
          WHERE p.household_id=x.household_id AND p.member_user_id=x.redeemed_by
            AND p.archived_at IS NULL ORDER BY p.created_at DESC LIMIT 1),
          m.login_name) AS redeemedByName,
        x.title_snapshot AS title,x.icon_snapshot AS icon,
        SUM(x.points_spent) AS points,COUNT(*) AS quantity,
        SUM(x.goal_credit_yen) AS creditedYen,
        CASE WHEN x.redeemed_by=?2 THEN MAX(x.wish_title_snapshot) ELSE NULL END AS wishTitle,
        CASE WHEN SUM(x.status='requested')>0 THEN 'requested' ELSE 'fulfilled' END AS status,
        MAX(x.created_at) AS createdAt,MAX(x.fulfilled_at) AS fulfilledAt
        FROM reward_redemptions x JOIN users m ON m.id=x.redeemed_by
        WHERE x.household_id=?1
        GROUP BY x.household_id,x.redeemed_by,SUBSTR(x.client_request_id,1,36),
          x.reward_id,x.title_snapshot,x.icon_snapshot
        ORDER BY MAX(x.created_at) DESC,MIN(x.id) DESC LIMIT 5 OFFSET ?3`)
        .bind(h,u,(redemptionPage-1)*pageSize).all(),
      db.prepare(`SELECT o.id,o.reward_id AS rewardId,o.created_by AS createdBy,
        o.title_snapshot AS title,o.icon_snapshot AS icon,o.points_required AS points,
        o.status,o.created_at AS createdAt,o.funded_at AS fundedAt,
        CASE WHEN o.created_by=?2 THEN o.wish_title_snapshot ELSE NULL END AS wishTitle,
        o.goal_credit_yen AS goalCreditYen,
        COALESCE((SELECT SUM(c.points) FROM reward_group_contributions c
          WHERE c.order_id=o.id),0) AS fundedPoints
        FROM reward_group_orders o WHERE o.household_id=?1
          AND o.status<>'cancelled'
           AND (o.status<>'collecting' OR ${pointYearPredicate('o.created_at')})
        ORDER BY o.created_at DESC,o.id DESC LIMIT 5 OFFSET ?3`).bind(h,u,(groupPage-1)*pageSize).all(),
      db.prepare(`SELECT c.order_id AS orderId,c.user_id AS userId,
        COALESCE((SELECT p.display_name FROM family_profiles p
          WHERE p.household_id=c.household_id AND p.member_user_id=c.user_id
          AND p.archived_at IS NULL ORDER BY p.created_at DESC LIMIT 1),
          u.login_name) AS displayName,
        SUM(c.points) AS points
        FROM reward_group_contributions c JOIN users u ON u.id=c.user_id
        WHERE c.household_id=?1 AND c.order_id IN
          (SELECT id FROM reward_group_orders WHERE household_id=?1
            AND status<>'cancelled'
            AND (status<>'collecting' OR ${pointYearPredicate('created_at')})
            ORDER BY created_at DESC,id DESC LIMIT 5 OFFSET ?2)
        GROUP BY c.order_id,c.user_id,u.login_name`).bind(h,(groupPage-1)*pageSize).all()
      db.prepare(`SELECT COUNT(*) AS total FROM (
        SELECT 1 FROM reward_redemptions x WHERE x.household_id=?1
        GROUP BY x.redeemed_by,SUBSTR(x.client_request_id,1,36),
          x.reward_id,x.title_snapshot,x.icon_snapshot)`).bind(h).first(),
      db.prepare(`SELECT COUNT(*) AS total FROM reward_group_orders o
        WHERE o.household_id=?1 AND o.status<>'cancelled'
          AND (o.status<>'collecting' OR ${pointYearPredicate('o.created_at')})`).bind(h).first()
    ])
    return json({rewards,redemptions:history.results||[],
      redemptionPage,groupPage,pageSize,
      redemptionTotal:Number(redemptionTotal?.total||0),
      redemptionPages:Math.max(1,Math.ceil(Number(redemptionTotal?.total||0)/pageSize)),
      groupTotal:Number(groupTotal?.total||0),
      groupPages:Math.max(1,Math.ceil(Number(groupTotal?.total||0)/pageSize)),
      groupOrders:(orders.results||[]).map(o=>({...o,points:Number(o.points),
        fundedPoints:Number(o.fundedPoints),
        contributions:(contributions.results||[]).filter(c=>c.orderId===o.id)
          .map(c=>({...c,points:Number(c.points)}))}))})
  }
  if(path==='/api/rewards'&&request.method==='POST'){
    const b=validReward(await readBody(request))
    if(!b)return json({error:'invalid_reward'},400)
    const id=crypto.randomUUID()
    await db.prepare(`INSERT INTO reward_items
      (id,household_id,title,description,icon,points,stock,active,created_by,goal_credit_yen)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)`)
      .bind(id,h,b.title,b.description,b.icon,b.points,b.stock,b.active?1:0,u,b.goalCreditYen).run()
    return json({ok:true,id},201)
  }
  if(path==='/api/rewards/pool'&&request.method==='POST'){
    const b=await readBody(request)
    if(!b||typeof b.rewardId!=='string'||b.rewardId.length>100||!uuid.test(b.requestId)||
      (b.wishId!==undefined&&b.wishId!==null&&!uuid.test(b.wishId))||
      (b.goalId!==undefined&&b.goalId!==null&&!uuid.test(b.goalId)))
      return json({error:'invalid_input'},400)
    const prior=await db.prepare(`SELECT id FROM reward_group_orders
      WHERE household_id=?1 AND created_by=?2 AND client_request_id=?3`)
      .bind(h,u,b.requestId).first()
    if(prior)return json({ok:true,id:prior.id,replayed:true})
    const id=crypto.randomUUID()
    const sql=`INSERT INTO reward_group_orders
      (id,household_id,reward_id,created_by,client_request_id,title_snapshot,
        icon_snapshot,points_required,created_at,credited_wish_id,credited_goal_id,
        goal_credit_yen,wish_title_snapshot)
      SELECT ?1,r.household_id,r.id,?2,?3,r.title,r.icon,r.points,?4,
        CASE WHEN r.goal_credit_yen>0 THEN w.id ELSE NULL END,
        CASE WHEN r.goal_credit_yen>0 THEN g.id ELSE NULL END,
        r.goal_credit_yen,
        CASE WHEN r.goal_credit_yen>0 THEN w.title ELSE NULL END
      FROM reward_items r
      ${goalJoins('?2','?7','?8')}
      WHERE r.id=?5 AND r.household_id=?6 AND r.active=1
        AND ((r.goal_credit_yen=0 AND ?7 IS NULL AND ?8 IS NULL)
             OR (r.goal_credit_yen>0 AND g.id IS NOT NULL AND w.id IS NOT NULL))
        AND (r.stock IS NULL OR r.stock>
          (SELECT COUNT(*) FROM reward_redemptions x WHERE x.reward_id=r.id)+
          (SELECT COUNT(*) FROM reward_group_orders g
            WHERE g.reward_id=r.id AND g.status<>'cancelled'))
        AND (SELECT COUNT(*) FROM reward_group_orders g
          WHERE g.household_id=?6 AND g.status='collecting')<10
        AND NOT EXISTS (SELECT 1 FROM reward_group_orders g WHERE
          g.household_id=?6 AND g.created_by=?2 AND g.client_request_id=?3)`
    try{
      const result=await db.prepare(sql).bind(id,u,b.requestId,iso(),b.rewardId,h,b.goalId||null,b.wishId||null).run()
      if(result.meta?.changes)return json({ok:true,id},201)
    }catch{
      const replay=await db.prepare(`SELECT id FROM reward_group_orders
        WHERE household_id=?1 AND created_by=?2 AND client_request_id=?3`)
        .bind(h,u,b.requestId).first()
      if(replay)return json({ok:true,id:replay.id,replayed:true})
    }
    return json({error:'reward_unavailable_or_insufficient'},409)
  }
  const poolContribution=path.match(/^\/api\/rewards\/pool\/([a-f0-9-]{36})\/contribute$/i)
  if(poolContribution&&request.method==='POST'){
    const b=await readBody(request)
    if(!b||!uuid.test(b.requestId)||!Number.isSafeInteger(b.points)||
      b.points<1||b.points>10000)return json({error:'invalid_input'},400)
    const prior=await db.prepare(`SELECT id FROM reward_group_contributions
      WHERE household_id=?1 AND user_id=?2 AND client_request_id=?3`)
      .bind(h,u,b.requestId).first()
    if(prior)return json({ok:true,id:prior.id,replayed:true})
    const id=crypto.randomUUID()
    // One atomic INSERT validates the current wallet, remaining target and open state.
    const sql=`INSERT INTO reward_group_contributions
        (id,household_id,order_id,user_id,points,client_request_id,created_at)
      SELECT ?1,g.household_id,g.id,?2,?3,?4,?5
      FROM reward_group_orders g
      WHERE g.id=?6 AND g.household_id=?7 AND g.status='collecting'
         AND ${pointYearPredicate('g.created_at')}
        AND ?3<=g.points_required-
          (SELECT COALESCE(SUM(c.points),0) FROM reward_group_contributions c
            WHERE c.order_id=g.id)
        AND ?3<=(
          ${householdWalletSql('?7','?2')}
        )
        AND NOT EXISTS (SELECT 1 FROM reward_group_contributions c WHERE
          c.household_id=?7 AND c.user_id=?2 AND c.client_request_id=?4)`
    try{
      const result=await db.prepare(sql)
        .bind(id,u,b.points,b.requestId,iso(),poolContribution[1],h).run()
      if(result.meta?.changes)return json({ok:true,id},201)
    }catch{
      const replay=await db.prepare(`SELECT id FROM reward_group_contributions
        WHERE household_id=?1 AND user_id=?2 AND client_request_id=?3`)
        .bind(h,u,b.requestId).first()
      if(replay)return json({ok:true,id:replay.id,replayed:true})
    }
    return json({error:'pool_closed_or_insufficient'},409)
  }
  const poolAction=path.match(/^\/api\/rewards\/pool\/([a-f0-9-]{36})\/(cancel|fulfill)$/i)
  if(poolAction&&request.method==='POST'){
    const [id,action]=[poolAction[1],poolAction[2]]
    if(action==='cancel'){
      const result=await db.prepare(`UPDATE reward_group_orders
        SET status='cancelled',cancelled_at=?1
        WHERE id=?2 AND household_id=?3 AND status='collecting'`)
        .bind(iso(),id,h).run()
      if(result.meta?.changes)return json({ok:true,refunded:true})
      const old=await db.prepare(`SELECT status FROM reward_group_orders
        WHERE id=?1 AND household_id=?2`).bind(id,h).first()
      if(old?.status==='cancelled')return json({ok:true,unchanged:true})
      return json({error:'pool_not_cancellable'},409)
    }
    const result=await db.prepare(`UPDATE reward_group_orders
      SET status='fulfilled',fulfilled_at=?1,fulfilled_by=?2
      WHERE id=?3 AND household_id=?4 AND status='requested'`)
      .bind(iso(),u,id,h).run()
    if(result.meta?.changes)return json({ok:true})
    const old=await db.prepare(`SELECT status FROM reward_group_orders
      WHERE id=?1 AND household_id=?2`).bind(id,h).first()
    if(old?.status==='fulfilled')return json({ok:true,unchanged:true})
    return json({error:'pool_not_funded'},409)
  }
  const itemPath=path.match(/^\/api\/rewards\/([^/]{1,160})$/i)
  if(itemPath&&request.method==='PATCH'){
    let itemId
    try{itemId=decodeURIComponent(itemPath[1])}catch{return json({error:'invalid_input'},400)}
    if(itemId.length>120)return json({error:'invalid_input'},400)
    const b=validReward(await readBody(request))
    if(!b)return json({error:'invalid_reward'},400)
    const result=await db.prepare(`UPDATE reward_items SET
      title=?1,description=?2,icon=?3,points=?4,stock=?5,active=?6,
      updated_at=?7,goal_credit_yen=?10 WHERE id=?8 AND household_id=?9`)
      .bind(b.title,b.description,b.icon,b.points,b.stock,b.active?1:0,iso(),itemId,h,b.goalCreditYen).run()
    if(!result.meta?.changes)return json({error:'not_found'},404)
    return json({ok:true})
  }
  if(path==='/api/rewards/redeem'&&request.method==='POST'){
    const b=await readBody(request)
    if(!b||typeof b.rewardId!=='string'||b.rewardId.length>100||!uuid.test(b.requestId)||
      (b.quantity!==undefined&&(!Number.isSafeInteger(b.quantity)||b.quantity<1||b.quantity>99))||
      (b.wishId!==undefined&&b.wishId!==null&&!uuid.test(b.wishId))||
      (b.goalId!==undefined&&b.goalId!==null&&!uuid.test(b.goalId)))
      return json({error:'invalid_input'},400)
    const quantity=b.quantity??1
    // Per-request idempotency also handles double taps / connection retries.
    const previous=await db.prepare(`SELECT id FROM reward_redemptions
      WHERE household_id=?1 AND redeemed_by=?2 AND client_request_id=?3`)
      .bind(h,u,b.requestId).first()
    if(previous)return json({ok:true,id:previous.id,replayed:true})
    const ids=Array.from({length:quantity},()=>crypto.randomUUID())
    // Each unit stays a normal redemption row: no D1 migration is needed.
    // All rows are inserted in ONE SQLite statement, guarded by total stock
    // and total wallet checks. First child holds the base idempotency token.
    const values=ids.map((_,i)=>`(${i+1},?${7+i})`).join(',')
    const goalParam='?'+(7+quantity),wishParam='?'+(8+quantity)
    const sql=`WITH units(n,unit_id) AS (VALUES ${values})
      INSERT INTO reward_redemptions
        (id,household_id,reward_id,redeemed_by,title_snapshot,icon_snapshot,
          points_spent,client_request_id,status,created_at,credited_wish_id,
          credited_goal_id,goal_credit_yen,wish_title_snapshot)
      SELECT units.unit_id,r.household_id,r.id,?1,r.title,r.icon,r.points,
        CASE WHEN units.n=1 THEN ?2 ELSE ?2||':'||units.n END,'requested',?3,
        CASE WHEN r.goal_credit_yen>0 THEN w.id ELSE NULL END,
        CASE WHEN r.goal_credit_yen>0 THEN g.id ELSE NULL END,
        r.goal_credit_yen,
        CASE WHEN r.goal_credit_yen>0 THEN w.title ELSE NULL END
      FROM reward_items r CROSS JOIN units
      ${goalJoins('?1',goalParam,wishParam)}
      WHERE r.id=?4 AND r.household_id=?5 AND r.active=1
        AND ((r.goal_credit_yen=0 AND ${goalParam} IS NULL AND ${wishParam} IS NULL)
             OR (r.goal_credit_yen>0 AND g.id IS NOT NULL AND w.id IS NOT NULL))
        AND (r.stock IS NULL OR r.stock >= ?6+
          (SELECT COUNT(*) FROM reward_redemptions x WHERE x.reward_id=r.id)+
          (SELECT COUNT(*) FROM reward_group_orders g
            WHERE g.reward_id=r.id AND g.status<>'cancelled'))
        AND NOT EXISTS (SELECT 1 FROM reward_redemptions x WHERE
          x.household_id=?5 AND x.redeemed_by=?1 AND x.client_request_id=?2)
        AND r.points*?6 <= ${householdWalletSql('?5','?1')}`
    try{
      const result=await db.prepare(sql).bind(u,b.requestId,iso(),b.rewardId,h,quantity,...ids,b.goalId||null,b.wishId||null).run()
      if(Number(result.meta?.changes)===quantity)return json({ok:true,id:ids[0],quantity},201)
    }catch{
      const replay=await db.prepare(`SELECT id FROM reward_redemptions WHERE
        household_id=?1 AND redeemed_by=?2 AND client_request_id=?3`)
        .bind(h,u,b.requestId).first()
      if(replay)return json({ok:true,id:replay.id,replayed:true})
      return json({error:'reward_unavailable_or_insufficient'},409)
    }
    return json({error:'reward_unavailable_or_insufficient'},409)
  }
  const mark=path.match(/^\/api\/rewards\/redemptions\/([a-f0-9-]{36})$/i)
  if(mark&&request.method==='PATCH'){
    const b=await readBody(request)
    if(b?.status!=='fulfilled')return json({error:'invalid_input'},400)
    const result=await db.prepare(`UPDATE reward_redemptions SET
      status='fulfilled',fulfilled_at=?1,fulfilled_by=?2
      WHERE household_id=?4 AND status='requested'
        AND redeemed_by=(SELECT redeemed_by FROM reward_redemptions WHERE id=?3 AND household_id=?4)
        AND SUBSTR(client_request_id,1,36)=
          (SELECT SUBSTR(client_request_id,1,36) FROM reward_redemptions WHERE id=?3 AND household_id=?4)`)
      .bind(iso(),u,mark[1],h).run()
    if(!result.meta?.changes){
      const prior=await db.prepare(`SELECT status FROM reward_redemptions
        WHERE id=?1 AND household_id=?2`).bind(mark[1],h).first()
      return prior?.status==='fulfilled'?json({ok:true,unchanged:true}):
        json({error:'not_found'},404)
    }
    return json({ok:true})
  }
  return json({error:'not_found'},404)
}
