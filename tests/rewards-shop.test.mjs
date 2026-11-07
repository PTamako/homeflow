import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {rewardsRoute} from '../worker/rewards.js'
import {pointsRoute,pointLevel,tokyoWeekWindow,longestStreak} from '../worker/points.js'

const source=readFileSync(new URL('../scripts/check_migrations.py',import.meta.url),'utf8')
const manifests=source.slice(source.indexOf('MIGRATIONS=['),source.indexOf(']\nfiles='))
const names=[...manifests.matchAll(/"(\d{4}_[^"]+\.sql)"/g)].map(m=>m[1])
assert.equal(names.length,37)
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
 const response=await rewardsRoute(request,db,path,session)
 return {status:response.status,body:await response.json()}
}
const balance=async(db,user)=>await (await pointsRoute(
 new Request('https://homeflow.invalid/api/points'),db,user)).json()
function earn(sqlite,user,quantity=12,visibility='household',offset=0){
 const stamp=new Date().toISOString()
 const q=sqlite.prepare(`INSERT INTO completion_points
 (household_id,kind,source_id,occurrence_on,earner_user_id,visibility,points,earned_at)
 VALUES('h','task',?1,'',?2,?3,10,?4)`)
 for(let i=0;i<quantity;i++)q.run(user+'-'+(i+offset),user,visibility,stamp)
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
test('12 task completions earn 120 and weekly 30 bonus; experience and challenge are not spent',async()=>{
 const {sqlite,db}=fixture()
 try{
  earn(sqlite,'alice',12)
  const data=await balance(db,alice)
  assert.equal(data.earnedPoints,120)
  assert.equal(data.weeklyBonusPoints,30)
  assert.equal(data.availablePoints,150)
  assert.equal(data.experience,150)
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
  assert.equal(a.availablePoints,150);assert.equal(b.availablePoints,150)
  const list=await call(db,alice,'/api/rewards')
  const dinner=list.body.rewards.find(x=>x.title==='选择一次周末大餐')
  assert.equal(dinner.points,300)
  const opening=await call(db,alice,'/api/rewards/pool','POST',{rewardId:dinner.id,requestId:id(1)})
  assert.equal(opening.status,201)
  const orderId=opening.body.id
  assert.equal((await call(db,alice,'/api/rewards/pool','POST',{rewardId:dinner.id,requestId:id(1)})).body.id,orderId)
  assert.equal((await call(db,alice,'/api/rewards/pool/'+orderId+'/contribute','POST',{points:151,requestId:id(2)})).status,409)
  const first=await call(db,alice,'/api/rewards/pool/'+orderId+'/contribute','POST',{points:150,requestId:id(3)})
  assert.equal(first.status,201)
  assert.equal((await balance(db,alice)).availablePoints,0)
  assert.equal((await balance(db,bob)).availablePoints,150)
  assert.equal((await call(db,alice,'/api/rewards/pool/'+orderId+'/contribute','POST',{points:1,requestId:id(4)})).status,409)
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
  assert.equal((await balance(db,bob)).availablePoints,0)
  assert.equal((await call(db,bob,'/api/rewards/pool/'+orderId+'/cancel','POST')).status,409)
  assert.equal((await call(db,bob,'/api/rewards/pool/'+orderId+'/fulfill','POST')).status,200)
  assert.equal((await call(db,alice,'/api/rewards')).body.groupOrders[0].status,'fulfilled')
  assert.equal((await balance(db,alice)).experience,150)
  assert.equal((await balance(db,bob)).experience,150)
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
  assert.equal((await balance(db,alice)).availablePoints,120)
  assert.equal((await balance(db,bob)).availablePoints,130)
  assert.equal((await call(db,bob,'/api/rewards/pool/'+open.body.id+'/cancel','POST')).status,200)
  assert.equal((await balance(db,alice)).availablePoints,150)
  assert.equal((await balance(db,bob)).availablePoints,150)
  assert.equal((await call(db,bob,'/api/rewards/redeem','POST',{rewardId:dessert.id,requestId:id(15)})).status,201)
  assert.equal((await balance(db,bob)).availablePoints,50)
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
  assert.equal((await balance(db,alice)).availablePoints,75)
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
    assert.equal(mixed.availablePoints,90)
    assert.equal(mixed.experience,210)
    assert.equal(mixed.challenge.completed,9)
    assert.equal(mixed.weeklyBonusPoints,0)
    assert.equal((await call(db,alice,'/api/rewards/redeem','POST',
      {rewardId:dessert.id,requestId:id(103)})).status,409,
      'private points must not top up the household wallet')
    assert.equal((await call(db,alice,'/api/rewards/pool/'+pool.body.id+'/contribute','POST',
      {points:90,requestId:id(104)})).status,201)
    assert.equal((await balance(db,alice)).availablePoints,0)
  }finally{sqlite.close()}
})

test('weekly household bonus is revoked if task visibility becomes private',async()=>{
  const {sqlite,db}=fixture()
  try{
    earn(sqlite,'bob',10,'household')
    assert.equal((await balance(db,bob)).availablePoints,130)
    assert.equal((await balance(db,bob)).weeklyBonusPoints,30)
    sqlite.prepare("UPDATE completion_points SET visibility='private' WHERE source_id='bob-0'").run()
    const after=await balance(db,bob)
    assert.equal(after.availablePoints,90)
    assert.equal(after.weeklyBonusPoints,0)
    assert.equal(after.ownPrivatePoints,10)
    assert.equal(after.experience,100)
    sqlite.prepare("UPDATE completion_points SET visibility='household' WHERE source_id='bob-0'").run()
    assert.equal((await balance(db,bob)).availablePoints,130)
  }finally{sqlite.close()}
})
