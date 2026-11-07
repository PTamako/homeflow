import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {tasksRoute} from '../worker/tasks.js'
import {lifeRoute} from '../worker/life.js'
import {routineAssignmentRoute} from '../worker/routine-assignments.js'
import {pointsRoute} from '../worker/points.js'

const source=readFileSync(new URL('../scripts/check_migrations.py',import.meta.url),'utf8')
const migrations=[...source.slice(source.indexOf('MIGRATIONS=['),source.indexOf(']\nfiles='))
  .matchAll(/"(\d{4}_[^"]+\.sql)"/g)].map(x=>x[1])
const alice={household_id:'house',user_id:'alice',role:'owner'}
const bob={household_id:'house',user_id:'bob',role:'member'}
const charlie={household_id:'house',user_id:'charlie',role:'member'}
const jst=()=>new Date(Date.now()+9*3600000).toISOString().slice(0,10)

function fixture(){
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec('PRAGMA foreign_keys=ON')
 for(const name of migrations)sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'))
 sqlite.exec(`
  INSERT INTO households(id,display_name) VALUES('house','家');
  INSERT INTO users(id,login_name,password_salt,password_verifier)
    VALUES('alice','alice','salt','verifier'),('bob','bob','salt','verifier'),
      ('charlie','charlie','salt','verifier');
  INSERT INTO household_members(household_id,user_id,role)
    VALUES('house','alice','owner'),('house','bob','member'),('house','charlie','member');
 `)
 const db={
  prepare(sql){
   const stmt=sqlite.prepare(sql);let args=[]
   return {bind(...p){args=p;return this},async first(){return stmt.get(...args)||null},
    async all(){return {results:stmt.all(...args)}},
    async run(){return {meta:{changes:Number(stmt.run(...args).changes)}}}}
  },
  async batch(statements){
   sqlite.exec('BEGIN')
   try{const results=[];for(const statement of statements)results.push(await statement.run())
    sqlite.exec('COMMIT');return results
   }catch(e){sqlite.exec('ROLLBACK');throw e}
  }
 }
 return {sqlite,db}
}
const request=(path,method='GET',payload)=>
 new Request('https://homeflow.invalid/api'+path,{method,
  ...(payload===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(payload)})})
const task=(db,session,path,method='GET',payload)=>
 tasksRoute(request(path,method,payload),db,'/api'+path,session)
const routine=(db,session,id,status,periodOn)=>
 lifeRoute(request('/routines/'+id+'/mark','POST',{date:jst(),periodOn,status}),
  db,'/api/routines/'+id+'/mark',session)
const assign=(db,session,id,periodOn,assignee,second,bonus)=>
 routineAssignmentRoute(request('/routines/'+id+'/assignment','POST',
  {periodOn,assigneeUserId:assignee,secondAssigneeUserId:second,bonusPoints:bonus}),db,session,id)
async function balances(db){
 const data={}
 for(const who of [alice,bob,charlie]){
  const r=await pointsRoute(request('/points'),db,who)
  assert.equal(r.status,200)
  data[who.user_id]=await r.json()
 }
 return data
}
test('unassigned shared task belongs to actual completer, no duplicate payout',async()=>{
 const {sqlite,db}=fixture()
 try{
  const made=await task(db,alice,'/tasks','POST',{title:'共同家务',visibility:'household'})
  assert.equal(made.status,201)
  const id=(await made.json()).id
  assert.equal((await task(db,bob,'/tasks/'+id,'PATCH',{completed:true})).status,200)
  const a=await balances(db)
  assert.equal(a.bob.earnedPoints,10)
  assert.equal(a.alice.earnedPoints,0)
  assert.equal((await task(db,alice,'/tasks/'+id,'PATCH',{completed:true})).status,200)
  assert.equal((await balances(db)).bob.earnedPoints,10)
 }finally{sqlite.close()}
})
test('sole assignee must complete; publisher needs reassignment to receive completion right',async()=>{
 const {sqlite,db}=fixture()
 try{
  const id=(await (await task(db,alice,'/tasks','POST',{title:'储备积分',visibility:'household'})).json()).id
  await task(db,alice,'/tasks/'+id,'PATCH',{completed:true})
  const made=await task(db,alice,'/tasks','POST',{title:'只能鸡毛完成',visibility:'household',
    assigneeUserId:'bob',bonusPoints:1})
  assert.equal(made.status,201)
  const target=(await made.json()).id
  const denied=await task(db,alice,'/tasks/'+target,'PATCH',{completed:true})
  assert.equal(denied.status,403,'publisher not assigned cannot claim completion')
  assert.equal((await task(db,charlie,'/tasks/'+target,'PATCH',{completed:true})).status,403)
  assert.equal((await task(db,bob,'/tasks/'+target,'PATCH',{completed:true})).status,200)
  assert.equal((await balances(db)).bob.earnedPoints,5)
 }finally{sqlite.close()}
})
test('two assignees can both complete once, split base plus integer bounty exactly, and undo reverses it',async()=>{
 const {sqlite,db}=fixture()
 try{
  const seed=(await (await task(db,alice,'/tasks','POST',{title:'积分种子',visibility:'household'})).json()).id
  await task(db,alice,'/tasks/'+seed,'PATCH',{completed:true})
  const old=await balances(db)
  const before=old.alice.availablePoints
  const made=await task(db,alice,'/tasks','POST',{title:'两人合力',visibility:'household',
    assigneeUserId:'alice',secondAssigneeUserId:'bob',bonusPoints:3})
  assert.equal(made.status,201)
  const id=(await made.json()).id
  assert.equal((await balances(db)).alice.availablePoints,before-3,'publisher funds bounty before completion')
  assert.equal((await task(db,charlie,'/tasks/'+id,'PATCH',{completed:true})).status,403)
  assert.equal((await task(db,bob,'/tasks/'+id,'PATCH',{completed:true})).status,200)
  let data=await balances(db)
  assert.equal(data.alice.earnedPoints,12.5,'creator receives half of base 5')
  assert.equal(data.bob.earnedPoints,2.5,'other assignee also receives half of base')
  assert.equal(data.alice.availablePoints,before-3+2.5+1.5,'publisher receives own bounty share after settlement')
  assert.equal(data.bob.availablePoints,2.5+1.5+5,'second assignee gets base, bounty and first badge')
  assert.equal((await task(db,alice,'/tasks/'+id,'PATCH',{completed:true})).status,200)
  data=await balances(db)
  assert.equal(data.alice.earnedPoints,12.5,'second completion cannot create another credit')
  assert.equal(data.bob.earnedPoints,2.5)
  assert.equal((await task(db,bob,'/tasks/'+id,'PATCH',{completed:false})).status,200)
  data=await balances(db)
  assert.equal(data.alice.earnedPoints,10)
  assert.equal(data.bob.earnedPoints,0)
  assert.equal(data.alice.availablePoints,before-3,'undo returns to reserved state')
 }finally{sqlite.close()}
})
test('two routine assignees share 5 base and funded bounty per occurrence, nonmembers cannot complete',async()=>{
 const {sqlite,db}=fixture()
 try{
  const seed=(await (await task(db,alice,'/tasks','POST',{title:'积分种子',visibility:'household'})).json()).id
  await task(db,alice,'/tasks/'+seed,'PATCH',{completed:true})
  const on=jst(),routineId='44444444-4444-4444-8444-444444444444'
  sqlite.prepare(`INSERT INTO routines(id,household_id,created_by,title,visibility,repeat_type,repeat_config,anchor_date,enabled)
    VALUES(?1,'house','alice','倒垃圾','household','daily','{}',?2,1)`).run(routineId,on)
  assert.equal((await assign(db,alice,routineId,on,'alice','bob',3)).status,200)
  assert.equal((await routine(db,charlie,routineId,'completed',on)).status,403)
  assert.equal((await routine(db,bob,routineId,'completed',on)).status,200)
  const data=await balances(db)
  assert.equal(data.alice.earnedPoints,12.5)
  assert.equal(data.bob.earnedPoints,2.5)
  assert.equal((await routine(db,alice,routineId,'completed',on)).status,200)
  assert.equal((await balances(db)).bob.earnedPoints,2.5)
  assert.equal((await routine(db,bob,routineId,'open',on)).status,200)
  assert.equal((await balances(db)).bob.earnedPoints,0)
 }finally{sqlite.close()}
})
