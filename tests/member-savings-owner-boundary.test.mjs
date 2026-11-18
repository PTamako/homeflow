import test from 'node:test'
import assert from 'node:assert/strict'
import {financeRoute,verifiedGoalProgress} from '../worker/finance.js'
import {goalPeriodsRoute} from '../worker/goal-settlements.js'
import {todayPlansRoute} from '../worker/plan-today.js'

const ID='11111111-1111-4111-8111-111111111111'
const member={user_id:'member',household_id:'home',role:'member'}
const owner={user_id:'owner',household_id:'home',role:'owner'}
const goal={id:ID,household_id:'home',created_by:'member',creator_role:'member',
  visibility:'private',goal_mode:'monthly',start_on:'2026-09-01',target_on:null,
  target_amount:20000,reserved_amount:0}
const req=(path,method='GET',body)=>new Request('https://homeflow.test'+path,{
  method,...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})
})
function fixture(g=goal){
  const calls=[],writes=[]
  const db={
    prepare(sql){
      const stmt={sql,bind(...params){this.params=params;return this},
        async first(){
          if(sql.includes('FROM goals'))return g
          if(sql.includes('FROM goal_period_adjustments'))return {adjustment_amount:20000}
          if(sql.includes('FROM finance_target_settings'))return {adjustment_amount:20000}
          if(sql.includes('FROM goal_period_settlements'))return null
          return null
        },
        async all(){return {results:[]}},
        async run(){writes.push({sql,params:this.params});return {meta:{changes:1}}}
      }
      return stmt
    },
    async batch(statements){
      writes.push(...statements.map(s=>({sql:s.sql,params:s.params})))
      return statements.map(()=>({meta:{changes:1},results:[]}))
    }
  }
  const env={APP_ENV:'production',DB:db,
    KAKEBO_LEDGER_API_URL:'https://kakeibo-f17.pages.dev/api/homeflow-ledger',
    KAKEBO_LEDGER_SERVICE:{fetch:async()=>{calls.push('ledger');throw Error('private_ledger_must_not_be_queried')}}}
  return {db,env,calls,writes}
}

test('personal goal progress uses own adjustments without Kakeibo ledger',async()=>{
  const f=fixture()
  const progress=await verifiedGoalProgress(f.env,goal,'2026-10','2026-11-18',{personalOnly:true})
  assert.equal(progress.amount,20000)
  assert.equal(progress.ok,true)
  assert.equal(progress.calculationBasis,'personal_manual_estimate')
  assert.equal(f.calls.length,0)
})
test('member can inspect own personal goal estimate, other members cannot',async()=>{
  const f=fixture()
  const path='/api/finance/goal/net?targetId='+ID+'&periodKey=2026-10'
  const allowed=await financeRoute(req(path),f.env,'/api/finance/goal/net',member)
  assert.equal(allowed.status,200)
  const data=await allowed.json()
  assert.equal(data.net,0)
  assert.equal(data.calculationBasis,'personal_manual_estimate')
  assert.equal(f.calls.length,0)
  const blocked=await financeRoute(req(path),f.env,'/api/finance/goal/net',
    {...member,user_id:'other-member'})
  assert.equal(blocked.status,403)
})
test('personal monthly settlement works without owner and never reads household ledger',async()=>{
  const f=fixture()
  const path='/api/goals/'+ID+'/periods/settle'
  const response=await goalPeriodsRoute(req(path,'POST',{periodKey:'2026-10'}),
    f.env,path,member)
  assert.equal(response.status,200)
  const result=await response.json()
  assert.equal(result.status,'met')
  assert.equal(result.calculationBasis,'personal_manual_estimate')
  assert.equal(f.calls.length,0)
  assert.ok(f.writes.some(row=>row.sql.includes('goal_period_settlements')))
})
test('member cannot settle another creator goal even if household-visible',async()=>{
  const f=fixture({...goal,visibility:'household',created_by:'owner',creator_role:'owner'})
  const path='/api/goals/'+ID+'/periods/settle'
  const response=await goalPeriodsRoute(req(path,'POST',{periodKey:'2026-10'}),
    f.env,path,member)
  assert.equal(response.status,403)
  assert.equal(f.calls.length,0)
})
