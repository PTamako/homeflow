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
 assert.match(app,/@delete="skipToday\(row\)"/)
 assert.match(app,/@edit="openPostpone\(row\)"/)
 assert.match(app,/:allow-edit="!row.done&&!row.routine"/)
 assert.match(app,/:allow-delete="!row.done"/)
 assert.match(app,/edit-label="延期" delete-label="跳过"/)
 assert.doesNotMatch(app,/dismissToday\(row\)|从今天移除/)
 assert.match(app,/postponeToday\(row\)/)
 assert.match(app,/:min="tomorrowJst\(\)"/)
 assert.match(life,/跳过记录/)
 assert.match(life,/skippedActionCursor/)
})


test('skipped history filters by selected plan kind before five-item pagination',async()=>{
 const x=fixture()
 const shoppingId='22222222-2222-4222-8222-222222222222'
 try{
  x.sqlite.prepare('INSERT INTO wishes(id,household_id,created_by,visibility,title,target_on,status) VALUES(?,?,?,?,?,?,?)')
   .run(id,'family','owner','household','心愿',today,'wished')
  x.sqlite.prepare('INSERT INTO shopping_items(id,household_id,created_by,visibility,title,due_on) VALUES(?,?,?,?,?,?)')
   .run(shoppingId,'family','owner','household','购物',today)
  for(const [kind,itemId] of [['wish',id],['shopping',shoppingId]]){
   const response=await todayActionRoute(x.req('/api/plans/today-action','POST',
    {kind,id:itemId,on:today,action:'skipped'}),x.db,'/api/plans/today-action',session)
   assert.equal(response.status,200,kind)
  }
  const history=async suffix=>{
   const path='/api/plans/action-history?limit=5'+suffix
   const response=await todayActionRoute(x.req(path),x.db,'/api/plans/action-history',session)
   return {status:response.status,body:await response.json()}
  }
  const all=await history('')
  assert.deepEqual(new Set(all.body.items.map(row=>row.kind)),new Set(['wish','shopping']))
  const wish=await history('&kind=wish')
  assert.deepEqual(wish.body.items.map(row=>row.kind),['wish'])
  assert.equal(wish.body.nextCursor,null)
  const shopping=await history('&kind=shopping')
  assert.deepEqual(shopping.body.items.map(row=>row.kind),['shopping'])
  const goals=await history('&kind=goal')
  assert.deepEqual(goals.body.items,[])
  const bad=await history('&kind=routines')
  assert.equal(bad.status,400)
  assert.equal(bad.body.error,'invalid_filter')
 }finally{x.sqlite.close()}
})

test('repeated postponements resolve through the original action and ignore edited source dates',async()=>{
 const x=fixture()
 try{
  const past=add(today,-2),yesterday=add(today,-1),later=add(today,3)
  x.sqlite.prepare('INSERT INTO shopping_items(id,household_id,created_by,visibility,title,due_on) VALUES(?,?,?,?,?,?)')
   .run(id,'family','owner','household','购物',past)
  const insert=x.sqlite.prepare(`INSERT INTO today_plan_actions
   (household_id,kind,source_id,original_on,title,action,postponed_to,acted_by)
   VALUES(?,?,?,?,?,?,?,?)`)
  insert.run('family','shopping',id,past,'购物','postponed',yesterday,'owner')
  insert.run('family','shopping',id,yesterday,'购物','postponed',today,'owner')
  const actions=await actionWindow(x.db,'family',today)
  assert.equal(actions.length,2)
  assert.equal(actionDue('shopping',id,past,today,actions),true)
  assert.equal(effectiveReminderDate('shopping',id,past,today,today,actions),today)
  x.sqlite.prepare('UPDATE shopping_items SET due_on=? WHERE id=?').run(later,id)
  assert.equal(actionDue('shopping',id,later,today,actions),false)
  assert.equal(actionDue('shopping',id,later,later,actions),true)
  const result=await todayActionRoute(x.req('/api/plans/today-action','POST',
    {kind:'shopping',id,on:today,action:'skipped'}),x.db,'/api/plans/today-action',session)
  assert.equal(result.status,409,'an old postpone cannot authorize an edited plan')
  assert.equal(x.sqlite.prepare('SELECT COUNT(*) AS n FROM today_plan_actions').get().n,2)
 }finally{x.sqlite.close()}
})
test('a skip in a postponed chain prevents future reminders',()=>{
 const a='2026-11-01',b='2026-11-02',c='2026-11-03'
 const actions=[
  {kind:'wish',source_id:id,original_on:a,action:'postponed',postponed_to:b},
  {kind:'wish',source_id:id,original_on:b,action:'skipped',postponed_to:null}]
 assert.equal(actionDue('wish',id,a,c,actions),false)
 assert.equal(effectiveReminderDate('wish',id,a,b,c,actions),null)
})

test('Today reads all 40 chained postponements without the old 32-level cutoff',async()=>{
 const x=fixture()
 try{
  const insert=x.sqlite.prepare(`INSERT INTO today_plan_actions
    (household_id,kind,source_id,original_on,title,action,postponed_to,acted_by)
    VALUES(?,?,?,?,?,?,?,?)`)
  const original=add(today,-40)
  for(let i=0;i<40;i++)
   insert.run('family','shopping',id,add(original,i),'长期延期','postponed',add(original,i+1),'owner')
  const actions=await actionWindow(x.db,'family',today)
  assert.equal(actions.length,40,'must include every predecessor in the chain')
  assert.equal(actionDue('shopping',id,original,today,actions),true)
  assert.equal(actionDue('shopping',id,original,add(today,-1),actions),false)
 }finally{x.sqlite.close()}
})
test('Today reads all 520 same-date actions without the former 500-row truncation',async()=>{
 const x=fixture()
 try{
  const insert=x.sqlite.prepare(`INSERT INTO today_plan_actions
    (household_id,kind,source_id,original_on,title,action,postponed_to,acted_by)
    VALUES(?,?,?,?,?,?,?,?)`)
  for(let i=0;i<520;i++){
   const sourceId='00000000-0000-4000-8000-'+String(i).padStart(12,'0')
   insert.run('family','shopping',sourceId,today,'已跳过','skipped',null,'owner')
  }
  insert.run('another','shopping',id,today,'其他家庭','skipped',null,'other')
  const actions=await actionWindow(x.db,'family',today)
  assert.equal(actions.length,520)
  assert.ok(actions.every(a=>a.kind==='shopping'&&a.original_on===today))
 }finally{x.sqlite.close()}
})
