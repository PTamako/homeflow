import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {tasksRoute} from '../worker/tasks.js'
const root='https://homeflow.example.test/api/tasks'
const session=(who)=>({household_id:'primary',user_id:who,role:'member'})
const task={title:'Shared household work',notes:'',visibility:'household',dueOn:null,
 assigneeUserId:null,secondAssigneeUserId:null,subjectProfileId:null,bonusPoints:0}
const request=(actor,path=root,method='POST')=>new Request(path,{
 method,headers:{'content-type':'application/json','x-homeflow-offline-actor':actor},
 body:JSON.stringify(task)})
test('stale iPhone offline outbox actor cannot POST a household task under a different logged-in member cookie',async()=>{
 let touched=0
 const db={prepare(){touched++;throw Error('should not query D1')}}
 const res=await tasksRoute(request('old-member'),db,'/api/tasks',session('new-member'))
 assert.equal(res.status,403)
 assert.equal((await res.json()).error,'offline_actor_changed')
 assert.equal(touched,0)
})
test('stale iPhone offline outbox actor cannot PATCH a shared task under other member cookie',async()=>{
 let touched=0
 const db={prepare(){touched++;throw Error('should not query D1')}}
 const path='/api/tasks/11111111-1111-4111-8111-111111111111'
 const res=await tasksRoute(request('old-member',root+'/11111111-1111-4111-8111-111111111111','PATCH'),
  db,path,session('new-member'))
 assert.equal(res.status,403)
 assert.equal(touched,0)
})
test('matching replay actor writes once using original authenticated session; no extra authorization D1 query',async()=>{
 let ran=0
 const db={prepare(q){assert.match(q,/INSERT OR IGNORE INTO tasks/)
  return{bind(){return{async run(){ran++;return {meta:{changes:1}}}}}}}}
 const res=await tasksRoute(request('current-member'),db,'/api/tasks',session('current-member'))
 assert.equal(res.status,201)
 assert.equal((await res.json()).ok,true)
 assert.equal(ran,1)
})
test('offline sender and outbox replay both pin original user ID as actor guard; no financial offline retries',()=>{
 const code=readFileSync(new URL('../src/offline-tasks.ts',import.meta.url),'utf8')
 assert.match(code,/'x-homeflow-offline-actor':userId/)
 assert.match(code,/'x-homeflow-offline-actor':op.userId/)
 assert.match(code,/op.userId!==userId/)
 assert.match(code,/response.status===409/)
 assert.doesNotMatch(code,/\/api\/finance/)
})
