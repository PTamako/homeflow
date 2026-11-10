import {householdWalletSql} from './points-wallet.js'
import {json,readBody} from './security.js'

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COST=5
const MONTHLY_LIMIT=10
const HISTORY_PAGE_SIZE=5
const MAX_HISTORY_PAGE=10000
export const lotteryOdds=[
  {kind:'empty',rate:35,points:0,label:'空手而归'},
  {kind:'six',rate:40,points:6,label:'幸运小赚 · 6 积分'},
  {kind:'ten',rate:14,points:10,label:'10 积分'},
  {kind:'twenty',rate:2,points:20,label:'20 积分'},
  {kind:'fifty',rate:0.3,points:50,label:'50 积分'},
  {kind:'double',rate:0.2,points:null,label:'传说翻倍 · 80～200 积分'},
  {kind:'ticket',rate:4,points:0,label:'免费抽奖券 · 60 天'},
  {kind:'shop',rate:1,points:0,label:'商城 95 折券 · 90 天'},
  {kind:'wish',rate:3.5,points:0,label:'心愿加速券 ¥100 · 90 天'}
]

// Crypto randomness is independent of user-supplied requests and wallet balance.
export function lotteryPrize(roll){
  if(typeof roll!=='number'||roll<0||roll>=1)return null
  let ticket=Math.floor(roll*1000)
  return lotteryOdds.find(item=>(ticket-=Math.round(item.rate*10))<0)||lotteryOdds.at(-1)
}
const securePrize=()=>lotteryPrize(crypto.getRandomValues(new Uint32Array(1))[0]/4294967296)
const jstMonth=(now=Date.now())=>new Date(now+9*3600000).toISOString().slice(0,7)
function historyFloor(){
  const d=new Date()
  d.setUTCFullYear(d.getUTCFullYear()-1)
  return d.toISOString()
}
// A legacy CHECK requires the five/empty storage variants. The additive
// migration supplies a bonus point and special prize kind for new draws.
const drawKind="COALESCE(l.special_prize_kind,CASE WHEN l.prize_kind='five' AND l.prize_bonus_points=1 THEN 'six' ELSE l.prize_kind END)"
const selectDraw=async(db,h,u,requestId)=>db.prepare(
  `SELECT l.id,l.household_id AS householdId,l.user_id AS userId,
    ${drawKind} AS kind,
    CASE WHEN l.ticket_coupon_id IS NULL THEN l.cost_points ELSE 0 END AS cost,
    l.prize_points+l.prize_bonus_points AS points,
    l.month_on AS month,l.created_at AS createdAt,l.ticket_coupon_id AS ticketCouponId
    FROM household_lottery_draws l
    WHERE l.household_id=?1 AND l.user_id=?2 AND l.client_request_id=?3`)
  .bind(h,u,requestId).first()

export async function lotteryRoute(request,db,path,session,onDraw=null,choosePrize=securePrize){
  const h=session.household_id,u=session.user_id,month=jstMonth()
  if(path==='/api/lottery/coupons'&&request.method==='GET'){
    const {results=[]}=await db.prepare(`SELECT c.id,c.kind,c.created_at AS createdAt,
      c.expires_on AS expiresOn,c.used_at AS usedAt,c.use_reference AS useReference,
      c.used_goal_id AS usedGoalId,c.wish_title_snapshot AS wishTitle,
      CASE WHEN c.used_at IS NOT NULL THEN 'used'
        WHEN c.expires_on<date('now','+9 hours') THEN 'expired'
        ELSE 'available' END AS status
      FROM lottery_coupons c WHERE c.household_id=?1 AND c.user_id=?2
      ORDER BY c.created_at DESC,c.id DESC LIMIT 200`).bind(h,u).all()
    return json({items:results})
  }
  if(path==='/api/lottery/coupons/redeem-wish'&&request.method==='POST'){
    const b=await readBody(request)
    if(!b||![b.couponId,b.requestId,b.wishId,b.goalId].every(x=>typeof x==='string'&&UUID.test(x)))
      return json({error:'invalid_input'},400)
    // Idempotent replay is scoped to the authenticated original holder and
    // original wish. A replay cannot silently move the credit to another goal.
    const prior=await db.prepare(`SELECT used_at AS usedAt,use_reference AS useReference,
      used_wish_id AS wishId,used_goal_id AS goalId FROM lottery_coupons
      WHERE id=?1 AND household_id=?2 AND user_id=?3 AND kind='wish'`)
      .bind(b.couponId,h,u).first()
    if(prior?.usedAt)return prior.useReference===b.requestId&&
      prior.wishId===b.wishId&&prior.goalId===b.goalId?
      json({ok:true,replayed:true,creditedYen:100}):json({error:'coupon_unavailable'},409)
    const result=await db.prepare(`UPDATE lottery_coupons SET
       used_at=?1,use_reference=?2,used_wish_id=?3,used_goal_id=?4,
       wish_title_snapshot=(SELECT title FROM wishes WHERE id=?3 AND household_id=?5)
      WHERE id=?6 AND household_id=?5 AND user_id=?7 AND kind='wish'
        AND used_at IS NULL AND expires_on>=date(?1,'+9 hours')
        AND EXISTS (
          SELECT 1 FROM wishes w JOIN goals g ON g.wish_id=w.id
            AND g.household_id=w.household_id
          WHERE w.id=?3 AND g.id=?4 AND w.household_id=?5
            AND w.deleted_at IS NULL AND g.deleted_at IS NULL
            AND w.currency='JPY' AND g.currency='JPY'
            AND w.status IN ('wished','planning','active') AND g.goal_mode='once'
            AND (w.visibility='household' OR w.created_by=?7)
            AND (g.visibility='household' OR g.created_by=?7))`)
      .bind(new Date().toISOString(),b.requestId,b.wishId,b.goalId,h,b.couponId,u).run()
    return result.meta?.changes?json({ok:true,creditedYen:100}):
      json({error:'coupon_unavailable_or_wish_inactive'},409)
  }
  if(path==='/api/lottery'&&request.method==='GET'){
    const search=new URL(request.url).searchParams
    const rawPage=search.get('page')??'1'
    if(!/^[1-9][0-9]*$/.test(rawPage)||Number(rawPage)>MAX_HISTORY_PAGE)
      return json({error:'invalid_page'},400)
    const page=Number(rawPage),offset=(page-1)*HISTORY_PAGE_SIZE,after=historyFloor()
    const [count,historyCount,history]=await Promise.all([
      db.prepare(`SELECT COUNT(*) AS used FROM household_lottery_draws
        WHERE household_id=?1 AND user_id=?2 AND month_on=?3`).bind(h,u,month).first(),
      db.prepare(`SELECT COUNT(*) AS total FROM household_lottery_draws
        WHERE household_id=?1 AND created_at>=?2`).bind(h,after).first(),
      db.prepare(`SELECT l.id,l.user_id AS userId,
        COALESCE((SELECT p.display_name FROM family_profiles p
          WHERE p.household_id=l.household_id AND p.member_user_id=l.user_id
            AND p.type='person' AND p.archived_at IS NULL
          ORDER BY p.created_at DESC LIMIT 1),u.login_name) AS displayName,
        ${drawKind} AS kind,
        CASE WHEN l.ticket_coupon_id IS NULL THEN l.cost_points ELSE 0 END AS cost,
        l.prize_points+l.prize_bonus_points AS points,
        l.month_on AS month,l.created_at AS createdAt
        FROM household_lottery_draws l JOIN users u ON u.id=l.user_id
        WHERE l.household_id=?1 AND l.created_at>=?2
        ORDER BY l.created_at DESC,l.id DESC LIMIT ?3 OFFSET ?4`)
        .bind(h,after,HISTORY_PAGE_SIZE,offset).all()
    ])
    const total=Math.max(0,Number(historyCount?.total)||0)
    return json({month,cost:COST,limit:MONTHLY_LIMIT,used:Number(count?.used||0),
      odds:lotteryOdds,history:history.results||[],
      historyPage:page,historyPageSize:HISTORY_PAGE_SIZE,
      historyTotal:total,historyTotalPages:Math.max(1,Math.ceil(total/HISTORY_PAGE_SIZE))})
  }
  if(path!=='/api/lottery/draw')return json({error:'not_found'},404)
  if(request.method!=='POST')return json({error:'method_not_allowed'},405)
  const body=await readBody(request)
  if(!UUID.test(body?.requestId)||(
    body.ticketCouponId!==undefined&&body.ticketCouponId!==null&&!UUID.test(body.ticketCouponId)))
    return json({error:'invalid_input'},400)
  const existing=await selectDraw(db,h,u,body.requestId)
  if(existing){if(onDraw)try{onDraw(existing)}catch{};return json({ok:true,draw:existing,replayed:true})}
  const prize=choosePrize(),id=crypto.randomUUID(),now=new Date().toISOString()
  if(!prize||!['empty','six','ten','twenty','fifty','double','ticket','shop','wish'].includes(prize.kind))
    return json({error:'lottery_unavailable'},409)
  const isVoucher=['ticket','shop','wish'].includes(prize.kind)
  const storedKind=prize.kind==='six'?'five':isVoucher?'empty':prize.kind
  const ticketId=body.ticketCouponId||null
  const wallet=householdWalletSql('?2','?3')
  // One INSERT and database triggers atomically claim the free ticket, enforce
  // monthly limit, create earned coupons and protect against concurrent taps.
  const sql=`INSERT INTO household_lottery_draws
    (id,household_id,user_id,client_request_id,month_on,prize_kind,
      cost_points,prize_points,created_at,special_prize_kind,prize_bonus_points,ticket_coupon_id)
    SELECT ?1,?2,?3,?4,?5,?6,5,
      CASE WHEN ?6='double' THEN MIN(200,MAX(80,MAX(0,${wallet}-CASE WHEN ?11 IS NULL THEN 5 ELSE 0 END)))
        ELSE ?7 END,?8,?9,?10,?11
    WHERE EXISTS(SELECT 1 FROM household_members m
      WHERE m.household_id=?2 AND m.user_id=?3)
      AND ( (?11 IS NULL AND ${wallet}>=5) OR
        (?11 IS NOT NULL AND EXISTS (
          SELECT 1 FROM lottery_coupons c
          WHERE c.id=?11 AND c.household_id=?2 AND c.user_id=?3
            AND c.kind='ticket' AND c.used_at IS NULL
            AND c.expires_on>=date(?8,'+9 hours'))))
      AND (SELECT COUNT(*) FROM household_lottery_draws l
        WHERE l.household_id=?2 AND l.user_id=?3 AND l.month_on=?5)<${MONTHLY_LIMIT}
      AND NOT EXISTS(SELECT 1 FROM household_lottery_draws l
        WHERE l.household_id=?2 AND l.user_id=?3 AND l.client_request_id=?4)`
  try{
    const result=await db.prepare(sql)
      .bind(id,h,u,body.requestId,month,storedKind,prize.kind==='six'?5:prize.points??0,
        now,isVoucher?prize.kind:null,prize.kind==='six'?1:0,ticketId).run()
    if(result.meta?.changes){
      const draw=await selectDraw(db,h,u,body.requestId)
      if(onDraw&&draw)try{onDraw(draw)}catch{}
      return json({ok:true,draw},201)
    }
  }catch{
    const replay=await selectDraw(db,h,u,body.requestId)
    if(replay)return json({ok:true,draw:replay,replayed:true})
    return json({error:'lottery_unavailable'},409)
  }
  const replay=await selectDraw(db,h,u,body.requestId)
  return replay?json({ok:true,draw:replay,replayed:true}):
    json({error:'lottery_unavailable'},409)
}
