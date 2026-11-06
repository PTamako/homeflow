import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import worker from '../worker/index.js'
import {registerPassword,derivePasswordProof,validLocalPassword} from '../src/auth-crypto.js'

function makeDb() {
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec('PRAGMA foreign_keys=ON;')
 for (const filename of ['0001_core.sql','0002_stage1_family_tasks.sql','0003_life_projects.sql','0004_push_notifications.sql','0005_interval_policies.sql','0006_pet_health.sql','0007_offline_tasks.sql','0008_shopping_ledger.sql','0009_routine_pet_care.sql','0010_task_pet_care.sql','0012_savings_goal_cadence.sql','0009_finance_target_settings.sql','0011_unified_plan_hub.sql','0013_plan_completion_marks.sql','0014_shopping_multi_expense.sql','0015_reminder_snoozes.sql','0016_reminder_preferences.sql','0017_shopping_partial_quantity.sql','0018_shopping_created_index.sql','0019_reminder_item_quiet_retry.sql','0020_goal_period_settlements.sql','0021_account_recovery.sql','0022_recycle_plans.sql','0023_today_dismissals.sql','0024_shopping_assignee.sql','0025_daily_notification_inbox.sql','0026_shopping_any_receipt_complete.sql','0027_wish_reminder_settings.sql','0028_explicit_today_actions.sql','0029_household_revisions.sql','0030_member_revisions.sql','0031_completion_event_read_state.sql']) {
   sqlite.exec(readFileSync(new URL('../migrations/'+filename, import.meta.url),'utf8'))
 }
 sqlite.exec("INSERT INTO environment_identity(key,database_name) VALUES('current','homeflow-preview')")
 sqlite.exec("CREATE TABLE d1_migrations(id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT UNIQUE,applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL)")
 sqlite.exec("INSERT INTO d1_migrations(name) VALUES('0028_explicit_today_actions.sql')")
 sqlite.exec("INSERT INTO d1_migrations(name) VALUES('0029_household_revisions.sql')")
 sqlite.exec("INSERT INTO d1_migrations(name) VALUES('0030_member_revisions.sql')")
 sqlite.exec("INSERT INTO d1_migrations(name) VALUES('0031_completion_event_read_state.sql')")
 const db={
   prepare(sql) {
     const stmt=sqlite.prepare(sql)
     const args=[]
     return {
       _sql:sql,
       bind(...values){args.splice(0,args.length,...values);return this},
       async first(){return stmt.get(...args)||null},
       async all(){return {results:stmt.all(...args)}},
       async run(){const r=stmt.run(...args);return {meta:{changes:Number(r.changes)}}}
     }
   },
   async batch(statements) {
     const results=[]
     sqlite.exec('BEGIN')
     try {
       for (const st of statements){
         // SQLite SELECT / PRAGMA operations are read-only in this test adapter.
         if (/^\s*(SELECT|PRAGMA)/i.test(st._sql||''))results.push(await st.all())
         else results.push(await st.run())
       }
       sqlite.exec('COMMIT')
     }catch(e){sqlite.exec('ROLLBACK');throw e}
     return results
   }
 }
 return {db,sqlite}
}
const origin='https://homeflow.example'
function req(path,method='GET',body,token,csrf=true){
 const headers={}
 if(token)headers.cookie=token
 if(body!==undefined)headers['content-type']='application/json'
 if(method!=='GET'&&csrf)headers.origin=origin
 return new Request(origin+path,{method,headers,...(body===undefined?{}:{body:JSON.stringify(body)})})
}
async function send(env,path,method='GET',body,cookie,csrf=true){
 let payload=body
 if(method==='POST'&&body&&typeof body.password==='string'&&
    ['/api/auth/bootstrap','/api/auth/join','/api/auth/login'].includes(path)){
   const {password,...rest}=body
   if(path==='/api/auth/login'){
     const challenge=await worker.fetch(req('/api/auth/login-challenge?loginName='+
       encodeURIComponent(String(body.loginName).trim().toLowerCase())),env)
     const options=await challenge.json()
     payload={...rest,passwordProof:await derivePasswordProof(password,options.salt)}
   }else{
     payload={...rest,...(validLocalPassword(password)?await registerPassword(password):
       {passwordSalt:'bad',passwordProof:'invalid',passwordRounds:100000})}
   }
 }
 const response=await worker.fetch(req(path,method,payload,cookie,csrf),env)
 const result=await response.json()
 return {status:response.status,cookie:response.headers.get('set-cookie'),body:result}
}
function extractCookie(header) {return header?.split(';')[0]||''}
// Mock the private, READ-ONLY Kakebo ledger. All assertions exercise the
// production-only verification gate, never a real user database or network.
function mockedProductionLedger(db,sqlite,secret='example-secret-for-test-012345678901234'){
 sqlite.prepare("UPDATE environment_identity SET database_name='homeflow' WHERE key='current'").run()
 const amount={net:20000,expenses:[{id:123,date:'2026-11-04',type:'expense',amount:3500,merchant:'测试购物',category:'购物'}]}
 const env={APP_ENV:'production',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:secret,
   KAKEBO_LEDGER_API_URL:'https://kakeibo-f17.pages.dev/api/homeflow-ledger',
   KAKEBO_LEDGER_SERVICE:{fetch:async input=>{
     const url=new URL(input)
     if(url.searchParams.get('summary')==='net'){
       return new Response(JSON.stringify({income:Math.max(0,amount.net),expense:Math.max(0,-amount.net),net:amount.net}),
         {status:200,headers:{'content-type':'application/json'}})
     }
     const ids=url.searchParams.get('ids')
     return new Response(JSON.stringify({entries:ids?amount.expenses.filter(x=>ids.split(',').includes(String(x.id))):amount.expenses,nextCursor:null}),
       {status:200,headers:{'content-type':'application/json'}})
   }}
 }
 return {env,amount}
}

test('client password derivation uses exactly 100000 PBKDF2 iterations with 16-byte random salt',async()=>{
  const proof=await registerPassword('a-long-password-for-homeflow')
  assert.match(proof.passwordSalt,/^[a-f0-9]{32}$/)
  assert.match(proof.passwordProof,/^[a-f0-9]{64}$/)
  assert.equal(proof.passwordRounds,100000)
  assert.equal(proof.passwordProof,await derivePasswordProof('a-long-password-for-homeflow',proof.passwordSalt))
  assert.notEqual(proof.passwordProof,await derivePasswordProof('wrong-long-password-12345',proof.passwordSalt))
  assert.equal(validLocalPassword('short'),false)
  assert.equal(validLocalPassword('very-long-password-is-okay'),true)
})

test('bootstrap readiness distinguishes missing vs short keys without exposing their contents',async()=>{
 const {db,sqlite}=makeDb()
 const base={APP_ENV:'preview',DB:db}
 for (const [secret,expected] of [[undefined,'missing'],['short-value','too_short'],['x'.repeat(32),null]]){
   const env={...base,HOMEFLOW_BOOTSTRAP_SECRET:secret}
   const result=await send(env,'/api/auth/bootstrap-status')
   assert.equal(result.status,200)
   assert.equal(result.body.bootstrapIssue,expected)
   assert.equal(result.body.bootstrapAvailable,expected===null)
   assert.equal(JSON.stringify(result.body).includes('short-value'),false)
 }
 const bad=await send({...base,HOMEFLOW_BOOTSTRAP_SECRET:'short-value'},'/api/auth/bootstrap','POST',{
   loginName:'owner',password:'owner-passphrase-example-123',displayName:'Owner',bootstrapSecret:'short-value'})
 assert.equal(bad.status,503)
 assert.equal(bad.body.error,'bootstrap_secret_too_short')
 sqlite.close()
})

test('email login, Japanese nickname and specific registration errors',async()=>{
  const {db,sqlite}=makeDb()
  const secret='testing-bootstrap-secret-0123456789abcdef'
  const env={APP_ENV:'preview',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:secret}
  const register=(overrides={})=>send(env,'/api/auth/bootstrap','POST',{
    loginName:'new.user+home@example.com',password:'my-long-password-123456',
    displayName:'白ちゃん',householdName:'我们的小家',bootstrapSecret:secret,...overrides
  })
  assert.equal((await register({loginName:'bad@name'})).body.error,'invalid_login_name')
  assert.equal((await register({password:'short'})).body.error,'invalid_password_proof')
  assert.equal((await register({displayName:'<script>'})).body.error,'invalid_display_name')
  const created=await register()
  assert.equal(created.status,201,JSON.stringify(created.body))
  const session=extractCookie(created.cookie)
  const me=await send(env,'/api/auth/me','GET',undefined,session)
  assert.equal(me.body.user.loginName,'new.user+home@example.com')
  const good=await send(env,'/api/auth/login','POST',
    {loginName:'NEW.USER+HOME@EXAMPLE.COM',password:'my-long-password-123456'})
  assert.equal(good.status,200,JSON.stringify(good.body))
  const failed=await send(env,'/api/auth/login','POST',
    {loginName:'new.user+home@example.com',password:'wrong-long-password-12345'})
  assert.equal(failed.status,401)
  sqlite.close()
})

test('end-to-end owner, one-use invitation, private/shared ACL and trip import',async()=>{
 const {db,sqlite}=makeDb()
 const env={APP_ENV:'preview',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:'example-secret-only-for-unit-test-123456789'}
 const base=async(path,method='GET',body,cookie,csrf)=>send(env,path,method,body,cookie,csrf)
 const uninit=await base('/api/auth/bootstrap-status')
 assert.equal(uninit.status,200)
 assert.equal(uninit.body.initialized,false)
 const wrong=await base('/api/auth/bootstrap','POST',{loginName:'owner',password:'owner-passphrase-example-123',displayName:'Owner',bootstrapSecret:'wrong'})
 assert.equal(wrong.status,403)
 const created=await base('/api/auth/bootstrap','POST',{loginName:'owner',password:'owner-passphrase-example-123',displayName:'Owner',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(created.status,201,JSON.stringify(created.body))
 const owner=extractCookie(created.cookie)
 assert.match(owner,/__Host-hf_session=/)
 const me=await base('/api/auth/me','GET',undefined,owner)
 assert.equal(me.body.user.role,'owner')
 const anon=await base('/api/tasks')
 assert.equal(anon.status,401)
 const noOrigin=await base('/api/tasks','POST',{title:'x',visibility:'private'},owner,false)
 assert.equal(noOrigin.status,403)
 const made=await base('/api/tasks','POST',{title:'买生日礼物',visibility:'private'},owner)
 assert.equal(made.status,201,JSON.stringify(made.body))
 const sameRequestId='aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee'
 const firstOffline=await base('/api/tasks','POST',{title:'断网新建的任务',visibility:'private',clientRequestId:sameRequestId},owner)
 const replayOffline=await base('/api/tasks','POST',{title:'断网新建的任务',visibility:'private',clientRequestId:sameRequestId},owner)
 assert.equal(firstOffline.status,201)
 assert.equal(replayOffline.status,200)
 assert.equal(replayOffline.body.id,firstOffline.body.id)
 assert.equal(replayOffline.body.replayed,true)
 const tasksBefore=await base('/api/tasks?status=all','GET',undefined,owner)
 assert.equal(tasksBefore.body.tasks.filter(x=>x.title==='断网新建的任务').length,1)
 const staleEdit=await base('/api/tasks/'+firstOffline.body.id,'PATCH',
   {title:'不应该保存的覆盖',notes:'',visibility:'private',expectedUpdatedAt:'2020-01-01T00:00:00Z'},owner)
 assert.equal(staleEdit.status,409)
 const privateId=made.body.id
 const shared=await base('/api/tasks','POST',{title:'照顾豆沙',visibility:'household'},owner)
 assert.equal(shared.status,201,JSON.stringify(shared.body))
 const invite=await base('/api/auth/invitations','POST',{},owner)
 assert.equal(invite.status,201)
 const joined=await base('/api/auth/join','POST',{loginName:'partner',password:'partner-passphrase-example-123',displayName:'Partner',invitationCode:invite.body.invitationCode})
 assert.equal(joined.status,201,JSON.stringify(joined.body))
 const partner=extractCookie(joined.cookie)
 const usedAgain=await base('/api/auth/join','POST',{loginName:'attacker',password:'attacker-passphrase-example-123',displayName:'Attacker',invitationCode:invite.body.invitationCode})
 assert.equal(usedAgain.status,409)
 const partnerList=await base('/api/tasks','GET',undefined,partner)
 assert.equal(partnerList.status,200,JSON.stringify(partnerList.body))
 assert.equal(partnerList.body.tasks.some(t=>t.id===privateId),false)
 assert.equal(partnerList.body.tasks.some(t=>t.id===shared.body.id),true)
 const attack=await base('/api/tasks/'+privateId,'PATCH',{completed:true},partner)
 assert.equal(attack.status,404)
 const okShared=await base('/api/tasks/'+shared.body.id,'PATCH',{completed:true},partner)
 assert.equal(okShared.status,200)
 const ownerCanSee=await base('/api/tasks?status=done','GET',undefined,owner)
 assert.equal(typeof ownerCanSee.body.tasks.find(x=>x.id===shared.body.id)?.completedBy,'string')
 // A shared wish can become a trip without modifying the ledger.
 const wish=await base('/api/wishes','POST',{title:'北海道旅行',wishType:'trip',estimatedAmount:200000,currency:'JPY',visibility:'household'},owner)
 assert.equal(wish.status,201,JSON.stringify(wish.body))
 const converted=await base('/api/wishes/'+wish.body.id+'/start-trip','POST',{title:'北海道旅行',destination:'北海道'},owner)
 assert.equal(converted.status,201,JSON.stringify(converted.body))
 const source=JSON.parse(readFileSync(new URL('../examples/hokkaido-trip-v1.json',import.meta.url),'utf8'))
 source.trip.tasks.push({externalId:'shared-pack-check',title:'共同行李核对',dueDate:'2027-01-16',assignee:'adult-a',visibility:'household'})
 const imported=await base('/api/trips/import','POST',{payload:source,targetTripId:converted.body.id,confirmReplace:true},owner)
 assert.equal(imported.status,200,JSON.stringify(imported.body))
 const ownView=await base('/api/trips/'+converted.body.id,'GET',undefined,owner)
 assert.equal(ownView.body.trip.plan.trip.tasks.length,2)
 const partnerView=await base('/api/trips/'+converted.body.id,'GET',undefined,partner)
 assert.equal(partnerView.status,200)
 assert.equal(partnerView.body.trip.plan.trip.tasks.length,1)
 assert.equal(partnerView.body.trip.plan.trip.tasks[0].externalId,'shared-pack-check')
 const privateProgress=await base('/api/trips/'+converted.body.id+'/progress','POST',{itemId:'check-tickets',completed:true},partner)
 assert.equal(privateProgress.status,404)
 const sharedProgress=await base('/api/trips/'+converted.body.id+'/progress','POST',{itemId:'shared-pack-check',completed:true},partner)
 assert.equal(sharedProgress.status,200)
 const privateReminders=await base('/api/reminders?date=2027-01-15','GET',undefined,partner)
 assert.equal(privateReminders.status,200)
 assert.equal(privateReminders.body.items.some(x=>x.title.includes('检查交通')),false)
 const sameImport=await base('/api/trips/import','POST',{payload:source,targetTripId:converted.body.id},owner)
 assert.equal(sameImport.body.unchanged,true)
 const afterProgress=await base('/api/trips/'+converted.body.id,'GET',undefined,partner)
 assert.equal(afterProgress.body.progress.some(x=>x.itemId==='shared-pack-check'&&x.completedAt),true)
 const tripList=await base('/api/trips','GET',undefined,partner)
 assert.equal(tripList.status,200)
 assert.equal(tripList.body.items.length,1)
 // Prevent other member from editing creator's trip.
 const denied=await base('/api/trips/'+converted.body.id,'PATCH',{status:'completed'},partner)
 assert.equal(denied.status,403)
 // Personal anniversary cannot be viewed by partner.
 const anniv=await base('/api/anniversaries','POST',{title:'我的私人日子',eventDate:'2026-11-05',repeatMode:'yearly',visibility:'private'},owner)
 assert.equal(anniv.status,201)
 const annivPartner=await base('/api/anniversaries','GET',undefined,partner)
 assert.equal(annivPartner.body.items.length,0)
 // Shared memory and private photo access boundary
 const memory=await base('/api/memories','POST',{title:'一段回忆',happenedOn:'2026-11-04',visibility:'private'},owner)
 assert.equal(memory.status,201)
 const pet=await base('/api/family/profiles','POST',{displayName:'豆沙',type:'pet',birthday:'2022-05-01'},owner)
 assert.equal(pet.status,201,JSON.stringify(pet.body))
 const health=await base('/api/pets/'+pet.body.id+'/health','POST',{
   recordType:'deworm',eventOn:'2026-11-04',nextDueOn:'2027-02-04',note:'example only',
   visibility:'household'},owner)
 assert.equal(health.status,201,JSON.stringify(health.body))
 const healthList=await base('/api/pets/'+pet.body.id+'/health','GET',undefined,partner)
 assert.equal(healthList.status,200)
 assert.equal(healthList.body.records.length,1)
 const privateHealth=await base('/api/pets/'+pet.body.id+'/health','POST',{
   recordType:'weight',eventOn:'2026-11-04',weightGrams:5500,visibility:'private'},owner)
 assert.equal(privateHealth.status,201)
 const privateHealthList=await base('/api/pets/'+pet.body.id+'/health','GET',undefined,partner)
 assert.equal(privateHealthList.body.records.length,1)
 const partnerMemory=await base('/api/memories','GET',undefined,partner)
 assert.equal(partnerMemory.body.items.length,0)
 const exportPartner=await base('/api/export','GET',undefined,partner)
 assert.equal(exportPartner.status,200)
 assert.equal(exportPartner.body.records.memories.length,0)
 const portableExport=await base('/api/portable','GET',undefined,owner)
 assert.equal(portableExport.status,200,JSON.stringify(portableExport.body))
 assert.equal(portableExport.body.schemaVersion,1)
 const oldMem=portableExport.body.records.memories[0]
 assert.equal(oldMem.title,'一段回忆')
 const previewRestore=await base('/api/portable/restore','POST',
   {dataset:'memories',items:[oldMem],preview:true},owner)
 assert.equal(previewRestore.status,200)
 const repeatedImport=await base('/api/portable/restore','POST',
   {dataset:'memories',items:[oldMem],confirm:true},owner)
 assert.equal(repeatedImport.status,200,JSON.stringify(repeatedImport.body))
 assert.equal(repeatedImport.body.inserted,0)
 const newMemory={...oldMem,id:'00000000-0000-4000-8000-000000000123',title:'恢复后新增的回忆'}
 const freshImport=await base('/api/portable/restore','POST',{dataset:'memories',items:[newMemory],confirm:true},owner)
 assert.equal(freshImport.status,200,JSON.stringify(freshImport.body))
 assert.equal(freshImport.body.inserted,1)
 const secondImport=await base('/api/portable/restore','POST',{dataset:'memories',items:[newMemory],confirm:true},owner)
 assert.equal(secondImport.body.inserted,0)
 const ownerHistory=await base('/api/memories','GET',undefined,owner)
 assert.equal(ownerHistory.body.items.filter(x=>x.id===newMemory.id).length,1)
 // Cloud media is private and cannot be read by the other household login.
 const mediaObjects=new Map()
 env.MEDIA={
   async put(key,bytes){mediaObjects.set(key,Uint8Array.from(bytes))},
   async get(key){const body=mediaObjects.get(key);return body?{body}:null},
   async delete(key){mediaObjects.delete(key)}
 }
 const photoBytes=Uint8Array.from([255,216,255,10,11,12,13,14,15,16,17,18,19,20,255,217])
 const photoReq=new Request(origin+'/api/media/upload?memoryId='+memory.body.id,{
   method:'POST',headers:{cookie:owner,origin,'content-type':'image/jpeg'},body:photoBytes
 })
 const photoResponse=await worker.fetch(photoReq,env)
 assert.equal(photoResponse.status,201,await photoResponse.text().catch(()=>''))
 const metadata=await base('/api/media','GET',undefined,owner)
 assert.equal(metadata.body.items.length,1)
 const mediaId=metadata.body.items[0].id
 const otherResponse=await worker.fetch(req('/api/media/'+mediaId,'GET',undefined,partner),env)
 assert.equal(otherResponse.status,404)
 const ownerResponse=await worker.fetch(req('/api/media/'+mediaId,'GET',undefined,owner),env)
 assert.equal(ownerResponse.status,200)
 assert.deepEqual(new Uint8Array(await ownerResponse.arrayBuffer()),photoBytes)
 const cannotDelete=await worker.fetch(req('/api/media/'+mediaId,'DELETE',undefined,partner),env)
 assert.equal(cannotDelete.status,404)
 const deleted=await worker.fetch(req('/api/media/'+mediaId,'DELETE',undefined,owner),env)
 assert.equal(deleted.status,200)
 const anotherPrivate=await base('/api/portable','GET',undefined,partner)
 assert.equal(anotherPrivate.status,200)
 assert.equal(anotherPrivate.body.records.memories.length,0)
  sqlite.close()
})

// Editing an existing profile must update birthday reminders without creating
// a second family member or writing duplicate anniversary records.
test('family profile edits drive birthday list and reminders, with no duplicate records',async()=>{
 const {db,sqlite}=makeDb()
 const env={APP_ENV:'preview',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:'example-secret-for-test-012345678901234'}
 const ask=(path,method='GET',body,cookie)=>send(env,path,method,body,cookie)
 const registered=await ask('/api/auth/bootstrap','POST',{
   loginName:'owner',password:'a-secure-test-password-123',displayName:'白ちゃん',
   householdName:'我们的家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(registered.status,201,JSON.stringify(registered.body))
 const owner=extractCookie(registered.cookie)
 const family=await ask('/api/family','GET',undefined,owner)
 assert.equal(family.body.profiles.length,1)
 const p=family.body.profiles[0]
 assert.equal(p.type,'person')
 const first=await ask('/api/family/profiles/'+p.id,'PATCH',{
   type:'person',displayName:'白ちゃん',birthday:'1994-11-06',
   relation:'自己',adoptedOn:null,weightGrams:null,notes:''
 },owner)
 assert.equal(first.status,200,JSON.stringify(first.body))
 const list=await ask('/api/anniversaries/upcoming','GET',undefined,owner)
 const birthday=list.body.items.find(e=>e.id==='profile-birthday:'+p.id)
 assert.ok(birthday,JSON.stringify(list.body))
 assert.equal(birthday.title,'白ちゃん的生日')
 assert.equal(birthday.event_date,'1994-11-06')
 assert.equal(birthday.source,'profile_birthday')
 const reminded=await ask('/api/reminders?date=2026-11-05','GET',undefined,owner)
 assert.equal(reminded.body.items.filter(e=>e.id==='profile-birthday:'+p.id).length,1)
 assert.equal(reminded.body.items.find(e=>e.id==='profile-birthday:'+p.id)?.daysBefore,1)
 const updated=await ask('/api/family/profiles/'+p.id,'PATCH',{
   type:'person',displayName:'玉ちゃん',birthday:'1994-11-10',
   relation:'自己',adoptedOn:null,weightGrams:null,notes:''
 },owner)
 assert.equal(updated.status,200)
 const latest=await ask('/api/anniversaries/upcoming','GET',undefined,owner)
 assert.equal(latest.body.items.find(e=>e.id==='profile-birthday:'+p.id)?.title,'玉ちゃん的生日')
 assert.equal(latest.body.items.find(e=>e.id==='profile-birthday:'+p.id)?.event_date,'1994-11-10')
 const oldReminder=await ask('/api/reminders?date=2026-11-05','GET',undefined,owner)
 assert.equal(oldReminder.body.items.some(e=>e.id==='profile-birthday:'+p.id),false)
 const newReminder=await ask('/api/reminders?date=2026-11-09','GET',undefined,owner)
 assert.equal(newReminder.body.items.filter(e=>e.id==='profile-birthday:'+p.id).length,1)
 const all=await ask('/api/family','GET',undefined,owner)
 assert.equal(all.body.profiles.length,1)
 assert.equal(all.body.profiles[0].birthday,'1994-11-10')
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM anniversaries').get().n,0)
 // An explicitly linked birthday anniversary suppresses the synthetic copy.
 const manual=await ask('/api/anniversaries','POST',{
   title:'玉ちゃん生日',eventDate:'1994-11-10',repeatMode:'yearly',
   advanceDays:[30,7,1,0],subjectProfileId:p.id,visibility:'household'
 },owner)
 assert.equal(manual.status,201,JSON.stringify(manual.body))
 const merged=await ask('/api/anniversaries/upcoming','GET',undefined,owner)
 assert.equal(merged.body.items.filter(e=>e.subject_profile_id===p.id).length,1)
 const pet=await ask('/api/family/profiles','POST',{
   type:'pet',displayName:'豆沙',birthday:'2022-05-01',adoptedOn:'2022-06-01'
 },owner)
 assert.equal(pet.status,201)
 const petUpdated=await ask('/api/family/profiles/'+pet.body.id,'PATCH',{
   type:'pet',displayName:'豆沙',birthday:'2022-05-07',adoptedOn:'2022-06-01',
   relation:'',weightGrams:5500,notes:''
 },owner)
 assert.equal(petUpdated.status,200)
 const petList=await ask('/api/anniversaries/upcoming','GET',undefined,owner)
 assert.equal(petList.body.items.find(e=>e.id==='profile-birthday:'+pet.body.id)?.event_date,'2022-05-07')
 sqlite.close()
})

test('reminder snooze is per-user, cross-day and preserved in portable backup',async()=>{
 const {db,sqlite}=makeDb()
 const env={APP_ENV:'preview',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:'example-secret-for-test-012345678901234'}
 const ask=(path,method='GET',body,cookie)=>send(env,path,method,body,cookie)
 const ownerCreated=await ask('/api/auth/bootstrap','POST',{
   loginName:'snooze-owner',password:'another-long-test-password-123',
   displayName:'主人',householdName:'小家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(ownerCreated.status,201)
 const owner=extractCookie(ownerCreated.cookie)
 const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
 const nextDay=new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10)
 const yesterday=new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10)
 const task=await ask('/api/tasks','POST',{
   title:'明天再提醒的测试任务',visibility:'household',
   dueOn:today,notes:'',remindEnabled:true},owner)
 assert.equal(task.status,201,JSON.stringify(task.body))
 const endpoint='/api/reminders?date='
 const initial=await ask(endpoint+today,'GET',undefined,owner)
 assert.equal(initial.status,200,JSON.stringify(initial.body))
 assert.ok(initial.body.items.some(x=>x.kind==='task'&&x.id===task.body.id))
 const snoozed=await ask('/api/reminders/snooze','POST',{
   kind:'task',id:task.body.id,untilOn:today},owner)
 assert.equal(snoozed.status,200,JSON.stringify(snoozed.body))
 const after=await ask(endpoint+today,'GET',undefined,owner)
 assert.equal(after.status,200)
 assert.ok(!after.body.items.some(x=>x.kind==='task'&&x.id===task.body.id))
 const tomorrow=await ask(endpoint+nextDay,'GET',undefined,owner)
 assert.equal(tomorrow.status,200)
 assert.ok(!tomorrow.body.items.some(x=>x.kind==='task'&&x.id===task.body.id),
   'snooze cannot silently postpone a one-time task')
 const duplicate=await ask('/api/reminders/snooze','POST',{
   kind:'task',id:task.body.id,untilOn:today},owner)
 assert.equal(duplicate.status,200)
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM reminder_snoozes').get().n,1)
 const exportResult=await ask('/api/portable','GET',undefined,owner)
 assert.equal(exportResult.status,200,JSON.stringify(exportResult.body))
 const saved=exportResult.body.records.reminderSnoozes
 assert.equal(saved.length,1)
 sqlite.exec('DELETE FROM reminder_snoozes')
 const restore=await ask('/api/portable/restore','POST',{
   dataset:'reminderSnoozes',items:saved,confirm:true},owner)
 assert.equal(restore.status,200,JSON.stringify(restore.body))
 assert.equal(restore.body.inserted,1)
 const repeated=await ask('/api/portable/restore','POST',{
   dataset:'reminderSnoozes',items:saved,confirm:true},owner)
 assert.equal(repeated.status,200)
 assert.equal(repeated.body.inserted,0)
 sqlite.close()
})

test('per-user advance reminder and custom snooze preserve due dates and backup',async()=>{
 const {db,sqlite}=makeDb()
 const env={APP_ENV:'preview',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:'example-secret-for-test-012345678901234'}
 const ask=(path,method='GET',body,cookie)=>send(env,path,method,body,cookie)
 const registered=await ask('/api/auth/bootstrap','POST',{
   loginName:'reminder-ahead-owner',password:'another-long-test-password-123',
   displayName:'主人',householdName:'小家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(registered.status,201)
 const owner=extractCookie(registered.cookie)
 const invite=await ask('/api/auth/invitations','POST',{},owner)
 assert.equal(invite.status,201)
 const registered2=await ask('/api/auth/join','POST',{
   loginName:'reminder-ahead-member',password:'another-long-password-321',displayName:'家人',
   invitationCode:invite.body.invitationCode})
 assert.equal(registered2.status,201)
 const member=extractCookie(registered2.cookie)
 const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
 const plus=n=>new Date(Date.parse(today+'T00:00:00Z')+n*86400000).toISOString().slice(0,10)
 const future=await ask('/api/tasks','POST',{
   title:'三天后任务',dueOn:plus(3),visibility:'household',notes:'',remindEnabled:true},owner)
 assert.equal(future.status,201,JSON.stringify(future.body))
 const path='/api/reminders?date='+today
 const before=await ask(path,'GET',undefined,owner)
 assert.equal(before.status,200)
 assert.equal(before.body.items.some(x=>x.id===future.body.id),false)
 const configure=await ask('/api/reminders/preferences','PUT',{advanceDays:3},owner)
 assert.equal(configure.status,200)
 assert.equal((await ask('/api/reminders/preferences','PUT',{advanceDays:2},owner)).status,400)
 const ownerNow=await ask(path,'GET',undefined,owner)
 assert.equal(ownerNow.status,200,JSON.stringify(ownerNow.body))
 assert.equal(ownerNow.body.advanceDays,3)
 assert.equal(ownerNow.body.items.find(x=>x.id===future.body.id)?.daysBefore,3)
 assert.equal((await ask(path,'GET',undefined,member)).body.items.some(x=>x.id===future.body.id),false)
 const snooze=await ask('/api/reminders/snooze','POST',{
   kind:'task',id:future.body.id,untilOn:plus(2)},owner)
 assert.equal(snooze.status,200)
 const suppressed=await ask(path,'GET',undefined,owner)
 assert.equal(suppressed.body.items.some(x=>x.id===future.body.id),false)
 assert.equal(suppressed.body.snoozed.find(x=>x.id===future.body.id)?.untilOn,plus(2))
 const cancel=await ask('/api/reminders/snooze','DELETE',{kind:'task',id:future.body.id},owner)
 assert.equal(cancel.status,200)
 assert.ok((await ask(path,'GET',undefined,owner)).body.items.some(x=>x.id===future.body.id))
 const backup=await ask('/api/portable','GET',undefined,owner)
 assert.equal(backup.status,200)
 assert.deepEqual(backup.body.records.reminderPreferences,[{advance_days:3,quiet_start_hour:null,quiet_end_hour:null}])
 sqlite.exec('DELETE FROM reminder_preferences')
 const restored=await ask('/api/portable/restore','POST',{
   dataset:'reminderPreferences',items:backup.body.records.reminderPreferences,confirm:true},owner)
 assert.equal(restored.status,200,JSON.stringify(restored.body))
 assert.equal(restored.body.inserted,1)
 assert.equal(sqlite.prepare('SELECT advance_days AS days FROM reminder_preferences').get().days,3)
 assert.equal(sqlite.prepare('SELECT due_on AS dueOn FROM tasks WHERE id=?').get(future.body.id).dueOn,plus(3))
 sqlite.close()
})

test('quiet hours and per-item priority are per account, roundtrip via personal backup',async()=>{
 const {db,sqlite}=makeDb()
 const env={APP_ENV:'preview',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:'test-secret-for-notifications-012345678'}
 const ask=(path,method='GET',body,cookie)=>send(env,path,method,body,cookie)
 const registered=await ask('/api/auth/bootstrap','POST',{
   loginName:'quiet-reminder-owner',password:'another-long-test-password-123',
   displayName:'Owner',householdName:'Home',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(registered.status,201)
 const owner=extractCookie(registered.cookie)
 const invite=await ask('/api/auth/invitations','POST',{},owner)
 assert.equal(invite.status,201)
 const joined=await ask('/api/auth/join','POST',{
   loginName:'quiet-reminder-member',password:'another-long-password-321',
   displayName:'Member',invitationCode:invite.body.invitationCode})
 assert.equal(joined.status,201)
 const member=extractCookie(joined.cookie)
 const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
 const plus=n=>new Date(Date.parse(today+'T00:00:00Z')+n*86400000).toISOString().slice(0,10)
 const shared=await ask('/api/tasks','POST',{title:'计划中的重要任务',dueOn:plus(7),
   visibility:'household',notes:'',remindEnabled:true},owner)
 assert.equal(shared.status,201,JSON.stringify(shared.body))
 const secret=await ask('/api/tasks','POST',{title:'私密提醒',dueOn:plus(7),
   visibility:'private',notes:'',remindEnabled:true},owner)
 assert.equal(secret.status,201)
 const settings=await ask('/api/reminders/preferences','PUT',
   {advanceDays:0,quietStartHour:22,quietEndHour:6},owner)
 assert.equal(settings.status,200,JSON.stringify(settings.body))
 assert.equal((await ask('/api/reminders/preferences','PUT',
   {advanceDays:0,quietStartHour:5,quietEndHour:5},owner)).status,400)
 const beforeEditor=await ask('/api/reminders/item?kind=task&id='+shared.body.id,'GET',undefined,owner)
 assert.equal(beforeEditor.status,200)
 assert.deepEqual(beforeEditor.body,{kind:'task',id:shared.body.id,
   customized:false,defaultDays:0,advanceDays:0,priority:'normal'})
 const add=await ask('/api/reminders/item','PUT',
   {kind:'task',id:shared.body.id,advanceDays:7,priority:'important'},owner)
 assert.equal(add.status,200,JSON.stringify(add.body))
 const savedEditor=await ask('/api/reminders/item?kind=task&id='+shared.body.id,'GET',undefined,owner)
 assert.equal(savedEditor.status,200)
 assert.equal(savedEditor.body.customized,true)
 assert.equal(savedEditor.body.advanceDays,7)
 assert.equal(savedEditor.body.priority,'important')
 const memberEditor=await ask('/api/reminders/item?kind=task&id='+shared.body.id,'GET',undefined,member)
 assert.equal(memberEditor.status,200)
 assert.equal(memberEditor.body.customized,false,'shared task allows independent user settings')
 assert.equal((await ask('/api/reminders/item?kind=task&id='+secret.body.id,'GET',undefined,member)).status,404)
 const forbidden=await ask('/api/reminders/item','PUT',
   {kind:'task',id:secret.body.id,advanceDays:7,priority:'important'},member)
 assert.equal(forbidden.status,404,'other member private task cannot be customized')
 const path='/api/reminders?date='+today
 const result=(await ask(path,'GET',undefined,owner)).body
 assert.equal(result.advanceDays,0)
 assert.deepEqual(result.quietHours,{start:22,end:6})
 const event=result.items.find(x=>x.id===shared.body.id)
 assert.equal(event?.daysBefore,7)
 assert.equal(event?.priority,'important')
 const other=(await ask(path,'GET',undefined,member)).body
 assert.deepEqual(other.quietHours,{start:null,end:null})
 assert.ok(!other.items.some(x=>x.id===shared.body.id),'one owner item preference cannot change member scheduling')
 const archive=await ask('/api/portable','GET',undefined,owner)
 assert.equal(archive.status,200)
 assert.deepEqual(archive.body.records.reminderPreferences,
   [{advance_days:0,quiet_start_hour:22,quiet_end_hour:6}])
 assert.equal(archive.body.records.reminderItemPreferences.length,1)
 sqlite.exec('DELETE FROM reminder_item_preferences')
 sqlite.exec('DELETE FROM reminder_preferences')
 for(const key of ['reminderPreferences','reminderItemPreferences']){
  const restore=await ask('/api/portable/restore','POST',
   {dataset:key,items:archive.body.records[key],confirm:true},owner)
  assert.equal(restore.status,200,JSON.stringify(restore.body))
  assert.equal(restore.body.inserted,1)
 }
 assert.equal((await ask(path,'GET',undefined,owner)).body.items.find(x=>x.id===shared.body.id)?.priority,'important')
 const reset=await ask('/api/reminders/item','DELETE',{kind:'task',id:shared.body.id},owner)
 assert.equal(reset.status,200)
 assert.equal((await ask(path,'GET',undefined,owner)).body.items.some(x=>x.id===shared.body.id),false)
 sqlite.close()
})

test('private wish memories cannot be shared by create or edit, while shared plan links work',async()=>{
 const {db,sqlite}=makeDb()
 const env={APP_ENV:'preview',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:'example-secret-for-test-012345678901234'}
 const ask=(path,method='GET',body,cookie)=>send(env,path,method,body,cookie)
 const created=await ask('/api/auth/bootstrap','POST',{
   loginName:'memory-link-owner',password:'another-long-test-password-123',
   displayName:'主人',householdName:'小家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(created.status,201)
 const owner=extractCookie(created.cookie)
 const wish=(visibility,title)=>ask('/api/wishes','POST',{
   title,wishType:'activity',estimatedAmount:0,currency:'JPY',visibility
 },owner)
 const secret=await wish('private','私人礼物')
 const shared=await wish('household','家庭旅行心愿')
 assert.equal(secret.status,201)
 assert.equal(shared.status,201)
 const memory=(planId,visibility)=>ask('/api/memories','POST',{
   title:'珍贵的一天',story:'值得记住',happenedOn:'2026-11-04',
   linkedType:'wish',linkedId:planId,visibility
 },owner)
 const leak=await memory(secret.body.id,'household')
 assert.equal(leak.status,400,'sharing a private linked plan leaks source metadata')
 const privateMemory=await memory(secret.body.id,'private')
 assert.equal(privateMemory.status,201,JSON.stringify(privateMemory.body))
 const allowed=await memory(shared.body.id,'household')
 assert.equal(allowed.status,201,JSON.stringify(allowed.body))
 const edit=await ask('/api/memories/'+privateMemory.body.id,'PATCH',{
   title:'珍贵的一天',story:'值得记住',happenedOn:'2026-11-04',
   linkedType:'wish',linkedId:secret.body.id,visibility:'household'
 },owner)
 assert.equal(edit.status,400,'editing cannot leak an existing private linked memory')
 const safe=sqlite.prepare('SELECT visibility,linked_type,linked_id FROM memories WHERE id=?')
   .get(privateMemory.body.id)
 assert.equal(safe.visibility,'private')
 assert.equal(safe.linked_type,'wish')
 assert.equal(safe.linked_id,secret.body.id)
 sqlite.close()
})

test('on-demand monthly plan review uses JST bounds and hides the other member private tasks',async()=>{
 const {db,sqlite}=makeDb()
 const env={APP_ENV:'preview',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:'example-secret-for-test-012345678901234'}
 const ask=(path,method='GET',body,cookie)=>send(env,path,method,body,cookie)
 const host=await ask('/api/auth/bootstrap','POST',{
   loginName:'recap-owner',password:'another-long-test-password-123',
   displayName:'主人',householdName:'小家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(host.status,201)
 const owner=extractCookie(host.cookie)
 const invitation=await ask('/api/auth/invitations','POST',{},owner)
 assert.equal(invitation.status,201)
 const second=await ask('/api/auth/join','POST',{
   loginName:'recap-member',password:'another-long-test-password-321',
   displayName:'家人',invitationCode:invitation.body.invitationCode})
 assert.equal(second.status,201)
 const partner=extractCookie(second.cookie)
 const task=(title,visibility,cookie)=>ask('/api/tasks','POST',{
   title,visibility,notes:'',dueOn:'2026-11-01'},cookie)
 const mine=await task('我的私人任务','private',owner)
 const shared=await task('家庭共享任务','household',owner)
 const theirs=await task('另一个账号的私人任务','private',partner)
 const october=await task('十月任务','private',owner)
 for(const x of [mine,shared,theirs,october])assert.equal(x.status,201,JSON.stringify(x.body))
 const completionInNovJst='2026-10-31T15:30:00.000Z'
 for(const x of [mine,shared,theirs])sqlite.prepare(
   'UPDATE tasks SET completed_at=?1 WHERE id=?2').run(completionInNovJst,x.body.id)
 sqlite.prepare('UPDATE tasks SET completed_at=?1 WHERE id=?2')
   .run('2026-10-31T14:59:00.000Z',october.body.id)
 const ownerResult=await ask('/api/plans/summary?month=2026-11','GET',undefined,owner)
 assert.equal(ownerResult.status,200,JSON.stringify(ownerResult.body))
 assert.equal(ownerResult.body.counts.tasks,2)
 assert.equal(ownerResult.body.total,2)
 const partnerResult=await ask('/api/plans/summary?month=2026-11','GET',undefined,partner)
 assert.equal(partnerResult.status,200,JSON.stringify(partnerResult.body))
 assert.equal(partnerResult.body.counts.tasks,2)
 assert.equal(partnerResult.body.total,2)
 assert.equal((await ask('/api/plans/summary?month=2026-13','GET',undefined,owner)).status,400)
 assert.equal((await ask('/api/plans/summary?month=2026-11','POST',{},owner)).status,405)
 sqlite.close()
})

test('one verified receipt completes multiple shopping items without per-item allocation',async()=>{
  const {db,sqlite}=makeDb()
  const {env,amount}=mockedProductionLedger(db,sqlite)
  amount.expenses.push({id:124,date:'2026-11-04',type:'expense',amount:1400,merchant:'第二家店'})
  const ask=(path,method='GET',body,cookie)=>send(env,path,method,body,cookie)
  const registered=await ask('/api/auth/bootstrap','POST',{
    loginName:'shared-receipt-owner',password:'another-long-test-password-123',
    displayName:'主人',householdName:'小家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
  assert.equal(registered.status,201)
  const owner=extractCookie(registered.cookie)
  const firstItem=await ask('/api/shopping','POST',{title:'猫粮',quantity:3,visibility:'household'},owner)
  const secondItem=await ask('/api/shopping','POST',{title:'洗衣液',quantity:1,visibility:'household'},owner)
  assert.equal(firstItem.status,201)
  assert.equal(secondItem.status,201)
  const first='/api/finance/shopping/'+firstItem.body.id
  const second='/api/finance/shopping/'+secondItem.body.id
  // A single receipt completes each independently; item quantity is informational.
  for(const base of [first,second]){
    const linked=await ask(base+'/link','POST',{entryId:123},owner)
    assert.equal(linked.status,200,JSON.stringify(linked.body))
    const links=await ask(base+'/links','GET',undefined,owner)
    assert.equal(links.status,200,JSON.stringify(links.body))
    assert.equal(links.body.items.length,1)
    assert.equal(links.body.completed,true)
  }
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM shopping_expense_links WHERE external_entry_id=?')
    .get('123').n,2,'one receipt is independently associated with two shopping items')
  const firstDone=sqlite.prepare('SELECT completed_at FROM shopping_items WHERE id=?')
    .get(firstItem.body.id).completed_at
  assert.ok(firstDone)
  assert.ok(sqlite.prepare('SELECT completed_at FROM shopping_items WHERE id=?')
    .get(secondItem.body.id).completed_at)
  assert.equal((await ask(first+'/link','POST',{entryId:123},owner)).status,200)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM shopping_expense_links WHERE shopping_id=?')
    .get(firstItem.body.id).n,1,'relinking the same receipt is idempotent')
  // Removing one of multiple receipts must not reopen the item; removing the last does.
  assert.equal((await ask(first+'/link','POST',{entryId:124},owner)).status,200)
  assert.equal((await ask(first+'/link','DELETE',{entryId:123},owner)).status,200)
  assert.equal(sqlite.prepare('SELECT completed_at FROM shopping_items WHERE id=?')
    .get(firstItem.body.id).completed_at,firstDone)
  assert.equal((await ask(first+'/link','DELETE',{entryId:124},owner)).status,200)
  assert.equal(sqlite.prepare('SELECT completed_at FROM shopping_items WHERE id=?')
    .get(firstItem.body.id).completed_at,null)
  assert.ok(sqlite.prepare('SELECT completed_at FROM shopping_items WHERE id=?')
    .get(secondItem.body.id).completed_at,'other items sharing the receipt stay completed')
  const saved=(await ask('/api/portable','GET',undefined,owner)).body.records.shoppingExpenseLinks
  assert.equal(saved.length,1)
  assert.equal(saved[0].purchase_quantity,null,'legacy quantity data stays nullable')
  sqlite.close()
})

test('shopping supports two verified receipts, partial unlink, and source deletion review',async()=>{
 const {db,sqlite}=makeDb()
 const {env,amount}=mockedProductionLedger(db,sqlite)
 amount.expenses.push({id:124,date:'2026-11-04',type:'expense',amount:1400,merchant:'第二次购买'})
 const ask=(path,method='GET',body,cookie)=>send(env,path,method,body,cookie)
 const registered=await ask('/api/auth/bootstrap','POST',{
   loginName:'multi-shopping-owner',password:'another-long-test-password-123',
   displayName:'主人',householdName:'小家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(registered.status,201)
 const owner=extractCookie(registered.cookie)
 const item=await ask('/api/shopping','POST',{title:'分两次购买',quantity:2,visibility:'household'},owner)
 assert.equal(item.status,201)
 const link='/api/finance/shopping/'+item.body.id+'/link'
 const list='/api/finance/shopping/'+item.body.id+'/links'
 for(const entryId of [123,124]){
   const connected=await ask(link,'POST',{entryId},owner)
   assert.equal(connected.status,200,JSON.stringify(connected.body))
 }
 const linked=await ask(list,'GET',undefined,owner)
 assert.equal(linked.status,200,JSON.stringify(linked.body))
 assert.equal(linked.body.items.length,2)
 assert.equal(linked.body.linkedAmount,4900)
 assert.equal(linked.body.needsReview,false)
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM shopping_expense_links').get().n,2)
 const repeated=await ask(link,'POST',{entryId:123},owner)
 assert.equal(repeated.status,200)
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM shopping_expense_links').get().n,2)
 const snapshot=await ask('/api/portable','GET',undefined,owner)
 assert.equal(snapshot.status,200,JSON.stringify(snapshot.body))
 assert.equal(snapshot.body.records.shoppingExpenseLinks.length,2)
 const part=await ask(link,'DELETE',{entryId:123},owner)
 assert.equal(part.status,200)
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM shopping_expense_links').get().n,1)
 assert.ok(sqlite.prepare('SELECT completed_at AS done FROM shopping_items WHERE id=?').get(item.body.id).done)
 amount.expenses.pop()
 const review=await ask(list,'GET',undefined,owner)
 assert.equal(review.status,200)
 assert.equal(review.body.needsReview,true)
 assert.equal(review.body.linkedAmount,0,'unavailable or refunded source is not counted as live expense')
 const clear=await ask(link,'DELETE',undefined,owner)
 assert.equal(clear.status,200)
 const status=sqlite.prepare('SELECT ledger_entry_id AS entry,completed_at AS done FROM shopping_items WHERE id=?').get(item.body.id)
 assert.equal(status.entry,null)
 assert.equal(status.done,null)
 sqlite.close()
})

test('dated shopping, wishes and savings goals require explicit postpone',async()=>{
 const {db,sqlite}=makeDb()
 const {env,amount}=mockedProductionLedger(db,sqlite)
 const ask=(path,method='GET',body,cookie)=>send(env,path,method,body,cookie)
 const ownerRegistered=await ask('/api/auth/bootstrap','POST',{
   loginName:'followup-owner',password:'another-long-test-password-123',
   displayName:'主人',householdName:'小家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(ownerRegistered.status,201)
 const owner=extractCookie(ownerRegistered.cookie)
 const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
 const plus=(d,n)=>new Date(Date.parse(d+'T00:00:00Z')+n*86400000).toISOString().slice(0,10)
 const yesterday=plus(today,-1),tomorrow=plus(today,1)
 const previousMonth=new Date(Date.parse(today+'T00:00:00Z'))
 previousMonth.setUTCDate(1);previousMonth.setUTCMonth(previousMonth.getUTCMonth()-1)
 const lastMonthKey=previousMonth.toISOString().slice(0,7)
 const shopping=await ask('/api/shopping','POST',{
   title:'计划购物未购买',quantity:1,dueOn:yesterday,visibility:'household'},owner)
 const wish=await ask('/api/wishes','POST',{
   title:'没有实现的心愿',wishType:'purchase',estimatedAmount:0,
   targetOn:yesterday,currency:'JPY',visibility:'household'},owner)
 const saving=await ask('/api/goals','POST',{
   title:'本月储值',targetAmount:5000,reservedAmount:0,
   goalMode:'monthly',startOn:lastMonthKey+'-01',currency:'JPY',visibility:'household'},owner)
 const once=await ask('/api/goals','POST',{
   title:'一次性储值',targetAmount:10000,reservedAmount:0,
   goalMode:'once',startOn:yesterday,targetOn:yesterday,currency:'JPY',visibility:'household'},owner)
 const trip=await ask('/api/trips','POST',{
   title:'未收尾旅行',destination:'大阪',startDate:yesterday,endDate:yesterday,
   budgetAmount:3000,visibility:'household'},owner)
 for(const created of [shopping,wish,saving,once,trip])assert.equal(created.status,201,JSON.stringify(created.body))
 let rows=(await ask('/api/plans/today?date='+today,'GET',undefined,owner)).body.items
 const get=(kind,id)=>rows.find(x=>x.kind===kind&&x.id===id)
 assert.equal(get('shopping',shopping.body.id),undefined)
 assert.equal(get('wish',wish.body.id),undefined)
 assert.equal(get('goal',once.body.id),undefined)
 assert.equal(get('goal',saving.body.id),undefined,'closed recurring period is not an overdue Today task')
 const reviews=(await ask('/api/plans/today?date='+today,'GET',undefined,owner)).body.goalReviews
 assert.equal(reviews.find(x=>x.id===saving.body.id).periodKey,lastMonthKey)
 assert.equal(get('trip',trip.body.id),undefined)
 assert.equal((await ask('/api/plans/complete','POST',
   {kind:'goal',id:saving.body.id,periodKey:today.slice(0,7),completed:true},owner)).status,409,
   'current monthly goal must not complete before the end of its period')

 const wishDone=await ask('/api/plans/complete','POST',{kind:'wish',id:wish.body.id,completed:true},owner)
 assert.equal(wishDone.status,200,JSON.stringify(wishDone.body))
 amount.net=0
 const notFunded=await ask('/api/plans/complete','POST',{
   kind:'goal',id:saving.body.id,periodKey:lastMonthKey,completed:true},owner)
 assert.equal(notFunded.status,200,'an insufficient period is a valid settled shortfall')
 assert.equal(notFunded.body.status,'shortfall')
 assert.ok(notFunded.body.differenceAmount>0)
 amount.net=20000
 const saved=await ask('/api/plans/complete','POST',{
   kind:'goal',id:saving.body.id,periodKey:lastMonthKey,completed:true},owner)
 assert.equal(saved.status,200,JSON.stringify(saved.body))
 const onceDone=await ask('/api/plans/complete','POST',{
   kind:'goal',id:once.body.id,completed:true},owner)
 assert.equal(onceDone.status,200,JSON.stringify(onceDone.body))
 const invalidBuy=await ask('/api/shopping/'+shopping.body.id+'/toggle','POST',{completed:true},owner)
 assert.equal(invalidBuy.status,409)
 assert.equal(invalidBuy.body.error,'link_ledger_to_complete')
 const bought=await ask('/api/finance/shopping/'+shopping.body.id+'/link','POST',{entryId:123},owner)
 assert.equal(bought.status,200,JSON.stringify(bought.body))
 rows=(await ask('/api/plans/today?date='+today,'GET',undefined,owner)).body.items
 assert.equal(get('wish',wish.body.id).done,true)
 assert.equal(get('goal',saving.body.id),undefined,'settled recurring goals stay in history')
 const settled=(await ask('/api/goals/'+saving.body.id+'/periods?limit=5','GET',undefined,owner)).body
 assert.equal(settled.items.find(x=>x.periodKey===lastMonthKey).status,'met')
 assert.equal(get('goal',once.body.id).done,true)
 assert.equal(get('shopping',shopping.body.id).done,true)
 assert.equal(sqlite.prepare("SELECT COUNT(*) AS n FROM plan_completion_marks").get().n,3)
 rows=(await ask('/api/plans/today?date='+tomorrow,'GET',undefined,owner)).body.items
 assert.equal(get('wish',wish.body.id),undefined,'wish disappears on next JST day')
 assert.equal(get('goal',once.body.id),undefined,'one-time saving disappears after completion')
 assert.equal(get('shopping',shopping.body.id),undefined,'purchased item disappears next day')
 assert.equal(get('trip',trip.body.id),undefined,'an unfinished trip does not automatically carry over')
 const undoWish=await ask('/api/plans/complete','POST',{kind:'wish',id:wish.body.id,completed:false},owner)
 assert.equal(undoWish.status,200)
 const undoGoal=await ask('/api/plans/complete','POST',{
   kind:'goal',id:saving.body.id,periodKey:lastMonthKey,completed:false},owner)
 assert.equal(undoGoal.status,409,'historic settlement is rechecked, not manually unchecked')
 rows=(await ask('/api/plans/today?date='+tomorrow,'GET',undefined,owner)).body.items
 assert.equal(get('wish',wish.body.id),undefined,'undo never schedules another due day')
 assert.equal(get('goal',saving.body.id),undefined,'settled periods never re-enter Today')
 assert.equal(sqlite.prepare("SELECT status FROM wishes WHERE id=?").get(wish.body.id).status,'wished')
 sqlite.close()
})

test('finished savings goals archive and expired unfinished trips stay active',async()=>{
 const {db,sqlite}=makeDb()
 const {env}=mockedProductionLedger(db,sqlite)
 const ask=(path,method='GET',body,cookie)=>send(env,path,method,body,cookie)
 const user=await ask('/api/auth/bootstrap','POST',{
   loginName:'archive-owner',password:'another-long-test-password-123',
   displayName:'主人',householdName:'小家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(user.status,201)
 const owner=extractCookie(user.cookie)
 const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
 const yesterday=new Date(Date.parse(today+'T00:00:00Z')-86400000).toISOString().slice(0,10)
 const goal=await ask('/api/goals','POST',{
   title:'已储值目标',goalMode:'once',targetAmount:10000,
   reservedAmount:0,startOn:yesterday,targetOn:yesterday,currency:'JPY',
   visibility:'household'},owner)
 const trip=await ask('/api/trips','POST',{
   title:'旅行待收尾',destination:'大阪',startDate:yesterday,endDate:yesterday,
   budgetAmount:1000,visibility:'household'},owner)
 assert.equal(goal.status,201)
 assert.equal(trip.status,201)
 const before=(await ask('/api/goals?scope=active&limit=5','GET',undefined,owner)).body.items
 assert.ok(before.some(x=>x.id===goal.body.id))
 const marked=await ask('/api/plans/complete','POST',{
   kind:'goal',id:goal.body.id,completed:true},owner)
 assert.equal(marked.status,200)
 const active=(await ask('/api/goals?scope=active&limit=5','GET',undefined,owner)).body.items
 const history=(await ask('/api/goals?scope=history&limit=5','GET',undefined,owner)).body.items
 assert.ok(!active.some(x=>x.id===goal.body.id),'confirmed goal is no longer active')
 assert.ok(history.some(x=>x.id===goal.body.id),'confirmed goal appears in history')
 const tripsActive=(await ask('/api/trips?scope=active&limit=5','GET',undefined,owner)).body.items
 const tripsHistory=(await ask('/api/trips?scope=history&limit=5','GET',undefined,owner)).body.items
 assert.ok(tripsActive.some(x=>x.id===trip.body.id),'incomplete trip remains editable')
 assert.ok(!tripsHistory.some(x=>x.id===trip.body.id),'end date alone does not imply completion')
 const undone=await ask('/api/plans/complete','POST',{
   kind:'goal',id:goal.body.id,completed:false},owner)
 assert.equal(undone.status,200)
 const reopened=(await ask('/api/goals?scope=active&limit=5','GET',undefined,owner)).body.items
 assert.ok(reopened.some(x=>x.id===goal.body.id),'undo returns goal to active plans')
 sqlite.close()
})

test('undated and early-achieved plans complete safely and portable backup restores period marks',async()=>{
 const {db,sqlite}=makeDb()
 const {env}=mockedProductionLedger(db,sqlite)
 const ask=(path,method='GET',body,cookie)=>send(env,path,method,body,cookie)
 const registered=await ask('/api/auth/bootstrap','POST',{
   loginName:'undated-backup-owner',password:'another-long-test-password-123',
   displayName:'主人',householdName:'小家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(registered.status,201)
 const owner=extractCookie(registered.cookie)
 const today=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
 const tomorrow=new Date(Date.parse(today+'T00:00:00Z')+86400000).toISOString().slice(0,10)
 const wish=await ask('/api/wishes','POST',{
   title:'未设置目标日期的心愿',wishType:'other',estimatedAmount:0,
   targetOn:null,currency:'JPY',visibility:'household'},owner)
 const earlyWish=await ask('/api/wishes','POST',{
   title:'提前实现的心愿',wishType:'activity',estimatedAmount:0,
   targetOn:tomorrow,currency:'JPY',visibility:'household'},owner)
 const once=await ask('/api/goals','POST',{
   title:'没有结束日期的结余目标',targetAmount:10000,reservedAmount:0,
   goalMode:'once',startOn:today,targetOn:null,currency:'JPY',visibility:'household'},owner)
 for(const created of [wish,earlyWish,once])assert.equal(created.status,201,JSON.stringify(created.body))
 for(const id of [wish.body.id,earlyWish.body.id]){
   const done=await ask('/api/plans/complete','POST',{kind:'wish',id,completed:true},owner)
   assert.equal(done.status,200,JSON.stringify(done.body))
 }
 const funded=await ask('/api/plans/complete','POST',{kind:'goal',id:once.body.id,completed:true},owner)
 assert.equal(funded.status,200,JSON.stringify(funded.body))
 const exported=await ask('/api/portable','GET',undefined,owner)
 assert.equal(exported.status,200,JSON.stringify(exported.body))
 const marks=exported.body.records.planCompletionMarks
 assert.equal(marks.length,3,'every wish and one-time goal completion is portable')
 assert.ok(marks.every(x=>!('completed_by' in x)),'a backup never embeds another member completion identity')
 const preview=await ask('/api/portable/restore','POST',{dataset:'planCompletionMarks',items:marks,preview:true},owner)
 assert.equal(preview.status,200,JSON.stringify(preview.body))
 sqlite.exec('DELETE FROM plan_completion_marks')
 const restored=await ask('/api/portable/restore','POST',{dataset:'planCompletionMarks',items:marks,confirm:true},owner)
 assert.equal(restored.status,200,JSON.stringify(restored.body))
 assert.equal(restored.body.inserted,3)
 const again=await ask('/api/portable/restore','POST',{dataset:'planCompletionMarks',items:marks,confirm:true},owner)
 assert.equal(again.status,200)
 assert.equal(again.body.inserted,0,'restores are idempotent')
 const undo=await ask('/api/plans/complete','POST',{kind:'wish',id:wish.body.id,completed:false},owner)
 assert.equal(undo.status,200)
 assert.equal(sqlite.prepare('SELECT status FROM wishes WHERE id=?').get(wish.body.id).status,'wished',
   'prior status survives ZIP restoration and permits undo')
 sqlite.close()
})

test('linked wish and savings cannot be completed without verified funding; outages fail closed',async()=>{
 const {db,sqlite}=makeDb()
 const {env,amount}=mockedProductionLedger(db,sqlite)
 const ask=(path,method='GET',body,cookie)=>send(env,path,method,body,cookie)
 const registered=await ask('/api/auth/bootstrap','POST',{
   loginName:'linked-savings-owner',password:'another-long-test-password-123',
   displayName:'主人',householdName:'小家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(registered.status,201)
 const owner=extractCookie(registered.cookie)
 const yesterday=new Date(Date.now()+9*3600000-86400000).toISOString().slice(0,10)
 const created=await ask('/api/wishes','POST',{
   title:'想买电脑',visibility:'household',wishType:'purchase',estimatedAmount:100000,
   currency:'JPY',targetOn:yesterday,createSavingsGoal:true,
   goalTargetOn:yesterday,goalStartOn:yesterday},owner)
 assert.equal(created.status,201,JSON.stringify(created.body))
 const goalId=created.body.goalId
 amount.net=90000
 const bypass=await ask('/api/wishes/'+created.body.id,'PATCH',{
   title:'想买电脑',visibility:'household',wishType:'purchase',estimatedAmount:100000,
   currency:'JPY',targetOn:yesterday,status:'completed'},owner)
 assert.equal(bypass.status,409,'editing status must not bypass savings verification')
 const wished=await ask('/api/plans/complete','POST',{
   kind:'wish',id:created.body.id,completed:true},owner)
 assert.equal(wished.status,409)
 assert.equal(wished.body.error,'goal_not_funded')
 assert.equal(sqlite.prepare("SELECT status FROM wishes WHERE id=?").get(created.body.id).status,'wished')
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM plan_completion_marks').get().n,0)
 const short=await ask('/api/plans/complete','POST',{
   kind:'goal',id:goalId,completed:true},owner)
 assert.equal(short.status,409,'explicit goal completion also checks balance')

 const originalService=env.KAKEBO_LEDGER_SERVICE
 delete env.KAKEBO_LEDGER_SERVICE
 const offline=await ask('/api/plans/complete','POST',{
   kind:'wish',id:created.body.id,completed:true},owner)
 assert.equal(offline.status,503,'outage cannot cause a false completed mark')
 env.KAKEBO_LEDGER_SERVICE=originalService
 amount.net=120000
 const goalDone=await ask('/api/plans/complete','POST',{kind:'goal',id:goalId,completed:true},owner)
 assert.equal(goalDone.status,200,JSON.stringify(goalDone.body))
 const wishDone=await ask('/api/plans/complete','POST',{kind:'wish',id:created.body.id,completed:true},owner)
 assert.equal(wishDone.status,200,JSON.stringify(wishDone.body))
 assert.equal(sqlite.prepare("SELECT status FROM wishes WHERE id=?").get(created.body.id).status,'completed')
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM plan_completion_marks').get().n,2)
 sqlite.close()
})

test('direct plan detail fetches a record beyond five pages without broadening visibility',async()=>{
 const {db,sqlite}=makeDb()
 const env={APP_ENV:'preview',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:'example-secret-for-test-012345678901234'}
 const ask=(path,method='GET',body,cookie)=>send(env,path,method,body,cookie)
 const ownerCreated=await ask('/api/auth/bootstrap','POST',{
   loginName:'plan-focus-owner',password:'another-long-test-password-123',
   displayName:'主人',householdName:'小家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(ownerCreated.status,201)
 const owner=extractCookie(ownerCreated.cookie)
 const ids=[]
 for(let i=0;i<8;i++){
   const created=await ask('/api/shopping','POST',{
     title:'购物计划 '+i,quantity:1,dueOn:'2026-11-04',visibility:'household'},owner)
   assert.equal(created.status,201,JSON.stringify(created.body))
   ids.push(created.body.id)
 }
 const page=await ask('/api/shopping?scope=active&limit=5','GET',undefined,owner)
 assert.equal(page.status,200)
 assert.equal(page.body.items.length,5)
 const hiddenId=ids.find(id=>!page.body.items.some(x=>x.id===id))
 assert.ok(hiddenId,'at least three plans must be outside the first five')
 const focus=await ask('/api/shopping/'+hiddenId,'GET',undefined,owner)
 assert.equal(focus.status,200)
 assert.equal(focus.body.item.id,hiddenId)
 assert.equal(focus.body.item.title,'购物计划 '+ids.indexOf(hiddenId))
 const stranger=await ask('/api/shopping/00000000-0000-4000-8000-000000000999','GET',undefined,owner)
 assert.equal(stranger.status,404)
 const invalid=await ask('/api/shopping/not-a-valid-id','GET',undefined,owner)
 assert.equal(invalid.status,400)
 const wish=await ask('/api/wishes','POST',{
   title:'关联储值的心愿',wishType:'purchase',visibility:'household',
   estimatedAmount:10000,currency:'JPY',targetOn:'2026-11-04',createSavingsGoal:true},owner)
 assert.equal(wish.status,201)
 const linked=await ask('/api/wishes/'+wish.body.id,'GET',undefined,owner)
 assert.equal(linked.status,200)
 assert.equal(linked.body.item.id,wish.body.id)
 assert.equal(linked.body.linkedGoals[0].id,wish.body.goalId)
 const goal=await ask('/api/goals/'+wish.body.goalId,'GET',undefined,owner)
 assert.equal(goal.status,200)
 assert.deepEqual(goal.body.completedPeriods,[])
 sqlite.close()
})

test('completion-anchored interval stays checked on its due date and recurs normally',async()=>{
 const {db,sqlite}=makeDb()
 const env={APP_ENV:'preview',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:'example-secret-for-test-012345678901234'}
 const ask=(path,method='GET',body,cookie)=>send(env,path,method,body,cookie)
 const ownerRegistered=await ask('/api/auth/bootstrap','POST',{
   loginName:'routine-owner',password:'another-long-test-password-123',
   displayName:'主人',householdName:'小家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(ownerRegistered.status,201,JSON.stringify(ownerRegistered.body))
 const owner=extractCookie(ownerRegistered.cookie)
 const created=await ask('/api/routines','POST',{
   title:'给豆沙换水',repeatType:'interval',
   repeatConfig:{days:3,anchor:'completion'},anchorDate:'2026-11-04',visibility:'household'
 },owner)
 assert.equal(created.status,201,JSON.stringify(created.body))
 const baseline=await ask('/api/routines/today?date=2026-11-04','GET',undefined,owner)
 assert.equal(baseline.body.items.some(x=>x.id===created.body.id),false,
   'starting date is a baseline, not the first due occurrence')
 const first=await ask('/api/routines/today?date=2026-11-07','GET',undefined,owner)
 assert.equal(first.body.items.filter(x=>x.id===created.body.id).length,1)
 const mark=await ask('/api/routines/'+created.body.id+'/mark','POST',{
   date:'2026-11-07',status:'completed'},owner)
 assert.equal(mark.status,200,JSON.stringify(mark.body))
 const today=await ask('/api/routines/today?date=2026-11-07','GET',undefined,owner)
 assert.equal(today.body.items.filter(x=>x.id===created.body.id).length,1,
   'completed row stays visible today for the checked strikethrough')
 assert.ok(today.body.items.find(x=>x.id===created.body.id).mark.completed_at)
 const tomorrow=await ask('/api/routines/today?date=2026-11-08','GET',undefined,owner)
 assert.equal(tomorrow.body.items.some(x=>x.id===created.body.id),false)
 const next=await ask('/api/routines/today?date=2026-11-10','GET',undefined,owner)
 assert.equal(next.body.items.some(x=>x.id===created.body.id),true)
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM routines').get().n,1,
   'completing a routine does not delete or duplicate it')
 sqlite.close()
})

test('future interval can be completed early in Plans and undone without duplicating care history',async()=>{
 const {db,sqlite}=makeDb()
 const env={APP_ENV:'preview',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:'example-secret-for-test-012345678901234'}
 const ask=(path,method='GET',body,cookie)=>send(env,path,method,body,cookie)
 const registration=await ask('/api/auth/bootstrap','POST',{
   loginName:'early-owner',password:'another-long-test-password-123',
   displayName:'主人',householdName:'小家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(registration.status,201)
 const owner=extractCookie(registration.cookie)
 const tokyoToday=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
 const plus=(date,days)=>new Date(Date.parse(date+'T00:00:00Z')+days*86400000).toISOString().slice(0,10)
 const anchor=plus(tokyoToday,-5)
 const pet=await ask('/api/family/profiles','POST',{
   type:'pet',displayName:'豆沙',birthday:'2022-05-02',adoptedOn:anchor
 },owner)
 assert.equal(pet.status,201)
 const created=await ask('/api/routines','POST',{
   title:'豆沙内驱',repeatType:'interval',repeatConfig:{days:90,anchor:'completion'},
   anchorDate:anchor,subjectProfileId:pet.body.id,healthRecordType:'deworm',visibility:'household'
 },owner)
 assert.equal(created.status,201)
 const before=await ask('/api/routines/today?date='+tokyoToday,'GET',undefined,owner)
 assert.equal(before.body.items.some(x=>x.id===created.body.id),false)
 const notAllowed=await ask('/api/routines/'+created.body.id+'/mark','POST',{
   date:tokyoToday,status:'completed'},owner)
 assert.equal(notAllowed.status,409,'ordinary completion cannot bypass its scheduled period')
 const marked=await ask('/api/routines/'+created.body.id+'/mark','POST',{
   date:tokyoToday,status:'completed',early:true},owner)
 assert.equal(marked.status,200,JSON.stringify(marked.body))
 const stored=sqlite.prepare('SELECT next_due_on FROM routines WHERE id=?').get(created.body.id)
 assert.equal(stored.next_due_on,plus(tokyoToday,90))
 const current=await ask('/api/routines/today?date='+tokyoToday,'GET',undefined,owner)
 assert.equal(current.body.items.some(x=>x.id===created.body.id),false, 'early-completed future periods do not enter Today')
 const nextDay=await ask('/api/routines/today?date='+plus(tokyoToday,1),'GET',undefined,owner)
 assert.equal(nextDay.body.items.some(x=>x.id===created.body.id),false)
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM pet_health_records WHERE profile_id=? AND deleted_at IS NULL').get(pet.body.id).n,1)
 const archived=await ask('/api/routines/period-history?scope=history&limit=5','GET',undefined,owner)
 assert.equal(archived.status,200,JSON.stringify(archived.body))
 assert.equal(archived.body.items.find(x=>x.id===created.body.id)?.status,'completed')
 const undo=await ask('/api/routines/'+created.body.id+'/mark','POST',{
   date:tokyoToday,periodOn:plus(anchor,90),status:'open'},owner)
 assert.equal(undo.status,200,JSON.stringify(undo.body))
 assert.equal(sqlite.prepare('SELECT next_due_on FROM routines WHERE id=?').get(created.body.id).next_due_on,plus(anchor,90))
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM pet_health_records WHERE profile_id=? AND deleted_at IS NULL').get(pet.body.id).n,0)
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM routines').get().n,1)
 sqlite.close()
})

test('missed weekly and monthly occurrences expire; later cycles are independent',async()=>{
 const {db,sqlite}=makeDb()
 const env={APP_ENV:'preview',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:'example-secret-for-test-012345678901234'}
 const ask=(path,method='GET',body,cookie)=>send(env,path,method,body,cookie)
 const registration=await ask('/api/auth/bootstrap','POST',{
   loginName:'rollover-owner',password:'another-long-password-1234',
   displayName:'主人',householdName:'小家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(registration.status,201,JSON.stringify(registration.body))
 const owner=extractCookie(registration.cookie)
 const weekly=await ask('/api/routines','POST',{
   title:'周一整理',repeatType:'weekly',repeatConfig:{weekdays:[1]},
   anchorDate:'2026-11-02',visibility:'private'
 },owner)
 assert.equal(weekly.status,201,JSON.stringify(weekly.body))
 const day=(date)=>ask('/api/routines/today?date='+date,'GET',undefined,owner)
 const tuesday=await day('2026-11-03')
 assert.equal(tuesday.body.items.some(x=>x.id===weekly.body.id),false)
 const missedHistory=await ask('/api/routines/period-history?scope=history&limit=5','GET',undefined,owner)
 assert.ok(missedHistory.body.items.some(x=>x.id===weekly.body.id&&x.periodOn==='2026-11-02'&&x.status==='missed'))
 const marked=await ask('/api/routines/'+weekly.body.id+'/mark','POST',
   {date:'2026-11-02',status:'skipped'},owner)
 assert.equal(marked.status,200,JSON.stringify(marked.body))
 const sameDay=await day('2026-11-03')
 assert.equal(sameDay.body.items.some(x=>x.id===weekly.body.id),false)
 const skippedHistory=await ask('/api/routines/period-history?scope=history&limit=5','GET',undefined,owner)
 assert.ok(skippedHistory.body.items.some(x=>x.id===weekly.body.id&&x.status==='skipped'))
 const wednesday=await day('2026-11-04')
 assert.equal(wednesday.body.items.some(x=>x.id===weekly.body.id),false,
   'completed overdue Monday is not re-shown Wednesday')
 const nextMonday=await day('2026-11-09')
 assert.ok(nextMonday.body.items.some(x=>x.id===weekly.body.id))
 assert.equal(nextMonday.body.items.find(x=>x.id===weekly.body.id).mark,null,
   'old completion does not mark next scheduled occurrence')
 const monthly=await ask('/api/routines','POST',{
   title:'每月一号缴费',repeatType:'monthly',repeatConfig:{day:1},
   anchorDate:'2026-10-01',visibility:'household'
 },owner)
 assert.equal(monthly.status,201,JSON.stringify(monthly.body))
 const nov4=await day('2026-11-04')
 assert.equal(nov4.body.items.some(x=>x.id===monthly.body.id),false)
 const saved=await ask('/api/routines/'+monthly.body.id+'/mark','POST',
   {date:'2026-11-01',status:'skipped'},owner)
 assert.equal(saved.status,200,JSON.stringify(saved.body))
 const nov5=await day('2026-11-05')
 assert.equal(nov5.body.items.some(x=>x.id===monthly.body.id),false)
 const dec1=await day('2026-12-01')
 assert.ok(dec1.body.items.some(x=>x.id===monthly.body.id))
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM routines').get().n,2)
 sqlite.close()
})
test('workday routines do not roll into Japanese weekends and daily marks reset each day',async()=>{
 const {db,sqlite}=makeDb()
 const env={APP_ENV:'preview',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:'example-secret-for-test-012345678901234'}
 const ask=(path,method='GET',body,cookie)=>send(env,path,method,body,cookie)
 const registration=await ask('/api/auth/bootstrap','POST',{
   loginName:'workday-owner',password:'a-strong-test-password-123',
   displayName:'主人',householdName:'小家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(registration.status,201)
 const owner=extractCookie(registration.cookie)
 const daily=await ask('/api/routines','POST',{
   title:'早上添猫粮',repeatType:'daily',repeatConfig:{},
   anchorDate:'2026-11-06',visibility:'household'
 },owner)
 const workday=await ask('/api/routines','POST',{
   title:'平日通勤',repeatType:'workday',repeatConfig:{},
   anchorDate:'2026-11-06',visibility:'household'
 },owner)
 assert.equal(daily.status,201)
 assert.equal(workday.status,201)
 const done=await ask('/api/routines/'+daily.body.id+'/mark','POST',
   {date:'2026-11-06',status:'completed'},owner)
 assert.equal(done.status,200)
 const friday=await ask('/api/routines/today?date=2026-11-06','GET',undefined,owner)
 assert.ok(friday.body.items.find(x=>x.id===daily.body.id)?.mark?.completed_at)
 const saturday=await ask('/api/routines/today?date=2026-11-07','GET',undefined,owner)
 assert.equal(saturday.body.items.find(x=>x.id===daily.body.id)?.mark,null)
 assert.equal(saturday.body.items.some(x=>x.id===workday.body.id),false,
   'Saturday has no Japanese workday task, even if Friday was missed')
 const monday=await ask('/api/routines/today?date=2026-11-09','GET',undefined,owner)
 assert.equal(monday.body.items.some(x=>x.id===workday.body.id),true)
 sqlite.close()
})

test('routine archive preserves old overdue completion keys and undoes the correct record',async()=>{
 const {db,sqlite}=makeDb()
 const env={APP_ENV:'preview',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:'example-secret-for-test-012345678901234'}
 const ask=(path,method='GET',body,cookie)=>send(env,path,method,body,cookie)
 const boot=await ask('/api/auth/bootstrap','POST',{
   loginName:'routine-legacy-owner',password:'a-long-test-password-1234',
   displayName:'主人',householdName:'小家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(boot.status,201)
 const owner=extractCookie(boot.cookie)
 const day=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
 const plus=(value,n)=>new Date(Date.parse(value+'T00:00:00Z')+n*86400000).toISOString().slice(0,10)
 const base=plus(day,-9)
 const weekday=new Date(base+'T00:00:00Z').getUTCDay()
 const created=await ask('/api/routines','POST',{
   title:'旧版晚完成',repeatType:'weekly',repeatConfig:{weekdays:[weekday]},
   anchorDate:base,visibility:'household'
 },owner)
 assert.equal(created.status,201,JSON.stringify(created.body))
 const actual=plus(base,1)
 sqlite.prepare(`INSERT INTO routine_marks (routine_id,occurrence_on,completed_at)
  VALUES(?1,?2,?3)`).run(created.body.id,actual,actual+'T12:00:00Z')
 const history=await ask('/api/routines/period-history?scope=history&limit=5','GET',undefined,owner)
 assert.equal(history.status,200,JSON.stringify(history.body))
 const completed=history.body.items.find(r=>r.id===created.body.id&&r.periodOn===base)
 assert.ok(completed,JSON.stringify(history.body))
 assert.equal(completed.status,'completed')
 assert.equal(completed.completedOn,actual)
 assert.equal(completed.markOccurrenceOn,actual)
 const detail=await ask('/api/routines/'+created.body.id+'/period?on='+base,'GET',undefined,owner)
 assert.equal(detail.status,200,JSON.stringify(detail.body))
 assert.equal(detail.body.item.status,'completed')
 const undo=await ask('/api/routines/'+created.body.id+'/mark','POST',
   {date:day,periodOn:base,recordOn:actual,status:'open'},owner)
 assert.equal(undo.status,200,JSON.stringify(undo.body))
 const after=await ask('/api/routines/period-history?scope=history&limit=5','GET',undefined,owner)
 assert.equal(after.body.items.find(r=>r.id===created.body.id&&r.periodOn===base)?.status,'missed')
 sqlite.close()
})

test('new weekly occurrences may be completed early only once and never enter future Today',async()=>{
 const {db,sqlite}=makeDb()
 const env={APP_ENV:'preview',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:'example-secret-for-test-012345678901234'}
 const ask=(path,method='GET',body,cookie)=>send(env,path,method,body,cookie)
 const boot=await ask('/api/auth/bootstrap','POST',{
   loginName:'routine-new-owner',password:'a-long-test-password-1234',
   displayName:'主人',householdName:'小家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(boot.status,201)
 const owner=extractCookie(boot.cookie)
 const day=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
 const plus=(value,n)=>new Date(Date.parse(value+'T00:00:00Z')+n*86400000).toISOString().slice(0,10)
 const future=plus(day,3)
 const weekday=new Date(future+'T00:00:00Z').getUTCDay()
 const created=await ask('/api/routines','POST',{
   title:'零食日',repeatType:'weekly',repeatConfig:{weekdays:[weekday]},
   anchorDate:day,visibility:'household'
 },owner)
 assert.equal(created.status,201)
 const marked=await ask('/api/routines/'+created.body.id+'/mark','POST',
   {date:day,periodOn:future,early:true,status:'completed'},owner)
 assert.equal(marked.status,200,JSON.stringify(marked.body))
 assert.equal(marked.body.periodOn,future)
 const again=await ask('/api/routines/'+created.body.id+'/mark','POST',
   {date:day,periodOn:plus(future,7),early:true,status:'completed'},owner)
 assert.equal(again.status,409)
 const today=await ask('/api/routines/today?date='+future,'GET',undefined,owner)
 assert.equal(today.body.items.some(x=>x.id===created.body.id),false)
 const history=await ask('/api/routines/period-history?scope=history&limit=5','GET',undefined,owner)
 const completed=history.body.items.find(x=>x.id===created.body.id&&x.periodOn===future)
 assert.equal(completed?.status,'completed',JSON.stringify(history.body))
 assert.equal(completed.completedOn,day)
 sqlite.close()
})

test('early-completed routine suppresses advance and due-day reminders until undone',async()=>{
 const {db,sqlite}=makeDb()
 const env={APP_ENV:'preview',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:'example-secret-for-test-012345678901234'}
 const ask=(path,method='GET',body,cookie)=>send(env,path,method,body,cookie)
 const boot=await ask('/api/auth/bootstrap','POST',{
   loginName:'ahead-routine-owner',password:'a-long-test-password-1234',
   displayName:'主人',householdName:'小家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(boot.status,201)
 const owner=extractCookie(boot.cookie)
 const day=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
 const plus=(value,n)=>new Date(Date.parse(value+'T00:00:00Z')+n*86400000).toISOString().slice(0,10)
 const future=plus(day,3),weekday=new Date(future+'T00:00:00Z').getUTCDay()
 const routine=await ask('/api/routines','POST',{
   title:'豆沙零食日',repeatType:'weekly',repeatConfig:{weekdays:[weekday]},
   anchorDate:day,visibility:'household',remindEnabled:true
 },owner)
 assert.equal(routine.status,201,JSON.stringify(routine.body))
 assert.equal((await ask('/api/reminders/preferences','PUT',{advanceDays:3},owner)).status,200)
 const before=await ask('/api/reminders?date='+day,'GET',undefined,owner)
 assert.ok(before.body.items.some(x=>x.kind==='routine'&&x.id===routine.body.id&&x.dueOn===future),
   JSON.stringify(before.body))
 const completed=await ask('/api/routines/'+routine.body.id+'/mark','POST',
   {date:day,periodOn:future,status:'completed',early:true},owner)
 assert.equal(completed.status,200,JSON.stringify(completed.body))
 for(const date of [day,future]){
  const result=await ask('/api/reminders?date='+date,'GET',undefined,owner)
  assert.ok(!result.body.items.some(x=>x.kind==='routine'&&x.id===routine.body.id),
    'no redundant reminder on '+date+': '+JSON.stringify(result.body))
 }
 const undo=await ask('/api/routines/'+routine.body.id+'/mark','POST',
  {date:day,periodOn:future,status:'open'},owner)
 assert.equal(undo.status,200,JSON.stringify(undo.body))
 const restored=await ask('/api/reminders?date='+day,'GET',undefined,owner)
 assert.ok(restored.body.items.some(x=>x.kind==='routine'&&x.id===routine.body.id))
 sqlite.close()
})

test('shopping links to a verified kakebo expense and edits / removes details safely',async()=>{
 const {db,sqlite}=makeDb()
 sqlite.exec("UPDATE environment_identity SET database_name='homeflow' WHERE key='current'")
 const token='test-read-token-012345678901234567890'
 const env={APP_ENV:'production',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:'example-secret-for-test-012345678901234',
   KAKEBO_LEDGER_API_URL:'https://kakeibo-f17.pages.dev/api/homeflow-ledger',KAKEBO_LEDGER_READ_TOKEN:token,
    KAKEBO_LEDGER_SERVICE:{fetch:(...args)=>globalThis.fetch(...args)}}
 const ownerRegistered=await send(env,'/api/auth/bootstrap','POST',{
   loginName:'shopping-owner',password:'another-long-test-password-123',
   displayName:'主人',householdName:'小家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(ownerRegistered.status,201,JSON.stringify(ownerRegistered.body))
 const owner=extractCookie(ownerRegistered.cookie)
 const shopping=await send(env,'/api/shopping','POST',{title:'给豆沙买猫粮',quantity:2,visibility:'household'},owner)
 assert.equal(shopping.status,201,JSON.stringify(shopping.body))
 const originalFetch=globalThis.fetch
 globalThis.fetch=async(url,options)=>{
   assert.match(String(url),/kakeibo-f17\.pages\.dev\/api\/homeflow-ledger\?ids=123/)
   assert.equal(options.headers.Authorization,undefined)
   assert.equal(options.method,'GET')
   return new Response(JSON.stringify({entries:[{id:123,date:'2026-11-04',type:'expense',amount:800,merchant:'超市'}]}),
     {status:200,headers:{'content-type':'application/json'}})
 }
 try{
   const linked=await send(env,'/api/finance/shopping/'+shopping.body.id+'/link','POST',{entryId:123},owner)
   assert.equal(linked.status,200,JSON.stringify(linked.body))
   const list=await send(env,'/api/shopping','GET',undefined,owner)
   const item=list.body.items.find(x=>x.id===shopping.body.id)
   assert.equal(item.ledger_entry_id,'123')
   assert.ok(item.completed_at)
   const patch=await send(env,'/api/shopping/'+item.id,'PATCH',
     {title:'豆沙猫粮（新）',quantity:3,visibility:'household'},owner)
   assert.equal(patch.status,200,JSON.stringify(patch.body))
   const after=await send(env,'/api/shopping','GET',undefined,owner)
   assert.equal(after.body.items.find(x=>x.id===item.id)?.title,'豆沙猫粮（新）')
   assert.equal(after.body.items.find(x=>x.id===item.id)?.ledger_entry_id,'123')
   const unlink=await send(env,'/api/finance/shopping/'+item.id+'/link','DELETE',undefined,owner)
   assert.equal(unlink.status,200)
   const opened=await send(env,'/api/shopping','GET',undefined,owner)
   assert.equal(opened.body.items.find(x=>x.id===item.id)?.completed_at,null)
   assert.equal(opened.body.items.find(x=>x.id===item.id)?.ledger_entry_id,null)
   const del=await send(env,'/api/shopping/'+item.id,'DELETE',undefined,owner)
   assert.equal(del.status,200)
   assert.equal((await send(env,'/api/shopping','GET',undefined,owner)).body.items.length,0)
 }finally{globalThis.fetch=originalFetch;sqlite.close()}
})
test('completed routine plans can be archived without losing their completion marks',async()=>{
 const {db,sqlite}=makeDb()
 const env={APP_ENV:'preview',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:'example-secret-for-test-012345678901234'}
 const registered=await send(env,'/api/auth/bootstrap','POST',{
   loginName:'archive-owner',password:'long-password-for-test-112233',
   displayName:'主人',householdName:'家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(registered.status,201)
 const owner=extractCookie(registered.cookie)
 const r=await send(env,'/api/routines','POST',{
   title:'喝水',repeatType:'daily',repeatConfig:{},anchorDate:'2026-11-04',
   visibility:'household'},owner)
 assert.equal(r.status,201)
 assert.equal((await send(env,'/api/routines/'+r.body.id+'/mark','POST',
   {date:'2026-11-04',status:'completed'},owner)).status,200)
 assert.equal((await send(env,'/api/routines/'+r.body.id,'DELETE',undefined,owner)).status,200)
 assert.equal((await send(env,'/api/routines','GET',undefined,owner)).body.items.length,0)
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS c FROM routine_marks WHERE routine_id=?').get(r.body.id).c,1)
 sqlite.close()
})

test('owner can link a shared shopping item created by family member, but cannot access their private shopping',async()=>{
 const {db,sqlite}=makeDb()
 sqlite.exec("UPDATE environment_identity SET database_name='homeflow' WHERE key='current'")
 const token='another-ledger-token-0123456789012345'
 const env={APP_ENV:'production',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:'example-secret-for-test-012345678901234',
   KAKEBO_LEDGER_API_URL:'https://kakeibo-f17.pages.dev/api/homeflow-ledger',KAKEBO_LEDGER_READ_TOKEN:token,
    KAKEBO_LEDGER_SERVICE:{fetch:(...args)=>globalThis.fetch(...args)}}
 const ask=(path,method='GET',body,cookie)=>send(env,path,method,body,cookie)
 const account=await ask('/api/auth/bootstrap','POST',{
   loginName:'shopping-host',password:'long-test-password-2026-11',
   displayName:'主人',householdName:'家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(account.status,201,JSON.stringify(account.body))
 const owner=extractCookie(account.cookie)
 const invitation=await ask('/api/auth/invitations','POST',{},owner)
 assert.equal(invitation.status,201)
 const account2=await ask('/api/auth/join','POST',{
   loginName:'shopping-partner',password:'another-very-long-password-2026',
   displayName:'家人',invitationCode:invitation.body.invitationCode})
 assert.equal(account2.status,201,JSON.stringify(account2.body))
 const partner=extractCookie(account2.cookie)
 const shared=await ask('/api/shopping','POST',{title:'共享购物',quantity:1,visibility:'household'},partner)
 const hidden=await ask('/api/shopping','POST',{title:'秘密购物',quantity:1,visibility:'private'},partner)
 assert.equal(shared.status,201)
 assert.equal(hidden.status,201)
 assert.equal((await ask('/api/finance/status','GET',undefined,partner)).status,200)
 assert.equal((await ask('/api/finance/candidates?start=2026-11-01&end=2026-11-04','GET',undefined,partner)).status,403)
 let externalRequests=0
 const old=globalThis.fetch
 globalThis.fetch=async(url,opts)=>{
   externalRequests++
   assert.equal(opts.headers.Authorization,undefined)
   return new Response(JSON.stringify({entries:[{id:456,type:'expense',date:'2026-11-04',amount:1800}]}),{status:200})
 }
 try {
   const notAllowed=await ask('/api/finance/shopping/'+hidden.body.id+'/link','POST',{entryId:456},owner)
   assert.equal(notAllowed.status,403)
   assert.equal(externalRequests,0,'private item authorization must precede external lookup')
   const verified=await ask('/api/finance/shopping/'+shared.body.id+'/link','POST',{entryId:456},owner)
   assert.equal(verified.status,200,JSON.stringify(verified.body))
   const shown=await ask('/api/shopping','GET',undefined,owner)
   assert.equal(shown.body.items.some(x=>x.id===hidden.body.id),false)
   assert.equal(shown.body.items.find(x=>x.id===shared.body.id)?.ledger_entry_id,'456')
   assert.ok(shown.body.items.find(x=>x.id===shared.body.id)?.completed_at)
   // Both members see completed household-shared records regardless of creator.
   const partnerHistory=await ask('/api/shopping?scope=history&limit=5','GET',undefined,partner)
   assert.equal(partnerHistory.status,200)
   assert.ok(partnerHistory.body.items.some(x=>x.id===shared.body.id))
   const createdByOwner=await ask('/api/shopping','POST',{
     title:'另一条家庭共享已完成购物',quantity:1,visibility:'household'
   },owner)
   assert.equal(createdByOwner.status,201)
   sqlite.prepare('UPDATE shopping_items SET completed_at=? WHERE id=?')
     .run(new Date().toISOString(),createdByOwner.body.id)
   const partnerAfter=await ask('/api/shopping?scope=history&limit=5','GET',undefined,partner)
   assert.ok(partnerAfter.body.items.some(x=>x.id===createdByOwner.body.id))
   assert.equal(partnerAfter.body.items.some(x=>x.id===hidden.body.id),false)
   const unlinked=await ask('/api/finance/shopping/'+shared.body.id+'/link','DELETE',undefined,owner)
   assert.equal(unlinked.status,200)
   const restored=await ask('/api/shopping','GET',undefined,owner)
   assert.equal(restored.body.items.find(x=>x.id===shared.body.id)?.completed_at,null)
 }finally{globalThis.fetch=old;sqlite.close()}
})

test('date/month keyset pagination keeps all memories accessible without duplicates',async()=>{
 const {db,sqlite}=makeDb()
 const env={APP_ENV:'preview',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:'example-bootstrap-secret-unit-test-012345'}
 const user=await send(env,'/api/auth/bootstrap','POST',{
   loginName:'history-owner',displayName:'回忆',password:'test-long-history-password-2026',
   householdName:'小家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(user.status,201,JSON.stringify(user.body))
 const cookie=extractCookie(user.cookie)
 for(let i=0;i<13;i++){
   const created=await send(env,'/api/memories','POST',{
     title:'回忆 '+i,happenedOn:i<7?'2025-02-12':'2026-11-04',
     visibility:'private',story:'记忆'},cookie)
   assert.equal(created.status,201,JSON.stringify(created.body))
 }
 const ids=new Set()
 let cursor=null
 for(let page=0;page<8;page++){
   const result=await send(env,'/api/memories?limit=4'+
     (cursor?'&cursor='+encodeURIComponent(cursor):''),'GET',undefined,cookie)
   assert.equal(result.status,200,JSON.stringify(result.body))
   assert.ok(result.body.items.length<=4)
   for(const item of result.body.items){
     assert.equal(ids.has(item.id),false,'no duplicate in keyset pages')
     ids.add(item.id)
   }
   cursor=result.body.nextCursor
   if(!cursor)break
 }
 assert.equal(ids.size,13,'old records remain reachable beyond initial page')
 const filtered=await send(env,'/api/memories?limit=20&year=2025&month=02','GET',undefined,cookie)
 assert.equal(filtered.status,200)
 assert.equal(filtered.body.items.length,7)
 assert.ok(filtered.body.items.every(x=>x.happened_on.startsWith('2025-02')))
 const year=await send(env,'/api/memories?limit=20&year=2026','GET',undefined,cookie)
 assert.equal(year.body.items.length,6)
 assert.equal((await send(env,'/api/memories?month=02','GET',undefined,cookie)).status,400)
 assert.equal((await send(env,'/api/memories?limit=999','GET',undefined,cookie)).status,400)
 sqlite.close()
})

test('completed wishes and past shopping move to history; in-progress items stay visible',async()=>{
 const {db,sqlite}=makeDb()
 const env={APP_ENV:'preview',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:'example-bootstrap-secret-unit-test-012345'}
 const owner=await send(env,'/api/auth/bootstrap','POST',{
   loginName:'history-keeper',displayName:'主人',password:'test-long-history-password-2026',
   householdName:'小家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(owner.status,201)
 const cookie=extractCookie(owner.cookie)
 const wishes=[]
 for(let i=0;i<9;i++){
   const result=await send(env,'/api/wishes','POST',{
     title:'心愿 '+i,wishType:'other',estimatedAmount:0,visibility:'household'},cookie)
   assert.equal(result.status,201)
   wishes.push(result.body.id)
 }
 const done=await send(env,'/api/wishes/'+wishes[0],'PATCH',{
   title:'心愿 0',wishType:'other',status:'completed',
   estimatedAmount:0,currency:'JPY',visibility:'household'},cookie)
 assert.equal(done.status,409,'manual status edit may not bypass completion verification')
 sqlite.prepare("UPDATE wishes SET status='completed' WHERE id=?").run(wishes[0])
 const active=await send(env,'/api/wishes?scope=active&limit=3','GET',undefined,cookie)
 assert.equal(active.body.items.length,3)
 assert.ok(active.body.nextCursor)
 assert.equal(active.body.items.some(x=>x.status==='completed'),false)
 const history=await send(env,'/api/wishes?scope=history&limit=6','GET',undefined,cookie)
 assert.equal(history.body.items.length,1)
 assert.equal(history.body.items[0].id,wishes[0])
 const older=await send(env,'/api/shopping','POST',{
   title:'已买猫粮',quantity:1,visibility:'household'},cookie)
 const open=await send(env,'/api/shopping','POST',{
   title:'下次买猫砂',quantity:1,visibility:'household'},cookie)
 assert.equal(older.status,201);assert.equal(open.status,201)
 assert.equal((await send(env,'/api/shopping/'+older.body.id+'/toggle','POST',{completed:true},cookie)).status,409)
 const yesterday=new Date(Date.now()-2*86400000).toISOString()
 // Historical manual completion predates the new verified-ledger rule.
 sqlite.prepare('UPDATE shopping_items SET completed_at=? WHERE id=?').run(yesterday,older.body.id)
 const current=await send(env,'/api/shopping?scope=active&limit=6','GET',undefined,cookie)
 assert.equal(current.body.items.some(x=>x.id===older.body.id),false)
 assert.equal(current.body.items.some(x=>x.id===open.body.id),true)
 const past=await send(env,'/api/shopping?scope=history&limit=6','GET',undefined,cookie)
 assert.equal(past.body.items.some(x=>x.id===older.body.id),true)
 sqlite.close()
})

test('pet health and travel history can be filtered by month and paged',async()=>{
 const {db,sqlite}=makeDb()
 const env={APP_ENV:'preview',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:'example-bootstrap-secret-unit-test-012345'}
 const owner=await send(env,'/api/auth/bootstrap','POST',{
   loginName:'pet-history',displayName:'主人',password:'test-long-history-password-2026',
   householdName:'小家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(owner.status,201)
 const cookie=extractCookie(owner.cookie)
 const pet=await send(env,'/api/family/profiles','POST',{
   type:'pet',displayName:'豆沙',birthday:'2022-05-01',adoptedOn:'2022-06-01'},cookie)
 assert.equal(pet.status,201,JSON.stringify(pet.body))
 for(let i=0;i<9;i++){
   const health=await send(env,'/api/pets/'+pet.body.id+'/health','POST',{
     recordType:'weight',eventOn:i<5?'2025-02-12':'2026-11-04',weightGrams:5000+i,
     nextDueOn:null,note:'体重',visibility:'household'},cookie)
   assert.equal(health.status,201,JSON.stringify(health.body))
 }
 const first=await send(env,'/api/pets/'+pet.body.id+'/health?limit=3','GET',undefined,cookie)
 assert.equal(first.body.records.length,3)
 assert.ok(first.body.nextCursor)
 const older=await send(env,'/api/pets/'+pet.body.id+'/health?year=2025&month=02&limit=6','GET',undefined,cookie)
 assert.equal(older.body.records.length,5)
 assert.ok(older.body.records.every(x=>x.eventOn==='2025-02-12'))
 const row=sqlite.prepare('SELECT id FROM users LIMIT 1').get()
 const household=sqlite.prepare('SELECT id FROM households LIMIT 1').get().id
 const insert=sqlite.prepare("INSERT INTO trips(id,household_id,created_by,visibility,title,destination,start_on,end_on,status) VALUES(?,?,?,?,?,?,?,?,?)")
 insert.run('00000000-0000-4000-8000-000000000011',household,row.id,'household',
   '过去的旅行','仙台','2024-01-10','2024-01-13','planning')
 insert.run('00000000-0000-4000-8000-000000000012',household,row.id,'household',
   '明年的旅行','京都','2027-05-10','2027-05-12','planning')
 const active=await send(env,'/api/trips?scope=active&limit=6','GET',undefined,cookie)
 const history=await send(env,'/api/trips?scope=history&year=2024&limit=6','GET',undefined,cookie)
 assert.equal(active.body.items.length,2,JSON.stringify(active.body))
 assert.ok(active.body.items.some(x=>x.title==='明年的旅行'))
 assert.ok(active.body.items.some(x=>x.title==='过去的旅行'),
   'travel that was never explicitly finished remains active')
 assert.equal(history.body.items.length,0,JSON.stringify(history.body))
 sqlite.close()
})

test('old one-time anniversaries are in history; recurring birthdays stay upcoming',async()=>{
 const {db,sqlite}=makeDb()
 const env={APP_ENV:'preview',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:'example-bootstrap-secret-unit-test-012345'}
 const owner=await send(env,'/api/auth/bootstrap','POST',{
   loginName:'anniv-history',displayName:'主人',password:'test-long-history-password-2026',
   householdName:'小家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(owner.status,201)
 const cookie=extractCookie(owner.cookie)
 const old=await send(env,'/api/anniversaries','POST',{
   title:'毕业纪念',eventDate:'2024-08-15',repeatMode:'once',visibility:'household'},cookie)
 const annual=await send(env,'/api/anniversaries','POST',{
   title:'结婚纪念日',eventDate:'2022-06-01',repeatMode:'yearly',visibility:'household'},cookie)
 assert.equal(old.status,201);assert.equal(annual.status,201)
 const upcoming=await send(env,'/api/anniversaries/upcoming','GET',undefined,cookie)
 assert.equal(upcoming.body.items.some(x=>x.id===old.body.id),false)
 assert.equal(upcoming.body.items.some(x=>x.id===annual.body.id),true)
 const past=await send(env,'/api/anniversaries?scope=history&year=2024&month=08&limit=6','GET',undefined,cookie)
 assert.equal(past.status,200,JSON.stringify(past.body))
 assert.equal(past.body.items.length,1)
 assert.equal(past.body.items[0].id,old.body.id)
 assert.equal((await send(env,'/api/anniversaries?scope=history&year=2023&limit=6','GET',undefined,cookie)).body.items.length,0)
 sqlite.close()
})

test('recurring pet task completion creates exactly one linked care record, supports undo and privacy',async()=>{
 const {db,sqlite}=makeDb()
 const env={APP_ENV:'preview',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:'example-secret-for-test-012345678901234'}
 const ask=(path,method='GET',body,cookie)=>send(env,path,method,body,cookie)
 const registered=await ask('/api/auth/bootstrap','POST',{
   loginName:'care-owner',password:'care-strong-test-password-123',
   displayName:'主人',householdName:'小家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(registered.status,201)
 const owner=extractCookie(registered.cookie)
 const pet=await ask('/api/family/profiles','POST',{type:'pet',displayName:'豆沙'},owner)
 const person=await ask('/api/family/profiles','POST',{type:'person',displayName:'家人'},owner)
 assert.equal(pet.status,201)
 assert.equal(person.status,201)
 const invalid=await ask('/api/routines','POST',{
   title:'错误关联',repeatType:'daily',repeatConfig:{},anchorDate:'2026-11-04',
   subjectProfileId:person.body.id,healthRecordType:'other',visibility:'household'},owner)
 assert.equal(invalid.status,400,'people cannot receive pet health records')
 const routine=await ask('/api/routines','POST',{
   title:'给豆沙添猫粮早',repeatType:'daily',repeatConfig:{},anchorDate:'2026-11-04',
   subjectProfileId:pet.body.id,healthRecordType:'other',visibility:'private'},owner)
 assert.equal(routine.status,201,JSON.stringify(routine.body))
 const mark='/api/routines/'+routine.body.id+'/mark'
 const health='/api/pets/'+pet.body.id+'/health'
 for(let i=0;i<2;i++){
   assert.equal((await ask(mark,'POST',{date:'2026-11-04',status:'completed'},owner)).status,200)
 }
 let records=(await ask(health,'GET',undefined,owner)).body.records
 assert.equal(records.length,1,'repeat completion is idempotent')
 assert.equal(records[0].recordType,'other')
 assert.equal(records[0].note,'给豆沙添猫粮早')
 assert.equal(records[0].eventOn,'2026-11-04')
 assert.equal(records[0].visibility,'private')
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM pet_health_records WHERE source_routine_id=?').get(routine.body.id).n,1)
 assert.equal((await ask(mark,'POST',{date:'2026-11-04',status:'open'},owner)).status,200)
 records=(await ask(health,'GET',undefined,owner)).body.records
 assert.equal(records.length,0,'undo archives auto record')
 assert.equal((await ask(mark,'POST',{date:'2026-11-04',status:'completed'},owner)).status,200)
 records=(await ask(health,'GET',undefined,owner)).body.records
 assert.equal(records.length,1,'re-check restores the same record')
 assert.equal(sqlite.prepare('SELECT COUNT(*) n FROM pet_health_records WHERE source_routine_id=?').get(routine.body.id).n,1)
 assert.equal((await ask(mark,'POST',{date:'2026-11-05',status:'completed'},owner)).status,200)
 records=(await ask(health,'GET',undefined,owner)).body.records
 assert.equal(records.length,2,'each day gets its own record')
 const standalone=await ask(health,'POST',{recordType:'grooming',eventOn:'2026-11-05',note:'手工梳毛'},owner)
 assert.equal(standalone.status,201)
 assert.equal((await ask(mark,'POST',{date:'2026-11-05',status:'open'},owner)).status,200)
 records=(await ask(health,'GET',undefined,owner)).body.records
 assert.equal(records.length,2,'undo must not delete manual records')
 const newMode=await ask('/api/routines/'+routine.body.id,'PATCH',{
   title:'给豆沙添猫粮早',repeatType:'daily',repeatConfig:{},anchorDate:'2026-11-04',
   subjectProfileId:pet.body.id,healthRecordType:null,visibility:'private'},owner)
 assert.equal(newMode.status,200)
 assert.equal((await ask(mark,'POST',{date:'2026-11-06',status:'completed'},owner)).status,200)
 records=(await ask(health,'GET',undefined,owner)).body.records
 assert.equal(records.length,2,'disabled care sync does not create records')
 sqlite.close()
})

test('one-off today pet tasks sync exactly once, undo safely, and respect privacy and editing',async()=>{
 const {db,sqlite}=makeDb()
 const env={APP_ENV:'preview',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:'example-secret-for-test-012345678901234'}
 const ask=(path,method='GET',body,cookie)=>send(env,path,method,body,cookie)
 const registration=await ask('/api/auth/bootstrap','POST',{
   loginName:'task-care-owner',password:'a-strong-care-password-12345',
   displayName:'主人',householdName:'小家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(registration.status,201)
 const owner=extractCookie(registration.cookie)
 const pet=await ask('/api/family/profiles','POST',{type:'pet',displayName:'豆沙'},owner)
 const person=await ask('/api/family/profiles','POST',{type:'person',displayName:'家庭成员'},owner)
 assert.equal(pet.status,201)
 assert.equal(person.status,201)
 const health='/api/pets/'+pet.body.id+'/health'
 const bad=await ask('/api/tasks','POST',{
   title:'不属于宠物的任务',visibility:'household',
   subjectProfileId:person.body.id,healthRecordType:'other'},owner)
 assert.equal(bad.status,400)
 const noCare=await ask('/api/tasks','POST',{
   title:'只做任务不写护理',visibility:'household',
   subjectProfileId:pet.body.id,healthRecordType:null},owner)
 assert.equal(noCare.status,201)
 const linked=await ask('/api/tasks','POST',{
   title:'给豆沙换水',visibility:'household',subjectProfileId:pet.body.id},owner)
 assert.equal(linked.status,201,JSON.stringify(linked.body))
 const id=linked.body.id
 const list=await ask('/api/tasks?status=all','GET',undefined,owner)
 const task=list.body.tasks.find(t=>t.id===id)
 assert.equal(task.healthRecordType,'other','pet-linked tasks default to logging care')
 assert.equal(task.subjectProfileId,pet.body.id)
 const invitation=await ask('/api/auth/invitations','POST',{},owner)
 const joined=await ask('/api/auth/join','POST',{
   loginName:'partner-care',password:'another-strong-test-password-123',
   displayName:'伴侣',invitationCode:invitation.body.invitationCode})
 assert.equal(joined.status,201)
 const partner=extractCookie(joined.cookie)
 const privatePet=await ask('/api/tasks','POST',{
   title:'私人梳毛',visibility:'private',subjectProfileId:pet.body.id,healthRecordType:'grooming'},owner)
 assert.equal(privatePet.status,201)
 assert.equal((await ask('/api/tasks/'+privatePet.body.id,'PATCH',{completed:true},partner)).status,404)
 const shared='/api/tasks/'+id
 assert.equal((await ask(shared,'PATCH',{completed:true},partner)).status,200)
 assert.equal((await ask(shared,'PATCH',{completed:true},owner)).status,200)
 let records=(await ask(health,'GET',undefined,owner)).body.records
 assert.equal(records.length,1,'shared task completion does not duplicate history')
 assert.equal(records[0].recordType,'other')
 assert.equal(records[0].note,'给豆沙换水')
 assert.equal(records[0].sourceTaskId,id)
 assert.equal(records[0].eventOn,new Date(Date.now()+9*3600000).toISOString().slice(0,10))
 assert.equal(records[0].visibility,'household')
 const recordId=records[0].id
 const manuallyAdded=await ask(health,'POST',{
   recordType:'grooming',eventOn:records[0].eventOn,note:'独立梳毛记录',visibility:'private'},owner)
 assert.equal(manuallyAdded.status,201)
 assert.equal((await ask(shared,'PATCH',{completed:false},owner)).status,200)
 records=(await ask(health,'GET',undefined,owner)).body.records
 assert.equal(records.length,1,'undo should archive only the generated record')
 assert.equal(records[0].note,'独立梳毛记录')
 assert.equal((await ask(shared,'PATCH',{completed:true},partner)).status,200)
 records=(await ask(health,'GET',undefined,owner)).body.records
 assert.equal(records.length,2)
 assert.equal(records.find(x=>x.sourceTaskId===id)?.id,recordId,'rechecking restores same history id')
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM pet_health_records WHERE source_task_id=?').get(id).n,1)
 const petOnly=await ask('/api/tasks/'+privatePet.body.id,'PATCH',{completed:true},owner)
 assert.equal(petOnly.status,200)
 const partnerHealth=(await ask(health,'GET',undefined,partner)).body.records
 assert.equal(partnerHealth.some(x=>x.note==='私人梳毛'),false,
   'private care entries must remain invisible to another household login')
 assert.equal((await ask('/api/tasks/'+noCare.body.id,'PATCH',{completed:true},owner)).status,200)
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM pet_health_records WHERE source_task_id=?').get(noCare.body.id).n,0,
   'explicitly disabling care sync is respected')
 const current=(await ask('/api/tasks?status=all','GET',undefined,owner)).body.tasks.find(t=>t.id===noCare.body.id)
 const edited=await ask('/api/tasks/'+noCare.body.id,'PATCH',{
   title:'更新后仍不记录',visibility:'household',notes:'',
   subjectProfileId:pet.body.id,healthRecordType:'other',dueOn:current.dueOn,
   expectedUpdatedAt:current.updatedAt},owner)
 assert.equal(edited.status,200,JSON.stringify(edited.body))
 assert.equal((await ask('/api/tasks/'+noCare.body.id,'PATCH',{completed:false},owner)).status,200)
 assert.equal((await ask('/api/tasks/'+noCare.body.id,'PATCH',{completed:true},owner)).status,200)
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM pet_health_records WHERE source_task_id=?').get(noCare.body.id).n,1,
  'editing an existing task can enable linked pet care')
 sqlite.close()
})


test('hiding a Today detail is per-person and per-date, never deletes a plan or its completed period',async()=>{
 const {db,sqlite}=makeDb()
 const env={APP_ENV:'preview',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:'example-secret-for-test-012345678901234'}
 const ask=(path,method='GET',body,cookie)=>send(env,path,method,body,cookie)
 const boot=await ask('/api/auth/bootstrap','POST',{
   loginName:'dismiss-owner',password:'a-strong-password-for-dismissal',
   displayName:'主人',householdName:'小家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET})
 assert.equal(boot.status,201,JSON.stringify(boot.body))
 const owner=extractCookie(boot.cookie)
 const date=new Date(Date.now()+9*3600000).toISOString().slice(0,10)
 const routine=await ask('/api/routines','POST',{
   title:'豆沙每日零食',repeatType:'daily',repeatConfig:{},anchorDate:date,visibility:'household'},owner)
 const task=await ask('/api/tasks','POST',{
   title:'今天一次性待办',visibility:'household',dueOn:date},owner)
 assert.equal(routine.status,201,JSON.stringify(routine.body))
 assert.equal(task.status,201,JSON.stringify(task.body))
 const routineId=routine.body.id,taskId=task.body.id
 const periodKey='routine:'+routineId+':'+date,taskKey='task:'+taskId
 const marked=await ask('/api/routines/'+routineId+'/mark','POST',
   {date,status:'completed'},owner)
 assert.equal(marked.status,200,JSON.stringify(marked.body))
 const dismiss=async(itemKey,as=owner,viewOn=date)=>ask('/api/tasks/today/dismiss','POST',
   {date:viewOn,itemKey},as)
 assert.equal((await dismiss(periodKey)).status,200)
 assert.equal((await dismiss(taskKey)).status,200)
 assert.equal((await dismiss(periodKey)).status,200,'repeat dismiss is idempotent')
 const today=(await ask('/api/tasks?status=all&today='+date+'&legacyDismissals=1','GET',undefined,owner))
 assert.equal(today.status,200)
 assert.deepEqual(new Set(today.body.hiddenTodayKeys),new Set([periodKey,taskKey]))
 assert.equal(today.body.tasks.some(x=>x.id===taskId),true,'one-off task is still stored')
 assert.equal((await ask('/api/routines/'+routineId,'GET',undefined,owner)).status,200)
 assert.equal((await ask('/api/tasks/'+taskId,'GET',undefined,owner)).status,200)
 const marks=sqlite.prepare('SELECT completed_at,skipped_at FROM routine_marks WHERE routine_id=?').all(routineId)
 assert.equal(marks.length,1)
 assert.ok(marks[0].completed_at,'the completion history stays intact')
 assert.equal(marks[0].skipped_at,null)
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM today_dismissals').get().n,2)
 assert.equal((await dismiss(taskKey,owner,'1999-01-01')).status,400,'reject past day manipulation')
 assert.equal((await dismiss('task:other')).status,400)
 const invitation=await ask('/api/auth/invitations','POST',{},owner)
 const partner=await ask('/api/auth/join','POST',{
   loginName:'dismiss-partner',password:'a-different-strong-password',
   displayName:'家人',invitationCode:invitation.body.invitationCode})
 assert.equal(partner.status,201)
 const member=extractCookie(partner.cookie)
 const otherToday=await ask('/api/tasks?status=all&today='+date+'&legacyDismissals=1','GET',undefined,member)
 assert.deepEqual(otherToday.body.hiddenTodayKeys,[],'one member cannot dismiss another member view')
 const privateTask=await ask('/api/tasks','POST',{
   title:'私人待办',visibility:'private',dueOn:date},owner)
 assert.equal(privateTask.status,201)
 assert.equal((await dismiss('task:'+privateTask.body.id,member)).status,404,
   'cannot hide a plan the member is not authorized to see')
 sqlite.close()
})


test('monthly nth weekday routine creates two separate Tuesday periods and reminder dates',async()=>{
 const {db,sqlite}=makeDb()
 const env={APP_ENV:'preview',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:'example-secret-for-test-012345678901234'}
 const ask=(path,method='GET',body,cookie)=>send(env,path,method,body,cookie)
 try{
  const registration=await ask('/api/auth/bootstrap','POST',{
   loginName:'nth-tuesday-owner',password:'another-long-password-1234',
   displayName:'主人',householdName:'小家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET
  })
  assert.equal(registration.status,201)
  const owner=extractCookie(registration.cookie)
  const create=await ask('/api/routines','POST',{
   title:'扔不可燃垃圾',repeatType:'monthly',
   repeatConfig:{mode:'weekday',weekday:2,weekNumbers:[2,4]},
   anchorDate:'2026-11-06',visibility:'household',remindEnabled:true
  },owner)
  assert.equal(create.status,201,JSON.stringify(create.body))
  const id=create.body.id
  const stored=sqlite.prepare('SELECT repeat_type,repeat_config FROM routines WHERE id=?').get(id)
  assert.equal(stored.repeat_type,'monthly')
  assert.deepEqual(JSON.parse(stored.repeat_config),{mode:'weekday',weekday:2,weekNumbers:[2,4]})
  const day=async date=>ask('/api/routines/today?date='+date,'GET',undefined,owner)
  assert.equal((await day('2026-11-09')).body.items.some(r=>r.id===id),false)
  const ten=await day('2026-11-10')
  assert.equal(ten.body.items.find(r=>r.id===id)?.currentPeriodOn,'2026-11-10')
  const reminder=await ask('/api/reminders?date=2026-11-10','GET',undefined,owner)
  assert.equal(reminder.status,200,JSON.stringify(reminder.body))
  assert.ok(reminder.body.items.some(r=>r.kind==='routine'&&r.id===id&&r.dueOn==='2026-11-10'))
  const missed=await day('2026-11-11')
  assert.equal(missed.body.items.some(r=>r.id===id),false)
  const skipped=await ask('/api/routines/'+id+'/mark','POST',
   {date:'2026-11-10',status:'skipped'},owner)
  assert.equal(skipped.status,200,JSON.stringify(skipped.body))
  assert.equal((await day('2026-11-12')).body.items.some(r=>r.id===id),false)
  assert.equal((await day('2026-11-17')).body.items.some(r=>r.id===id),false)
  const twentyFourth=await day('2026-11-24')
  assert.equal(twentyFourth.body.items.find(r=>r.id===id)?.currentPeriodOn,'2026-11-24')
  const nextReminder=await ask('/api/reminders?date=2026-11-24','GET',undefined,owner)
  assert.ok(nextReminder.body.items.some(r=>r.kind==='routine'&&r.id===id&&r.dueOn==='2026-11-24'))
  const completedNext=await ask('/api/routines/'+id+'/mark','POST',
   {date:'2026-11-24',status:'completed'},owner)
  assert.equal(completedNext.status,200,JSON.stringify(completedNext.body))
  assert.equal((await day('2026-11-25')).body.items.some(r=>r.id===id),false)
  assert.equal((await day('2026-12-01')).body.items.some(r=>r.id===id),false)
  assert.equal((await day('2026-12-08')).body.items.find(r=>r.id===id)?.currentPeriodOn,'2026-12-08')
  assert.equal((await day('2026-12-29')).body.items.some(r=>r.id===id),false)
  const marks=sqlite.prepare('SELECT occurrence_on FROM routine_marks WHERE routine_id=? ORDER BY occurrence_on').all(id)
  assert.deepEqual(marks.map(r=>r.occurrence_on),['2026-11-10','2026-11-24'])
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM routines').get().n,1)
 }finally{sqlite.close()}
})

test('monthly date rules can be edited into nth weekdays and back without losing the plan',async()=>{
 const {db,sqlite}=makeDb()
 const env={APP_ENV:'preview',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:'example-secret-for-test-012345678901234'}
 const ask=(path,method='GET',body,cookie)=>send(env,path,method,body,cookie)
 try{
  const registration=await ask('/api/auth/bootstrap','POST',{
   loginName:'nth-edit-owner',password:'another-long-password-1234',
   displayName:'主人',householdName:'小家',bootstrapSecret:env.HOMEFLOW_BOOTSTRAP_SECRET
  })
  assert.equal(registration.status,201)
  const owner=extractCookie(registration.cookie)
  const created=await ask('/api/routines','POST',{
   title:'每月日期提醒',repeatType:'monthly',repeatConfig:{day:10},
   anchorDate:'2026-11-01',visibility:'household'
  },owner)
  assert.equal(created.status,201,JSON.stringify(created.body))
  const id=created.body.id
  const base={title:'扔不可燃垃圾',repeatType:'monthly',
   anchorDate:'2026-11-01',visibility:'household',remindEnabled:true}
  const wrong=await ask('/api/routines/'+id,'PATCH',{
   ...base,repeatConfig:{mode:'weekday',weekday:2,weekNumbers:[2,2]}
  },owner)
  assert.equal(wrong.status,400)
  const switched=await ask('/api/routines/'+id,'PATCH',{
   ...base,repeatConfig:{mode:'weekday',weekday:2,weekNumbers:[2,4]}
  },owner)
  assert.equal(switched.status,200,JSON.stringify(switched.body))
  let saved=JSON.parse(sqlite.prepare('SELECT repeat_config FROM routines WHERE id=?').get(id).repeat_config)
  assert.deepEqual([saved.mode,saved.weekday,saved.weekNumbers],['weekday',2,[2,4]])
  const restored=await ask('/api/routines/'+id,'PATCH',{
   ...base,repeatConfig:{day:15}
  },owner)
  assert.equal(restored.status,200,JSON.stringify(restored.body))
  saved=JSON.parse(sqlite.prepare('SELECT repeat_config FROM routines WHERE id=?').get(id).repeat_config)
  assert.equal(saved.day,15)
  assert.equal(saved.mode,undefined)
  assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM routines').get().n,1)
 }finally{sqlite.close()}
})
