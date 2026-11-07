import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {lotteryOdds,lotteryPrize,lotteryRoute} from '../worker/lottery.js'
import {pointsRoute} from '../worker/points.js'
import {sendLotteryDrawNotification} from '../worker/webpush.js'

const manifest=readFileSync(new URL('../scripts/check_migrations.py',import.meta.url),'utf8')
const names=[...manifest.slice(manifest.indexOf('MIGRATIONS=['),manifest.indexOf(']\nfiles=')).matchAll(/"(\d{4}_[^"]+\.sql)"/g)].map(x=>x[1])
const alice={household_id:'h',user_id:'alice'},bob={household_id:'h',user_id:'bob'},other={household_id:'h2',user_id:'c'}
function fixture(){
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec('PRAGMA foreign_keys=ON')
 for(const name of names)sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'))
 sqlite.exec("INSERT INTO households(id,display_name) VALUES('h','家庭'),('h2','其他')")
 sqlite.exec("INSERT INTO users(id,login_name,password_salt,password_verifier) VALUES('alice','Alice','salt','verifier'),('bob','Bob','salt','verifier'),('c','Other','salt','verifier')")
 sqlite.exec("INSERT INTO household_members(household_id,user_id,role) VALUES('h','alice','owner'),('h','bob','member'),('h2','c','owner')")
 const db={prepare(sql){const q=sqlite.prepare(sql);let args=[];return {
  bind(...values){args=values;return this},
  async first(){return q.get(...args)||null},
  async all(){return {results:q.all(...args)}},
  async run(){const r=q.run(...args);return {meta:{changes:Number(r.changes)}}}
 }}}
 return {sqlite,db}
}
function earn(sqlite,user,count=15,visibility='household'){
 const q=sqlite.prepare("INSERT INTO completion_points(household_id,kind,source_id,occurrence_on,earner_user_id,visibility,points,earned_at) VALUES(?1,'task',?2,'',?3,?4,10,?5)")
 for(let i=0;i<count;i++)q.run(user==='c'?'h2':'h',crypto.randomUUID(),user,visibility,new Date().toISOString())
}
async function call(db,session,method='GET',id,kind='empty',notify){
 const path=method==='POST'?'/api/lottery/draw':'/api/lottery'
 const request=new Request('https://homeflow.invalid'+path,{method,...(method==='POST'?{headers:{'content-type':'application/json'},body:JSON.stringify({requestId:id})}:{})})
 const response=await lotteryRoute(request,db,path,session,notify,()=>lotteryOdds.find(x=>x.kind===kind))
 return {status:response.status,body:await response.json()}
}
async function wallet(db,person){return (await pointsRoute(new Request('https://homeflow.invalid/api/points'),db,person)).json()}

test('probability thresholds cover all 100% and put doubling at the top 1%',()=>{
 assert.equal(lotteryOdds.reduce((n,x)=>n+x.rate,0),100)
 for(const [roll,expected] of [[0,'empty'],[.499,'empty'],[.5,'five'],[.799,'five'],[.8,'ten'],[.899,'ten'],[.9,'twenty'],[.959,'twenty'],[.96,'fifty'],[.989,'fifty'],[.99,'double'],[.99999,'double']])
   assert.equal(lotteryPrize(roll).kind,expected)
})

test('seven draws per member per month; replay does not double-charge; private XP intact',async()=>{
 const {sqlite,db}=fixture()
 try{
  earn(sqlite,'alice');earn(sqlite,'bob')
  const before=await wallet(db,alice)
  let net=0
  for(const [index,kind] of ['empty','five','ten','twenty','fifty','empty','five'].entries()){
   const id=crypto.randomUUID()
   const first=await call(db,alice,'POST',id,kind)
   assert.equal(first.status,201)
   assert.equal(first.body.draw.kind,kind)
   net+=first.body.draw.points-5
   const replay=await call(db,alice,'POST',id,kind)
   assert.equal(replay.status,200)
   assert.equal(replay.body.draw.id,first.body.draw.id)
   assert.equal((await call(db,alice)).body.used,index+1)
  }
  assert.equal((await call(db,alice,'POST',crypto.randomUUID())).status,409)
  assert.equal((await call(db,bob)).body.used,0)
  const after=await wallet(db,alice)
  assert.equal(after.availablePoints,before.availablePoints+net)
  assert.equal(after.experience,before.experience)
  assert.equal((await call(db,bob,'POST',crypto.randomUUID())).status,201)
  assert.equal((await call(db,alice)).body.history.length,8)
  assert.equal((await call(db,other)).body.history.length,0)
 }finally{sqlite.close()}
})

test('lottery net winnings appear in shared cumulative and monthly leaderboard but never XP',async()=>{
 const {sqlite,db}=fixture()
 try{
  earn(sqlite,'alice',4)
  const awardedTask=sqlite.prepare("SELECT source_id FROM completion_points WHERE household_id='h' AND earner_user_id='alice' LIMIT 1").get().source_id
  sqlite.prepare("INSERT INTO completion_point_adjustments(household_id,kind,source_id,occurrence_on,earner_user_id,visibility,delta,earned_at) VALUES('h','task',?1,'','alice','household',-5,?2)")
   .run(awardedTask,new Date().toISOString())
  const before=await wallet(db,alice)
  const myself=result=>result.members.find(m=>m.userId==='alice')
  const base=myself(before)
  const result=await call(db,alice,'POST',crypto.randomUUID(),'ten')
  assert.equal(result.status,201)
  const after=await wallet(db,alice)
  assert.equal(after.availablePoints,before.availablePoints+5)
  assert.equal(myself(after).sharedPoints,base.sharedPoints+5)
  assert.equal(myself(after).monthPoints,base.monthPoints+5)
  assert.equal(after.experience,before.experience,'lottery does not generate XP')
  const bobs=(await wallet(db,bob)).members.find(x=>x.userId==='bob')
  assert.equal(bobs.sharedPoints,0,'no shared ranking credit to partner')
 }finally{sqlite.close()}
})

test('doubling uses balance AFTER five-point entry fee; private points cannot pay',async()=>{
 const {sqlite,db}=fixture()
 try{
  earn(sqlite,'alice',2);earn(sqlite,'bob',2,'private')
  const before=(await wallet(db,alice)).availablePoints
  const res=await call(db,alice,'POST',crypto.randomUUID(),'double')
  assert.equal(res.status,201)
  assert.equal(res.body.draw.points,before-5)
  assert.equal((await wallet(db,alice)).availablePoints,(before-5)*2)
  assert.equal((await call(db,bob,'POST',crypto.randomUUID())).status,409)
  assert.equal((await call(db,bob)).body.used,0)
 }finally{sqlite.close()}
})

test('racing attempts obey monthly cap and a stale history row stays hidden',async()=>{
 const {sqlite,db}=fixture()
 try{
  earn(sqlite,'alice')
  const attempts=await Promise.all(Array.from({length:10},()=>call(db,alice,'POST',crypto.randomUUID())))
  assert.equal(attempts.filter(x=>x.status===201).length,7)
  assert.equal(attempts.filter(x=>x.status===409).length,3)
  const old=new Date();old.setUTCFullYear(old.getUTCFullYear()-2)
  sqlite.prepare("INSERT INTO household_lottery_draws(id,household_id,user_id,client_request_id,month_on,prize_kind,cost_points,prize_points,created_at) VALUES (?1,'h','alice',?2,'2024-02','empty',5,0,?3)").run(crypto.randomUUID(),crypto.randomUUID(),old.toISOString())
  const list=(await call(db,alice)).body
  assert.equal(list.used,7)
  assert.equal(list.history.length,7)
  assert.equal(list.history.every(x=>x.kind==='empty'&&x.points===0),true)
 }finally{sqlite.close()}
})

test('each draw creates an independent today inbox message for both members; retries preserve read status',async()=>{
 const {sqlite,db}=fixture()
 try{
  earn(sqlite,'alice',1)
  const result=await call(db,alice,'POST',crypto.randomUUID(),'empty')
  assert.equal(result.status,201)
  const draw=result.body.draw
  const first=await sendLotteryDrawNotification({DB:db},alice,draw)
  assert.equal(first.members,2)
  const rows=sqlite.prepare("SELECT recipient_user_id,kind,title,message,read_at FROM notification_inbox ORDER BY recipient_user_id").all()
  assert.deepEqual(rows.map(x=>x.recipient_user_id),['alice','bob'])
  assert.equal(rows.every(x=>x.kind==='system'&&x.title.includes('Alice')&&x.message.includes('空手而归')),true)
  sqlite.prepare("UPDATE notification_inbox SET read_at='2026-11-07 08:00:00' WHERE recipient_user_id='bob'").run()
  await sendLotteryDrawNotification({DB:db},alice,draw)
  const again=sqlite.prepare("SELECT recipient_user_id,read_at FROM notification_inbox ORDER BY recipient_user_id").all()
  assert.equal(again.length,2,'no duplicate message')
  assert.equal(again[1].read_at,'2026-11-07 08:00:00','replayed delivery must not clear read status')
 }finally{sqlite.close()}
})
