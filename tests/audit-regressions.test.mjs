import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {portableRoute,RESTORE_ORDER} from '../worker/portable.js'
import {tasksRoute} from '../worker/tasks.js'
import {lifeRoute} from '../worker/life.js'
import {petsRoute} from '../worker/pets.js'
import {authRoute} from '../worker/auth.js'
import {sha256} from '../worker/security.js'
import {searchRoute} from '../worker/search.js'
import {recycleRoute} from '../worker/recycle.js'
import {tripsRoute} from '../worker/trips.js'

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
  '0012_savings_goal_cadence.sql','0013_plan_completion_marks.sql','0014_shopping_multi_expense.sql','0015_reminder_snoozes.sql','0016_reminder_preferences.sql','0017_shopping_partial_quantity.sql','0018_shopping_created_index.sql','0019_reminder_item_quiet_retry.sql','0020_goal_period_settlements.sql','0021_account_recovery.sql','0022_recycle_plans.sql','0023_today_dismissals.sql','0024_shopping_assignee.sql','0025_daily_notification_inbox.sql','0026_shopping_any_receipt_complete.sql','0027_wish_reminder_settings.sql','0028_explicit_today_actions.sql',
  '0029_household_revisions.sql','0030_member_revisions.sql','0031_completion_event_read_state.sql',
  '0032_settlement_origin.sql','0033_completion_points.sql','0034_rewards_shop.sql',
  '0035_household_rewards_only.sql','0036_plan_scoring.sql','0037_goal_rewards.sql','0038_routine_occurrence_assignments.sql','0039_monthly_achievements.sql','0040_monthly_achievement_credits.sql','0041_household_lottery.sql','0041_dual_assignees.sql','0042_shopping_dual_assignee.sql']
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
  x.prepare('INSERT INTO wishes(id,household_id,created_by,visibility,title,wish_type,target_on,remind_enabled,remind_advance_days) VALUES(?,?,?,?,?,?,?,?,?)').run(wish,'primary','u1','household','猫咪新玩具','purchase','2027-01-09',1,3)
  x.prepare(`INSERT INTO today_plan_actions
    (household_id,kind,source_id,original_on,title,action,acted_by)
    VALUES(?,?,?,?,?,'skipped',?)`).run('primary','wish',wish,'2027-01-09','猫咪新玩具','u1')
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
  const restoredWish=target.sqlite.prepare('SELECT target_on,remind_enabled,remind_advance_days FROM wishes WHERE id=?').get(wish)
  assert.equal(restoredWish.target_on,'2027-01-09')
  assert.equal(restoredWish.remind_enabled,1)
  assert.equal(restoredWish.remind_advance_days,3)
  const restoredAction=target.sqlite.prepare('SELECT action,original_on,title FROM today_plan_actions WHERE source_id=?').get(wish)
  assert.equal(restoredAction.action,'skipped')
  assert.equal(restoredAction.original_on,'2027-01-09')
  assert.equal(restoredAction.title,'猫咪新玩具')
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

test('shopping backfill completes previously partial linked purchases without changing receipt records',()=>{
 const {sqlite}=database()
 try{
  const shoppingId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  sqlite.prepare('INSERT INTO shopping_items(id,household_id,created_by,visibility,title,quantity) VALUES(?,?,?,?,?,?)')
    .run(shoppingId,'primary','u1','household','三瓶洗发水',3)
  sqlite.prepare('INSERT INTO shopping_expense_links(household_id,shopping_id,external_entry_id,linked_by,purchase_quantity) VALUES(?,?,?,?,?)')
    .run('primary',shoppingId,'123','u1',1)
  assert.equal(sqlite.prepare('SELECT completed_at FROM shopping_items WHERE id=?').get(shoppingId).completed_at,null)
  const migration=readFileSync(new URL('../migrations/0026_shopping_any_receipt_complete.sql',import.meta.url),'utf8')
  sqlite.exec(migration)
  const item=sqlite.prepare('SELECT completed_at,completed_by FROM shopping_items WHERE id=?').get(shoppingId)
  assert.ok(item.completed_at)
  assert.equal(item.completed_by,'u1')
  assert.equal(sqlite.prepare('SELECT purchase_quantity FROM shopping_expense_links WHERE shopping_id=?').get(shoppingId).purchase_quantity,1)
  sqlite.exec(migration)
  assert.deepEqual(sqlite.prepare('SELECT completed_at,completed_by FROM shopping_items WHERE id=?').get(shoppingId),item,
    'running the backfill again must not rewrite the completion')
 }finally{sqlite.close()}
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
  const beforeShopping=JSON.stringify(['旧购物',1,null,null,null,null])
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

test('portable backup pages more than 500 records without truncation or write queries',async()=>{
 const {sqlite,db}=database()
 try{
   const insert=sqlite.prepare("INSERT INTO wishes(id,household_id,created_by,visibility,title,wish_type) VALUES(?,?,?,'private',?,'other')")
   for(let i=0;i<507;i++)insert.run('9999'+String(i).padStart(4,'0')+'-aaaa-4aaa-8aaa-aaaaaaaaaaaa','primary','u1','wish '+i)
   let cursor='',all=[]
   do{
     const u='https://homeflow.test/api/portable?dataset=wishes'+(cursor?'&cursor='+cursor:'')
     const response=await portableRoute(new Request(u),db,'/api/portable',session)
     assert.equal(response.status,200)
     const payload=await response.json()
     assert.ok(payload.items.length<=100)
     all.push(...payload.items)
     cursor=payload.nextCursor||''
   }while(cursor)
   assert.equal(all.length,507)
   assert.equal(new Set(all.map(x=>x.id)).size,507)
   const invalid=await portableRoute(new Request('https://homeflow.test/api/portable?dataset=wishes&cursor=-3'),db,'/api/portable',session)
   assert.equal(invalid.status,400)
 }finally{sqlite.close()}
})

test('password change validates old proof and revokes only other sessions',async()=>{
 const {db,sqlite}=database()
 const a='a'.repeat(64),b='b'.repeat(64),currentToken='c'.repeat(64),otherToken='d'.repeat(64)
 const sessionWithLogin={...session,login_name:'owner'}
 const route=async(oldProof,newProof)=>{
  const request=new Request('https://homeflow.test/api/auth/change-password',{
    method:'POST',headers:{'content-type':'application/json',cookie:'__Host-hf_session='+currentToken},
    body:JSON.stringify({currentPasswordProof:oldProof,newPasswordProof:newProof,
      newPasswordSalt:'e'.repeat(32),newPasswordRounds:100000})})
  const response=await authRoute(request,{DB:db},'/api/auth/change-password',sessionWithLogin)
  return {status:response.status,body:await response.json()}
 }
 try{
  sqlite.prepare('UPDATE users SET password_salt=?,password_verifier=?,password_rounds=100000 WHERE id=?')
    .run('c1:'+'1'.repeat(32),await sha256(a),'u1')
  for(const token of [currentToken,otherToken]){
   sqlite.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)')
     .run(await sha256(token),'u1',Date.now()+86400000)
  }
  assert.equal((await route('0'.repeat(64),b)).status,401)
  assert.equal((await route(a,b)).status,200)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,1)
  assert.equal(sqlite.prepare('SELECT token_hash FROM sessions').get().token_hash,await sha256(currentToken))
  assert.equal(sqlite.prepare("SELECT password_verifier FROM users WHERE id='u1'").get().password_verifier,await sha256(b))
  assert.equal((await route(a,'f'.repeat(64))).status,401)
 }finally{sqlite.close()}
})
test('pet weight trend returns 24 latest records and respects private visibility',async()=>{
 const {db,sqlite}=database()
 const pet='88888888-8888-4888-8888-888888888888'
 try{
  sqlite.prepare("INSERT INTO family_profiles(id,household_id,type,display_name) VALUES(?,?,'pet',?)").run(pet,'primary','豆沙')
  sqlite.prepare("INSERT INTO users(id,login_name,password_salt,password_verifier) VALUES('u2','partner','x','y')").run()
  sqlite.prepare("INSERT INTO household_members(household_id,user_id,role) VALUES('primary','u2','member')").run()
  const insert=sqlite.prepare("INSERT INTO pet_health_records(id,household_id,profile_id,created_by,visibility,record_type,event_on,weight_grams) VALUES(?, 'primary', ?, 'u1', ?, 'weight', ?, ?)")
  for(let i=0;i<26;i++)insert.run('8888'+String(i).padStart(4,'0')+'-bbbb-4bbb-8bbb-bbbbbbbbbbbb',pet,i===25?'private':'household','2026-11-'+String(i+1).padStart(2,'0'),5000+i*10)
  const path='/api/pets/'+pet+'/health/trend'
  const check=async(who)=>{
   const response=await petsRoute(new Request('https://homeflow.test'+path),db,path,who)
   assert.equal(response.status,200)
   return (await response.json()).points
  }
  const owner=await check(session)
  assert.equal(owner.length,24)
  assert.equal(owner.at(-1).weightGrams,5250)
  const member=await check({...session,user_id:'u2',role:'member'})
  assert.equal(member.length,24)
  assert.equal(member.at(-1).weightGrams,5240)
 }finally{sqlite.close()}
})

test('global search returns five rows and respects member private records',async()=>{
 const {db,sqlite}=database()
 try{
  sqlite.prepare("INSERT INTO users(id,login_name,password_salt,password_verifier) VALUES('u2','member','x','y')").run()
  sqlite.prepare("INSERT INTO household_members(household_id,user_id,role) VALUES('primary','u2','member')").run()
  const statement=sqlite.prepare("INSERT INTO wishes(id,household_id,created_by,visibility,title,wish_type,target_on) VALUES(?,'primary','u1',? ,?,'other',?)")
  for(let n=1;n<=8;n++)statement.run('dddd'+String(n).padStart(4,'0')+'-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
     n===8?'private':'household','家庭目标','2026-11-'+String(n).padStart(2,'0'))
  const ask=async(who,cursor='')=>{
   const query='q='+encodeURIComponent('家庭目标')+'&kind=wish'+(cursor?'&cursor='+encodeURIComponent(cursor):'')
   const r=await searchRoute(new Request('https://homeflow.test/api/search?'+query),db,{...session,user_id:who})
   assert.equal(r.status,200)
   return r.json()
  }
  const first=await ask('u2')
  assert.equal(first.items.length,5)
  assert.ok(first.nextCursor)
  const second=await ask('u2',first.nextCursor)
  assert.equal(second.items.length,2)
  assert.equal(new Set([...first.items,...second.items].map(x=>x.id)).size,7)
  assert.equal((await ask('u1')).items[0].event_date,'2026-11-08')
 }finally{sqlite.close()}
})
test('unscheduled tasks are paged on server and excluded from Today',async()=>{
 const {db,sqlite}=database()
 try{
  const task='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  sqlite.prepare("INSERT INTO tasks(id,household_id,creator_user_id,visibility,title) VALUES(?,'primary','u1','private','undated')").run(task)
  const r=await tasksRoute(new Request('https://homeflow.test/api/tasks?scope=unscheduled&limit=5'),db,'/api/tasks',session)
  assert.equal(r.status,200)
  const body=await r.json()
  assert.equal(body.items[0].id,task)
  assert.match(readFileSync(new URL('../worker/today-page.js',import.meta.url),'utf8'),/!task\.dueOn\|\|task\.dueOn>date/)
 }finally{sqlite.close()}
})

test('one-time account recovery codes are hashed, consumed and revoke sessions',async()=>{
 const {sqlite,db}=database()
 const oldProof='a'.repeat(64),freshProof='b'.repeat(64)
 const signed={...session,login_name:'owner'}
 try{
  sqlite.prepare("UPDATE users SET password_salt=?,password_verifier=?,password_rounds=100000 WHERE id='u1'")
    .run('c1:'+'1'.repeat(32),await sha256(oldProof))
  const post=async(path,body,who=null)=>{
   const r=await authRoute(new Request('https://homeflow.test'+path,{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify(body)}),{DB:db},path,who)
   return {status:r.status,data:await r.json()}
  }
  const bad=await post('/api/auth/recovery-codes',{currentPasswordProof:'f'.repeat(64)},signed)
  assert.equal(bad.status,401)
  const issued=await post('/api/auth/recovery-codes',{currentPasswordProof:oldProof},signed)
  assert.equal(issued.status,200)
  assert.equal(issued.data.codes.length,5)
  const code=issued.data.codes[0]
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM account_recovery_codes').get().n,5)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM account_recovery_codes WHERE code_hash=?').get(code).n,0)
  sqlite.prepare('INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)')
    .run('d'.repeat(64),'u1',Date.now()+86400000)
  const payload={loginName:'owner',recoveryCode:code,newPasswordSalt:'2'.repeat(32),
    newPasswordProof:freshProof,newPasswordRounds:100000}
  assert.equal((await post('/api/auth/recover',{...payload,recoveryCode:'f'.repeat(32)})).status,401)
  assert.equal((await post('/api/auth/recover',payload)).status,200)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,0)
  assert.equal(sqlite.prepare("SELECT password_verifier FROM users WHERE id='u1'").get().password_verifier,await sha256(freshProof))
  assert.equal((await post('/api/auth/recover',payload)).status,401)
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM account_recovery_codes WHERE used_at IS NOT NULL").get().n,1)
 }finally{sqlite.close()}
})

test('exact task detail returns owner data but no private data to other accounts',async()=>{
 const {db,sqlite}=database()
 const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
 try{
  sqlite.prepare("INSERT INTO tasks(id,household_id,creator_user_id,visibility,title) VALUES(?,'primary','u1','private','Search-only task')").run(id)
  const request=new Request('https://homeflow.test/api/tasks/'+id),path='/api/tasks/'+id
  const own=await tasksRoute(request,db,path,session)
  assert.equal(own.status,200)
  assert.equal((await own.json()).task.id,id)
  sqlite.prepare("INSERT INTO users(id,login_name,password_salt,password_verifier) VALUES('u2','member','x','y')").run()
  sqlite.prepare("INSERT INTO household_members(household_id,user_id,role) VALUES('primary','u2','member')").run()
  const other=await tasksRoute(request,db,path,{...session,user_id:'u2',role:'member'})
  assert.equal(other.status,404)
 }finally{sqlite.close()}
})

test('soft-deleted task recycling is five-row keyed and creator-only',async()=>{
 const {db,sqlite}=database()
 try{
  const insert=sqlite.prepare("INSERT INTO tasks(id,household_id,creator_user_id,visibility,title,deleted_at) VALUES(?, 'primary','u1','household',?,?)")
  for(let i=0;i<7;i++)insert.run('ffff'+String(i).padStart(4,'0')+'-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Deleted '+i,'2026-11-05T10:00:'+String(i).padStart(2,'0')+'.000Z')
  const request=async(path,method='GET',who=session)=>{
   const r=await tasksRoute(new Request('https://homeflow.test'+path,{method}),db,
     new URL('https://homeflow.test'+path).pathname,who)
   return {status:r.status,body:await r.json()}
  }
  const first=await request('/api/tasks/trash?limit=5')
  assert.equal(first.status,200)
  assert.equal(first.body.items.length,5)
  assert.ok(first.body.nextCursor)
  const second=await request('/api/tasks/trash?limit=5&cursor='+encodeURIComponent(first.body.nextCursor))
  assert.equal(second.body.items.length,2)
  const target=first.body.items[0].id
  assert.equal((await request('/api/tasks/'+target+'/restore','POST',{...session,user_id:'someone-else'})).status,404)
  assert.equal((await request('/api/tasks/'+target+'/restore','POST')).status,200)
  assert.equal(sqlite.prepare('SELECT deleted_at FROM tasks WHERE id=?').get(target).deleted_at,null)
  assert.equal((await request('/api/tasks/'+target+'/restore','POST')).status,404)
 }finally{sqlite.close()}
})

test('Today task read excludes undated and future tasks, but plans can still fetch them',async()=>{
 const {db,sqlite}=database()
 const insert=sqlite.prepare("INSERT INTO tasks(id,household_id,creator_user_id,visibility,title,due_on,completed_at) VALUES(?,'primary','u1','private',?,?,?)")
 const id=n=>'abbb'+String(n).padStart(4,'0')+'-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
 try{
  insert.run(id(1),'overdue','2026-11-01',null)
  insert.run(id(2),'today','2026-11-05',null)
  insert.run(id(3),'future','2026-11-06',null)
  insert.run(id(4),'unscheduled',null,null)
  insert.run(id(5),'completed today','2026-11-05','2026-11-05T03:00:00.000Z')
  insert.run(id(6),'completed before','2026-11-01','2026-11-01T03:00:00.000Z')
  const fetch=async(path)=>{
   const response=await tasksRoute(new Request('https://homeflow.test'+path),db,'/api/tasks',session)
   assert.equal(response.status,200)
   return response.json()
  }
  const today=await fetch('/api/tasks?status=all&today=2026-11-05')
  assert.deepEqual(new Set(today.tasks.map(t=>t.title)),new Set(['today','completed today']))
  const historical=await fetch('/api/tasks?status=all&today=2026-11-05&showHistory=1')
  assert.ok(historical.tasks.some(t=>t.title==='completed before'))
  const unscheduled=await fetch('/api/tasks?scope=unscheduled&limit=5')
  assert.equal(unscheduled.items.length,1)
  assert.equal(unscheduled.items[0].title,'unscheduled')
  const invalid=await tasksRoute(new Request('https://homeflow.test/api/tasks?status=all&today=2026-02-30'),db,'/api/tasks',session)
  assert.equal(invalid.status,400)
 }finally{sqlite.close()}
})

test('recycle restores all plan types without losing finance links or task completion history',async()=>{
 const {db,sqlite}=database()
 const kinds=[
  ['routine','routines',"title,repeat_type,anchor_date","'照顾豆沙','daily','2026-11-01'"],
  ['anniversary','anniversaries',"title,event_date,repeat_mode","'纪念日','2026-12-01','yearly'"],
  ['shopping','shopping_items',"title","'猫粮'"],
  ['wish','wishes',"title,wish_type","'心愿','purchase'"],
  ['goal','goals',"title,target_amount","'储值',60000"],
  ['trip','trips',"title","'上海旅行'"],
  ['memory','memories',"title,happened_on","'快乐一天','2026-11-01'"]
 ]
 const keys=new Map()
 try{
  for(let i=0;i<kinds.length;i++){
   const [kind,table,cols,values]=kinds[i],id='cccc'+String(i).padStart(4,'0')+'-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
   sqlite.prepare(`INSERT INTO ${table}(id,household_id,created_by,visibility,${cols}) VALUES(?1,'primary','u1','household',${values})`).run(id)
   keys.set(kind,id)
  }
  const goalId=keys.get('goal'),tripId=keys.get('trip'),shoppingId=keys.get('shopping')
  sqlite.prepare("INSERT INTO finance_links(id,household_id,created_by,target_type,target_id,external_entry_id) VALUES('12345678-1234-4234-8234-123456789012','primary','u1','trip',?,'1234')").run(tripId)
  sqlite.prepare("INSERT INTO shopping_expense_links(household_id,shopping_id,external_entry_id,linked_by,purchase_quantity) VALUES('primary',?,'1234','u1',1)").run(shoppingId)
  sqlite.prepare("INSERT INTO plan_completion_marks(household_id,plan_type,plan_id,period_key,completed_at,completed_by) VALUES('primary','goal',?,'once','2026-11-03T00:00:00Z','u1')").run(goalId)
  const request=(path,method='GET',body)=>new Request('https://homeflow.test'+path,{
   method,headers:body?{'content-type':'application/json'}:{},
   ...(body?{body:JSON.stringify(body)}:{})})
  for(const [kind,table] of kinds){
   const path='/api/'+(kind==='shopping'?'shopping':kind==='trip'?'trips':
     kind==='routine'?'routines':kind==='anniversary'?'anniversaries':
     kind==='wish'?'wishes':kind==='goal'?'goals':'memories')+'/'+keys.get(kind)
   const response=kind==='trip'?await tripsRoute(request(path,'DELETE'),db,path,session):
     await lifeRoute(request(path,'DELETE'),db,path,session)
   assert.equal(response.status,200,kind)
   assert.ok(sqlite.prepare(`SELECT deleted_at FROM ${table} WHERE id=?`).get(keys.get(kind)).deleted_at)
  }
  const firstResponse=await recycleRoute(request('/api/recycle'),db,'/api/recycle',session)
  assert.equal(firstResponse.status,200)
  const first=await firstResponse.json()
  assert.equal(first.items.length,5)
  assert.ok(first.nextCursor)
  const secondResponse=await recycleRoute(request('/api/recycle?cursor='+encodeURIComponent(first.nextCursor)),db,'/api/recycle',session)
  const second=await secondResponse.json()
  assert.equal(second.items.length,2)
  const visible=new Set([...first.items,...second.items].map(x=>x.kind))
  assert.deepEqual(visible,new Set(kinds.map(k=>k[0])))
  const foreign=await recycleRoute(request('/api/recycle/restore','POST',{kind:'goal',id:goalId}),db,'/api/recycle/restore',{...session,user_id:'u2'})
  assert.equal(foreign.status,404)
  for(const [kind,table] of kinds){
   const answer=await recycleRoute(request('/api/recycle/restore','POST',{kind,id:keys.get(kind)}),db,'/api/recycle/restore',session)
   assert.equal(answer.status,200,kind)
   assert.equal(sqlite.prepare(`SELECT deleted_at FROM ${table} WHERE id=?`).get(keys.get(kind)).deleted_at,null)
  }
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM finance_links WHERE target_id=?").get(tripId).n,1)
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM shopping_expense_links WHERE shopping_id=?").get(shoppingId).n,1)
  assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM plan_completion_marks WHERE plan_id=?").get(goalId).n,1)
 }finally{sqlite.close()}
})

test('portable backup preserves deleted flags for a goal, wish and ordinary task',async()=>{
 const source=database(),target=database()
 const timestamp='2026-11-05T03:42:00.000Z'
 const ids={wishes:'a1a1a1a1-a1a1-41a1-81a1-a1a1a1a1a1a1',
   goals:'b2b2b2b2-b2b2-42b2-82b2-b2b2b2b2b2b2',
   tasks:'c3c3c3c3-c3c3-43c3-83c3-c3c3c3c3c3c3'}
 try{
   source.sqlite.prepare("INSERT INTO wishes(id,household_id,created_by,visibility,title,wish_type,deleted_at) VALUES(?,'primary','u1','private','archived wish','purchase',?)")
     .run(ids.wishes,timestamp)
   source.sqlite.prepare("INSERT INTO goals(id,household_id,created_by,visibility,title,target_amount,wish_id,deleted_at) VALUES(?,'primary','u1','private','archived saving',1000,?,?)")
     .run(ids.goals,ids.wishes,timestamp)
   source.sqlite.prepare("INSERT INTO tasks(id,household_id,creator_user_id,visibility,title,deleted_at) VALUES(?,'primary','u1','private','archived task',?)")
     .run(ids.tasks,timestamp)
   for(const dataset of ['wishes','goals','tasks']){
     const response=await portableRoute(new Request('https://homeflow.test/api/portable?dataset='+dataset),
       source.db,'/api/portable',session)
     assert.equal(response.status,200)
     const page=await response.json()
     assert.equal(page.items.length,1,dataset)
     assert.equal(page.items[0].deleted_at,timestamp)
     const restoreRequest=new Request('https://homeflow.test/api/portable/restore',{method:'POST',
       headers:{'content-type':'application/json'},
       body:JSON.stringify({dataset,items:page.items,confirm:true})})
     const restored=await portableRoute(restoreRequest,target.db,'/api/portable/restore',session)
     assert.equal(restored.status,200,dataset+': '+await restored.text())
     const copied=target.sqlite.prepare('SELECT deleted_at FROM '+dataset+' WHERE id=?').get(ids[dataset])
     assert.equal(copied.deleted_at,timestamp,dataset)
   }
   assert.equal(target.sqlite.prepare('SELECT wish_id FROM goals WHERE id=?').get(ids.goals).wish_id,ids.wishes)
 }finally{source.sqlite.close();target.sqlite.close()}
})


test('recycle uses D1-safe four-source reads with a stable cross-kind five-item cursor',async()=>{
 const {db,sqlite}=database()
 const rows=[
  ['task','tasks','creator_user_id',"title","'任务'"],
  ['routine','routines','created_by',"title,repeat_type,anchor_date","'定期','daily','2026-11-01'"],
  ['anniversary','anniversaries','created_by',"title,event_date,repeat_mode","'纪念','2026-12-01','yearly'"],
  ['shopping','shopping_items','created_by',"title","'购物'"],
  ['wish','wishes','created_by',"title,wish_type","'心愿','purchase'"],
  ['goal','goals','created_by',"title,target_amount","'储值',1000"],
  ['trip','trips','created_by',"title","'旅行'"],
  ['memory','memories','created_by',"title,happened_on","'回忆','2026-11-05'"]
 ]
 try{
  for(let i=0;i<rows.length;i++){
   const [kind,table,creator,columns,values]=rows[i]
   const id='eeee'+String(i).padStart(4,'0')+'-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
   sqlite.prepare('INSERT INTO '+table+'(id,household_id,'+creator+',visibility,'+columns+',deleted_at) VALUES(?,\'primary\',\'u1\',\'private\','+values+',?)')
    .run(id,'2026-11-05T00:00:0'+i+'.000Z')
  }
  const boundedDb={...db,async batch(statements){
   assert.equal(statements.length,2,'the read is two bounded D1 statements')
   for(const statement of statements){
    assert.ok((statement._sql.match(/UNION ALL/g)||[]).length<=3,'D1 supports each four-source compound SELECT')
   }
   return db.batch(statements)
  }}
  const fetchPage=async(cursor)=>{
   const uri='https://homeflow.test/api/recycle'+(cursor?'?cursor='+encodeURIComponent(cursor):'')
   const response=await recycleRoute(new Request(uri),boundedDb,'/api/recycle',session)
   assert.equal(response.status,200)
   return response.json()
  }
  const first=await fetchPage()
  const second=await fetchPage(first.nextCursor)
  assert.equal(first.items.length,5)
  assert.equal(second.items.length,3)
  assert.equal(second.nextCursor,null)
  assert.deepEqual([...first.items,...second.items].map(x=>x.kind),
   ['memory','trip','goal','wish','shopping','anniversary','routine','task'])
  const bad=await recycleRoute(new Request('https://homeflow.test/api/recycle?cursor=bad'),
    boundedDb,'/api/recycle',session)
  assert.equal(bad.status,400)
 }finally{sqlite.close()}
})

test('manual recycle clearing requires confirmation, respects ownership and protects linked photos',async()=>{
 const {db,sqlite}=database()
 const ids={
  task:'bbbb0001-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  active:'bbbb0002-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  other:'bbbb0003-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  shop:'bbbb0004-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  wish:'bbbb0005-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  goal:'bbbb0006-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  photo:'bbbb0007-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  memory:'bbbb0008-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  keptWish:'bbbb0009-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  keptTrip:'bbbb0010-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
 }
 const time='2026-11-05T02:00:00.000Z'
 const request=(path,body)=>new Request('https://homeflow.test'+path,{method:'POST',
  headers:{'content-type':'application/json'},body:JSON.stringify(body)})
 const count=(table,id)=>sqlite.prepare('SELECT COUNT(*) AS n FROM '+table+' WHERE id=?').get(id).n
 try{
  sqlite.exec("INSERT INTO users(id,login_name,password_salt,password_verifier) VALUES('u2','member','x','y')")
  sqlite.exec("INSERT INTO household_members(household_id,user_id,role) VALUES('primary','u2','member')")
  const taskInsert=sqlite.prepare("INSERT INTO tasks(id,household_id,creator_user_id,visibility,title,deleted_at) VALUES(?,'primary',?,'private','task',?)")
  taskInsert.run(ids.task,'u1',time)
  taskInsert.run(ids.active,'u1',null)
  taskInsert.run(ids.other,'u2',time)
  sqlite.prepare("INSERT INTO shopping_items(id,household_id,created_by,visibility,title,deleted_at) VALUES(?,'primary','u1','private','shopping',?)").run(ids.shop,time)
  sqlite.prepare("INSERT INTO shopping_expense_links(household_id,shopping_id,external_entry_id,linked_by,purchase_quantity) VALUES('primary',?,'receipt-1','u1',1)").run(ids.shop)
  const wishInsert=sqlite.prepare("INSERT INTO wishes(id,household_id,created_by,visibility,title,wish_type,deleted_at) VALUES(?,'primary','u1','private','wish','purchase',?)")
  wishInsert.run(ids.wish,time)
  wishInsert.run(ids.keptWish,time)
  sqlite.prepare("INSERT INTO goals(id,household_id,created_by,visibility,title,target_amount,wish_id,deleted_at) VALUES(?,'primary','u1','private','goal',1000,?,?)").run(ids.goal,ids.wish,time)
  sqlite.prepare("INSERT INTO goal_period_settlements(household_id,goal_id,period_key,period_start,period_end,target_amount,status) VALUES('primary',?,'once','2026-11-01','2026-11-30',1000,'pending')").run(ids.goal)
  sqlite.prepare("INSERT INTO trips(id,household_id,created_by,visibility,title,wish_id) VALUES(?,'primary','u1','private','active trip',?)").run(ids.keptTrip,ids.keptWish)
  const memoryInsert=sqlite.prepare("INSERT INTO memories(id,household_id,created_by,visibility,title,happened_on,deleted_at) VALUES(?,'primary','u1','private','memory','2026-11-05',?)")
  memoryInsert.run(ids.photo,time)
  memoryInsert.run(ids.memory,time)
  sqlite.prepare("INSERT INTO media_assets(id,household_id,uploaded_by,visibility,memory_id,storage_key,mime_type,byte_size) VALUES('asset-1','primary','u1','private',?,'private/picture','image/jpeg',10)").run(ids.photo)

  const invalid=await recycleRoute(request('/api/recycle/empty',{confirm:false}),db,'/api/recycle/empty',session)
  assert.equal(invalid.status,400)
  assert.equal(count('tasks',ids.task),1,'invalid request cannot delete anything')
  const foreign=await recycleRoute(request('/api/recycle/empty',{confirm:'PERMANENTLY_EMPTY_RECYCLE_BIN'}),db,'/api/recycle/empty',{...session,user_id:'u2'})
  assert.equal(foreign.status,200)
  assert.equal((await foreign.json()).deleted,1)
  assert.equal(count('tasks',ids.task),1,'second account cannot empty the first account trash')
  const response=await recycleRoute(request('/api/recycle/empty',{confirm:'PERMANENTLY_EMPTY_RECYCLE_BIN'}),
    db,'/api/recycle/empty',session)
  assert.equal(response.status,200,await response.clone().text())
  const result=await response.json()
  assert.equal(result.deleted,5,'only unblocked deleted items are physically purged')
  for(const item of ['task','shop','wish','goal','memory'])assert.equal(count(
   item==='task'?'tasks':item==='shop'?'shopping_items':item==='wish'?'wishes':item==='goal'?'goals':'memories',
   ids[item]),0,item)
  assert.equal(count('tasks',ids.active),1)
  assert.equal(count('memories',ids.photo),1,'keep memories with media')
  assert.equal(count('wishes',ids.keptWish),1,'keep wishes linked to a surviving trip')
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM shopping_expense_links WHERE shopping_id=?').get(ids.shop).n,0)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM goal_period_settlements WHERE goal_id=?').get(ids.goal).n,0)
  assert.equal(sqlite.prepare('SELECT memory_id FROM media_assets WHERE id=?').get('asset-1').memory_id,ids.photo)
  const after=await recycleRoute(new Request('https://homeflow.test/api/recycle'),db,'/api/recycle',session)
  assert.deepEqual(new Set((await after.json()).items.map(x=>x.id)),new Set([ids.photo,ids.keptWish]))
 }finally{sqlite.close()}
})

test('recycle UI preserves genuine empty state and requires a second explicit click to purge',()=>{
 const ui=readFileSync(new URL('../src/components/TrashPanel.vue',import.meta.url),'utf8')
 assert.match(ui,/loaded&&!busy&&!error&&!rows\.length/)
 assert.match(ui,/confirmEmpty\.value\|\|busy\.value/)
 assert.match(ui,/PERMANENTLY_EMPTY_RECYCLE_BIN/)
 assert.match(ui,/回收箱读取失败，请重试/)
 assert.match(ui,/确认永久清空/)
 assert.doesNotMatch(ui,/error\.value=\(e as Error\)\.message/)
})

test('global eight-category search uses D1-safe groups and preserves cross-kind keyset paging',async()=>{
 const {db,sqlite}=database()
 try{
  const addWish=sqlite.prepare("INSERT INTO wishes(id,household_id,created_by,visibility,title,wish_type,target_on) VALUES(?,'primary','u1','household','跨类审查','other',?)")
  const addTask=sqlite.prepare("INSERT INTO tasks(id,household_id,creator_user_id,visibility,title,due_on) VALUES(?,'primary','u1','household','跨类审查',?)")
  for(let i=1;i<=7;i++){
   const id='abcde'+String(i).padStart(3,'0')+'-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
   const date='2026-11-'+String(i).padStart(2,'0')
   ;(i%2?addWish:addTask).run(id,date)
  }
  const ask=async(cursor='',kind='all')=>{
   const url=new URL('https://homeflow.test/api/search')
   url.searchParams.set('q','跨类审查')
   url.searchParams.set('kind',kind)
   if(cursor)url.searchParams.set('cursor',cursor)
   const res=await searchRoute(new Request(url),db,session)
   assert.equal(res.status,200)
   return res.json()
  }
  const first=await ask()
  assert.equal(first.items.length,5)
  assert.ok(first.nextCursor)
  const second=await ask(first.nextCursor)
  assert.equal(second.items.length,2)
  assert.equal(second.nextCursor,null)
  const all=[...first.items,...second.items]
  assert.equal(new Set(all.map(x=>x.id)).size,7)
  assert.deepEqual(all.map(x=>x.event_date),[7,6,5,4,3,2,1].map(x=>'2026-11-'+String(x).padStart(2,'0')))
  assert.equal((await ask('','task')).items.length,3)
 }finally{sqlite.close()}
})
