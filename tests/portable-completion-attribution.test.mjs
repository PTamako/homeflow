import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {portableRoute} from '../worker/portable.js'

const owner={household_id:'family',user_id:'owner',role:'owner'}
const uid=n=>String(n).padStart(8,'0')+'-1111-4111-8111-111111111111'
const completed='2026-11-12T10:30:00.000Z'
function fixture(){
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec(`
  CREATE TABLE household_members(household_id TEXT,user_id TEXT,PRIMARY KEY(household_id,user_id));
  CREATE TABLE family_profiles(id TEXT,household_id TEXT);
  CREATE TABLE tasks(
    id TEXT PRIMARY KEY,household_id TEXT,creator_user_id TEXT,visibility TEXT,
    title TEXT,notes TEXT,due_on TEXT,completed_at TEXT,completed_by TEXT,
    subject_profile_id TEXT,client_request_id TEXT,health_record_type TEXT,
    remind_enabled INTEGER,assignee_user_id TEXT,deleted_at TEXT,
    bonus_points INTEGER,second_assignee_user_id TEXT);
  CREATE TABLE shopping_items(
    id TEXT PRIMARY KEY,household_id TEXT,created_by TEXT,visibility TEXT,title TEXT,
    quantity INTEGER,completed_at TEXT,completed_by TEXT,due_on TEXT,ledger_entry_id TEXT,
    deleted_at TEXT,assigned_to TEXT,second_assignee_user_id TEXT);
  CREATE TABLE routines(id TEXT PRIMARY KEY,household_id TEXT,created_by TEXT,visibility TEXT);
  CREATE TABLE routine_marks(
    routine_id TEXT,occurrence_on TEXT,completed_at TEXT,completed_by TEXT,skipped_at TEXT,
    PRIMARY KEY(routine_id,occurrence_on));
  CREATE TABLE trips(id TEXT PRIMARY KEY,household_id TEXT,created_by TEXT,visibility TEXT);
  CREATE TABLE trip_progress(trip_id TEXT,item_id TEXT,completed_at TEXT,completed_by TEXT,
    PRIMARY KEY(trip_id,item_id));
  CREATE TABLE wishes(id TEXT PRIMARY KEY,household_id TEXT,created_by TEXT,visibility TEXT);
  CREATE TABLE goals(id TEXT PRIMARY KEY,household_id TEXT,created_by TEXT,visibility TEXT);
  CREATE TABLE plan_completion_marks(
    household_id TEXT,plan_type TEXT,plan_id TEXT,period_key TEXT,
    completed_at TEXT,completed_by TEXT,prior_status TEXT,
    PRIMARY KEY(household_id,plan_type,plan_id,period_key));
 `)
 sqlite.exec(`INSERT INTO household_members VALUES('family','owner'),('family','partner'),('foreign','outsider');
   INSERT INTO routines VALUES('${uid(3)}','family','owner','household');
   INSERT INTO trips VALUES('${uid(4)}','family','owner','household');
   INSERT INTO wishes VALUES('${uid(5)}','family','owner','household');`)
 let queryCount=0
 const db={
   prepare(sql){const statement=sqlite.prepare(sql);let args=[];return {
     bind(...params){args=params;return this},
     async first(){return statement.get(...args)||null},
     async all(){queryCount++;return {results:statement.all(...args)}},
     async run(){return {meta:{changes:Number(statement.run(...args).changes)}}
   }},
   async batch(statements){
     sqlite.exec('BEGIN')
     try{
       const out=[]
       for(const statement of statements)out.push(await statement.run())
       sqlite.exec('COMMIT')
       return out
     }catch(e){sqlite.exec('ROLLBACK');throw e}
   }
 }
 const restore=async(dataset,items,preview=false)=>{
   const response=await portableRoute(new Request('https://homeflow.invalid/api/portable/restore',{
     method:'POST',headers:{'content-type':'application/json'},
     body:JSON.stringify({dataset,items,confirm:true,preview})
   }),db,'/api/portable/restore',owner)
   return {status:response.status,body:await response.json()}
 }
 return {sqlite,restore,queryCount:()=>queryCount}
}

test('portable import preserves partner completion for family tasks, shopping, routine, travel and wish',async()=>{
 const f=fixture()
 try{
  const batches=[
   ['tasks',[{id:uid(1),title:'共享任务',visibility:'household',completed_at:completed,
     completed_by:'partner'}]],
   ['shopping',[{id:uid(2),title:'家庭采购',visibility:'household',quantity:1,
     completed_at:completed,completed_by:'partner'}]],
   ['routineMarks',[{routine_id:uid(3),occurrence_on:'2026-11-12',
     completed_at:completed,completed_by:'partner'}]],
   ['tripProgress',[{trip_id:uid(4),item_id:'flight',completed_at:completed,
     completed_by:'partner'}]],
   ['planCompletionMarks',[{plan_type:'wish',plan_id:uid(5),period_key:'once',
     completed_at:completed,completed_by:'partner',prior_status:'wished'}]]
  ]
  for(const [dataset,items] of batches){
   const result=await f.restore(dataset,items)
   assert.equal(result.status,200,dataset+': '+JSON.stringify(result.body))
   assert.equal(result.body.inserted,1,dataset)
  }
  for(const sql of [
    "SELECT completed_by AS actor FROM tasks",
    "SELECT completed_by AS actor FROM shopping_items",
    "SELECT completed_by AS actor FROM routine_marks",
    "SELECT completed_by AS actor FROM trip_progress",
    "SELECT completed_by AS actor FROM plan_completion_marks"
  ])assert.equal(f.sqlite.prepare(sql).get().actor,'partner',sql)
 }finally{f.sqlite.close()}
})

test('foreign or absent actors are rejected before writing; private records cannot impersonate family',async()=>{
 const f=fixture()
 try{
  const outsider={id:uid(7),title:'shared',visibility:'household',
    completed_at:completed,completed_by:'outsider'}
  const response=await f.restore('tasks',[outsider])
  assert.equal(response.status,409)
  assert.equal(response.body.error,'restore_completion_actor_unavailable')
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM tasks').get().n,0)
  const missing=await f.restore('tasks',[{...outsider,completed_by:'unknown'}],true)
  assert.equal(missing.status,409,'preview must reject missing household actors')
  const privateRow=await f.restore('tasks',[{...outsider,visibility:'private',completed_by:'partner'}])
  assert.equal(privateRow.status,400)
  assert.equal(f.sqlite.prepare('SELECT COUNT(*) AS n FROM tasks').get().n,0)
 }finally{f.sqlite.close()}
})

test('old personal archives without completed_by keep owner attribution',async()=>{
 const f=fixture()
 try{
  const result=await f.restore('tasks',[{id:uid(9),title:'本人完成',
    visibility:'private',completed_at:completed}])
  assert.equal(result.status,200)
  assert.equal(f.sqlite.prepare('SELECT completed_by AS actor FROM tasks').get().actor,'owner')
 }finally{f.sqlite.close()}
})

test('portable completed wish/goal marks now export original completion attribution',()=>{
 const source=readFileSync(new URL('../worker/portable.js',import.meta.url),'utf8')
 assert.match(source,/SELECT m\.plan_type,m\.plan_id,m\.period_key,m\.completed_at,m\.completed_by,m\.prior_status/)
})
