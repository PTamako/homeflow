import test from 'node:test'
import assert from 'node:assert/strict'
import {closedGoalPeriods,settleGoalPeriod,goalPeriodsRoute} from '../worker/goal-settlements.js'
import {todayPlansRoute} from '../worker/plan-today.js'

const ID='11111111-1111-4111-8111-111111111111'
const owner={role:'owner',household_id:'home',user_id:'alice'}
const goal={id:ID,household_id:'home',created_by:'alice',visibility:'household',
  goal_mode:'monthly',start_on:'2026-09-15',target_on:null,target_amount:60000}
const req=(path,method='GET',data)=>new Request('https://homeflow.test'+path,{
  method,...(data===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(data)})})

function fixture(net){
 const statements=[],outgoing=[]
 const db={
   prepare(sql){const st={sql,values:[],
     bind(...values){this.values=values;return this},
     async first(){
       if(sql.includes('FROM goals'))return goal
       if(sql.includes('FROM goal_period_adjustments'))return {adjustment_amount:2000}
       return null
     },
     async all(){return {results:[]}},
     async run(){statements.push(this);return {success:true}}}
     return st
   },
   async batch(statementsBatch){statements.push(...statementsBatch);return []}
 }
 const env={APP_ENV:'production',DB:db,
   KAKEBO_LEDGER_API_URL:'https://kakeibo-f17.pages.dev/api/homeflow-ledger',
   KAKEBO_LEDGER_SERVICE:{fetch:async url=>{
     outgoing.push(new URL(url))
     return Response.json({income:100000,expense:100000-net,net})
   }}}
 return {env,db,statements,outgoing}
}

test('closed monthly periods do not appear before the JST cutoff, and respect partial first month',()=>{
 const before=closedGoalPeriods(goal,'2026-10-31')
 assert.deepEqual(before.map(x=>x.periodKey),['2026-09'])
 const after=closedGoalPeriods(goal,'2026-11-05')
 assert.deepEqual(after.map(x=>x.periodKey),['2026-10','2026-09'])
 assert.equal(after[1].start,'2026-09-15')
 assert.equal(after[1].periodEnd,'2026-09-30')
 assert.deepEqual(closedGoalPeriods(goal,'2026-11-05',1,'2026-10').map(x=>x.periodKey),['2026-09'])
 assert.deepEqual(closedGoalPeriods(goal,'2026-11-05',5,'','2026','09').map(x=>x.periodKey),['2026-09'])
})
test('yearly period and early final target date close the day after the deadline',()=>{
 const annual={...goal,goal_mode:'yearly',start_on:'2026-09-01',target_on:'2027-05-04'}
 assert.equal(closedGoalPeriods(annual,'2027-05-04').length,1)
 assert.deepEqual(closedGoalPeriods(annual,'2027-05-05').map(x=>x.periodKey),['2027','2026'])
 assert.equal(closedGoalPeriods(annual,'2027-05-05')[0].periodEnd,'2027-05-04')
})
test('shortfall is a real settlement with a signed gap, not an overdue task',async()=>{
 const {env,outgoing,statements}=fixture(30000)
 const result=await settleGoalPeriod(env,goal,'2026-10','2026-11-05')
 assert.equal(result.status,'shortfall')
 assert.equal(result.actualAmount,32000)
 assert.equal(result.targetAmount,60000)
 assert.equal(result.differenceAmount,28000)
 assert.equal(outgoing.length,1)
 assert.equal(outgoing[0].searchParams.get('start'),'2026-10-01')
 assert.equal(outgoing[0].searchParams.get('end'),'2026-10-31')
 assert.equal(statements.length,2)
 assert.equal(statements[0].values.at(-2),'scheduled')
 assert.match(statements[0].sql,/goal_period_settlements/)
 assert.match(statements[1].sql,/DELETE FROM plan_completion_marks/)
})
test('met goal is settled with over-target difference, and failure never saves a zero snapshot',async()=>{
 const {env,statements}=fixture(65000)
 const ok=await settleGoalPeriod(env,goal,'2026-10','2026-11-05')
 assert.equal(ok.status,'met')
 assert.equal(ok.differenceAmount,-7000)
 assert.match(statements[1].sql,/INSERT OR IGNORE INTO plan_completion_marks/)
 const failed=fixture(1000)
 failed.env.KAKEBO_LEDGER_SERVICE.fetch=async()=>{throw Error('network offline')}
 const result=await settleGoalPeriod(failed.env,goal,'2026-10','2026-11-05')
 assert.equal(result.ok,false)
 assert.equal(failed.statements.length,0)
})
test('manual recheck records a reviewed result without changing the shortfall',async()=>{
 const {env,statements}=fixture(30000)
 const result=await settleGoalPeriod(env,goal,'2026-10','2026-11-05',true)
 assert.equal(result.status,'shortfall')
 assert.equal(result.differenceAmount,28000)
 assert.equal(result.settlementOrigin,'manual')
 assert.match(statements[0].sql,/settlement_origin=excluded.settlement_origin/)
 assert.equal(statements[0].values.at(-2),'manual')
 assert.equal(statements[1].sql.includes('DELETE FROM plan_completion_marks'),true)
})

test('period history is bounded at five and never calls Kakebo on page render',async()=>{
 const {env,outgoing}=fixture(1)
 const result=await goalPeriodsRoute(req('/api/goals/'+ID+'/periods?limit=5'),env,
   '/api/goals/'+ID+'/periods',owner)
 assert.equal(result.status,200)
 const data=await result.json()
 assert.deepEqual(data.items.map(x=>x.periodKey),closedGoalPeriods(goal,new Date(Date.now()+9*3600000).toISOString().slice(0,10),5).map(x=>x.periodKey))
 assert.equal(data.items.every(x=>x.status==='pending'&&x.actualAmount===null),true)
 assert.equal(outgoing.length,0)
})
test('Today consolidates missing settlement periods into one reminder and no overdue goal rows',async()=>{
 const db={prepare(sql){return {bind(){return this},all:async()=>({results:[]})}},async batch(){return [
   {results:[]},{results:[]},{results:[goal]},{results:[]},
   {results:[]},{results:[]}
 ]}}
 const result=await todayPlansRoute(req('/api/plans/today?date=2026-11-05'),db,owner)
 const data=await result.json()
 assert.equal(data.items.length,0)
 assert.equal(data.goalReviews.length,1)
 assert.equal(data.goalReviews[0].pendingCount,2)
 assert.equal(data.goalReviews[0].periodKey,'2026-09')
})
test('settlement API rejects non-owner and does not settle current month',async()=>{
 const {env,outgoing}=fixture(90000)
 const endpoint='/api/goals/'+ID+'/periods/settle'
 const member=await goalPeriodsRoute(req(endpoint,'POST',{periodKey:'2026-10'}),
   env,endpoint,{...owner,role:'member'})
 assert.equal(member.status,403)
 const current=await goalPeriodsRoute(req(endpoint,'POST',{periodKey:'2026-11'}),env,endpoint,owner)
 assert.equal(current.status,409)
 assert.equal(outgoing.length,0)
})
