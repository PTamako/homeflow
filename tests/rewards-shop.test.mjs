import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {rewardsRoute} from '../worker/rewards.js'
import {tasksRoute} from '../worker/tasks.js'
import {goalRewardCreditAmount} from '../worker/reward-goal-credits.js'
import {pointsRoute,pointLevel,tokyoWeekWindow,longestStreak} from '../worker/points.js'
import {annualPointLedgerSql,pointsHistoryRoute,jstYearWindow} from '../worker/points-history.js'

const source=readFileSync(new URL('../scripts/check_migrations.py',import.meta.url),'utf8')
const manifests=source.slice(source.indexOf('MIGRATIONS=['),source.indexOf(']\nfiles='))
const names=[...manifests.matchAll(/"(\d{4}_[^"]+\.sql)"/g)].map(m=>m[1])
assert.equal(names.length,52)
function fixture(){
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec('PRAGMA foreign_keys=ON')
 for(const file of names)sqlite.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8'))
 sqlite.exec(`
  INSERT INTO households(id,display_name) VALUES ('h','家'),('h2','别家');
  INSERT INTO users(id,login_name,password_salt,password_verifier)
    VALUES('alice','alice','salt','verifier'),('bob','bob','salt','verifier'),('c','c','salt','verifier');
  INSERT INTO household_members(household_id,user_id,role)
    VALUES('h','alice','owner'),('h','bob','member'),('h2','c','owner');
 `)
 const db={
  prepare(sql){
   const q=sqlite.prepare(sql);let args=[]
   return {bind(...values){args=values;return this},
    async all(){return {results:q.all(...args)}},
    async first(){return q.get(...args)||null},
    async run(){const result=q.run(...args);return {meta:{changes:Number(result.changes)}}}}
  }
 }
 return {sqlite,db}
}
const alice={household_id:'h',user_id:'alice',role:'owner'}
const bob={household_id:'h',user_id:'bob',role:'member'}
const other={household_id:'h2',user_id:'c',role:'owner'}
const id=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
const call=async(db,session,path,method='GET',body)=> {
 const request=new Request('https://homeflow.invalid'+path,{method,
  ...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})})
 const response=await rewardsRoute(request,db,path.split('?')[0],session)
 return {status:response.status,body:await response.json()}
}
const balance=async(db,user)=>await (await pointsRoute(
 new Request('https://homeflow.invalid/api/points'),db,user)).json()
function earn(sqlite,user,quantity=12,visibility='household',offset=0){
 const stamp=new Date().toISOString()
 const q=sqlite.prepare(`INSERT INTO completion_points
 (household_id,kind,source_id,occurrence_on,earner_user_id,visibility,points,earned_at)
 VALUES('h','task',?1,'',?2,?3,10,?4)`)
 // Older 10-point awards remain valid after the new scoring migration.
 // This fixture intentionally represents those historical ledger rows.
 const undo=sqlite.prepare("DELETE FROM completion_point_adjustments WHERE household_id='h' AND kind='task' AND source_id=?1")
 for(let i=0;i<quantity;i++){
  const key=user+'-'+(i+offset)
  q.run(key,user,visibility,stamp)
  undo.run(key)
 }
}
test('migration creates four configurable household presets and strong foreign keys',async()=>{
 const {sqlite,db}=fixture()
 try{
  const a=await call(db,alice,'/api/rewards'),b=await call(db,other,'/api/rewards')
  assert.equal(a.status,200)
  assert.deepEqual(a.body.rewards.map(x=>x.points).sort((a,b)=>a-b),[100,200,300,500])
  assert.equal(a.body.rewards.every(x=>x.builtin&&x.stock===null),true)
  assert.equal(b.body.rewards.length,4)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM reward_group_orders').get().n,0)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM pragma_foreign_key_check').get().n,0)
  const trig=sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='trigger' AND name LIKE 'rewards_%'").get().n
  assert.equal(trig,5)
 }finally{sqlite.close()}
})
test('12 task completions earn 120 and monthly badges while XP remains permanent',async()=>{
 const {sqlite,db}=fixture()
 try{
  earn(sqlite,'alice',12)
  const data=await balance(db,alice)
  assert.equal(data.earnedPoints,120)
  assert.equal(data.weeklyBonusPoints,30)
  assert.equal(data.availablePoints,170)
  assert.equal(data.experience,170)
  assert.equal(data.ownLevel.level,2)
  assert.equal(data.challenge.completed,12)
  assert.equal(data.challenge.achieved,true)
  assert.equal(data.badges.find(x=>x.id==='challenge').unlocked,true)
  assert.equal(pointLevel(150).progress,50)
  assert.equal(longestStreak(['2026-11-01','2026-11-02','2026-11-03']),3)
  assert.match(tokyoWeekWindow().weekOn,/^\d{4}-\d{2}-\d{2}$/)
  sqlite.prepare("DELETE FROM completion_points WHERE source_id='alice-0'").run()
  assert.equal((await balance(db,alice)).weeklyBonusPoints,30,'still over threshold')
  for(let i=1;i<4;i++)sqlite.prepare('DELETE FROM completion_points WHERE source_id=?1').run('alice-'+i)
  assert.equal((await balance(db,alice)).weeklyBonusPoints,0,'weekly award revoked below 10')
 }finally{sqlite.close()}
})
test('real 150 + 150 joint reward purchase closes only after both members pay',async()=>{
 const {sqlite,db}=fixture()
 try{
  earn(sqlite,'alice',12);earn(sqlite,'bob',12)
  let a=await balance(db,alice),b=await balance(db,bob)
  assert.equal(a.availablePoints,170);assert.equal(b.availablePoints,170)
  const list=await call(db,alice,'/api/rewards')
  const dinner=list.body.rewards.find(x=>x.title==='选择一次周末大餐')
  assert.equal(dinner.points,300)
  const opening=await call(db,alice,'/api/rewards/pool','POST',{rewardId:dinner.id,requestId:id(1)})
  assert.equal(opening.status,201)
  const orderId=opening.body.id
  assert.equal((await call(db,alice,'/api/rewards/pool','POST',{rewardId:dinner.id,requestId:id(1)})).body.id,orderId)
  assert.equal((await call(db,alice,'/api/rewards/pool/'+orderId+'/contribute','POST',{points:176,requestId:id(2)})).status,409)
  const first=await call(db,alice,'/api/rewards/pool/'+orderId+'/contribute','POST',{points:150,requestId:id(3)})
  assert.equal(first.status,201)
  assert.equal((await balance(db,alice)).availablePoints,20)
  assert.equal((await balance(db,bob)).availablePoints,170)
  assert.equal((await call(db,alice,'/api/rewards/pool/'+orderId+'/contribute','POST',{points:26,requestId:id(4)})).status,409)
  let orders=(await call(db,alice,'/api/rewards')).body.groupOrders
  assert.equal(orders[0].status,'collecting')
  assert.equal(orders[0].fundedPoints,150)
  assert.deepEqual(orders[0].contributions.map(x=>x.userId),['alice'])
  assert.equal((await call(db,bob,'/api/rewards/pool/'+orderId+'/contribute','POST',{points:150,requestId:id(5)})).status,201)
  assert.equal((await call(db,bob,'/api/rewards/pool/'+orderId+'/contribute','POST',{points:150,requestId:id(5)})).body.replayed,true)
  orders=(await call(db,bob,'/api/rewards')).body.groupOrders
  assert.equal(orders[0].status,'requested')
  assert.equal(orders[0].fundedPoints,300)
  assert.equal(orders[0].contributions.length,2)
  assert.equal((await balance(db,bob)).availablePoints,20)
  assert.equal((await call(db,bob,'/api/rewards/pool/'+orderId+'/cancel','POST')).status,409)
  assert.equal((await call(db,bob,'/api/rewards/pool/'+orderId+'/fulfill','POST')).status,200)
  assert.equal((await call(db,alice,'/api/rewards')).body.groupOrders[0].status,'fulfilled')
  assert.equal((await balance(db,alice)).experience,170)
  assert.equal((await balance(db,bob)).experience,170)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM reward_group_contributions').get().n,2)
 }finally{sqlite.close()}
})
test('pool cancellation fully refunds both partial contributors and releases limited stock',async()=>{
 const {sqlite,db}=fixture()
 try{
  earn(sqlite,'alice',12);earn(sqlite,'bob',12)
  const dessert=(await call(db,alice,'/api/rewards')).body.rewards.find(x=>x.title==='请吃一次甜品')
  assert.equal((await call(db,alice,'/api/rewards/'+encodeURIComponent(dessert.id),'PATCH',{
    title:dessert.title,description:dessert.description,icon:dessert.icon,points:100,stock:1,active:true})).status,200)
  const open=await call(db,alice,'/api/rewards/pool','POST',{rewardId:dessert.id,requestId:id(11)})
  assert.equal(open.status,201)
  assert.equal((await call(db,bob,'/api/rewards/redeem','POST',{rewardId:dessert.id,requestId:id(12)})).status,409,'stock reserved')
  assert.equal((await call(db,alice,'/api/rewards/pool/'+open.body.id+'/contribute','POST',{points:30,requestId:id(13)})).status,201)
  assert.equal((await call(db,bob,'/api/rewards/pool/'+open.body.id+'/contribute','POST',{points:20,requestId:id(14)})).status,201)
  assert.equal((await balance(db,alice)).availablePoints,140)
  assert.equal((await balance(db,bob)).availablePoints,150)
  assert.equal((await call(db,bob,'/api/rewards/pool/'+open.body.id+'/cancel','POST')).status,200)
  assert.equal((await balance(db,alice)).availablePoints,170)
  assert.equal((await balance(db,bob)).availablePoints,170)
  // A refunded, cancelled group order disappears from both members' active
  // list without deleting its record or its audit-friendly contributions.
  const ownerShop=await call(db,alice,'/api/rewards')
  const memberShop=await call(db,bob,'/api/rewards')
  assert.equal(ownerShop.body.groupOrders.some(o=>o.id===open.body.id),false)
  assert.equal(memberShop.body.groupOrders.some(o=>o.id===open.body.id),false)
  assert.equal(sqlite.prepare("SELECT status FROM reward_group_orders WHERE id=?").get(open.body.id).status,'cancelled')
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM reward_group_contributions WHERE order_id=?").get(open.body.id).n,2)
  // Cancelled entries cannot consume the 25-row active-list budget.
  const another=await call(db,alice,'/api/rewards/pool','POST',{rewardId:dessert.id,requestId:id(17)})
  assert.equal(another.status,201)
  assert.deepEqual((await call(db,alice,'/api/rewards')).body.groupOrders.map(o=>o.id),[another.body.id])
  assert.equal((await call(db,bob,'/api/rewards/redeem','POST',{rewardId:dessert.id,requestId:id(15)})).status,409,'new pending pool keeps stock reserved')
  assert.equal((await call(db,alice,'/api/rewards/pool/'+another.body.id+'/cancel','POST')).status,200)
  assert.equal((await call(db,bob,'/api/rewards/redeem','POST',{rewardId:dessert.id,requestId:id(15)})).status,201)
  assert.equal((await balance(db,bob)).availablePoints,70)
  assert.equal((await call(db,bob,'/api/rewards/redeem','POST',{rewardId:dessert.id,requestId:id(15)})).body.replayed,true)
  assert.equal((await call(db,bob,'/api/rewards/redeem','POST',{rewardId:dessert.id,requestId:id(16)})).status,409)
  assert.equal((await call(db,bob,'/api/rewards')).body.rewards.find(x=>x.id===dessert.id).redeemedCount,1)
 }finally{sqlite.close()}
})
test('reward settings are household-scoped and redemptions cannot charge the other user',async()=>{
 const {sqlite,db}=fixture()
 try{
  earn(sqlite,'alice',12)
  const create=await call(db,bob,'/api/rewards','POST',{title:'猫咪零食之夜',
    description:'为豆沙准备',icon:'🐱',points:75,stock:2,active:true})
  assert.equal(create.status,201)
  assert.equal((await call(db,other,'/api/rewards')).body.rewards.some(x=>x.title==='猫咪零食之夜'),false)
  assert.equal((await call(db,bob,'/api/rewards/redeem','POST',{rewardId:create.body.id,requestId:id(21)})).status,409)
  assert.equal((await call(db,alice,'/api/rewards/redeem','POST',{rewardId:create.body.id,requestId:id(22)})).status,201)
  assert.equal((await balance(db,alice)).availablePoints,95)
  assert.equal((await balance(db,bob)).availablePoints,0)
  assert.equal((await call(db,alice,'/api/rewards/pool','POST',{rewardId:'unknown',requestId:id(23)})).status,409)
  assert.equal((await call(db,other,'/api/rewards/pool','POST',{rewardId:create.body.id,requestId:id(24)})).status,409)
  const history=(await call(db,bob,'/api/rewards')).body.redemptions
  assert.equal(history.length,1);assert.equal(history[0].points,75)
  assert.equal((await call(db,bob,'/api/rewards/redemptions/'+history[0].id,'PATCH',{status:'fulfilled'})).status,200)
  assert.equal((await call(db,bob,'/api/rewards')).body.redemptions[0].status,'fulfilled')
 }finally{sqlite.close()}
})

test('private completions grant XP but can neither buy nor cofund household rewards',async()=>{
  const {sqlite,db}=fixture()
  try{
    earn(sqlite,'alice',12,'private')
    const privateOnly=await balance(db,alice)
    assert.equal(privateOnly.experience,120)
    assert.equal(privateOnly.ownPrivatePoints,120)
    assert.equal(privateOnly.availablePoints,0)
    assert.equal(privateOnly.weeklyBonusPoints,0)
    assert.equal(privateOnly.challenge.completed,0)
    const dessert=(await call(db,alice,'/api/rewards')).body.rewards.find(x=>x.title==='请吃一次甜品')
    assert.equal((await call(db,alice,'/api/rewards/redeem','POST',
      {rewardId:dessert.id,requestId:id(100)})).status,409)
    const pool=(await call(db,alice,'/api/rewards/pool','POST',
      {rewardId:dessert.id,requestId:id(101)}))
    assert.equal(pool.status,201)
    assert.equal((await call(db,alice,'/api/rewards/pool/'+pool.body.id+'/contribute','POST',
      {points:10,requestId:id(102)})).status,409)
    earn(sqlite,'alice',9,'household',12)
    const mixed=await balance(db,alice)
    assert.equal(mixed.availablePoints,95)
    assert.equal(mixed.experience,215)
    assert.equal(mixed.challenge.completed,9)
    assert.equal(mixed.weeklyBonusPoints,0)
    assert.equal((await call(db,alice,'/api/rewards/redeem','POST',
      {rewardId:dessert.id,requestId:id(103)})).status,409,
      'private points must not top up the household wallet')
    assert.equal((await call(db,alice,'/api/rewards/pool/'+pool.body.id+'/contribute','POST',
      {points:90,requestId:id(104)})).status,201)
    assert.equal((await balance(db,alice)).availablePoints,5)
  }finally{sqlite.close()}
})

test('weekly household bonus is revoked if task visibility becomes private',async()=>{
  const {sqlite,db}=fixture()
  try{
    earn(sqlite,'bob',10,'household')
    assert.equal((await balance(db,bob)).availablePoints,150)
    assert.equal((await balance(db,bob)).weeklyBonusPoints,30)
    sqlite.prepare("UPDATE completion_points SET visibility='private' WHERE source_id='bob-0'").run()
    const after=await balance(db,bob)
    assert.equal(after.availablePoints,95)
    assert.equal(after.weeklyBonusPoints,0)
    assert.equal(after.ownPrivatePoints,10)
    assert.equal(after.experience,105)
    sqlite.prepare("UPDATE completion_points SET visibility='household' WHERE source_id='bob-0'").run()
    assert.equal((await balance(db,bob)).availablePoints,150)
  }finally{sqlite.close()}
})

test('multi-quantity checkout is atomic, replay-safe, stock-aware and fulfilled as a group',async()=>{
 const {sqlite,db}=fixture()
 try{
  earn(sqlite,'alice',25)
  const dessert=(await call(db,alice,'/api/rewards')).body.rewards.find(x=>x.points===100)
  await call(db,alice,'/api/rewards/'+encodeURIComponent(dessert.id),'PATCH',{
   title:dessert.title,description:dessert.description,icon:dessert.icon,points:100,stock:2,active:true})
  assert.equal((await call(db,alice,'/api/rewards/redeem','POST',{
   rewardId:dessert.id,requestId:id(501),quantity:3})).status,409,'no partial stock charge')
  assert.equal((await call(db,alice,'/api/rewards/redeem','POST',{
   rewardId:dessert.id,requestId:id(502),quantity:0})).status,400)
  const walletBefore=(await balance(db,alice)).availablePoints
  const paid=await call(db,alice,'/api/rewards/redeem','POST',{
   rewardId:dessert.id,requestId:id(503),quantity:2})
  assert.equal(paid.status,201)
  assert.equal(paid.body.quantity,2)
  assert.equal((await call(db,alice,'/api/rewards/redeem','POST',{
   rewardId:dessert.id,requestId:id(503),quantity:2})).body.replayed,true)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM reward_redemptions').get().n,2)
  assert.equal((await balance(db,alice)).availablePoints,walletBefore-200)
  const shop=(await call(db,alice,'/api/rewards')).body
  assert.equal(shop.rewards.find(x=>x.id===dessert.id).redeemedCount,2)
  assert.equal(shop.redemptions.length,1)
  assert.equal(shop.redemptions[0].quantity,2)
  assert.equal(shop.redemptions[0].points,200)
  assert.equal((await call(db,bob,'/api/rewards/redemptions/'+shop.redemptions[0].id,
   'PATCH',{status:'fulfilled'})).status,200)
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM reward_redemptions WHERE status='fulfilled'").get().n,2)
  assert.equal((await call(db,bob,'/api/rewards/redeem','POST',{
   rewardId:dessert.id,requestId:id(504),quantity:1})).status,409)
 }finally{sqlite.close()}
})

test('annual points history lists credits, spending, privacy and pre-reset balance',async()=>{
 const {sqlite,db}=fixture()
 try{
  const year=new Date(Date.now()+9*3600000).getUTCFullYear()
  const {start,end}=jstYearWindow(year)
  assert.equal(new Date(start).getUTCHours(),15)
  assert.equal(new Date(end).getUTCHours(),15)
  earn(sqlite,'alice',12)
  earn(sqlite,'bob',2,'private')
  const dessert=(await call(db,alice,'/api/rewards')).body.rewards.find(x=>x.points===100)
  assert.equal((await call(db,alice,'/api/rewards/redeem','POST',
   {rewardId:dessert.id,requestId:id(601),quantity:1})).status,201)
  const history=async(session,y=year,member='')=>{
   const response=await pointsHistoryRoute(new Request(
    'https://homeflow.invalid/api/points/history?year='+y+'&page=1&member='+encodeURIComponent(member)),db,session)
   return {status:response.status,body:await response.json()}
  }
  const own=await history(alice)
  assert.equal(own.status,200)
  const mine=own.body.members.find(x=>x.userId==='alice')
  assert.equal(mine.endingPoints,(await balance(db,alice)).availablePoints)
  assert.equal(mine.contributionPoints,(await balance(db,alice)).householdEarnedPoints)
  assert.equal(mine.spentPoints,100)
  assert.equal(own.body.entries.some(x=>x.category==='redeem'&&x.amount===-100),true)
  assert.equal(own.body.entries.some(x=>x.userId==='bob'&&x.visibility==='private'),false)
  assert.equal(own.body.members.find(x=>x.userId==='bob').privatePoints,null)
  const otherView=await history(bob,year,'bob')
  assert.equal(otherView.body.members.find(x=>x.userId==='bob').privatePoints,20)
  assert.equal(otherView.body.entries.some(x=>x.userId==='bob'&&x.visibility==='private'),true)
  assert.equal((await history(alice,2025)).status,400)
 }finally{sqlite.close()}
})

test('history nets task adjustments and dual shares and paginates five rows',async()=>{
 const {sqlite,db}=fixture()
 try{
  const stamp=new Date().toISOString(),day=stamp.slice(0,10)
  const year=new Date(Date.now()+9*3600000).getUTCFullYear()
  sqlite.prepare(`INSERT INTO tasks
    (id,household_id,creator_user_id,assignee_user_id,visibility,title)
    VALUES('net-task','h','alice','bob','household','单人任务')`).run()
  sqlite.prepare("UPDATE tasks SET completed_at=?1,completed_by='bob' WHERE id='net-task'").run(stamp)
  sqlite.prepare(`INSERT INTO tasks
    (id,household_id,creator_user_id,assignee_user_id,second_assignee_user_id,visibility,title)
    VALUES('dual-task','h','alice','alice','bob','household','双人任务')`).run()
  sqlite.prepare("UPDATE tasks SET completed_at=?1,completed_by='alice' WHERE id='dual-task'").run(stamp)
  sqlite.prepare(`INSERT INTO routines
    (id,household_id,created_by,title,visibility,repeat_type,repeat_config,anchor_date)
    VALUES('net-routine','h','alice','周期任务','household','daily','{}',?1)`).run(day)
  sqlite.prepare(`INSERT INTO routine_marks(routine_id,occurrence_on,completed_at,completed_by)
    VALUES('net-routine',?1,?2,'bob')`).run(day,stamp)
  sqlite.prepare(`INSERT INTO shopping_items
    (id,household_id,created_by,visibility,title,assigned_to,second_assignee_user_id)
    VALUES('joint-buy','h','alice','household','一起购物','alice','bob')`).run()
  sqlite.prepare("UPDATE shopping_items SET completed_at=?1,completed_by='alice' WHERE id='joint-buy'").run(stamp)
  const {start,end}=jstYearWindow(year)
  const entries=sqlite.prepare(`WITH ledger AS (${annualPointLedgerSql()})
    SELECT userId,label,amount FROM ledger
    WHERE label IN ('单人任务','双人任务','周期任务','一起购物')
    ORDER BY label,userId`).all('h',start,end).map(e=>({
      userId:e.userId,label:e.label,amount:e.amount
    }))
  assert.deepEqual(entries,[
   {userId:'alice',label:'一起购物',amount:1},
   {userId:'bob',label:'一起购物',amount:1},
   {userId:'bob',label:'单人任务',amount:5},
   {userId:'alice',label:'双人任务',amount:2.5},
   {userId:'bob',label:'双人任务',amount:2.5},
   {userId:'bob',label:'周期任务',amount:5}
  ])
  const get=async(who,page)=>{
   const response=await pointsHistoryRoute(
     new Request(`https://homeflow.invalid/api/points/history?year=${year}&page=${page}`),db,who)
   assert.equal(response.status,200)
   return response.json()
  }
  const first=await get(alice,1),second=await get(alice,2)
  assert.equal(first.pageSize,5)
  assert.equal(first.entries.length,5)
  assert.equal(first.totalPages,Math.ceil(first.total/5))
  assert.equal(first.total,second.total)
  assert.ok(second.entries.length>0)
  assert.equal(first.members.find(x=>x.userId==='alice').endingPoints,
    (await balance(db,alice)).availablePoints)
  assert.equal(first.members.find(x=>x.userId==='bob').endingPoints,
    (await balance(db,bob)).availablePoints)
  const all=[...first.entries,...second.entries]
  assert.equal(all.some(x=>x.category==='adjustment'||x.category==='split'),false)
 }finally{sqlite.close()}
})

test('one multi-item redemption is one ledger row with total points, while later buys stay separate',async()=>{
 const {sqlite,db}=fixture()
 try{
  const year=new Date(Date.now()+9*3600000).getUTCFullYear()
  const {start,end}=jstYearWindow(year)
  earn(sqlite,'alice',40)
  const dessert=(await call(db,alice,'/api/rewards')).body.rewards
   .find(x=>x.title==='请吃一次甜品')
  const before=await balance(db,alice)
  const beforeHistory=await pointsHistoryRoute(new Request(
   `https://homeflow.invalid/api/points/history?year=${year}`),db,alice)
  assert.equal(beforeHistory.status,200)
  const initialCount=(await beforeHistory.json()).total
  const first=await call(db,alice,'/api/rewards/redeem','POST',
   {rewardId:dessert.id,requestId:id(801),quantity:3})
  assert.equal(first.status,201)
  assert.equal(first.body.quantity,3)
  const second=await call(db,alice,'/api/rewards/redeem','POST',
   {rewardId:dessert.id,requestId:id(802),quantity:1})
  assert.equal(second.status,201)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM reward_redemptions').get().n,4)
  const lines=sqlite.prepare(`WITH ledger AS (${annualPointLedgerSql()})
    SELECT userId,label,amount FROM ledger WHERE category='redeem'
    ORDER BY amount`).all('h',start,end).map(x=>({
     userId:x.userId,label:x.label,amount:x.amount
    }))
  assert.deepEqual(lines,[
   {userId:'alice',label:'兑换：请吃一次甜品 ×3',amount:-300},
   {userId:'alice',label:'兑换：请吃一次甜品',amount:-100}
  ])
  const wallet=await balance(db,alice)
  assert.equal(wallet.availablePoints,before.availablePoints-400)
  const response=await pointsHistoryRoute(new Request(
   `https://homeflow.invalid/api/points/history?year=${year}`),db,alice)
  assert.equal(response.status,200)
  const after=await response.json()
  assert.equal(after.pageSize,5)
  assert.equal(after.entries.length,5)
  assert.equal(after.total,initialCount+2,'batch uses one pagination slot')
  assert.equal(after.members.find(x=>x.userId==='alice').endingPoints,wallet.availablePoints)
  assert.equal(after.members.find(x=>x.userId==='alice').spentPoints,400)
  assert.equal(after.totalPages,Math.ceil(after.total/5))
 }finally{sqlite.close()}
})

function addWishAndSavingsGoal(sqlite,who='alice',visibility='household',house='h'){
 const wishId=id(850+(who==='bob'?1:0)+(house==='h2'?10:0)),goalId=id(860+(who==='bob'?1:0)+(house==='h2'?10:0))
 sqlite.prepare(`INSERT INTO wishes
  (id,household_id,created_by,visibility,title,wish_type,status,estimated_amount,currency)
  VALUES(?1,?2,?3,?4,?5,'purchase','wished',100000,'JPY')`)
  .run(wishId,house,who,visibility,'想要的物品')
 sqlite.prepare(`INSERT INTO goals
  (id,household_id,created_by,visibility,title,target_amount,reserved_amount,currency,wish_id,goal_mode)
  VALUES(?1,?2,?3,?4,'愿望储值',100000,0,'JPY',?5,'once')`)
  .run(goalId,house,who,visibility,wishId)
 return {wishId,goalId}
}
test('wish reward redeem credits one-time yen allowance, not duplicated by quantity or retry',async()=>{
 const {sqlite,db}=fixture()
 try{
  earn(sqlite,'alice',35)
  const {wishId,goalId}=addWishAndSavingsGoal(sqlite)
  const dessert=(await call(db,alice,'/api/rewards')).body.rewards.find(r=>r.points===100)
  const enabled=await call(db,alice,'/api/rewards/'+encodeURIComponent(dessert.id),'PATCH',{
    title:dessert.title,description:dessert.description,icon:dessert.icon,points:dessert.points,
    stock:null,active:true,goalCreditYen:1000})
  assert.equal(enabled.status,200)
  const wishChoices=await call(db,alice,'/api/rewards/wish-goals')
  assert.equal(wishChoices.status,200)
  assert.ok(wishChoices.body.items.some(x=>x.wishId===wishId&&x.goalId===goalId))
  assert.equal((await call(db,alice,'/api/rewards/redeem','POST',
    {rewardId:dessert.id,requestId:id(801),quantity:2})).status,409,
    'credit voucher cannot be purchased without a linked goal')
  const before=(await balance(db,alice)).availablePoints
  const args={rewardId:dessert.id,requestId:id(802),quantity:3,wishId,goalId}
  const first=await call(db,alice,'/api/rewards/redeem','POST',args)
  assert.equal(first.status,201)
  assert.equal(first.body.quantity,3)
  assert.equal((await call(db,alice,'/api/rewards/redeem','POST',args)).body.replayed,true)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM reward_redemptions').get().n,3)
  assert.equal(await goalRewardCreditAmount(db,'h',goalId),3000)
  assert.equal((await balance(db,alice)).availablePoints,before-300)
  const records=(await call(db,alice,'/api/rewards')).body.redemptions
  assert.equal(records.length,1)
  assert.equal(records[0].quantity,3)
  assert.equal(records[0].creditedYen,3000)
  assert.equal(records[0].wishTitle,'想要的物品')
  assert.equal((await call(db,bob,'/api/rewards')).body.redemptions[0].wishTitle,null)
  await call(db,alice,'/api/rewards/'+encodeURIComponent(dessert.id),'PATCH',{
    title:dessert.title,description:dessert.description,icon:dessert.icon,points:dessert.points,
    stock:null,active:true,goalCreditYen:0})
  assert.equal(await goalRewardCreditAmount(db,'h',goalId),3000,
    'prior credited vouchers survive reward item edits')
 }finally{sqlite.close()}
})
test('linked reward validates household, private wish and specific goal',async()=>{
 const {sqlite,db}=fixture()
 try{
  earn(sqlite,'alice',35)
  const own=addWishAndSavingsGoal(sqlite,'alice','household')
  const privateGoal=addWishAndSavingsGoal(sqlite,'bob','private')
  const foreign=addWishAndSavingsGoal(sqlite,'c','household','h2')
  const dessert=(await call(db,alice,'/api/rewards')).body.rewards.find(r=>r.points===100)
  await call(db,alice,'/api/rewards/'+encodeURIComponent(dessert.id),'PATCH',{
    title:dessert.title,description:dessert.description,icon:dessert.icon,points:dessert.points,
    stock:null,active:true,goalCreditYen:1000})
  const cases=[
    {wishId:privateGoal.wishId,goalId:privateGoal.goalId},
    {wishId:foreign.wishId,goalId:foreign.goalId},
    {wishId:own.wishId,goalId:privateGoal.goalId},
    {wishId:own.wishId,goalId:id(999)}
  ]
  for(let i=0;i<cases.length;i++){
   const denied=await call(db,alice,'/api/rewards/redeem','POST',
     {rewardId:dessert.id,requestId:id(830+i),quantity:1,...cases[i]})
   assert.equal(denied.status,409,'must reject mismatched/private/other-household goals')
  }
  assert.equal(await goalRewardCreditAmount(db,'h',own.goalId),0)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM reward_redemptions').get().n,0)
  const allowed=await call(db,bob,'/api/rewards/wish-goals')
  assert.equal(allowed.body.items.some(x=>x.goalId===privateGoal.goalId),true)
  assert.equal((await call(db,alice,'/api/rewards/wish-goals')).body.items
    .some(x=>x.goalId===privateGoal.goalId),false)
 }finally{sqlite.close()}
})
test('poolled voucher credits its selected wish only after full funding',async()=>{
 const {sqlite,db}=fixture()
 try{
  earn(sqlite,'alice',15);earn(sqlite,'bob',15)
  const {wishId,goalId}=addWishAndSavingsGoal(sqlite)
  const dessert=(await call(db,alice,'/api/rewards')).body.rewards.find(r=>r.points===100)
  await call(db,alice,'/api/rewards/'+encodeURIComponent(dessert.id),'PATCH',{
    title:dessert.title,description:dessert.description,icon:dessert.icon,points:dessert.points,
    stock:null,active:true,goalCreditYen:1000})
  const created=await call(db,alice,'/api/rewards/pool','POST',
    {rewardId:dessert.id,requestId:id(900),wishId,goalId})
  assert.equal(created.status,201)
  assert.equal(await goalRewardCreditAmount(db,'h',goalId),0)
  assert.equal((await call(db,alice,'/api/rewards/pool/'+created.body.id+'/contribute','POST',
    {points:40,requestId:id(901)})).status,201)
  assert.equal(await goalRewardCreditAmount(db,'h',goalId),0)
  assert.equal((await call(db,bob,'/api/rewards/pool/'+created.body.id+'/contribute','POST',
    {points:60,requestId:id(902)})).status,201)
  assert.equal(await goalRewardCreditAmount(db,'h',goalId),1000)
  const group=(await call(db,alice,'/api/rewards')).body.groupOrders.find(x=>x.id===created.body.id)
  assert.equal(group.goalCreditYen,1000)
  assert.equal(group.status,'requested')
  assert.equal((await call(db,alice,'/api/rewards/pool/'+created.body.id+'/fulfill','POST')).status,200)
  assert.equal(await goalRewardCreditAmount(db,'h',goalId),1000,'no second award on fulfillment')
  const open=await call(db,alice,'/api/rewards/pool','POST',
    {rewardId:dessert.id,requestId:id(903),wishId,goalId})
  assert.equal(open.status,201)
  assert.equal((await call(db,alice,'/api/rewards/pool/'+open.body.id+'/cancel','POST')).status,200)
  assert.equal(await goalRewardCreditAmount(db,'h',goalId),1000,'cancelled unfunded order cannot grant credit')
 }finally{sqlite.close()}
})


test('shop history uses real five-entry pages and keeps multi-unit redemptions merged',async()=>{
 const {sqlite,db}=fixture()
 try{
  earn(sqlite,'alice',60)
  const reward=(await call(db,alice,'/api/rewards','POST',{
   title:'分页测试',description:'历史',icon:'🎁',points:10,stock:null,active:true})).body.id
  for(let n=0;n<12;n++){
   const result=await call(db,alice,'/api/rewards/redeem','POST',{
    rewardId:reward,requestId:id(910+n),quantity:n%2?2:1})
   assert.equal(result.status,201,'redeem '+n)
  }
  const first=await call(db,alice,'/api/rewards?redemptionPage=1')
  const second=await call(db,alice,'/api/rewards?redemptionPage=2')
  const third=await call(db,alice,'/api/rewards?redemptionPage=3')
  assert.equal(first.status,200)
  assert.equal(first.body.pageSize,5)
  assert.equal(first.body.redemptionTotal,12)
  assert.equal(first.body.redemptionPages,3)
  assert.equal(first.body.redemptions.length,5)
  assert.equal(second.body.redemptions.length,5)
  assert.equal(third.body.redemptions.length,2)
  const all=[...first.body.redemptions,...second.body.redemptions,...third.body.redemptions]
  assert.equal(new Set(all.map(x=>x.id)).size,12)
  assert.ok(all.some(x=>x.quantity===2),'two-unit orders stay one history event')
  assert.equal((await call(db,alice,'/api/rewards?redemptionPage=0')).status,400)
 }finally{sqlite.close()}
})

test('previous-year assigned bounty pays from current-year creator funds only at completion',async()=>{
 const {sqlite,db}=fixture()
 try{
  const year=new Date(Date.now()+9*3600000).getUTCFullYear()
  const prior=String(year-1)+'-12-31T14:00:00.000Z'
  const task=id(990)
  sqlite.prepare(`INSERT INTO tasks(id,household_id,creator_user_id,assignee_user_id,
    visibility,title,bonus_points,created_at) VALUES(?,?,?,?,?,?,?,?)`)
    .run(task,'h','alice','bob','household','跨年指定奖励',20,prior)
  const request=()=>new Request('https://homeflow.invalid/api/tasks/'+task,{
   method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({completed:true})})
  const before=await tasksRoute(request(),db,'/api/tasks/'+task,bob)
  assert.equal(before.status,409)
  assert.equal((await before.json()).error,'cross_year_bounty_insufficient')
  assert.equal(sqlite.prepare('SELECT completed_at FROM tasks WHERE id=?').get(task).completed_at,null)
  earn(sqlite,'alice',3)
  const after=await tasksRoute(request(),db,'/api/tasks/'+task,bob)
  assert.equal(after.status,200,await after.text())
  const bobWallet=(await balance(db,bob)).availablePoints
  assert.ok(bobWallet>=25,'5 base + 20 bounty credited in completion year')
  const aliceWallet=(await balance(db,alice)).availablePoints
  assert.ok(aliceWallet>=0,'creator cannot overdraw year-end reset wallet')
  const hist=await pointsHistoryRoute(new Request(
   'https://homeflow.invalid/api/points/history?year='+year+'&member=bob'),db,bob)
  assert.equal(hist.status,200)
  const history=await hist.json()
  assert.ok(history.entries.some(e=>e.userId==='bob'&&e.category==='bounty'&&e.amount===20))
  const aliceHistory=await pointsHistoryRoute(new Request(
   'https://homeflow.invalid/api/points/history?year='+year+'&member=alice'),db,alice)
  const aliceRows=(await aliceHistory.json()).entries
  assert.ok(aliceRows.some(e=>e.userId==='alice'&&e.category==='reserved'&&e.amount===-20))
 }finally{sqlite.close()}
})


test('lottery is one detailed ledger event per draw, with safe category and member filtering',async()=>{
 const {sqlite,db}=fixture()
 try{
  const year=new Date(Date.now()+9*3600000).getUTCFullYear()
  const month=new Date(Date.now()+9*3600000).toISOString().slice(0,7)
  const now=new Date().toISOString()
  const draw=sqlite.prepare(`INSERT INTO household_lottery_draws
    (id,household_id,user_id,client_request_id,month_on,prize_kind,
     cost_points,prize_points,created_at)
    VALUES(?1,?2,?3,?4,?5,?6,5,?7,?8)`)
  const outcomes=[['alice','empty',0],['alice','five',5],['bob','ten',10],
    ['alice','twenty',20],['bob','fifty',50],['alice','double',17]]
  for(const [i,[who,kind,prize]] of outcomes.entries())
   draw.run(id(2000+i),'h',who,id(2100+i),month,kind,prize,now)
  draw.run(id(2099),'h2','c',id(2199),month,'empty',0,now)
  earn(sqlite,'bob',1,'private')
  const query=async(session,category='all',page=1,member='')=>{
   const request=new Request('https://homeflow.invalid/api/points/history?year='+
     year+'&page='+page+'&category='+encodeURIComponent(category)+
     '&member='+encodeURIComponent(member))
   const response=await pointsHistoryRoute(request,db,session)
   return {status:response.status,body:await response.json()}
  }
  const all=await query(alice,'all')
  const first=await query(alice,'lottery',1)
  const second=await query(alice,'lottery',2)
  assert.equal(first.status,200)
  assert.equal(first.body.categoryFilter,'lottery')
  assert.equal(first.body.total,6,'one event per ticket, including empty tickets')
  assert.equal(first.body.totalPages,2)
  assert.equal(first.body.pageSize,5)
  assert.equal(first.body.entries.length,5)
  assert.equal(second.body.entries.length,1)
  const entries=[...first.body.entries,...second.body.entries]
  assert.equal(entries.every(x=>x.category==='lottery'),true)
  assert.equal(new Set(entries.map(x=>x.eventId)).size,6)
  assert.equal(entries.every(x=>x.ticketCost===5),true)
  assert.equal(entries.every(x=>x.amount===x.prizePoints-x.ticketCost),true)
  assert.ok(entries.some(x=>x.prizeKind==='empty'&&x.amount===-5))
  assert.ok(entries.some(x=>x.prizeKind==='five'&&x.amount===0))
  assert.ok(entries.some(x=>x.prizeKind==='double'&&x.prizePoints===17&&x.amount===12))
  assert.equal(entries.every(x=>x.contribution===0),true)
  assert.deepEqual(first.body.members,all.body.members,
    'category changes must not change yearly balances, earnings, spending or contribution')
  assert.equal((await query(alice,'lottery',1,'bob')).body.total,2)
  assert.equal((await query(bob,'lottery',1,'bob')).body.total,2)
  assert.equal((await query(alice,'task')).body.entries.some(x=>x.visibility==='private'&&x.userId==='bob'),false)
  assert.equal((await query(bob,'task')).body.entries.some(x=>x.visibility==='private'&&x.userId==='bob'),true)
  assert.equal((await query(alice,'shop')).body.total,0)
  assert.equal((await query(alice,'shopping')).body.total,0)
  assert.equal((await query(alice,'achievement')).status,200)
  assert.equal((await query(alice,'saving')).status,200)
  for(const invalid of ['__proto__','lottery;DROP TABLE household_lottery_draws','unknown']){
   assert.equal((await query(alice,invalid)).status,400)
  }
  assert.equal(sqlite.prepare('PRAGMA foreign_key_check').all().length,0)
 }finally{sqlite.close()}
})
