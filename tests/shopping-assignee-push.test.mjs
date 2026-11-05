import assert from 'node:assert/strict'
import test from 'node:test'
import {readFileSync} from 'node:fs'
import {pushRoute} from '../worker/webpush.js'
const read=file=>readFileSync(new URL('../'+file,import.meta.url),'utf8')
const creator='11111111-1111-4111-8111-111111111111'
const recipient='22222222-2222-4222-8222-222222222222'
const shoppingId='33333333-3333-4333-8333-333333333333'
const session={household_id:'my-house',user_id:creator}
const env=db=>({DB:db,VAPID_PUBLIC_KEY:Buffer.alloc(65).toString('base64url'),
  VAPID_PRIVATE_JWK:JSON.stringify({kty:'EC',crv:'P-256',x:'x',y:'y',d:'z'})})
const req=(body)=>new Request('https://homeflow.invalid/api/push/send-task',{
  method:'POST',body:JSON.stringify({kind:'shopping',id:shoppingId,...body})})

test('shopping push selects existing, uncompleted shared purchase belonging to sender',async()=>{
 const log=[]
 const db={prepare(sql){return {bind(...args){log.push({sql,args});return {
  first:async()=>null
 }}}}}
 const response=await pushRoute(req({message:'路过超市买下牛奶'}),env(db),'/api/push/send-task',session)
 assert.equal(response.status,404)
 assert.equal((await response.json()).error,'task_not_shareable')
 assert.equal(log.length,1)
 assert.match(log[0].sql,/FROM shopping_items t JOIN household_members m/)
 assert.match(log[0].sql,/t.created_by=\?3/)
 assert.match(log[0].sql,/t.visibility='household'/)
 assert.match(log[0].sql,/t.completed_at IS NULL/)
 assert.match(log[0].sql,/t.deleted_at IS NULL/)
 assert.deepEqual(log[0].args,[shoppingId,'my-house',creator])
})
test('shopping push targets only the validated assigned family account',async()=>{
 const log=[]
 const db={prepare(sql){return {bind(...args){log.push({sql,args});return {
  first:async()=>({id:shoppingId,title:'牛奶',dueOn:null,recipientId:recipient}),
  all:async()=>({results:[]}),run:async()=>({meta:{changes:1}})
 }}}}}
 const response=await pushRoute(req({message:'下班路上买牛奶'}),env(db),'/api/push/send-task',session)
 assert.equal(response.status,200)
 assert.equal((await response.json()).inAppOnly,true)
 assert.equal(log.length,3)
 assert.match(log[1].sql,/FROM push_subscriptions WHERE household_id=\?1 AND user_id=\?2 LIMIT 10/)
 assert.deepEqual(log[1].args,['my-house',recipient])
})
test('shopping push never allows self notification, malformed ids or oversized notes',async()=>{
 let calls=0
 const db={prepare(){calls++;return {bind(){return {first:async()=>({id:shoppingId,title:'牛奶',recipientId:creator})}}}}}
 const same=await pushRoute(req({}),env(db),'/api/push/send-task',session)
 assert.equal(same.status,409)
 assert.equal((await same.json()).error,'recipient_is_self')
 const bad=await pushRoute(req({id:'oops'}),env(db),'/api/push/send-task',session)
 assert.equal(bad.status,400)
 const long=await pushRoute(req({message:'x'.repeat(121)}),env(db),'/api/push/send-task',session)
 assert.equal(long.status,400)
 assert.equal(calls,1)
})
test('shopping assignment is additive with no ledger completion side effects',()=>{
 const sql=read('migrations/0024_shopping_assignee.sql')
 const life=read('worker/life.js'),creator=read('src/components/PlanCreator.vue')
 const editor=read('src/components/LifeItemEditor.vue')
 const panel=read('src/components/LifePanel.vue')
 const reminder=read('worker/reminders.js')
 const prefs=read('src/components/ReminderItemEditor.vue')
 assert.match(sql,/ALTER TABLE shopping_items ADD COLUMN assigned_to TEXT REFERENCES users\(id\)/)
 assert.doesNotMatch(sql,/\bDELETE\b|\bUPDATE\b|DROP TABLE/i)
 assert.match(life,/shopping_items:\{columns:\['title','quantity','due_on','assigned_to'\]/)
 assert.match(life,/requestedVisibility==='private'&&data\[3\]!==session.user_id/)
 assert.match(life,/\['title','quantity','due_on','completed_at','ledger_entry_id','assigned_to'\]/)
 assert.match(creator,/send\('\/shopping',[^\n]*assignedTo:form.assignedTo\|\|null/)
 assert.match(editor,/case 'shopping':[\s\S]*?assignedTo:form.assignedTo\|\|null/)
 assert.match(panel,/openTaskPush\('shopping',s\)/)
 assert.match(panel,/notifyHandler\('shopping',s\)/)
 assert.match(panel,/memberName\(s.assigned_to\)/)
 assert.match(panel,/@saved="shoppingLinksChanged"/)
 assert.match(reminder,/AND completed_at IS NULL AND due_on IS NOT NULL AND due_on<=\?2/)
 assert.match(reminder,/AND \(assigned_to=\?3 OR assigned_to IS NULL\)/)
 assert.match(reminder,/forItem\('shopping',item.id\)/)
 assert.match(prefs,/kind:'task'\|'routine'\|'shopping'\|'trip'/)
 const app=read('src/App.vue')
 assert.match(app,/\['task','routine','shopping'\].includes\(kind\|\|''\)/)
})
