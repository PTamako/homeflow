import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {tripsRoute} from '../worker/trips.js'
import {pointsRoute} from '../worker/points.js'

const manifest=readFileSync(new URL('../scripts/check_migrations.py',import.meta.url),'utf8')
const names=[...manifest.slice(manifest.indexOf('MIGRATIONS=['),manifest.indexOf(']\nfiles=')).matchAll(/"(\d{4}_[^"]+\.sql)"/g)].map(x=>x[1])
const owner={household_id:'h',user_id:'alice'},partner={household_id:'h',user_id:'bob'}
function fixture(){
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec('PRAGMA foreign_keys=ON')
 for(const name of names)sqlite.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'))
 sqlite.exec("INSERT INTO households(id,display_name) VALUES('h','家庭'),('h2','其他')")
 sqlite.exec("INSERT INTO users(id,login_name,password_salt,password_verifier) VALUES('alice','Alice','salt','verifier'),('bob','Bob','salt','verifier'),('other','Other','salt','verifier')")
 sqlite.exec("INSERT INTO household_members(household_id,user_id,role) VALUES('h','alice','owner'),('h','bob','member'),('h2','other','owner')")
 const db={prepare(sql){const q=sqlite.prepare(sql);let args=[];return {
  bind(...values){args=values;return this},
  async first(){return q.get(...args)||null},
  async all(){return {results:q.all(...args)}},
  async run(){const result=q.run(...args);return {meta:{changes:Number(result.changes)}}}
 }}}
 return {sqlite,db}
}
async function call(db,session,path,method='GET',body){
 const request=new Request('https://homeflow.invalid'+path,{method,
  ...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})})
 const response=await tripsRoute(request,db,path,session)
 return {status:response.status,body:await response.json()}
}
async function points(db,person){
 return (await pointsRoute(new Request('https://homeflow.invalid/api/points'),db,person)).json()
}
test('existing completed travel is not retroactively awarded after migration',()=>{
 const {sqlite}=fixture()
 try{
  sqlite.exec("INSERT INTO trips(id,household_id,created_by,visibility,title,destination,start_on,end_on,status) VALUES('legacy','h','alice','household','旧旅行','上海','2026-09-01','2026-09-03','completed')")
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM trip_completion_rewards").get().n,0)
  sqlite.exec("UPDATE trips SET title='修改名称' WHERE id='legacy'")
  assert.equal(sqlite.prepare("SELECT COUNT(*) n FROM trip_completion_rewards").get().n,0)
 }finally{sqlite.close()}
})
test('three-day shared trip awards 30 per traveler exactly once and edits recalculate',async()=>{
 const {db,sqlite}=fixture()
 try{
  const created=await call(db,owner,'/api/trips','POST',{
   title:'上海旅行',destination:'上海',visibility:'household',
   startDate:'2026-10-01',endDate:'2026-10-03',budgetAmount:120000})
  assert.equal(created.status,201)
  const id=created.body.id,path='/api/trips/'+id
  const list=await call(db,owner,'/api/trips')
  assert.deepEqual(list.body.items.find(x=>x.id===id).participants,['alice','bob'])
  assert.equal((await call(db,owner,path,'PATCH',{status:'completed'})).status,200)
  const first=await points(db,owner),second=await points(db,partner)
  assert.equal(first.travelBonusPoints,30)
  assert.equal(second.travelBonusPoints,30)
  assert.equal(first.availablePoints,30)
  assert.equal(first.members.find(x=>x.userId==='bob').sharedPoints,30)
  assert.equal((await call(db,owner,path,'PATCH',{status:'completed'})).status,200)
  assert.equal((await points(db,owner)).travelBonusPoints,30,'retry must not mint double credits')
  assert.equal((await call(db,owner,path,'PATCH',{status:'completed',endDate:'2026-10-02'})).status,200)
  assert.equal((await points(db,partner)).availablePoints,20,'date changes recalculate')
  assert.equal((await call(db,owner,path,'PATCH',{status:'completed',participants:['alice']})).status,200)
  assert.equal((await points(db,partner)).availablePoints,0,'removed traveler forfeits points')
  assert.equal((await call(db,owner,path,'PATCH',{status:'active'})).status,200)
  assert.equal((await points(db,owner)).availablePoints,0,'reopen reverses points')
  assert.equal((await call(db,owner,path,'PATCH',{status:'completed'})).status,200)
  assert.equal((await points(db,owner)).availablePoints,20,'completion restores one reward')
  assert.equal((await call(db,owner,path,'DELETE')).status,200)
  assert.equal((await points(db,owner)).availablePoints,0,'trash reverses rewards')
 }finally{sqlite.close()}
})
test('travel members must belong to household; unfinished and undated trips cannot settle',async()=>{
 const {db,sqlite}=fixture()
 try{
  const bad=await call(db,owner,'/api/trips','POST',{title:'违规',participants:['alice','other']})
  assert.equal(bad.status,400)
  const dup=await call(db,owner,'/api/trips','POST',{title:'重复',participants:['alice','alice']})
  assert.equal(dup.status,400)
  const noDate=await call(db,owner,'/api/trips','POST',{title:'未确定日期'})
  assert.equal((await call(db,owner,'/api/trips/'+noDate.body.id,'PATCH',{status:'completed'})).status,400)
  const future=await call(db,owner,'/api/trips','POST',{title:'未来旅行',startDate:'2099-01-01',endDate:'2099-01-03'})
  assert.equal((await call(db,owner,'/api/trips/'+future.body.id,'PATCH',{status:'completed'})).status,400)
 }finally{sqlite.close()}
})
test('private travel is creator-only and counts as private experience, never family wallet',async()=>{
 const {db,sqlite}=fixture()
 try{
  const created=await call(db,owner,'/api/trips','POST',{
   title:'个人旅行',visibility:'private',startDate:'2026-10-01',endDate:'2026-10-02'})
  assert.equal(created.status,201)
  assert.deepEqual((await call(db,owner,'/api/trips')).body.items.find(x=>x.id===created.body.id).participants,['alice'])
  assert.equal((await call(db,owner,'/api/trips/'+created.body.id,'PATCH',{status:'completed'})).status,200)
  const mine=await points(db,owner)
  assert.equal(mine.travelBonusPoints,20)
  assert.equal(mine.ownPrivatePoints,20)
  assert.equal(mine.availablePoints,0)
  assert.equal(mine.householdEarnedPoints,0)
  assert.equal((await call(db,partner,'/api/trips/'+created.body.id)).status,404)
 }finally{sqlite.close()}
})
