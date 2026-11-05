import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {pushRoute} from '../worker/webpush.js'
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8')

test('manual push requires the authenticated users subscriptions, not all household devices',async()=>{
 const seen=[]
 const db={prepare(sql){return {bind(...args){seen.push({sql,args});return {all:async()=>({results:[]})}}}}}
 const env={DB:db,VAPID_PUBLIC_KEY:Buffer.alloc(65).toString('base64url'),
   VAPID_PRIVATE_JWK:JSON.stringify({kty:'EC',crv:'P-256',x:'x',y:'y',d:'z'})}
 const session={household_id:'shared-house',user_id:'account-a'}
 const req=new Request('https://homeflow.invalid/api/push/send-now',{method:'POST'})
 const res=await pushRoute(req,env,'/api/push/send-now',session)
 assert.equal(res.status,409)
 assert.equal((await res.json()).error,'push_not_subscribed')
 assert.equal(seen.length,1)
 assert.match(seen[0].sql,/WHERE household_id=\?1 AND user_id=\?2 LIMIT 10/)
 assert.deepEqual(seen[0].args,['shared-house','account-a'])
})

test('manual push enforces configured VAPID and POST-only',async()=>{
 const session={household_id:'house',user_id:'user'}
 const env={DB:{prepare(){throw Error('unexpected DB query')}}}
 const post=new Request('https://homeflow.invalid/api/push/send-now',{method:'POST'})
 const get=new Request('https://homeflow.invalid/api/push/send-now')
 assert.equal((await pushRoute(get,env,'/api/push/send-now',session)).status,405)
 assert.equal((await pushRoute(post,env,'/api/push/send-now',session)).status,503)
})

test('task handlers appear in Today and Plans and map from existing family members',()=>{
 const app=read('src/App.vue')
 const life=read('src/components/LifePanel.vue')
 const creator=read('src/components/PlanCreator.vue')
 const once=read('src/components/OneTimeTaskFields.vue')
 const editor=read('src/components/LifeItemEditor.vue')
 const task=read('worker/tasks.js'),routine=read('worker/life.js')
 assert.match(app,/members\.value=a\.members\|\|\[\]/)
 assert.match(app,/发起人：\{\{ memberName\(row\.task\.creatorUserId\) \}\}/)
 assert.match(app,/处理人：\{\{ memberName\(row\.routine\.assigned_to\) \}\}/)
 assert.match(life,/发起人：\{\{ memberName\(t\.creatorUserId\) \}\}/)
 assert.match(life,/处理人：\{\{ memberName\(r\.assigned_to\) \}\}/)
 assert.match(once,/v-model="model\.assigneeUserId"/)
 assert.match(creator,/assignedTo:form\.assignedTo\|\|null/)
 assert.match(editor,/assignedTo:form\.assignedTo\|\|null/)
 assert.match(task,/creator_user_id,assignee_user_id/)
 assert.match(routine,/requestedVisibility==='private'&&data\[4\]/)
})

test('push reminders are scoped to the designated handler and preserve private visibility',()=>{
 const reminders=read('worker/reminders.js')
 const server=read('worker/webpush.js')
 const worker=read('worker/index.js')
 const panel=read('src/components/PushPanel.vue')
 assert.match(reminders,/AND \(visibility='household' OR created_by=\?2\) AND \(assigned_to=\?2 OR assigned_to IS NULL\)/)
 assert.match(reminders,/AND \(visibility='household' OR creator_user_id=\?3\) AND \(assignee_user_id=\?3 OR assignee_user_id IS NULL\)/)
 assert.match(server,/const key='manual-'\+slot/)
 assert.match(server,/INSERT OR IGNORE INTO notification_deliveries/)
 assert.match(worker,/path==='\/api\/push\/send-now'/)
 assert.doesNotMatch(panel,/>立即推送<\/button>/)
 assert.match(panel,/familyFormOpen\?'收起':'通知家人'/)
 assert.match(panel,/if\(members.length===1\)\{recipientId.value=members\[0\].id/)
 assert.match(panel,/recipientUserId:recipientId.value/)
 assert.doesNotMatch(panel,/async function sendNow\(/)
})

test('task push optionally accepts personalized note, rejects oversize, and never trusts a chosen recipient',async()=>{
 const id='123e4567-e89b-12d3-a456-426614174000',recipient='123e4567-e89b-12d3-a456-426614174001'
 const queries=[]
 const db={prepare(sql){return {bind(...args){
   queries.push({sql,args})
   return {
     first:async()=>({id,title:'给豆沙买猫粮',dueOn:'2026-11-06',recipientId:recipient}),
     all:async()=>({results:[]})
   }
 }}}}
 const env={DB:db,VAPID_PUBLIC_KEY:Buffer.alloc(65).toString('base64url'),
   VAPID_PRIVATE_JWK:JSON.stringify({kty:'EC',crv:'P-256',x:'x',y:'y',d:'z'})}
 const session={household_id:'family-a',user_id:'123e4567-e89b-12d3-a456-426614174002'}
 const endpoint='/api/push/send-task',url='https://homeflow.invalid'+endpoint
 const post=message=>new Request(url,{method:'POST',body:JSON.stringify({kind:'task',id,message,recipientUserId:'attacker'})})
 const invalid=await pushRoute(post('x'.repeat(121)),env,endpoint,session)
 assert.equal(invalid.status,400)
 assert.equal(queries.length,0)
 const accepted=await pushRoute(post('下班顺路买一下 🐱'),env,endpoint,session)
 assert.equal(accepted.status,409) // Recipient is authorized, but has no subscription in test DB
 assert.equal((await accepted.json()).error,'recipient_not_subscribed')
 assert.match(queries[0].sql,/t.visibility='household'/)
 assert.match(queries[0].sql,/JOIN household_members m ON m.user_id=/)
 assert.deepEqual(queries[0].args,[id,'family-a',session.user_id])
 assert.deepEqual(queries[1].args,['family-a',recipient])
 const server=read('worker/webpush.js')
 const form=read('src/components/LifePanel.vue')
 assert.match(server,/\(note\|\|'请查看并处理这项任务'\)/)
 assert.match(form,/message:pushMessage.value.trim\(\)/)
 assert.match(form,/maxlength="120"/)
 assert.match(form,/给 \{\{ memberName\(t.assigneeUserId\) \}\} 留言（可选）/)
})
