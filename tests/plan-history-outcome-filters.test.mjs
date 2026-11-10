import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {listFilters,listPage} from '../worker/list-pagination.js'
import {tasksRoute} from '../worker/tasks.js'
import {tripsRoute} from '../worker/trips.js'
import {archiveFilter,goalPeriodArchiveRoute} from '../worker/goal-period-archive.js'

const currentDay=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
const year=currentDay.slice(0,4)
const month=currentDay.slice(5,7)
const session={household_id:'house',user_id:'alice'}
const url=(path,outcome)=>'https://homeflow.invalid/api/'+path+
  '?limit=5&scope=history&year='+year+'&month='+month+'&outcome='+outcome
function dbAdapter(sqlite){
 return {prepare(sql){const stmt=sqlite.prepare(sql);return {
   bind(...args){return {
     all:async()=>({results:stmt.all(...args)}),
     first:async()=>stmt.get(...args)||null,
     run:async()=>({meta:{changes:stmt.run(...args).changes}})
   }}
 }}}
}

test('archive outcome only accepts four known values in history scope',()=>{
 for(const outcome of ['all','completed','skipped','missed'])
  assert.equal(listFilters(url('tasks',outcome)).outcome,outcome)
 assert.equal(listFilters(url('tasks','open')).invalid,true)
 assert.equal(listFilters('https://homeflow.invalid/api/tasks?scope=active&outcome=completed').invalid,true)
 assert.equal(listFilters('https://homeflow.invalid/api/tasks?limit=5').outcome,'all')
 assert.equal(archiveFilter(url('goals/period-archive','missed')).outcome,'missed')
 assert.equal(archiveFilter(url('goals/period-archive','unknown')),null)
})

test('completed and missed one-off tasks are filtered by SQL before page limit',async()=>{
 const sqlite=new DatabaseSync(':memory:')
 try{
  sqlite.exec(`CREATE TABLE tasks (
   id TEXT PRIMARY KEY,household_id TEXT,creator_user_id TEXT,deleted_at TEXT,
   visibility TEXT,notes TEXT,due_on TEXT,completed_at TEXT,created_at TEXT,updated_at TEXT,
   title TEXT,assignee_user_id TEXT,second_assignee_user_id TEXT,bonus_points INTEGER,
   subject_profile_id TEXT,health_record_type TEXT,remind_enabled INTEGER)`)
  const inserts=[
   ['00000000-0000-4000-8000-000000000001','finished','2026-11-01','2026-11-05T07:00:00Z','alice'],
   ['00000000-0000-4000-8000-000000000002','missed','2026-11-01',null,'alice'],
   ['00000000-0000-4000-8000-000000000003','another users private','2026-11-01','2026-11-05T07:00:00Z','bob']
  ]
  const insert=sqlite.prepare(`INSERT INTO tasks
   (id,title,due_on,completed_at,creator_user_id,household_id,visibility,
    created_at,updated_at,notes)
   VALUES(?1,?2,?3,?4,?5,'house',?6,'2026-11-01','2026-11-05','')`)
  for(const [id,title,due,done,owner] of inserts)
   insert.run(id,title,due,done,owner,owner==='bob'?'private':'household')
  const db=dbAdapter(sqlite)
  async function get(outcome){
   const result=await tasksRoute(new Request(url('tasks',outcome)),db,'/api/tasks',session)
   assert.equal(result.status,200)
   return (await result.json()).items.map(row=>row.title)
  }
  assert.deepEqual(await get('completed'),['finished'])
  assert.deepEqual(await get('missed'),['missed'])
  assert.deepEqual(await get('skipped'),[])
  assert.deepEqual(await get('all'),['finished','missed'])
 }finally{sqlite.close()}
})

test('shopping and wishes only expose outcomes they actually store',async()=>{
 const queries=[]
 const db={prepare(sql){return {bind(...args){return {all:async()=>{
  queries.push({sql,args});return {results:[]}
 }}}}}}
 const outcomes=['completed','skipped','missed']
 for(const outcome of outcomes){
  await listPage(db,'shopping_items',session,listFilters(url('shopping',outcome)))
  await listPage(db,'wishes',session,listFilters(url('wishes',outcome)))
 }
 assert.match(queries[0].sql,/completed_at IS NOT NULL/)
 assert.match(queries[2].sql,/AND 0/)
 assert.match(queries[4].sql,/AND 0/)
 assert.match(queries[1].sql,/status='completed'/)
 assert.match(queries[3].sql,/AND 0/)
 assert.match(queries[5].sql,/status='cancelled'/)
})

test('cancelled trips are incomplete and completed trips are distinct',async()=>{
 const queries=[]
 const db={prepare(sql){return {bind(...args){return {all:async()=>{
  queries.push({sql,args});return {results:[]}
 }}}}}}
 for(const outcome of ['completed','missed','skipped'])
  await tripsRoute(new Request(url('trips',outcome)),db,'/api/trips',session)
 assert.match(queries[0].sql,/status='completed'/)
 assert.match(queries[1].sql,/status='cancelled'/)
 assert.match(queries[2].sql,/AND 0/)
})

test('skipped-only savings archive does not query D1 or invent skipped settlements',async()=>{
 let reads=0
 const db={prepare(){reads++;throw Error('must not query D1')}}
 const response=await goalPeriodArchiveRoute(
  new Request(url('goals/period-archive','skipped')),db,session)
 assert.equal(response.status,200)
 assert.deepEqual(await response.json(),{items:[],nextCursor:null})
 assert.equal(reads,0)
})

test('history status selector starts completed, uses backend filters and reloads pages',()=>{
 const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
 assert.match(life,/const planOutcome=ref<HistoryOutcome>\('completed'\)/)
 assert.match(life,/aria-label="历史计划状态"/)
 for(const [value,label] of [['completed','已完成'],['skipped','已跳过'],
  ['missed','未完成'],['all','全部状态']])
  assert.ok(life.includes('<option value="'+value+'">'+label+'</option>'))
 assert.match(life,/q\.set\('outcome',planOutcome\.value\)/)
 assert.match(life,/watch\(\[planScope,planYear,planMonth,planOutcome\]/)
 assert.match(life,/planMonth\.value,planOutcome\.value\]\.join/)
 assert.match(life,/\['all','skipped'\]\.includes\(planOutcome\.value\)/)
 const routine=readFileSync(new URL('../worker/routine-history.js',import.meta.url),'utf8')
 assert.match(routine,/filters\.outcome==='completed'&&row\.status==='completed'/)
 assert.match(routine,/filters\.outcome==='skipped'&&row\.status==='skipped'/)
 assert.match(routine,/filters\.outcome==='missed'&&row\.status==='missed'/)
})
