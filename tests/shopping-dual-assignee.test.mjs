import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {lifeRoute} from '../worker/life.js'
import {financeRoute} from '../worker/finance.js'
import {pointsRoute} from '../worker/points.js'

const script=readFileSync(new URL('../scripts/check_migrations.py',import.meta.url),'utf8')
const migrations=[...script.slice(script.indexOf('MIGRATIONS=['),script.indexOf(']\nfiles='))
 .matchAll(/"(\d{4}_[^"]+\.sql)"/g)].map(x=>x[1])
const alice={household_id:'house',user_id:'11111111-1111-4111-8111-111111111111',role:'owner'}
const bob={household_id:'house',user_id:'22222222-2222-4222-8222-222222222222',role:'member'}
const charlie={household_id:'house',user_id:'33333333-3333-4333-8333-333333333333',role:'member'}
const url=(path)=>'https://homeflow.invalid/api'+path
const request=(path,method='GET',payload)=>new Request(url(path),{method,
 ...(payload===undefined?{}:{headers:{'content-type':'application/json'},
 body:JSON.stringify(payload)})})
function fixture(){
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec('PRAGMA foreign_keys=ON')
 for(const filename of migrations)
  sqlite.exec(readFileSync(new URL('../migrations/'+filename,import.meta.url),'utf8'))
 sqlite.exec(`
  INSERT INTO households(id,display_name) VALUES('house','Family');
  INSERT INTO users(id,login_name,password_salt,password_verifier) VALUES
   ('${alice.user_id}','alice','salt','verifier'),('${bob.user_id}','bob','salt','verifier'),
   ('${charlie.user_id}','charlie','salt','verifier');
  INSERT INTO household_members(household_id,user_id,role)
   VALUES('house','${alice.user_id}','owner'),('house','${bob.user_id}','member'),('house','${charlie.user_id}','member');
 `)
 const db={
  prepare(sql){const st=sqlite.prepare(sql);let args=[];return {
   bind(...p){args=p;return this},
   async first(){return st.get(...args)||null},
   async all(){return {results:st.all(...args)}},
   async run(){return {meta:{changes:Number(st.run(...args).changes)}}}
  }},
  async batch(st){sqlite.exec('BEGIN');try{
    const results=[];for(const x of st)results.push(await x.run())
    sqlite.exec('COMMIT');return results
   }catch(e){sqlite.exec('ROLLBACK');throw e}}
 }
 const env={APP_ENV:'production',DB:db,
  KAKEBO_LEDGER_API_URL:'https://kakeibo-f17.pages.dev/api/homeflow-ledger',
  KAKEBO_LEDGER_SERVICE:{fetch:async()=>new Response(JSON.stringify({
   entries:[{id:'101',type:'expense',amount:1000,date:'2026-11-07'}]
  }),{headers:{'content-type':'application/json'}})}}
 return {sqlite,db,env}
}
const shop=(db,s,path,method='GET',body)=>
 lifeRoute(request('/shopping'+path,method,body),db,'/api/shopping'+path,s)
const link=(env,s,id,method='POST',body={entryId:101})=>
 financeRoute(request('/finance/shopping/'+id+'/link',method,body),
  env,'/api/finance/shopping/'+id+'/link',s)
const points=async(db,s)=>{const r=await pointsRoute(request('/points'),db,s);assert.equal(r.status,200);return r.json()}
async function make(db,first=null,second=null){
 const res=await shop(db,alice,'','POST',{title:'买猫粮',quantity:1,visibility:'household',
   assignedTo:first,secondAssigneeUserId:second})
 assert.equal(res.status,201);return (await res.json()).id
}
test('shared shopping: two assignees, only either one may confirm verified receipt, 2 is split 1+1',async()=>{
 const {sqlite,db,env}=fixture()
 try{
  const id=await make(db,bob.user_id,charlie.user_id)
  const linked=await link(env,alice,id)
  assert.equal(linked.status,200)
  assert.equal((await linked.json()).awaitingAssignee,true)
  assert.equal((await points(db,alice)).earnedPoints,0)
  assert.equal((await shop(db,alice,'/'+id+'/confirm','POST')).status,403)
  assert.equal((await shop(db,bob,'/'+id+'/confirm','POST')).status,200)
  let one=await points(db,bob),two=await points(db,charlie)
  assert.equal(one.earnedPoints,1)
  assert.equal(two.earnedPoints,1)
  assert.equal(one.availablePoints,1)
  assert.equal(two.availablePoints,1)
  assert.equal((await shop(db,charlie,'/'+id+'/confirm','POST')).status,200)
  assert.equal((await points(db,bob)).earnedPoints,1,'cannot double credit')
  assert.equal((await link(env,alice,id,'DELETE',{entryId:'101'})).status,200)
  assert.equal((await points(db,bob)).earnedPoints,0,'undo removes both shares')
  assert.equal((await points(db,charlie)).earnedPoints,0)
 }finally{sqlite.close()}
})
test('single assignee can confirm but unassigned verified shopping credits actual linker',async()=>{
 const {sqlite,db,env}=fixture()
 try{
  const assigned=await make(db,bob.user_id,null)
  assert.equal((await link(env,alice,assigned)).status,200)
  assert.equal((await shop(db,charlie,'/'+assigned+'/confirm','POST')).status,403)
  assert.equal((await shop(db,bob,'/'+assigned+'/confirm','POST')).status,200)
  assert.equal((await points(db,bob)).earnedPoints,2)
  const unassigned=await make(db)
  assert.equal((await link(env,alice,unassigned)).status,200)
  assert.equal((await points(db,alice)).earnedPoints,2)
 }finally{sqlite.close()}
})
test('shopping assignees are valid household members, distinct and reassignable before completion only',async()=>{
 const {sqlite,db,env}=fixture()
 try{
  const created=await shop(db,alice,'','POST',{
   title:'非法指派',quantity:1,visibility:'household',
   assignedTo:bob.user_id,secondAssigneeUserId:bob.user_id})
  assert.equal(created.status,400)
  const id=await make(db,bob.user_id,charlie.user_id)
  assert.equal((await link(env,alice,id)).status,200)
  const updated=await shop(db,alice,'/'+id,'PATCH',{title:'买猫粮',quantity:1,
   visibility:'household',assignedTo:alice.user_id,secondAssigneeUserId:bob.user_id})
  assert.equal(updated.status,200)
  assert.equal((await shop(db,alice,'/'+id+'/confirm','POST')).status,200)
  assert.equal((await points(db,alice)).earnedPoints,1)
  assert.equal((await points(db,bob)).earnedPoints,1)
  const locked=await shop(db,alice,'/'+id,'PATCH',{title:'买猫粮',quantity:1,
   visibility:'household',assignedTo:alice.user_id,secondAssigneeUserId:charlie.user_id})
  assert.equal(locked.status,409)
 }finally{sqlite.close()}
})
