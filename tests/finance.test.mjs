import assert from 'node:assert/strict'
import test from 'node:test'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {financeRoute} from '../worker/finance.js'

const origin='https://homeflow.example'
const SECRET='unit-test-finance-token-not-a-real-secret-123456'
function createDatabase(){
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec('PRAGMA foreign_keys=ON')
 for(const name of ['0001_core.sql','0002_stage1_family_tasks.sql','0003_life_projects.sql']){
  sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'))
 }
 sqlite.exec("INSERT INTO users(id,login_name,password_salt,password_verifier) VALUES('owner','owner','salt','digest')")
 sqlite.exec("INSERT INTO users(id,login_name,password_salt,password_verifier) VALUES('partner','partner','salt','digest')")
 sqlite.exec("INSERT INTO households(id,display_name) VALUES('primary','Demo')")
 sqlite.exec("INSERT INTO household_members(household_id,user_id,role) VALUES('primary','owner','owner')")
 sqlite.exec("INSERT INTO household_members(household_id,user_id,role) VALUES('primary','partner','member')")
 const id='11111111-1111-4111-8111-111111111111'
 sqlite.prepare("INSERT INTO trips(id,household_id,created_by,visibility,title) VALUES(?1,'primary','owner','household','北海道旅行')").run(id)
 const db={prepare(query){
  const st=sqlite.prepare(query);let args=[]
  return {bind(...values){args=values;return this},
   async first(){return st.get(...args)||null},
   async all(){return {results:st.all(...args)}},
   async run(){const result=st.run(...args);return {meta:{changes:Number(result.changes)}}}
  }
 }}
 return {db,id,close:()=>sqlite.close()}
}
const user={user_id:'owner',role:'owner',household_id:'primary'}
const partner={user_id:'partner',role:'member',household_id:'primary'}
const window='?from=2026-11-01&to=2026-11-20'
const request=(path,method='GET',body)=>new Request(origin+path,{method,headers:{origin, ...(body?{'content-type':'application/json'}:{})},
  ...(body===undefined?{}:{body:JSON.stringify(body)})})
const ledger=[
{id:12,date:'2026-11-03',amount:1000,category:'交通費',merchant:'JR'},
{id:13,date:'2026-11-05',amount:5000,category:'ホテル',merchant:'ホテル'}
]
test('ledger finance bridge stays owner-only, validates dates and totals',async()=>{
 const {db,id,close}=createDatabase()
 const env={APP_ENV:'production',KAKEBO_BRIDGE_TOKEN:SECRET,DB:db}
 const noConfig=await financeRoute(request('/api/finance/status'),{APP_ENV:'preview',DB:db},'/api/finance/status',user)
 assert.equal((await noConfig.json()).configured,false)
 const partnerDenied=await financeRoute(request('/api/finance/trips/'+id+window),env,'/api/finance/trips/'+id,partner)
 assert.equal(partnerDenied.status,403)
 const wrongDates=await financeRoute(request('/api/finance/trips/'+id+'?from=2026-01-01&to=2026-11-20'),env,'/api/finance/trips/'+id,user)
 assert.equal(wrongDates.status,400)
 const originalFetch=globalThis.fetch
 let calls=0
 try{
  globalThis.fetch=async (url,init)=>{
   calls++
   assert.equal(new URL(url).origin,'https://kakeibo-f17.pages.dev')
   assert.equal(init.headers['x-homeflow-bridge-token'],SECRET)
   return new Response(JSON.stringify({items:ledger,truncated:false}),{status:200,headers:{'content-type':'application/json'}})
  }
  let r=await financeRoute(request('/api/finance/trips/'+id+window),env,'/api/finance/trips/'+id,user)
  assert.equal(r.status,200)
  let value=await r.json()
  assert.equal(value.linkedTotal,0)
  assert.equal(value.items.length,2)
  r=await financeRoute(request('/api/finance/trips/'+id+'/links','POST',{entryId:12,linked:true,from:'2026-11-01',to:'2026-11-20'}),
   env,'/api/finance/trips/'+id+'/links',user)
  assert.equal(r.status,200)
  value=await r.json()
  assert.equal(value.linked,true)
  r=await financeRoute(request('/api/finance/trips/'+id+window),env,'/api/finance/trips/'+id,user)
  value=await r.json()
  assert.equal(value.linkedTotal,1000)
  assert.equal(value.items[0].linked,true)
  assert.equal(value.items[1].linked,false)
  r=await financeRoute(request('/api/finance/trips/'+id+'/links','POST',{entryId:999,linked:true,from:'2026-11-01',to:'2026-11-20'}),
   env,'/api/finance/trips/'+id+'/links',user)
  assert.equal(r.status,404)
  r=await financeRoute(request('/api/finance/trips/'+id+'/links','POST',{entryId:12,linked:false}),
   env,'/api/finance/trips/'+id+'/links',user)
  assert.equal(r.status,200)
  r=await financeRoute(request('/api/finance/trips/'+id+window),env,'/api/finance/trips/'+id,user)
  value=await r.json()
  assert.equal(value.linkedTotal,0)
  assert.ok(calls>=4)
 }finally{
  globalThis.fetch=originalFetch;close()
 }
})
test('no integration token never fetches the private ledger',async()=>{
 const {db,id,close}=createDatabase()
 const response=await financeRoute(request('/api/finance/trips/'+id+window),
  {APP_ENV:'production',DB:db},'/api/finance/trips/'+id,user)
 assert.equal(response.status,503)
 close()
})
