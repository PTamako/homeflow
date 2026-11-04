import assert from 'node:assert/strict'
import test from 'node:test'
import {financeRoute} from '../worker/finance.js'

const token='a'.repeat(64)
const env={
  APP_ENV:'production', KAKEBO_LEDGER_READ_TOKEN:token,
  KAKEBO_LEDGER_API_URL:'https://kakeibo-f17.pages.dev/api/homeflow-ledger'
}
const session={role:'owner',user_id:'owner',household_id:'primary'}
const request=()=>new Request('https://homeflow.example/api/finance/candidates?start=2026-11-01&end=2026-11-04')
async function simulate(status,problem,expected){
  const original=globalThis.fetch
  globalThis.fetch=async(_url,options)=>{
    assert.equal(options.method,'GET')
    assert.equal(options.headers.Authorization,'Bearer '+token)
    return new Response(JSON.stringify(problem),{status,headers:{'content-type':'application/json'}})
  }
  try{
    const response=await financeRoute(request(),env,'/api/finance/candidates',session)
    assert.equal(response.status,502)
    const data=await response.json()
    assert.equal(data.error,expected)
    assert.equal(JSON.stringify(data).includes(token),false)
  }finally{globalThis.fetch=original}
}
test('ledger auth errors are actionable and never expose the shared token',async()=>{
  await simulate(401,{error:'not_authorized'},'ledger_auth_failed')
})
test('missing Pages secret is distinguished from ledger D1 failures',async()=>{
  await simulate(503,{error:'integration_disabled'},'ledger_source_token_missing')
  await simulate(503,{error:'ledger_read_unavailable'},'ledger_source_db_unavailable')
})
test('missing routed endpoint is distinguishable from authentication failure',async()=>{
  await simulate(404,{error:'not_found'},'ledger_endpoint_missing')
})
test('network fetch failures are safe and do not leak internal exception messages',async()=>{
  const original=globalThis.fetch
  globalThis.fetch=async()=>{throw new TypeError('internal network diagnostics')}
  try{
    const response=await financeRoute(request(),env,'/api/finance/candidates',session)
    assert.equal(response.status,502)
    assert.deepEqual(await response.json(),{error:'ledger_network_error'})
  }finally{globalThis.fetch=original}
})
test('successful upstream response preserves read-only ledger result',async()=>{
  const original=globalThis.fetch
  globalThis.fetch=async()=>Response.json({entries:[{id:5,date:'2026-11-01',amount:100,type:'expense'}],nextCursor:null})
  try{
    const response=await financeRoute(request(),env,'/api/finance/candidates',session)
    assert.equal(response.status,200)
    const data=await response.json()
    assert.equal(data.entries.length,1)
    assert.equal(data.entries[0].amount,100)
  }finally{globalThis.fetch=original}
})
