import test from 'node:test'
import assert from 'node:assert/strict'
import {archiveFilter,candidateGoalPeriods,goalPeriodArchiveRoute} from '../worker/goal-period-archive.js'

const a='11111111-1111-4111-8111-111111111111'
const b='22222222-2222-4222-8222-222222222222'
const session={household_id:'house',user_id:'owner',role:'owner'}
const monthly={id:a,title:'月目标存款',goal_mode:'monthly',
  start_on:'2026-10-01',target_on:null,target_amount:60000}
const yearly={id:b,title:'每年存款',goal_mode:'yearly',
  start_on:'2025-01-01',target_on:null,target_amount:500000}
const request=path=>new Request('https://homeflow.invalid'+path)

function fakeDb(goals=[monthly],snapshots=[]){
 const queries=[]
 const db={prepare(sql){const row={sql,params:[],
   bind(...params){this.params=params;queries.push(this);return this},
   async all(){
     if(sql.includes('FROM goals WHERE'))return {results:goals}
     if(sql.includes('WITH requested('))return {results:snapshots}
     throw Error('unexpected SQL read: '+sql)
   }};return row}}
 return {db,queries}
}

test('unbounded recurring goal remains active while October becomes a history entry',()=>{
 const opts=archiveFilter('https://x.invalid?limit=5')
 assert.deepEqual(candidateGoalPeriods([monthly],opts,'2026-10-31'),[])
 const archived=candidateGoalPeriods([monthly],opts,'2026-11-05')
 assert.equal(archived.length,1)
 assert.equal(archived[0].title,'月目标存款')
 assert.equal(archived[0].periodKey,'2026-10')
 assert.equal(archived[0].periodEnd,'2026-10-31')
 assert.equal(archived[0].targetAmount,60000)
 assert.equal(monthly.target_on,null)
})

test('yearly goals generate one history record per closed year without ending the parent',()=>{
 const p=candidateGoalPeriods([yearly],archiveFilter('https://x.invalid?limit=5'),'2027-01-01')
 assert.deepEqual(p.map(x=>x.periodKey),['2026','2025'])
 assert.equal(p[0].periodEnd,'2026-12-31')
 assert.deepEqual(candidateGoalPeriods([yearly],
   archiveFilter('https://x.invalid?year=2026&month=12'),'2027-01-01').map(x=>x.periodKey),['2026'])
 assert.deepEqual(candidateGoalPeriods([yearly],
   archiveFilter('https://x.invalid?year=2026&month=11'),'2027-01-01'),[])
})

test('history supports end-period year/month and five-item cursor pagination without duplicates',()=>{
 const goal={...monthly,start_on:'2026-01-01'}
 const first=candidateGoalPeriods([goal],archiveFilter('https://x.invalid?limit=5'),'2026-11-05')
 assert.deepEqual(first.map(x=>x.periodKey),['2026-10','2026-09','2026-08','2026-07','2026-06','2026-05'])
 const cursor=first[4].periodEnd+'|'+a
 const next=candidateGoalPeriods([goal],archiveFilter('https://x.invalid?limit=5&cursor='+encodeURIComponent(cursor)),'2026-11-05')
 assert.deepEqual(next.map(x=>x.periodKey),['2026-05','2026-04','2026-03','2026-02','2026-01'])
 const october=candidateGoalPeriods([goal],archiveFilter('https://x.invalid?year=2026&month=10'),'2026-11-05')
 assert.deepEqual(october.map(x=>x.periodKey),['2026-10'])
})

test('two goals closing on the same day page by period end and goal id',()=>{
 const g2={...monthly,id:b,title:'另一条'}
 const opts=archiveFilter('https://x.invalid?limit=1')
 const first=candidateGoalPeriods([monthly,g2],opts,'2026-11-05')
 assert.equal(first[0].goalId,b)
 const next=candidateGoalPeriods([monthly,g2],archiveFilter(
   'https://x.invalid?limit=1&cursor=2026-10-31%7C'+b),'2026-11-05')
 assert.equal(next[0].goalId,a)
})

test('history endpoint reads only two bounded HomeFlow D1 queries, no ledger lookups',async()=>{
 const {db,queries}=fakeDb([monthly],[{
   goal_id:a,period_key:'2026-10',status:'shortfall',
   target_amount:60000,actual_amount:47862,difference_amount:12138,
   settled_at:'2026-11-05T00:00:00.000Z'
 }])
 const res=await goalPeriodArchiveRoute(request('/api/goals/period-archive?year=2026&month=10'),db,session)
 assert.equal(res.status,200)
 const body=await res.json()
 assert.deepEqual(body.items.map(x=>x.periodKey),['2026-10'])
 assert.equal(body.items[0].status,'shortfall')
 assert.equal(body.items[0].actualAmount,47862)
 assert.equal(body.items[0].differenceAmount,12138)
 assert.equal(queries.length,2)
 assert.equal(queries[0].params[0],'house')
 assert.equal(queries[0].params[1],'owner')
 assert.ok(queries.every(x=>!x.sql.includes('kakebo_')&&!x.sql.includes('finance_links')))
})
test('unknown ended-period amounts remain pending, never zero',async()=>{
 const {db}=fakeDb()
 const res=await goalPeriodArchiveRoute(request('/api/goals/period-archive'),db,session)
 assert.equal(res.status,200)
 const item=(await res.json()).items[0]
 if(item){assert.equal(item.actualAmount,null);assert.equal(item.differenceAmount,null);assert.equal(item.status,'pending')}
})
test('invalid filters never touch database',async()=>{
 const {db,queries}=fakeDb()
 for(const q of ['limit=0','year=2026&month=13','month=10','cursor=garbage','limit=31']){
   const res=await goalPeriodArchiveRoute(request('/api/goals/period-archive?'+q),db,session)
   assert.equal(res.status,400,q)
 }
 assert.equal(queries.length,0)
})

