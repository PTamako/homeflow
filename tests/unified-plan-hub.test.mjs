import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {lifeRoute} from '../worker/life.js'
import {tasksRoute} from '../worker/tasks.js'
import {tripsRoute} from '../worker/trips.js'
import {todayPlansRoute} from '../worker/plan-today.js'

const owner={role:'owner',household_id:'family',user_id:'u-1'}
const url=(path,method='GET',payload)=>new Request('https://homeflow.invalid'+path,{
 method,...(payload===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(payload)})
})
function recordDb(){
 const calls=[],batches=[]
 return {calls,batches,prepare(sql){
  const q={sql,values:[],bind(...values){this.values=values;return this},
    async run(){calls.push({sql,values:this.values});return {meta:{changes:1}}},
    async first(){return null}}
  return q
 },async batch(statements){
  const items=statements.map(s=>({sql:s.sql,values:s.values}))
  batches.push(items)
  return statements.map((q)=>({success:true,results:[]}))
 }}
}
test('new wish and savings goal are created atomically and linked',async()=>{
 const db=recordDb()
 const r=await lifeRoute(url('/api/wishes','POST',{
  title:'买新电脑',visibility:'household',wishType:'purchase',
  estimatedAmount:200000,currency:'JPY',targetOn:'2027-03-01',
  createSavingsGoal:true
 }),db,'/api/wishes',owner)
 assert.equal(r.status,201)
 const result=await r.json()
 assert.equal(typeof result.goalId,'string')
 assert.equal(db.calls.length,0)
 assert.equal(db.batches.length,1)
 assert.equal(db.batches[0].length,2)
 const [wish,goal]=db.batches[0]
 assert.match(wish.sql,/INSERT INTO wishes/)
 assert.match(goal.sql,/INSERT INTO goals/)
 assert.equal(goal.values.at(-2),result.id)
 assert.match(goal.values.at(-1),/^\d{4}-\d{2}-\d{2}$/)
 assert.equal(goal.values[5],200000)
 assert.equal(goal.values[7],'2027-03-01')
})
test('invalid automatic savings goal amount is rejected without writes',async()=>{
 const db=recordDb()
 const r=await lifeRoute(url('/api/wishes','POST',{
  title:'没有金额',visibility:'household',wishType:'purchase',
  estimatedAmount:0,currency:'JPY',createSavingsGoal:true
 }),db,'/api/wishes',owner)
 assert.equal(r.status,400)
 assert.equal(db.calls.length+db.batches.length,0)
})
test('reminder-disabled one-off task persists and still has a due date',async()=>{
 const db=recordDb()
 const r=await tasksRoute(url('/api/tasks','POST',{
  title:'办理手续',notes:'',visibility:'household',
  dueOn:'2026-11-04',remindEnabled:false
 }),db,'/api/tasks',owner)
 assert.equal(r.status,201)
 assert.equal(db.calls.length,1)
 assert.match(db.calls[0].sql,/remind_enabled/)
 assert.equal(db.calls[0].values.at(-1),0)
})
test('ordinary trip can be created without an import JSON',async()=>{
 const db=recordDb()
 const r=await tripsRoute(url('/api/trips','POST',{
  title:'上海旅行',destination:'上海',visibility:'household',
  startDate:'2026-12-20',endDate:'2026-12-26',budgetAmount:180000
 }),db,'/api/trips',owner)
 assert.equal(r.status,201)
 assert.equal(db.calls.length,1)
 assert.match(db.calls[0].sql,/INSERT INTO trips/)
 assert.equal(db.calls[0].values.at(-1),180000)
})
test('Today shows date-matched plans without calling external ledger',async()=>{
 const db=recordDb()
 db.batch=async statements=>{
  db.batches.push(statements.map(s=>({sql:s.sql,values:s.values})))
  if(db.batches.length===1)return [
   {results:[{id:'shop',title:'猫粮',dueOn:'2026-11-04'}]},
   {results:[{id:'wish',title:'电脑',dueOn:'2026-11-03'}]},
   {results:[{id:'goal',title:'储值',goal_mode:'once',target_on:'2026-11-04',target_amount:10000,reserved_amount:0}]},
   {results:[{id:'trip',title:'旅行',dueOn:'2026-11-01',destination:'上海'}]}
  ]
  return statements.map(()=>({results:[]}))
 }
 const r=await todayPlansRoute(url('/api/plans/today?date=2026-11-04'),db,owner)
 assert.equal(r.status,200)
 const result=await r.json()
 assert.equal(result.items.length,4)
 assert.deepEqual(new Set(result.items.map(x=>x.kind)),new Set(['shopping','wish','goal','trip']))
 assert.equal(result.items.find(x=>x.kind==='wish').overdue,true)
 assert.equal(db.batches.length,2)
 assert.equal(db.batches[0].length,4)
 assert.equal(db.batches[1].length,3)
 assert.ok(db.batches[0].every(q=>q.values[0]==='family'&&q.values[1]==='u-1'))
 assert.ok(db.batches[1].every(q=>q.values[0]==='family'))
 assert.ok(db.batches[1].every(q=>q.sql.includes('IN (')),
   'Today history reads must be bounded by visible plan IDs')
 assert.ok(db.batches[1][0].sql.includes("plan_type='goal'"))
 assert.ok(db.batches[1][1].sql.includes("plan_type='wish'"))
 assert.ok(!db.batches[1].some(q=>q.sql.includes(' OR ')),'separate lookups use compound primary keys')
 assert.ok(db.batches.flat().every(q=>!q.sql.includes('finance_links')&&!q.sql.includes('kakebo_')),
   'rendering Today must not query the external Kakebo ledger')
})
test('invalid Today date never queries D1',async()=>{
 const db=recordDb()
 const r=await todayPlansRoute(url('/api/plans/today?date=2026-02-31'),db,owner)
 assert.equal(r.status,400)
 assert.equal(db.batches.length,0)
})
test('notification scheduling only selects reminder-enabled items',()=>{
 const source=readFileSync(new URL('../worker/reminders.js',import.meta.url),'utf8')
 assert.match(source,/enabled=1 AND deleted_at IS NULL AND remind_enabled=1/)
 assert.match(source,/completed_at IS NULL AND remind_enabled=1/)
 const push=readFileSync(new URL('../worker/webpush.js',import.meta.url),'utf8')
 assert.match(push,/redirect:'manual'/)
})

test('dated purchases completed today remain visible only for that Tokyo day',async()=>{
 const db=recordDb()
 db.batch=async statements=>{
   db.batches.push(statements.map(x=>({sql:x.sql,values:x.values})))
   return [
     {results:[{id:'done',title:'猫粮',dueOn:'2026-11-03',
       completedAt:'2026-11-04T06:00:00.000Z'},
       {id:'open',title:'洗衣液',dueOn:'2026-11-04',completedAt:null}]},
     {results:[]},{results:[]},{results:[]},{results:[]}
   ]
 }
 const response=await todayPlansRoute(url('/api/plans/today?date=2026-11-04'),db,owner)
 assert.equal(response.status,200)
 const x=(await response.json()).items
 assert.deepEqual(x.map(v=>v.done),[false,true])
 assert.equal(x.find(v=>v.id==='done').overdue,false)
 assert.ok(db.batches[0][0].sql.includes('completed_at>=?4'))
 assert.ok(db.batches[0][0].values[3].startsWith('2026-11-03T15:00:00'))
})
