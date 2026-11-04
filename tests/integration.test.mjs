import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import worker from '../worker/index.js'
import {registerPassword,derivePasswordProof,validLocalPassword} from '../src/auth-crypto.js'

function makeDb() {
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec('PRAGMA foreign_keys=ON;')
 for (const filename of ['0001_core.sql','0002_stage1_family_tasks.sql','0003_life_projects.sql','0004_push_notifications.sql','0005_interval_policies.sql','0006_pet_health.sql','0007_offline_tasks.sql','0008_shopping_ledger.sql']) {
   sqlite.exec(readFileSync(new URL('../migrations/'+filename, import.meta.url),'utf8'))
 }
 sqlite.exec("INSERT INTO environment_identity(key,database_name) VALUES('current','homeflow-preview')")
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
 const first=await ask('/api/routines/today?date=2026-11-04','GET',undefined,owner)
 assert.equal(first.body.items.filter(x=>x.id===created.body.id).length,1)
 const mark=await ask('/api/routines/'+created.body.id+'/mark','POST',{
   date:'2026-11-04',status:'completed'},owner)
 assert.equal(mark.status,200,JSON.stringify(mark.body))
 const today=await ask('/api/routines/today?date=2026-11-04','GET',undefined,owner)
 assert.equal(today.body.items.filter(x=>x.id===created.body.id).length,1,
   'completed row stays visible today for the checked strikethrough')
 assert.ok(today.body.items.find(x=>x.id===created.body.id).mark.completed_at)
 const tomorrow=await ask('/api/routines/today?date=2026-11-05','GET',undefined,owner)
 assert.equal(tomorrow.body.items.some(x=>x.id===created.body.id),false)
 const next=await ask('/api/routines/today?date=2026-11-07','GET',undefined,owner)
 assert.equal(next.body.items.some(x=>x.id===created.body.id),true)
 assert.equal(sqlite.prepare('SELECT COUNT(*) AS n FROM routines').get().n,1,
   'completing a routine does not delete or duplicate it')
 sqlite.close()
})

test('uncompleted weekly and monthly routines roll over without duplicate occurrences',async()=>{
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
 const carried=tuesday.body.items.find(x=>x.id===weekly.body.id)
 assert.ok(carried,JSON.stringify(tuesday.body))
 assert.equal(carried.carriedFrom,'2026-11-02')
 assert.equal(carried.mark,null)
 const marked=await ask('/api/routines/'+weekly.body.id+'/mark','POST',
   {date:'2026-11-03',status:'completed'},owner)
 assert.equal(marked.status,200,JSON.stringify(marked.body))
 const sameDay=await day('2026-11-03')
 assert.ok(sameDay.body.items.find(x=>x.id===weekly.body.id)?.mark?.completed_at)
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
 assert.equal(nov4.body.items.find(x=>x.id===monthly.body.id)?.carriedFrom,'2026-11-01')
 const saved=await ask('/api/routines/'+monthly.body.id+'/mark','POST',
   {date:'2026-11-04',status:'completed'},owner)
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

test('shopping links to a verified kakebo expense and edits / removes details safely',async()=>{
 const {db,sqlite}=makeDb()
 sqlite.exec("UPDATE environment_identity SET database_name='homeflow' WHERE key='current'")
 const token='test-read-token-012345678901234567890'
 const env={APP_ENV:'production',DB:db,HOMEFLOW_BOOTSTRAP_SECRET:'example-secret-for-test-012345678901234',
   KAKEBO_LEDGER_API_URL:'https://kakeibo-f17.pages.dev/api/homeflow-ledger',KAKEBO_LEDGER_READ_TOKEN:token}
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
   assert.equal(options.headers.Authorization,'Bearer '+token)
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
   KAKEBO_LEDGER_API_URL:'https://kakeibo-f17.pages.dev/api/homeflow-ledger',KAKEBO_LEDGER_READ_TOKEN:token}
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
 assert.equal((await ask('/api/finance/status','GET',undefined,partner)).status,403)
 let externalRequests=0
 const old=globalThis.fetch
 globalThis.fetch=async(url,opts)=>{
   externalRequests++
   assert.equal(opts.headers.Authorization,'Bearer '+token)
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
 assert.equal(done.status,200,JSON.stringify(done.body))
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
 assert.equal((await send(env,'/api/shopping/'+older.body.id+'/toggle','POST',{completed:true},cookie)).status,200)
 const yesterday=new Date(Date.now()-2*86400000).toISOString()
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
 assert.equal(active.body.items.length,1,JSON.stringify(active.body))
 assert.equal(active.body.items[0].title,'明年的旅行')
 assert.equal(history.body.items.length,1,JSON.stringify(history.body))
 assert.equal(history.body.items[0].title,'过去的旅行')
 sqlite.close()
})
