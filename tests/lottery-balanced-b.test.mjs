import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {lotteryOdds,lotteryRoute} from '../worker/lottery.js'
import {rewardsRoute} from '../worker/rewards.js'
import {pointsRoute} from '../worker/points.js'
import {pointsHistoryRoute} from '../worker/points-history.js'
import {goalRewardCreditAmount} from '../worker/reward-goal-credits.js'
import {expiringCouponReminders} from '../worker/webpush.js'

const manifest=readFileSync(new URL('../scripts/check_migrations.py',import.meta.url),'utf8')
const names=[...manifest.slice(manifest.indexOf('MIGRATIONS=['),manifest.indexOf(']\nfiles=')).matchAll(/"(\d{4}_[^"]+\.sql)"/g)].map(x=>x[1])
const alice={household_id:'h',user_id:'alice'},bob={household_id:'h',user_id:'bob'},
 outsider={household_id:'h2',user_id:'eve'}
const uuid=()=>crypto.randomUUID()
function fixture(){
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec('PRAGMA foreign_keys=ON')
 for(const filename of names)sqlite.exec(readFileSync(new URL('../migrations/'+filename,import.meta.url),'utf8'))
 sqlite.exec(`
  INSERT INTO households(id,display_name) VALUES('h','家'),('h2','外');
  INSERT INTO users(id,login_name,password_salt,password_verifier) VALUES
   ('alice','alice','salt','verifier'),('bob','bob','salt','verifier'),('eve','eve','salt','verifier');
  INSERT INTO household_members(household_id,user_id,role) VALUES
   ('h','alice','owner'),('h','bob','member'),('h2','eve','owner');
 `)
 const db={prepare(sql){const stmt=sqlite.prepare(sql);let args=[];return{
   bind(...params){args=params;return this},
   async first(){return stmt.get(...args)||null},
   async all(){return {results:stmt.all(...args)}},
   async run(){const r=stmt.run(...args);return{meta:{changes:Number(r.changes)}}}
 }}}
 return {sqlite,db}
}
function earn(sqlite,user,n=40,house='h'){
 const stmt=sqlite.prepare(`INSERT INTO completion_points
  (household_id,kind,source_id,occurrence_on,earner_user_id,visibility,points,earned_at)
  VALUES(?1,'task',?2,'',?3,'household',10,?4)`)
 for(let i=0;i<n;i++)stmt.run(house,uuid(),user,new Date().toISOString())
}
async function draw(db,who,kind,options={}){
 const requestId=options.requestId||uuid()
 const request=new Request('https://homeflow.invalid/api/lottery/draw',{
  method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({requestId,...(options.ticketCouponId?{ticketCouponId:options.ticketCouponId}:{})})})
 const result=await lotteryRoute(request,db,'/api/lottery/draw',who,null,
  ()=>lotteryOdds.find(x=>x.kind===kind))
 return {status:result.status,body:await result.json(),requestId}
}
async function coupons(db,who){
 const res=await lotteryRoute(new Request('https://homeflow.invalid/api/lottery/coupons'),
  db,'/api/lottery/coupons',who)
 return (await res.json()).items
}
async function wallet(db,who){
 return (await (await pointsRoute(new Request('https://homeflow.invalid/api/points'),db,who)).json()).availablePoints
}
async function redeem(db,who,body){
 const res=await rewardsRoute(new Request('https://homeflow.invalid/api/rewards/redeem',{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)
 }),db,'/api/rewards/redeem',who)
 return {status:res.status,body:await res.json()}
}
async function shop(db,who){
 const res=await rewardsRoute(new Request('https://homeflow.invalid/api/rewards'),
  db,'/api/rewards',who)
 return res.json()
}
async function redeemWish(db,who,body){
 const res=await lotteryRoute(new Request('https://homeflow.invalid/api/lottery/coupons/redeem-wish',{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)
 }),db,'/api/lottery/coupons/redeem-wish',who)
 return {status:res.status,body:await res.json()}
}

test('balanced lottery issues free tickets but never automatically uses them; double use and wrong owner fail',async()=>{
 const {sqlite,db}=fixture()
 try{
  earn(sqlite,'alice',35)
  const initial=await wallet(db,alice)
  const prize=await draw(db,alice,'ticket')
  assert.equal(prize.status,201)
  assert.equal(prize.body.draw.kind,'ticket')
  assert.equal(await wallet(db,alice),initial-5)
  const ticket=(await coupons(db,alice)).find(c=>c.kind==='ticket')
  assert.equal(ticket.id,prize.body.draw.id)
  assert.equal(ticket.status,'available')
  const paid=await draw(db,alice,'six')
  assert.equal(paid.status,201)
  assert.equal(paid.body.draw.points,6)
  assert.equal(paid.body.draw.cost,5)
  assert.equal((await coupons(db,alice))[0].status,'available','ticket must never auto-apply')
  const before=await wallet(db,alice)
  const used=await draw(db,alice,'ten',{ticketCouponId:ticket.id})
  assert.equal(used.status,201)
  assert.equal(used.body.draw.cost,0)
  assert.equal(used.body.draw.points,10)
  assert.equal(await wallet(db,alice),before+10)
  assert.equal((await coupons(db,alice)).find(c=>c.id===ticket.id).status,'used')
  const replay=await draw(db,alice,'empty',{requestId:used.requestId,ticketCouponId:ticket.id})
  assert.equal(replay.status,200)
  assert.equal(replay.body.draw.id,used.body.draw.id)
  assert.equal((await draw(db,alice,'empty',{ticketCouponId:ticket.id})).status,409)
  assert.equal((await draw(db,bob,'empty',{ticketCouponId:ticket.id})).status,409)
  assert.equal((await coupons(db,bob)).length,0)
  assert.equal((await coupons(db,outsider)).length,0)
  assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length,0)
 }finally{sqlite.close()}
})

test('shop 95% coupon deducts once per multi-quantity redemption and cannot be replay-spent',async()=>{
 const {sqlite,db}=fixture()
 try{
  earn(sqlite,'alice',65)
  const prize=await draw(db,alice,'shop')
  assert.equal(prize.status,201)
  const available=(await coupons(db,alice)).find(c=>c.kind==='shop')
  assert.ok(available)
  const dessert=(await shop(db,alice)).rewards.find(x=>x.points===100)
  assert.ok(dessert)
  const before=await wallet(db,alice)
  const requestId=uuid()
  const result=await redeem(db,alice,{rewardId:dessert.id,quantity:2,requestId,couponId:available.id})
  assert.equal(result.status,201,JSON.stringify(result.body))
  assert.equal(await wallet(db,alice),before-190,'5% on the whole 200-point order')
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM reward_redemptions').get().n,2)
  assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM reward_coupon_discounts').get().n,1)
  assert.equal(sqlite.prepare('SELECT discount_points AS points FROM reward_coupon_discounts').get().points,10)
  assert.equal((await coupons(db,alice)).find(c=>c.id===available.id).status,'used')
  const history=(await shop(db,alice)).redemptions
  assert.equal(history[0].points,190)
  assert.equal(history[0].discountPoints,10)
  assert.equal((await redeem(db,alice,{rewardId:dessert.id,quantity:2,requestId,couponId:available.id})).status,200)
  assert.equal((await redeem(db,alice,{rewardId:dessert.id,quantity:1,requestId:uuid(),couponId:available.id})).status,409)
  assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length,0)
 }finally{sqlite.close()}
})

test('wish bonus applies exactly 100 JPY virtual allowance without wallet gain or external payment',async()=>{
 const {sqlite,db}=fixture()
 try{
  earn(sqlite,'alice',25)
  const wishId=uuid(),goalId=uuid()
  sqlite.prepare(`INSERT INTO wishes(id,household_id,created_by,visibility,title,wish_type,status,estimated_amount,currency)
    VALUES(?1,'h','alice','household','想要的新东西','purchase','wished',100000,'JPY')`).run(wishId)
  sqlite.prepare(`INSERT INTO goals(id,household_id,created_by,visibility,title,target_amount,reserved_amount,currency,wish_id,goal_mode)
    VALUES(?1,'h','alice','household','心愿储值',100000,0,'JPY',?2,'once')`).run(goalId,wishId)
  const award=await draw(db,alice,'wish')
  assert.equal(award.status,201)
  const before=await wallet(db,alice)
  assert.equal(await goalRewardCreditAmount(db,'h',goalId),0)
  const params={couponId:award.body.draw.id,requestId:uuid(),wishId,goalId}
  const used=await redeemWish(db,alice,params)
  assert.equal(used.status,200,JSON.stringify(used.body))
  assert.equal(await goalRewardCreditAmount(db,'h',goalId),100)
  assert.equal(await wallet(db,alice),before)
  assert.equal((await redeemWish(db,alice,params)).body.replayed,true)
  assert.equal((await redeemWish(db,alice,{...params,requestId:uuid()})).status,409)
  assert.equal((await redeemWish(db,bob,{...params,requestId:uuid()})).status,409)
  assert.equal((await redeemWish(db,outsider,{...params,requestId:uuid()})).status,409)
  assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length,0)
 }finally{sqlite.close()}
})

test('coupon expiry follows JST dates, allows cross-year carry, and warns 7 days before expiry',async()=>{
 const {sqlite,db}=fixture()
 try{
  earn(sqlite,'alice',30)
  const drawTicket=await draw(db,alice,'ticket')
  const drawShop=await draw(db,alice,'shop')
  const c1=(await coupons(db,alice)).find(x=>x.id===drawTicket.body.draw.id)
  const c2=(await coupons(db,alice)).find(x=>x.id===drawShop.body.draw.id)
  const jstCreated=new Date(Date.parse(c1.createdAt)+9*3600000).toISOString().slice(0,10)
  assert.equal(c1.expiresOn,new Date(Date.parse(jstCreated+'T00:00:00Z')+60*86400000)
    .toISOString().slice(0,10))
  assert.equal(c2.expiresOn,new Date(Date.parse(jstCreated+'T00:00:00Z')+90*86400000)
    .toISOString().slice(0,10))
  const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
  const target=new Date(Date.parse(today+'T00:00:00Z')+7*86400000).toISOString().slice(0,10)
  sqlite.prepare('UPDATE lottery_coupons SET expires_on=? WHERE id=?').run(target,c1.id)
  sqlite.prepare('UPDATE lottery_coupons SET expires_on=? WHERE id=?').run('2027-01-12',c2.id)
  const reminders=await expiringCouponReminders(db,alice,today)
  assert.equal(reminders.length,1)
  assert.equal(reminders[0].daysBefore,7)
  assert.match(reminders[0].message,/免费抽奖券/)
  assert.equal((await expiringCouponReminders(db,bob,today)).length,0)
  assert.equal((await coupons(db,alice)).find(x=>x.id===c2.id).status,'available')
  sqlite.prepare("UPDATE lottery_coupons SET expires_on=date('now','+9 hours','-1 day') WHERE id=?").run(c1.id)
  assert.equal((await coupons(db,alice)).find(x=>x.id===c1.id).status,'expired')
  assert.equal((await draw(db,alice,'empty',{ticketCouponId:c1.id})).status,409)
 }finally{sqlite.close()}
})

test('lottery summary matches wallet and annual ledger for six-point prizes and free-ticket draws',async()=>{
 const {sqlite,db}=fixture()
 try{
  earn(sqlite,'alice',10)
  const before=await (await pointsRoute(new Request('https://homeflow.invalid/api/points'),db,alice)).json()
  assert.equal(before.pointRules.onceUnassigned,5,'all new one-off completions award five base points')
  assert.equal(before.pointRules.onceAssigned,5)
  const ticket=await draw(db,alice,'ticket')
  const six=await draw(db,alice,'six')
  const free=await draw(db,alice,'ten',{ticketCouponId:ticket.body.draw.id})
  const shopCoupon=await draw(db,alice,'shop')
  const wishCoupon=await draw(db,alice,'wish')
  for(const result of [ticket,six,free,shopCoupon,wishCoupon])assert.equal(result.status,201)
  assert.equal(free.body.draw.cost,0)
  const net=[ticket,six,free,shopCoupon,wishCoupon]
    .reduce((total,{body})=>total+body.draw.points-body.draw.cost,0)
  assert.equal(net,-4,'all five draws cost 5, except the free ticket')
  const after=await (await pointsRoute(new Request('https://homeflow.invalid/api/points'),db,alice)).json()
  assert.equal(after.lotteryNetPoints,net)
  assert.equal(after.availablePoints,before.availablePoints+net)
  assert.equal(after.experience,before.experience,'lottery never creates XP')
  const year=new Date(Date.now()+9*3600000).getUTCFullYear()
  const history=await pointsHistoryRoute(new Request(
   'https://homeflow.invalid/api/points/history?year='+year+'&category=lottery'),db,alice)
  assert.equal(history.status,200)
  const ledger=await history.json()
  assert.equal(ledger.members.find(m=>m.userId==='alice').lotteryNetPoints,net)
  assert.equal(ledger.members.find(m=>m.userId==='alice').endingPoints,after.availablePoints)
  assert.equal(ledger.entries.length,5)
 }finally{sqlite.close()}
})

test('yearly history excludes free-ticket and wish-coupon events from the Shop filter',async()=>{
 const {sqlite,db}=fixture()
 try{
  earn(sqlite,'alice',10)
  const ticket=await draw(db,alice,'ticket')
  const used=await draw(db,alice,'ten',{ticketCouponId:ticket.body.draw.id})
  const shopCoupon=await draw(db,alice,'shop')
  const wishCoupon=await draw(db,alice,'wish')
  assert.ok([ticket,used,shopCoupon,wishCoupon].every(r=>r.status===201))
  // Model expiration without spending a production coupon. History must
  // retain distinct coupon kinds even after expiry or manual consumption.
  sqlite.prepare("UPDATE lottery_coupons SET expires_on=date('now','+9 hours','-1 day') WHERE id=?").run(shopCoupon.body.draw.id)
  const year=new Date(Date.now()+9*3600000).getUTCFullYear()
  const query=async(category,page=1)=>{
   const res=await pointsHistoryRoute(new Request(
    'https://homeflow.invalid/api/points/history?year='+year+'&category='+category+'&page='+page),db,alice)
   assert.equal(res.status,200)
   return res.json()
  }
  const shop=await query('shop')
  assert.equal(shop.total,1,'only the shop coupon expiry belongs to Shop')
  assert.equal(shop.entries[0].category,'coupon_shop_expire')
  const first=await query('lottery')
  const second=await query('lottery',2)
  const categories=[...first.entries,...second.entries].map(e=>e.category)
  assert.ok(categories.includes('coupon_ticket_use'))
  assert.ok(categories.includes('coupon_shop_expire'))
  assert.equal(categories.filter(c=>c==='lottery').length,4)
  assert.equal(first.total,6)
  const all=await query('all')
  assert.ok(all.total>=first.total)
  assert.equal((await query('shop',2)).entries.length,0)
 }finally{sqlite.close()}
})


test('monthly ten-draw cap counts free tickets without charging twice, and blocks the eleventh draw',async()=>{
 const {sqlite,db}=fixture()
 try{
  earn(sqlite,'alice',40)
  const first=await draw(db,alice,'ticket')
  assert.equal(first.status,201)
  const ticket=(await coupons(db,alice)).find(c=>c.id===first.body.draw.id)
  assert.equal(ticket.kind,'ticket')
  const free=await draw(db,alice,'six',{ticketCouponId:ticket.id})
  assert.equal(free.status,201)
  assert.equal(free.body.draw.cost,0)
  const replay=await draw(db,alice,'empty',{requestId:free.requestId,ticketCouponId:ticket.id})
  assert.equal(replay.status,200)
  for(let i=0;i<8;i++)assert.equal((await draw(db,alice,'empty')).status,201)
  const summary=await lotteryRoute(new Request('https://homeflow.invalid/api/lottery'),
   db,'/api/lottery',alice)
  const result=await summary.json()
  assert.equal(result.limit,10)
  assert.equal(result.used,10)
  assert.equal(result.used+Math.max(0,result.limit-result.used),10)
  assert.equal((await draw(db,alice,'empty')).status,409)
  assert.equal((await draw(db,bob,'empty')).status,409,'free ticket cannot cross household members')
  assert.equal((await coupons(db,alice)).find(c=>c.id===ticket.id).status,'used')
  assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length,0)
 }finally{sqlite.close()}
})
