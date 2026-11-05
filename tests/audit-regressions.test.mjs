import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {portableRoute,RESTORE_ORDER} from '../worker/portable.js'
import {tasksRoute} from '../worker/tasks.js'
import {lifeRoute} from '../worker/life.js'
import {petsRoute} from '../worker/pets.js'

const person='11111111-1111-4111-8111-111111111111'
const wish='22222222-2222-4222-8222-222222222222'
const goal='33333333-3333-4333-8333-333333333333'
const shop='44444444-4444-4444-8444-444444444444'
const taskId='55555555-5555-4555-8555-555555555555'
const routine='66666666-6666-4666-8666-666666666666'
const session={household_id:'primary',user_id:'u1',role:'owner'}
const files=['0001_core.sql','0002_stage1_family_tasks.sql','0003_life_projects.sql',
  '0004_push_notifications.sql','0005_interval_policies.sql','0006_pet_health.sql',
  '0007_offline_tasks.sql','0008_shopping_ledger.sql','0009_finance_target_settings.sql',
  '0009_routine_pet_care.sql','0010_task_pet_care.sql','0011_unified_plan_hub.sql',
  '0012_savings_goal_cadence.sql','0013_plan_completion_marks.sql','0014_shopping_multi_expense.sql','0015_reminder_snoozes.sql','0016_reminder_preferences.sql','0017_shopping_partial_quantity.sql','0018_shopping_created_index.sql','0019_reminder_item_quiet_retry.sql','0020_goal_period_settlements.sql']
function database(){
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec('PRAGMA foreign_keys=ON')
 for(const path of files)sqlite.exec(readFileSync(new URL('../migrations/'+path,import.meta.url),'utf8'))
 sqlite.exec("INSERT INTO households(id,display_name) VALUES('primary','Home')")
 sqlite.exec("INSERT INTO users(id,login_name,password_salt,password_verifier) VALUES('u1','owner','x','y')")
 sqlite.exec("INSERT INTO household_members(household_id,user_id,role) VALUES('primary','u1','owner')")
 const db={
  prepare(sql){
   const stmt=sqlite.prepare(sql)
   let args=[]
   return {
    _sql:sql,
    bind(...values){args=values;return this},
    async first(){return stmt.get(...args)||null},
    async all(){return {results:stmt.all(...args)}},
    async run(){return {meta:{changes:Number(stmt.run(...args).changes)}}}
   }
  },
  async batch(statements){
   sqlite.exec('BEGIN')
   const out=[]
   try{
    for(const st of statements)out.push(/^\s*SELECT/i.test(st._sql)?await st.all():await st.run())
    sqlite.exec('COMMIT')
   }catch(e){sqlite.exec('ROLLBACK');throw e}
   return out
  }
 }
 return {sqlite,db}
}
test('portable full restore retains savings cadence, adjustments, dates and reminder flags',async()=>{
 const source=database(),target=database()
 try{
  const x=source.sqlite
  x.prepare('INSERT INTO family_profiles(id,household_id,type,display_name) VALUES(?,?,?,?)').run(person,'primary','pet','豆沙')
  x.prepare('INSERT INTO wishes(id,household_id,created_by,visibility,title,wish_type,target_on) VALUES(?,?,?,?,?,?,?)').run(wish,'primary','u1','household','猫咪新玩具','purchase','2027-01-09')
  x.prepare('INSERT INTO goals(id,household_id,created_by,visibility,wish_id,title,target_amount,goal_mode,start_on,target_on) VALUES(?,?,?,?,?,?,?,?,?,?)').run(goal,'primary','u1','household',wish,'按月储值',5000,'monthly','2026-11-01','2027-11-30')
  x.prepare('INSERT INTO shopping_items(id,household_id,created_by,visibility,title,quantity,due_on) VALUES(?,?,?,?,?,?,?)').run(shop,'primary','u1','household','猫粮',1,'2027-02-01')
  x.prepare('INSERT INTO tasks(id,household_id,creator_user_id,visibility,title,remind_enabled,subject_profile_id) VALUES(?,?,?,?,?,?,?)').run(taskId,'primary','u1','private','买东西',0,person)
  x.prepare('INSERT INTO routines(id,household_id,created_by,visibility,title,repeat_type,anchor_date,remind_enabled,subject_profile_id) VALUES(?,?,?,?,?,?,?,?,?)').run(routine,'primary','u1','household','梳毛','daily','2026-11-01',0,person)
  x.prepare('INSERT INTO finance_target_settings(household_id,target_type,target_id,adjustment_amount,updated_by) VALUES(?,?,?,?,?)').run('primary','shopping',shop,-500,'u1')
  x.prepare('INSERT INTO goal_period_adjustments(household_id,goal_id,period_key,adjustment_amount,updated_by) VALUES(?,?,?,?,?)').run('primary',goal,'2026-11',1200,'u1')
  const exported=await portableRoute(new Request('https://homeflow.invalid/api/portable'),source.db,'/api/portable',session)
  assert.equal(exported.status,200)
  const snapshot=await exported.json()
  assert.equal(snapshot.records.financeTargetSettings.length,1)
  assert.equal(snapshot.records.goalPeriodAdjustments.length,1)
  for(const dataset of RESTORE_ORDER){
   const items=snapshot.records[dataset]
   if(!items?.length)continue
   const request=new Request('https://homeflow.invalid/api/portable/restore',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({dataset,items,confirm:true})
   })
   const result=await portableRoute(request,target.db,'/api/portable/restore',session)
   assert.equal(result.status,200,dataset+': '+await result.text())
  }
  const restoredGoal=target.sqlite.prepare('SELECT goal_mode,start_on,target_on FROM goals WHERE id=?').get(goal)
  assert.equal(restoredGoal.goal_mode,'monthly')
  assert.equal(restoredGoal.start_on,'2026-11-01')
  assert.equal(restoredGoal.target_on,'2027-11-30')
  assert.equal(target.sqlite.prepare('SELECT target_on FROM wishes WHERE id=?').get(wish).target_on,'2027-01-09')
  assert.equal(target.sqlite.prepare('SELECT due_on FROM shopping_items WHERE id=?').get(shop).due_on,'2027-02-01')
  assert.equal(target.sqlite.prepare('SELECT remind_enabled FROM tasks WHERE id=?').get(taskId).remind_enabled,0)
  assert.equal(target.sqlite.prepare('SELECT remind_enabled FROM routines WHERE id=?').get(routine).remind_enabled,0)
  assert.equal(target.sqlite.prepare('SELECT adjustment_amount FROM finance_target_settings WHERE target_id=?').get(shop).adjustment_amount,-500)
  assert.equal(target.sqlite.prepare('SELECT adjustment_amount FROM goal_period_adjustments WHERE goal_id=?').get(goal).adjustment_amount,1200)
 }finally{source.sqlite.close();target.sqlite.close()}
})

test('tasks history endpoint is bounded and returns keyset cursors',async()=>{
 const calls=[]
 const db={prepare(sql){const q={bind(...params){calls.push({sql,params});return this},async all(){
  return {results:Array.from({length:7},(_,i)=>({id:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),
    completedAt:'2026-11-04T10:00:00.000Z'}))}}}
  return q
 }}
 const response=await tasksRoute(new Request('https://homeflow.invalid/api/tasks?scope=history&limit=6'),db,'/api/tasks',session)
 assert.equal(response.status,200)
 const data=await response.json()
 assert.equal(data.items.length,6)
 assert.ok(data.nextCursor.includes('|'))
 assert.match(calls[0].sql,/completed_at IS NOT NULL/)
 assert.match(calls[0].sql,/LIMIT/)
 assert.equal(calls[0].params.at(-1),7)
})

test('first paint and timeline do not show unrelated data while loading',()=>{
 const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
 const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
 assert.match(app,/const authReady=ref\(false\)/)
 assert.match(app,/<main v-if="!authReady"/)
 assert.match(app,/<main v-else-if="!user"/)
 assert.ok(app.includes(':key="user.id+\':\'+tab"'))
 assert.match(life,/listLoading=ref\(false\)/)
 assert.match(life,/if\(requestId!==activeFetch\)return/)
 assert.match(life,/role="status">正在读取时光轴/)
})

test('stale memory and shopping editor snapshots never overwrite newer changes',async()=>{
 const {db,sqlite}=database()
 try{
  const memoryId='77777777-7777-4777-8777-777777777777'
  sqlite.prepare('INSERT INTO memories(id,household_id,created_by,visibility,title,story,happened_on) VALUES(?,?,?,?,?,?,?)')
   .run(memoryId,'primary','u1','household','旧回忆','旧内容','2026-11-04')
  sqlite.prepare('INSERT INTO shopping_items(id,household_id,created_by,visibility,title,quantity) VALUES(?,?,?,?,?,?)')
   .run(shop,'primary','u1','household','旧购物',1)
  const patch=(kind,id,payload)=>lifeRoute(new Request('https://homeflow.invalid/api/'+kind+'/'+id,{
   method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(payload)
  }),db,'/api/'+kind+'/'+id,session)
  const before=JSON.stringify(['旧回忆','旧内容','2026-11-04','household',null,null])
  assert.equal((await patch('memories',memoryId,{title:'第一台修改',story:'第一条',happenedOn:'2026-11-04',
   visibility:'household',expectedSnapshot:before})).status,200)
  assert.equal((await patch('memories',memoryId,{title:'第二台覆盖',story:'不该保存',happenedOn:'2026-11-04',
   visibility:'household',expectedSnapshot:before})).status,409)
  assert.equal(sqlite.prepare('SELECT title FROM memories WHERE id=?').get(memoryId).title,'第一台修改')
  const beforeShopping=JSON.stringify(['旧购物',1,null,null,null])
  assert.equal((await patch('shopping',shop,{title:'第一台购物',quantity:1,visibility:'household',
    expectedSnapshot:beforeShopping})).status,200)
  assert.equal((await patch('shopping',shop,{title:'第二台购物',quantity:1,visibility:'household',
    expectedSnapshot:beforeShopping})).status,409)
  assert.equal(sqlite.prepare('SELECT title FROM shopping_items WHERE id=?').get(shop).title,'第一台购物')
 }finally{sqlite.close()}
})

test('pet health reminders are created, updated, cancelled and detached without touching independently edited tasks',async()=>{
 const {sqlite,db}=database()
 const pet='77777777-7777-4777-8777-777777777777'
 const path='/api/pets/'+pet+'/health'
 const req=(method,body,id='')=>new Request('https://homeflow.test'+path+(id?'/'+id:''),{
   method,headers:body?{'content-type':'application/json'}:{},
   ...(body?{body:JSON.stringify(body)}:{})})
 const call=async(method,body,id='')=>{
   const response=await petsRoute(req(method,body,id),db,path+(id?'/'+id:''),session)
   return {status:response.status,body:await response.json()}
 }
 const form=(nextDueOn)=>({recordType:'deworm',eventOn:'2026-11-05',
   weightGrams:null,note:'routine dose',nextDueOn,visibility:'household'})
 try{
   sqlite.prepare("INSERT INTO family_profiles(id,household_id,type,display_name) VALUES(?,?,'pet',?)")
     .run(pet,'primary','豆沙')
   const created=await call('POST',form(null))
   assert.equal(created.status,201)
   const id=created.body.id
   const added=await call('PATCH',form('2026-12-05'),id)
   assert.equal(added.status,200)
   assert.equal(added.body.createdReminder,true)
   const first=sqlite.prepare("SELECT linked_task_id,next_due_on FROM pet_health_records WHERE id=?").get(id)
   assert.ok(first.linked_task_id)
   assert.equal(first.next_due_on,'2026-12-05')
   const shifted=await call('PATCH',form('2026-12-12'),id)
   assert.equal(shifted.body.createdReminder,false)
   assert.equal(sqlite.prepare('SELECT due_on FROM tasks WHERE id=?').get(first.linked_task_id).due_on,'2026-12-12')
   const cleared=await call('PATCH',form(null),id)
   assert.equal(cleared.body.reminderUpdated,false)
   assert.equal(sqlite.prepare('SELECT linked_task_id FROM pet_health_records WHERE id=?').get(id).linked_task_id,null)
   assert.ok(sqlite.prepare('SELECT deleted_at FROM tasks WHERE id=?').get(first.linked_task_id).deleted_at)
   const recreated=await call('PATCH',form('2027-01-05'),id)
   assert.equal(recreated.body.createdReminder,true)
   const second=sqlite.prepare('SELECT linked_task_id FROM pet_health_records WHERE id=?').get(id).linked_task_id
   sqlite.prepare('UPDATE tasks SET title=? WHERE id=?').run('独立修改后的提醒',second)
   const safelyDetached=await call('PATCH',form('2027-02-05'),id)
   assert.equal(safelyDetached.body.reminderDetached,true)
   assert.equal(safelyDetached.body.createdReminder,true)
   assert.equal(sqlite.prepare('SELECT title,deleted_at FROM tasks WHERE id=?').get(second).title,'独立修改后的提醒')
   assert.equal(sqlite.prepare('SELECT deleted_at FROM tasks WHERE id=?').get(second).deleted_at,null)
   const lastId=sqlite.prepare('SELECT linked_task_id FROM pet_health_records WHERE id=?').get(id).linked_task_id
   const deleted=await call('DELETE',null,id)
   assert.equal(deleted.status,200)
   assert.ok(sqlite.prepare('SELECT deleted_at FROM tasks WHERE id=?').get(lastId).deleted_at)
   assert.equal(sqlite.prepare('SELECT deleted_at FROM tasks WHERE id=?').get(second).deleted_at,null)
 }finally{sqlite.close()}
})
