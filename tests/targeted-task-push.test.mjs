import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {pushRoute} from '../worker/webpush.js'
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8')
const A='11111111-1111-4111-8111-111111111111'
const B='22222222-2222-4222-8222-222222222222'
const TASK='33333333-3333-4333-8333-333333333333'
const session={household_id:'house-1',user_id:A}
const env=db=>({DB:db,VAPID_PUBLIC_KEY:Buffer.alloc(65).toString('base64url'),
  VAPID_PRIVATE_JWK:JSON.stringify({kty:'EC',crv:'P-256',x:'x',y:'y',d:'z'})})
const req=(path,body)=>new Request('https://homeflow.invalid/api/push/'+path,{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)})

test('send-task looks up only shared source created by the logged-in user',async()=>{
 const queries=[]
 const db={prepare(sql){return {bind(...args){queries.push({sql,args});return {
   first:async()=>null
 }}}}}
 const r=await pushRoute(req('send-task',{kind:'task',id:TASK}),env(db),'/api/push/send-task',session)
 assert.equal(r.status,404)
 assert.equal((await r.json()).error,'task_not_shareable')
 assert.equal(queries.length,1)
 assert.match(queries[0].sql,/JOIN household_members m/)
 assert.match(queries[0].sql,/t.visibility='household'/)
 assert.match(queries[0].sql,/t.creator_user_id=\?3/)
 assert.deepEqual(queries[0].args,[TASK,'house-1',A])
})

test('send-task sends only to the assigned recipient account, not the sender',async()=>{
 const queries=[]
 const db={prepare(sql){return {bind(...args){
    queries.push({sql,args})
    return {first:async()=>({id:TASK,title:'给豆沙喂药',dueOn:'2026-11-06',recipientId:B}),
      all:async()=>({results:[]}),run:async()=>({meta:{changes:1}})}
 }}}}
 const r=await pushRoute(req('send-task',{kind:'task',id:TASK}),env(db),'/api/push/send-task',session)
 assert.equal(r.status,200)
 assert.equal((await r.json()).inAppOnly,true)
 assert.equal(queries.length,3)
 assert.match(queries[1].sql,/FROM push_subscriptions WHERE household_id=\?1 AND user_id=\?2 LIMIT 10/)
 assert.deepEqual(queries[1].args,['house-1',B])
})

test('send-task rejects self-assignment and invalid input without querying subscriptions',async()=>{
 let calls=0
 const db={prepare(){calls++;return {bind(){return {first:async()=>({
   id:TASK,title:'任务',recipientId:A
 })}}}}}
 const self=await pushRoute(req('send-task',{kind:'task',id:TASK}),env(db),'/api/push/send-task',session)
 assert.equal(self.status,409)
 assert.equal((await self.json()).error,'recipient_is_self')
 assert.equal(calls,1)
 const bad=await pushRoute(req('send-task',{kind:'task',id:'oops'}),env(db),'/api/push/send-task',session)
 assert.equal(bad.status,400)
 assert.equal(calls,1)
})

test('family message recipients must belong to same household',async()=>{
 const queries=[]
 const db={prepare(sql){return {bind(...args){queries.push({sql,args});return {first:async()=>null}}}}}
 const r=await pushRoute(req('send-family',{recipientUserId:B,message:'回家记得买牛奶'}),
   env(db),'/api/push/send-family',session)
 assert.equal(r.status,404)
 assert.equal((await r.json()).error,'recipient_not_in_household')
 assert.equal(queries.length,1)
 assert.match(queries[0].sql,/FROM household_members/)
 assert.deepEqual(queries[0].args,['house-1',B])
})

test('task and message UI link to the secure push routes and deep-link task details',()=>{
 const life=read('src/components/LifePanel.vue')
 const web=read('worker/webpush.js'),app=read('src/App.vue'),sw=read('public/sw.js')
 const push=read('src/components/PushPanel.vue')
 assert.match(life,/notifyHandler\('task',t\)/)
 assert.match(life,/notifyHandler\('routine',r\)/)
 assert.match(life,/处理人：\{\{ memberName\(t\.assigneeUserId\) \}\}/)
 assert.match(web,/\/\?taskType='/)
 assert.match(web,/taskId='/)
 assert.match(web,/WHERE household_id=\?1 AND user_id=\?2 LIMIT 10/)
 assert.match(push,/send-family/)
 assert.match(app,/function consumeTaskLink\(/)
 assert.match(sw,/homeflow-open-task/)
 assert.match(sw,/target\.searchParams\.get\('taskId'\)/)
})
