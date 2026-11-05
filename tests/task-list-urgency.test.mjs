import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {sortPlanTasks,taskUrgencyKey} from '../src/plan-task-sort.mjs'
import {tasksRoute} from '../worker/tasks.js'

const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0')
test('active combined tasks prioritize overdue, then near dates, then undated',()=>{
 const routines=[
  {id:uuid(1),nextDueOn:'2026-11-09'},
  {id:uuid(2),currentStatus:'pending',currentPeriodOn:'2026-11-03',nextDueOn:'2026-11-06'},
  {id:uuid(3),nextDueOn:'2026-12-03'}
 ]
 const tasks=[
  {id:uuid(4),dueOn:'2026-11-05'},
  {id:uuid(5),dueOn:null},
  {id:uuid(6),dueOn:'2026-11-07'}
 ]
 const rows=sortPlanTasks(routines,tasks)
 assert.deepEqual(rows.map(x=>x.item.id),[2,4,6,1,3,5].map(uuid))
 assert.equal(rows.slice(0,5).length,5)
 assert.equal(taskUrgencyKey('task',{dueOn:null}),'9999-12-31')
})
test('history combines routine period dates and one-off completion dates latest first',()=>{
 const rows=sortPlanTasks(
  [{id:uuid(1),periodOn:'2026-11-03'},{id:uuid(2),periodOn:'2026-11-09'}],
  [{id:uuid(3),completedAt:'2026-11-04T17:00:00Z'}],'history')
 assert.deepEqual(rows.map(x=>x.item.id),[2,3,1].map(uuid))
})
test('active task endpoint performs date-ascending keyset paging',async()=>{
 const statements=[]
 const db={prepare(sql){
   const q={bind(...args){this.args=args;return this},async all(){
     statements.push({sql,args:this.args});return {results:[]}
   }};return q
 }}
 const session={household_id:'home',user_id:'self'}
 const req=new Request('https://example.invalid/api/tasks?scope=active&order=due&limit=5')
 const res=await tasksRoute(req,db,'/api/tasks',session)
 assert.equal(res.status,200)
 assert.match(statements[0].sql,/ORDER BY COALESCE\(due_on,'9999-12-31'\) ASC,id ASC LIMIT/)
 assert.deepEqual((await res.json()).items,[])
})
test('plan card uses one five-row page rather than two independent five-row lists',()=>{
 const source=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
 assert.match(source,/visibleTaskRows=computed\(\(\)=>taskRows\.value\.slice\(taskPage\.value\*pageLimit,\(taskPage\.value\+1\)\*pageLimit\)\)/)
 assert.match(source,/v-for="entry in visibleTaskRows"/)
 assert.match(source,/下一页/)
 assert.doesNotMatch(source,/加载更多定期任务/)
 assert.doesNotMatch(source,/加载更多一次性任务/)
 assert.match(source,/q\.set\('order','due'\)/)
})
