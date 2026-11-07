import {iso,json,readBody,shortText} from './security.js'

const icons=new Set(['🎁','🍦','🎬','🍖','🛋️','🐱','☕','🌸','🎮','🎟️','🧹','🎉'])
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const getList=async(db,household)=>{
  const {results}=await db.prepare(`SELECT r.id,r.title,r.description,r.icon,r.points,r.stock,r.active,
    r.builtin,r.created_by AS createdBy,
    (SELECT COUNT(*) FROM reward_redemptions x
      WHERE x.reward_id=r.id) AS redeemedCount
    FROM reward_items r WHERE r.household_id=?1
    ORDER BY r.active DESC,r.builtin DESC,r.created_at,r.id LIMIT 100`)
    .bind(household).all()
  return (results||[]).map(r=>({...r,points:Number(r.points),
    stock:r.stock===null?null:Number(r.stock),redeemedCount:Number(r.redeemedCount),
    active:!!r.active,builtin:!!r.builtin}))
}
const validReward=b=>{
  if(!b||typeof b.title!=='string'||b.title.trim().length<1||b.title.trim().length>60||
    typeof b.description!=='string'&&b.description!==undefined||
    typeof b.description==='string'&&b.description.length>150||
    !Number.isSafeInteger(b.points)||b.points<10||b.points>10000||
    (b.stock!==null&&b.stock!==undefined&&(!Number.isInteger(b.stock)||b.stock<0||b.stock>9999))||
    (b.icon!==undefined&&!icons.has(b.icon))||
    (b.active!==undefined&&typeof b.active!=='boolean'))return null
  return {title:b.title.trim(),description:shortText(b.description||'',150),
    icon:b.icon||'🎁',points:b.points,stock:b.stock??null,active:b.active!==false}
}
export async function rewardsRoute(request,db,path,session){
  const h=session.household_id,u=session.user_id
  if(path==='/api/rewards'&&request.method==='GET'){
    const [rewards,history]=await Promise.all([
      getList(db,h),
      db.prepare(`SELECT x.id,x.reward_id AS rewardId,x.redeemed_by AS redeemedBy,
        COALESCE((SELECT p.display_name FROM family_profiles p
          WHERE p.household_id=x.household_id AND p.member_user_id=x.redeemed_by
            AND p.archived_at IS NULL ORDER BY p.created_at DESC LIMIT 1),
          m.login_name) AS redeemedByName,
        x.title_snapshot AS title,x.icon_snapshot AS icon,x.points_spent AS points,
        x.status,x.created_at AS createdAt,x.fulfilled_at AS fulfilledAt
        FROM reward_redemptions x JOIN users m ON m.id=x.redeemed_by
        WHERE x.household_id=?1 ORDER BY x.created_at DESC,x.id DESC LIMIT 30`)
        .bind(h).all()
    ])
    return json({rewards,redemptions:history.results||[]})
  }
  if(path==='/api/rewards'&&request.method==='POST'){
    const b=validReward(await readBody(request))
    if(!b)return json({error:'invalid_reward'},400)
    const id=crypto.randomUUID()
    await db.prepare(`INSERT INTO reward_items
      (id,household_id,title,description,icon,points,stock,active,created_by)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)`)
      .bind(id,h,b.title,b.description,b.icon,b.points,b.stock,b.active?1:0,u).run()
    return json({ok:true,id},201)
  }
  const itemPath=path.match(/^\/api\/rewards\/([a-f0-9-]{36}|[^/]+:((?:dessert|movie|dinner|rest)))$/i)
  if(itemPath&&request.method==='PATCH'){
    const b=validReward(await readBody(request))
    if(!b)return json({error:'invalid_reward'},400)
    const result=await db.prepare(`UPDATE reward_items SET
      title=?1,description=?2,icon=?3,points=?4,stock=?5,active=?6,
      updated_at=?7 WHERE id=?8 AND household_id=?9`)
      .bind(b.title,b.description,b.icon,b.points,b.stock,b.active?1:0,iso(),itemPath[1],h).run()
    if(!result.meta?.changes)return json({error:'not_found'},404)
    return json({ok:true})
  }
  if(path==='/api/rewards/redeem'&&request.method==='POST'){
    const b=await readBody(request)
    if(!b||typeof b.rewardId!=='string'||b.rewardId.length>100||!uuid.test(b.requestId))
      return json({error:'invalid_input'},400)
    // Per-request idempotency also handles double taps / connection retries.
    const previous=await db.prepare(`SELECT id FROM reward_redemptions
      WHERE household_id=?1 AND redeemed_by=?2 AND client_request_id=?3`)
      .bind(h,u,b.requestId).first()
    if(previous)return json({ok:true,id:previous.id,replayed:true})
    const id=crypto.randomUUID()
    // The credit, inventory and active checks occur INSIDE one serializable D1 write.
    // A stale client balance or two simultaneous redemptions cannot overspend.
    const sql=`INSERT INTO reward_redemptions
        (id,household_id,reward_id,redeemed_by,title_snapshot,icon_snapshot,
          points_spent,client_request_id,status,created_at)
      SELECT ?1,r.household_id,r.id,?2,r.title,r.icon,r.points,?3,'requested',?4
      FROM reward_items r
      WHERE r.id=?5 AND r.household_id=?6 AND r.active=1
        AND (r.stock IS NULL OR r.stock>(SELECT COUNT(*) FROM reward_redemptions x
          WHERE x.reward_id=r.id))
        AND NOT EXISTS (SELECT 1 FROM reward_redemptions x WHERE
          x.household_id=?6 AND x.redeemed_by=?2 AND x.client_request_id=?3)
        AND r.points<=(
          COALESCE((SELECT SUM(points) FROM completion_points c WHERE
            c.household_id=?6 AND c.earner_user_id=?2),0)
          +COALESCE((SELECT SUM(points) FROM weekly_challenge_awards w WHERE
            w.household_id=?6 AND w.user_id=?2),0)
          -COALESCE((SELECT SUM(points_spent) FROM reward_redemptions x WHERE
            x.household_id=?6 AND x.redeemed_by=?2),0)
        )`
    try{
      const result=await db.prepare(sql).bind(id,u,b.requestId,iso(),b.rewardId,h).run()
      if(result.meta?.changes)return json({ok:true,id},201)
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
      WHERE id=?3 AND household_id=?4 AND status='requested'`)
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
