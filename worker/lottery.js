import {householdWalletSql} from './points-wallet.js'
import {json,readBody} from './security.js'

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COST=5
const MONTHLY_LIMIT=7
export const lotteryOdds=[
  {kind:'empty',rate:50,points:0,label:'空手而归'},
  {kind:'five',rate:30,points:5,label:'5 积分'},
  {kind:'ten',rate:10,points:10,label:'10 积分'},
  {kind:'twenty',rate:6,points:20,label:'20 积分'},
  {kind:'fifty',rate:3,points:50,label:'50 积分'},
  {kind:'double',rate:1,points:null,label:'当前积分翻倍'}
]

// Only a server-side cryptographically secure random number may choose a prize.
// Each possible 32-bit value has the same probability of being selected.
export function lotteryPrize(roll){
  if(typeof roll!=='number'||roll<0||roll>=1)return null
  const p=roll*100
  return lotteryOdds.find(item=>(p-=item.rate)<0)||lotteryOdds.at(-1)
}
const securePrize=()=>lotteryPrize(crypto.getRandomValues(new Uint32Array(1))[0]/4294967296)
const jstMonth=(now=Date.now())=>new Date(now+9*3600000).toISOString().slice(0,7)
function historyFloor(){
  const d=new Date()
  d.setUTCFullYear(d.getUTCFullYear()-1)
  return d.toISOString()
}
const selectDraw=async(db,h,u,requestId)=>db.prepare(
  `SELECT id,household_id AS householdId,user_id AS userId,
    prize_kind AS kind,cost_points AS cost,prize_points AS points,
    month_on AS month,created_at AS createdAt FROM household_lottery_draws
   WHERE household_id=?1 AND user_id=?2 AND client_request_id=?3`)
  .bind(h,u,requestId).first()

export async function lotteryRoute(request,db,path,session,onDraw=null,choosePrize=securePrize){
  const h=session.household_id,u=session.user_id,month=jstMonth()
  if(path==='/api/lottery'&&request.method==='GET'){
    const [count,history]=await Promise.all([
      db.prepare(`SELECT COUNT(*) AS used FROM household_lottery_draws
        WHERE household_id=?1 AND user_id=?2 AND month_on=?3`).bind(h,u,month).first(),
      db.prepare(`SELECT l.id,l.user_id AS userId,
        COALESCE((SELECT p.display_name FROM family_profiles p
          WHERE p.household_id=l.household_id AND p.member_user_id=l.user_id
            AND p.type='person' AND p.archived_at IS NULL
          ORDER BY p.created_at DESC LIMIT 1),u.login_name) AS displayName,
        l.prize_kind AS kind,l.cost_points AS cost,l.prize_points AS points,
        l.month_on AS month,l.created_at AS createdAt
        FROM household_lottery_draws l JOIN users u ON u.id=l.user_id
        WHERE l.household_id=?1 AND l.created_at>=?2
        ORDER BY l.created_at DESC,l.id DESC LIMIT 1000`)
        .bind(h,historyFloor()).all()
    ])
    return json({month,cost:COST,limit:MONTHLY_LIMIT,used:Number(count?.used||0),
      odds:lotteryOdds,history:history.results||[]})
  }
  if(path!=='/api/lottery/draw')return json({error:'not_found'},404)
  if(request.method!=='POST')return json({error:'method_not_allowed'},405)
  const body=await readBody(request)
  if(!UUID.test(body?.requestId||''))return json({error:'invalid_input'},400)
  const existing=await selectDraw(db,h,u,body.requestId)
  if(existing){if(onDraw)try{onDraw(existing)}catch{};return json({ok:true,draw:existing,replayed:true})}
  const prize=choosePrize(),id=crypto.randomUUID(),now=new Date().toISOString()
  // The wallet, monthly cap and idempotency are verified INSIDE the atomic
  // write, not in a separate request or only in the browser.
  const sql=`INSERT INTO household_lottery_draws
    (id,household_id,user_id,client_request_id,month_on,prize_kind,cost_points,prize_points,created_at)
    SELECT ?1,?2,?3,?4,?5,?6,5,
      CASE WHEN ?6='double' THEN MAX(0,(${householdWalletSql('?2','?3')})-5)
        ELSE ?7 END,?8
    WHERE EXISTS(SELECT 1 FROM household_members m
      WHERE m.household_id=?2 AND m.user_id=?3)
      AND (${householdWalletSql('?2','?3')})>=5
      AND (SELECT COUNT(*) FROM household_lottery_draws l
        WHERE l.household_id=?2 AND l.user_id=?3 AND l.month_on=?5)<7
      AND NOT EXISTS(SELECT 1 FROM household_lottery_draws l
        WHERE l.household_id=?2 AND l.user_id=?3 AND l.client_request_id=?4)`
  try{
    const result=await db.prepare(sql)
      .bind(id,h,u,body.requestId,month,prize.kind,prize.points??0,now).run()
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
