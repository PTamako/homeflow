import test from 'node:test'
import assert from 'node:assert/strict'
import {financeRoute} from '../worker/finance.js'

const goalId='11111111-1111-4111-8111-111111111111'
const shoppingId='22222222-2222-4222-8222-222222222222'
const owner={role:'owner',user_id:'owner',household_id:'family'}
const env=(db,bridge=async()=>Response.json({entries:[]}))=>({
  APP_ENV:'production',DB:db,
  KAKEBO_LEDGER_API_URL:'https://kakeibo-f17.pages.dev/api/homeflow-ledger',
  KAKEBO_LEDGER_SERVICE:{fetch:bridge}
})
const request=(path,method='GET',payload)=>new Request('https://homeflow.invalid'+path,{
  method,...(payload===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(payload)})
})
function database(){
  const events=[]
  return {events,prepare(sql){
    const item={bind(...values){this.values=values;return this},
      async first(){
        if(sql.includes('FROM finance_target_settings'))return {adjustment_amount:-10000,period_start:'2026-11-01',period_end:'2026-11-04'}
        if(sql.includes('FROM shopping_items'))return {id:shoppingId,ledger_entry_id:null}
        if(sql.includes('FROM goals'))return {id:goalId,reserved_amount:50000}
        return {id:goalId}
      },
      async run(){events.push({sql,values:this.values});return {success:true}}
    }
    return item
  }}
}
test('goal settings retain original opening balance and signed adjustment',async()=>{
  const db=database()
  const result=await financeRoute(request('/api/finance/settings?type=goal&targetId='+goalId),
    env(db),'/api/finance/settings',owner)
  assert.equal(result.status,200)
  assert.deepEqual(await result.json(),{
    adjustmentAmount:-10000,periodStart:'2026-11-01',periodEnd:'2026-11-04',
    openingAmount:50000,linkedAmount:null
  })
  assert.equal(db.events.length,0)
})
test('shopping signed adjustment saves only in HomeFlow',async()=>{
  const db=database()
  const response=await financeRoute(request('/api/finance/settings','PUT',{
    type:'shopping',targetId:shoppingId,adjustmentAmount:-500
  }),env(db),'/api/finance/settings',owner)
  assert.equal(response.status,200)
  assert.equal(db.events.length,1)
  assert.match(db.events[0].sql,/INSERT INTO finance_target_settings/)
  assert.deepEqual(db.events[0].values.slice(0,4),['family','shopping',shoppingId,-500])
})
test('invalid adjustment and malformed window are rejected before database write',async()=>{
  const db=database()
  for(const payload of [
    {type:'goal',targetId:goalId,adjustmentAmount:2.5},
    {type:'goal',targetId:goalId,adjustmentAmount:0,periodStart:'2026-11-03',periodEnd:'2026-11-01'},
    {type:'goal',targetId:goalId,adjustmentAmount:100000000001}
  ]){
    const r=await financeRoute(request('/api/finance/settings','PUT',payload),
      env(db),'/api/finance/settings',owner)
    assert.equal(r.status,400)
  }
  assert.equal(db.events.length,0)
})
test('goal net uses only the internal service binding and rejects transfers',async()=>{
  const db=database()
  let requests=0
  const workerEnv=env(db,async (url,init)=>{
    requests++
    const u=new URL(url)
    assert.equal(u.searchParams.get('summary'),'net')
    assert.equal(u.searchParams.get('start'),'2026-11-01')
    assert.equal(u.searchParams.get('end'),'2026-11-04')
    assert.equal(init.redirect,'manual')
    return Response.json({start:'2026-11-01',end:'2026-11-04',
      income:0,expense:4392,net:-4392})
  })
  const r=await financeRoute(request('/api/finance/goal/net?targetId='+goalId+
      '&start=2026-11-01&end=2026-11-04'),workerEnv,'/api/finance/goal/net',owner)
  assert.equal(r.status,200)
  assert.equal((await r.json()).net,-4392)
  assert.equal(requests,1)
  assert.equal(db.events.length,0)
})
test('member cannot read or change household finance adjustments',async()=>{
  const db=database()
  const member={...owner,role:'member'}
  const r=await financeRoute(request('/api/finance/settings?type=shopping&targetId='+shoppingId),
    env(db),'/api/finance/settings',member)
  assert.equal(r.status,403)
  assert.equal(db.events.length,0)
})
