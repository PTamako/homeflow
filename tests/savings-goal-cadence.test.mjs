import test from 'node:test'
import assert from 'node:assert/strict'
import {goalPeriod} from '../worker/goal-period.js'
import {lifeRoute} from '../worker/life.js'
import {financeRoute} from '../worker/finance.js'

const goalId='11111111-1111-4111-8111-111111111111'
const owner={role:'owner',household_id:'family',user_id:'owner'}
const req=(path,method='GET',payload)=>new Request('https://homeflow.invalid'+path,{
  method,...(payload===undefined?{}:{
    headers:{'content-type':'application/json'},body:JSON.stringify(payload)})
})
function goalDb(){
 const writes=[],reads=[]
 const goal={id:goalId,goal_mode:'monthly',start_on:'2026-07-10',
   target_on:null,reserved_amount:55000,target_amount:50000}
 return {writes,reads,goal,prepare(sql){
  const item={bind(...values){this.values=values;return this},
    async first(){
      reads.push({sql,values:this.values})
      if(sql.includes('FROM goals'))return goal
      if(sql.includes('FROM goal_period_adjustments'))return {adjustment_amount:2300}
      if(sql.includes('FROM finance_target_settings'))return null
      return null
    },
    async run(){writes.push({sql,values:this.values});return {success:true}}
  }
  return item
 }}
}
function env(db,ledgerFetch=async()=>Response.json({income:0,expense:0,net:0})){
 return {APP_ENV:'production',DB:db,
  KAKEBO_LEDGER_API_URL:'https://kakeibo-f17.pages.dev/api/homeflow-ledger',
  KAKEBO_LEDGER_SERVICE:{fetch:ledgerFetch}}
}
test('calendar month begins on first day except first partial month',()=>{
 const g={goal_mode:'monthly',start_on:'2026-07-10'}
 assert.deepEqual(goalPeriod(g,'2026-07','2026-07-20'),{
  periodKey:'2026-07',start:'2026-07-10',end:'2026-07-20',
  periodEnd:'2026-07-31',notStarted:false
 })
 assert.equal(goalPeriod(g,'2026-06','2026-11-04'),null)
 const november=goalPeriod(g,'2026-11','2026-11-04')
 assert.equal(november.start,'2026-11-01')
 assert.equal(november.end,'2026-11-04')
})
test('annual window starts on chosen date, then calendar year; future years do not query ledger',()=>{
 const g={goal_mode:'yearly',start_on:'2026-07-10'}
 assert.equal(goalPeriod(g,'2026','2026-11-04').start,'2026-07-10')
 assert.equal(goalPeriod(g,'2027','2027-12-31').start,'2027-01-01')
 assert.equal(goalPeriod(g,'2027','2026-11-04').notStarted,true)
 assert.equal(goalPeriod({...g,target_on:'2027-05-15'},'2027','2027-12-31').end,'2027-05-15')
 assert.equal(goalPeriod(g,'2026-13','2026-11-04'),null)
})
test('recurring goal period adjustment is scoped to one calendar period',async()=>{
 const db=goalDb()
 const get=await financeRoute(req('/api/finance/settings?type=goal&targetId='+goalId+
   '&periodKey=2026-10'),env(db),'/api/finance/settings',owner)
 assert.equal(get.status,200)
 const data=await get.json()
 assert.equal(data.adjustmentAmount,2300)
 assert.equal(data.goalMode,'monthly')
 assert.equal(data.openingAmount,0)
 assert.equal(data.targetAmount,50000)
 assert.equal(data.periodStart,'2026-10-01')
 const put=await financeRoute(req('/api/finance/settings','PUT',{
  type:'goal',targetId:goalId,adjustmentAmount:-3000,periodKey:'2026-10'
 }),env(db),'/api/finance/settings',owner)
 assert.equal(put.status,200)
 assert.equal(db.writes.length,1)
 assert.match(db.writes[0].sql,/goal_period_adjustments/)
 assert.deepEqual(db.writes[0].values.slice(0,4),['family',goalId,'2026-10',-3000])
})
test('monthly net fetch uses only that one period in kakeibo',async()=>{
 const db=goalDb()
 let requests=0
 const ledgerFetch=async url=>{
   requests++
   const u=new URL(url)
   assert.equal(u.searchParams.get('summary'),'net')
   assert.equal(u.searchParams.get('start'),'2026-10-01')
   assert.equal(u.searchParams.get('end'),'2026-10-31')
   return Response.json({income:300000,expense:255000,net:45000})
 }
 const r=await financeRoute(req('/api/finance/goal/net?targetId='+goalId+
   '&periodKey=2026-10'),env(db,ledgerFetch),'/api/finance/goal/net',owner)
 assert.equal(r.status,200)
 const data=await r.json()
 assert.equal(data.net,45000)
 assert.equal(requests,1)
 assert.equal(db.writes.length,0)
})
test('future month nets to zero without querying kakeibo D1',async()=>{
 const db=goalDb()
 let requests=0
 const r=await financeRoute(req('/api/finance/goal/net?targetId='+goalId+
   '&periodKey=2027-01'),env(db,async()=>{requests++;throw Error('unexpected')}),'/api/finance/goal/net',owner)
 assert.equal(r.status,200)
 const body=await r.json()
 assert.equal(body.notStarted,true)
 assert.equal(body.net,0)
 assert.equal(requests,0)
})
test('recurring settings reject malformed or pre-start periods without write',async()=>{
 const db=goalDb()
 for(const key of ['2026-13','2026-06','2026-11-20']){
  const r=await financeRoute(req('/api/finance/settings','PUT',{
   type:'goal',targetId:goalId,adjustmentAmount:1000,periodKey:key
  }),env(db),'/api/finance/settings',owner)
  assert.equal(r.status,400,key)
 }
 assert.equal(db.writes.length,0)
})
test('yearly goal creation stores cadence and start without changing saved legacy mode',async()=>{
 const writes=[]
 const db={prepare(sql){return {bind(...values){this.values=values;return this},
   async run(){writes.push({sql,values:this.values});return {success:true}},
   async first(){return null}}}}
 const r=await lifeRoute(req('/api/goals','POST',{
  title:'每年旅行基金',targetAmount:600000,reservedAmount:0,
  currency:'JPY',visibility:'household',goalMode:'yearly',startOn:'2026-11-04'
 }),db,'/api/goals',owner)
 assert.equal(r.status,201)
 assert.equal(writes.length,1)
 assert.match(writes[0].sql,/goal_mode,start_on/)
 assert.deepEqual(writes[0].values.slice(-2),['yearly','2026-11-04'])
})
