import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {tasksRoute} from '../worker/tasks.js'

const app=readFileSync(new URL('../src/App.vue',import.meta.url),'utf8')
const life=readFileSync(new URL('../src/components/LifePanel.vue',import.meta.url),'utf8')
const worker=readFileSync(new URL('../worker/tasks.js',import.meta.url),'utf8')
const session={household_id:'household-a',user_id:'user-a'}
const id='00000000-0000-4000-8000-000000000001'

test('completed Today checkboxes stay checked but cannot be toggled',()=>{
 assert.match(app,/:checked="row.done"\s+:disabled="row.done\|\|!canFinishEntry\(row\)/)
 assert.match(app,/:aria-label="\(row.done\?'已完成，请到查看计划撤销：':'完成 '\)\+row.title"/)
 assert.match(app,/async function toggleTask\(t:Task\)\{\s*\/\/[^\n]*\n  if\(t.completedAt\)return/)
 assert.match(app,/async function toggleRoutine\(r:Routine\)\{[\s\S]*?if\(routineBusy.value\|\|r.mark\?\.completed_at\)return/)
 assert.match(app, /row.done\?'查看计划':'去处理'/)
 assert.match(app,/focusPlanScope.value=done&&\(kind==='task'\|\|kind==='routine'/)
})

test('Plans history allows undo for completed one-time tasks and routine occurrences',()=>{
 assert.match(life,/async function undoOnce\(t:Row\)/)
 assert.match(life,/@click="undoOnce\(t\)">撤销/)
 assert.match(life, /t.completedAt&&canUndoOnce\(t\)/)
 assert.match(life, /api\('\/tasks\/'\+t.id,'PATCH',\{completed:false\}\)/)
 assert.match(life, /api\('\/routines\/'\+r.id\+'\/mark','POST'/)
 assert.match(life, /r.periodOn<today\(\)/)
})

test('expired single tasks are inferred as missed in history rather than active',async()=>{
 const log=[]
 const mockRow={id,title:'一次性任务',notes:'',visibility:'household',
  dueOn:'2020-01-01',createdAt:'2020-01-01T12:00:00Z',completedAt:null,
  historySortAt:'2020-01-01T23:59:59Z'}
 const db={prepare(sql){return {sql,
    bind(...args){this.args=args;return this},
    async all(){log.push({sql:this.sql,args:this.args});return {results:sql.includes('completed_at IS NOT NULL OR')?[mockRow]:[]}}
  }}}
 const hist=await tasksRoute(new Request('https://example.org/api/tasks?scope=history&limit=5'),
    db,'/api/tasks',session)
 assert.equal(hist.status,200)
 assert.equal((await hist.json()).items[0].missed,true)
 const query=log[0].sql
 assert.match(query,/completed_at IS NOT NULL OR \(completed_at IS NULL AND due_on<date\('now','\+9 hours'\)\)/)
 assert.match(query,/ORDER BY COALESCE\(completed_at,due_on\|\|'T23:59:59Z'\) DESC/)
 const active=await tasksRoute(new Request('https://example.org/api/tasks?scope=active&limit=5'),db,'/api/tasks',session)
 assert.deepEqual((await active.json()).items,[])
 assert.match(log[1].sql,/completed_at IS NULL AND \(due_on IS NULL OR due_on>=date\('now','\+9 hours'\)\)/)
 assert.match(life,/:label="t.completedAt\?'已完成':t.dueOn&&t.dueOn<today\(\)\?'未完成'/)
})

test('history cursor uses completion timestamp or virtual missed day',async()=>{
 const rows=Array.from({length:6},(_,i)=>({id:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),
    dueOn:'2020-01-01',completedAt:null,historySortAt:'2020-01-01T23:59:59Z'}))
 const db={prepare(sql){return {bind(){return this},async all(){return {results:rows}}}}}
 const response=await tasksRoute(new Request('https://example.org/api/tasks?scope=history&limit=5'),db,'/api/tasks',session)
 const data=await response.json()
 assert.equal(data.items.length,5)
 assert.equal(data.nextCursor,'2020-01-01T23:59:59Z|'+rows[4].id)
})
