import test from 'node:test'
import assert from 'node:assert/strict'
import {DatabaseSync} from 'node:sqlite'
import {readFileSync} from 'node:fs'
import {actionWindow,actionDue,effectiveReminderDate,todayActionRoute} from '../worker/today-actions.js'
import {isClosedRoutinePeriod} from '../worker/routine-periods.js'

const id='11111111-1111-4111-8111-111111111111'
const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
const add=(day,n)=>new Date(Date.parse(day+'T00:00:00Z')+n*86400000).toISOString().slice(0,10)
const tomorrow=add(today,1)
const session={household_id:'family',user_id:'owner'}
function fixture(){
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec('PRAGMA foreign_keys=OFF')
 const base='id TEXT PRIMARY KEY,household_id TEXT,created_by TEXT,visibility TEXT,title TEXT,deleted_at TEXT'
 sqlite.exec(`CREATE TABLE tasks(id TEXT PRIMARY KEY,household_id TEXT,creator_user_id TEXT,
     assignee_user_id TEXT,visibility TEXT,title TEXT,due_on TEXT,completed_at TEXT,deleted_at TEXT);
   CREATE TABLE shopping_items(${base},due_on TEXT,completed_at TEXT,assigned_to TEXT);
   CREATE TABLE wishes(${base},target_on TEXT,status TEXT);
   CREATE TABLE goals(${base},target_on TEXT,goal_mode TEXT);
   CREATE TABLE trips(${base},start_on TEXT,status TEXT);`)
 sqlite.exec(readFileSync(new URL('../migrations/0028_explicit_today_actions.sql',import.meta.url),'utf8'))
 const db={
   prepare(sql){
     const statement=sqlite.prepare(sql)
     let args=[]
     return {
       bind(...params){args=params;return this},
       async first(){return statement.get(...args)||null},
       async all(){return {results:statement.all(...args)}},
       async run(){const result=statement.run(...args);return {meta:{changes:Number(result.changes)}}}
     }
   }
 }
 const req=(path,method='GET',body)=>new Request('https://example.com'+path,{
   method,...(body?{headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{})
 })
 return {sqlite,db,req}
}
test('recurring period closes into missed history the next day, not next recurrence',()=>{
 const weekly={repeat_type:'weekly',anchor_date:today,
   repeat_config:JSON.stringify({weekdays:[new Date(today+'T00:00:00Z').getUTCDay()]})}
 assert.equal(isClosedRoutinePeriod(weekly,today,tomorrow),true)
 assert.equal(isClosedRoutinePeriod(weekly,today,today),false)
})
test('only an explicit postpone enters a one-off occurrence on another day',()=>{
 const original=today
 assert.equal(actionDue('shopping',id,original,today,[]),true)
 assert.equal(actionDue('shopping',id,original,tomorrow,[]),false)
 const actions=[{kind:'shopping',source_id:id,original_on:today,action:'postponed',postponed_to:tomorrow}]
 assert.equal(actionDue('shopping',id,original,today,actions),false)
 assert.equal(actionDue('shopping',id,original,tomorrow,actions),true)
 assert.equal(actionDue('shopping',id,original,add(today,2),actions),false)
 assert.equal(effectiveReminderDate('shopping',id,original,today,tomorrow,actions),tomorrow)
 const chained=[...actions,{kind:'shopping',source_id:id,original_on:tomorrow,
   action:'postponed',postponed_to:add(today,3)}]
 assert.equal(actionDue('shopping',id,original,tomorrow,chained),false)
 assert.equal(actionDue('shopping',id,original,add(today,3),chained),true)
 assert.equal(effectiveReminderDate('shopping',id,original,today,add(today,7),chained),add(today,3))
 const skipped=[...actions,{kind:'shopping',source_id:id,original_on:tomorrow,
   action:'skipped',postponed_to:null}]
 assert.equal(actionDue('shopping',id,original,tomorrow,skipped),false)
 assert.equal(effectiveReminderDate('shopping',id,original,today,add(today,7),skipped),null)
})
test('manual postpone never alters the original one-time savings target',async()=>{
 const x=fixture()
 try{
  x.sqlite.prepare('INSERT INTO goals(id,household_id,created_by,visibility,title,target_on,goal_mode) VALUES(?,?,?,?,?,?,?)')
   .run(id,'family','owner','household','一次性储值',today,'once')
  const response=await todayActionRoute(x.req('/api/plans/today-action','POST',
   {kind:'goal',id,on:today,action:'postponed',to:tomorrow}),x.db,'/api/plans/today-action',session)
  assert.equal(response.status,200)
  const record=x.sqlite.prepare('SELECT target_on FROM goals WHERE id=?').get(id)
  assert.equal(record.target_on,today)
  const actions=await actionWindow(x.db,'family',tomorrow)
  assert.equal(actionDue('goal',id,today,tomorrow,actions),true)
  const replay=await todayActionRoute(x.req('/api/plans/today-action','POST',
   {kind:'goal',id,on:today,action:'postponed',to:tomorrow}),x.db,'/api/plans/today-action',session)
  assert.equal(replay.status,409)
 }finally{x.sqlite.close()}
})
test('skip preserves visible history but never marks plan completed',async()=>{
 const x=fixture()
 try{
  x.sqlite.prepare('INSERT INTO wishes(id,household_id,created_by,visibility,title,target_on,status) VALUES(?,?,?,?,?,?,?)')
    .run(id,'family','owner','private','新钱包',today,'wished')
  const response=await todayActionRoute(x.req('/api/plans/today-action','POST',
    {kind:'wish',id,on:today,action:'skipped'}),x.db,'/api/plans/today-action',session)
  assert.equal(response.status,200)
  const h=await todayActionRoute(x.req('/api/plans/action-history?limit=5'),x.db,
    '/api/plans/action-history',session)
  const data=await h.json()
  assert.equal(data.items.length,1)
  assert.equal(data.items[0].title,'新钱包')
  assert.equal(data.items[0].action,'skipped')
  assert.equal(x.sqlite.prepare('SELECT status FROM wishes WHERE id=?').get(id).status,'wished')
  const other=await todayActionRoute(x.req('/api/plans/action-history?limit=5'),x.db,
    '/api/plans/action-history',{household_id:'family',user_id:'other'})
  assert.equal((await other.json()).items.length,0)
 }finally{x.sqlite.close()}
})
test('monthly or yearly savings cannot use manual postponement; routine has skip-only API',async()=>{
 const x=fixture()
 try{
  x.sqlite.prepare('INSERT INTO goals(id,household_id,created_by,visibility,title,target_on,goal_mode) VALUES(?,?,?,?,?,?,?)')
    .run(id,'family','owner','household','每月储值',today,'monthly')
  const month=await todayActionRoute(x.req('/api/plans/today-action','POST',
    {kind:'goal',id,on:today,action:'postponed',to:tomorrow}),x.db,'/api/plans/today-action',session)
  assert.equal(month.status,409)
  const routine=await todayActionRoute(x.req('/api/plans/today-action','POST',
    {kind:'routine',id,on:today,action:'postponed',to:tomorrow}),x.db,'/api/plans/today-action',session)
  assert.equal(routine.status,400)
 }finally{x.sqlite.close()}
})
test('Today actions are explicit in the UI and never archive on reminder/read state',()=>{
 const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
 const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
 assert.match(app,/@click="skipToday\(row\)"/)
 assert.match(app,/v-if="!row.routine"/)
 assert.match(app,/postponeToday\(row\)/)
 assert.match(app,/:min="tomorrowJst\(\)"/)
 assert.match(life,/跳过记录/)
 assert.match(life,/skippedActionCursor/)
})
