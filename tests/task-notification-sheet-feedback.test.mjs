import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {pushRoute} from '../worker/webpush.js'

const source=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
const sender='11111111-1111-4111-8111-111111111111'
const recipient='22222222-2222-4222-8222-222222222222'
const routine='33333333-3333-4333-8333-333333333333'
const session={household_id:'house-1',user_id:sender}

test('task notification sheets show errors where the send button is and avoid native form submits',()=>{
 assert.match(source,/pushError=ref\(''\)/)
 assert.match(source,/pushError\.value=\(e as Error\)\.message/)
 for(const [kind,row] of [['routine','r'],['task','t'],['shopping','s']]){
  assert.ok(source.includes('@click.stop="notifyHandler(\''+kind+'\','+row+')"'),
   kind+' uses an explicit click handler')
 }
 assert.equal(source.split('class="task-push-error"').length-1,3)
 assert.equal(source.split('@close="closeTaskPush"').length-1,3)
 assert.match(source,/task_not_shareable:'本期指派可能已变化/)
})

test('manual routine notification creates a recipient inbox entry even without device subscriptions',async()=>{
 const queries=[]
 const db={prepare(sql){return {bind(...args){queries.push({sql,args});return {
  first:async()=>sql.includes('FROM routine_occurrence_assignments a')?
   {id:routine,title:'定期任务',dueOn:'2026-11-07',
    recipientId:recipient,secondRecipientId:null}:null,
  all:async()=>({results:[]}),
  run:async()=>({meta:{changes:1}})
 }}}}}
 const payload={kind:'routine',id:routine,periodOn:'2026-11-07',message:'本期请处理'}
 const response=await pushRoute(new Request('https://homeflow.invalid/api/push/send-task',{
  method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)
 }),{DB:db},'/api/push/send-task',session)
 const data=await response.json()
 assert.equal(response.status,200)
 assert.equal(data.ok,true)
 assert.equal(data.inAppOnly,true)
 assert.ok(queries.some(x=>x.sql.includes('INSERT INTO notification_inbox')))
 assert.ok(queries.some(x=>x.sql.includes('FROM routine_occurrence_assignments a')&&
  x.args[3]==='2026-11-07'))
})
