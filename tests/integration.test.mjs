import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import worker from '../worker/index.js'

function makeDb() {
 const sqlite=new DatabaseSync(':memory:')
 sqlite.exec('PRAGMA foreign_keys=ON;')
 for (const filename of ['0001_core.sql','0002_stage1_family_tasks.sql','0003_life_projects.sql','0004_push_notifications.sql','0005_interval_policies.sql','0006_pet_health.sql','0007_offline_tasks.sql']) {
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
 const response=await worker.fetch(req(path,method,body,cookie,csrf),env)
 const result=await response.json()
 return {status:response.status,cookie:response.headers.get('set-cookie'),body:result}
}
function extractCookie(header) {return header?.split(';')[0]||''}

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
