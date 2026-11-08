import test from 'node:test'
import assert from 'node:assert/strict'
import {financeRoute} from '../worker/finance.js'

const tripId='11111111-1111-4111-8111-111111111111'
const member={role:'member',user_id:'member',household_id:'family'}
const makeRequest=(path,method='GET',body)=>new Request('https://homeflow.invalid'+path,{
 method,...(body===undefined?{}:{headers:{'content-type':'application/json'},body:JSON.stringify(body)})})
function setup(shared=true){
 const requests=[]
 const db={prepare(sql){return {bind(...args){this.args=args;return this},
  async first(){
   if(sql.includes('FROM trips')&&sql.includes("visibility='household'"))
     return shared?{ok:1}:null
   if(sql.includes('FROM trips'))return {id:tripId}
   if(sql.includes('FROM finance_target_settings'))
     return {adjustment_amount:400,period_start:null,period_end:null}
   return null
  },
  async all(){
   if(sql.includes('SELECT DISTINCT external_entry_id'))return {results:[{entryId:'77'}]}
   return {results:[]}
  }}}
 }
 const env={APP_ENV:'production',DB:db,
  KAKEBO_LEDGER_API_URL:'https://kakeibo-f17.pages.dev/api/homeflow-ledger',
  KAKEBO_LEDGER_SERVICE:{async fetch(url){
   requests.push(String(url))
   assert.equal(new URL(url).searchParams.get('ids'),'77')
   return Response.json({entries:[{id:77,type:'expense',amount:2500,
     merchant:'敏感商户名称',date:'2026-11-04',category:'私人消费'}]})
  }}
 }
 return {db,env,requests}
}
test('shared traveler gets only linked count, total and adjustment; never raw Kakebo entries',async()=>{
 const {env,requests}=setup()
 const settings=await financeRoute(makeRequest('/api/finance/settings?type=trip&targetId='+tripId),
  env,'/api/finance/settings',member)
 assert.equal(settings.status,200)
 assert.equal((await settings.json()).adjustmentAmount,400)
 const r=await financeRoute(makeRequest('/api/finance/links?type=trip&targetId='+tripId),
  env,'/api/finance/links',member)
 assert.equal(r.status,200)
 const data=await r.json()
 assert.deepEqual(data,{summaryOnly:true,linkedCount:1,total:2500,readOnly:true})
 assert.equal(JSON.stringify(data).includes('敏感商户名称'),false)
 assert.equal(JSON.stringify(data).includes('77'),false)
 assert.equal(requests.length,1)
 const blocked=await financeRoute(makeRequest('/api/finance/candidates?start=2026-11-01&end=2026-11-06'),
  env,'/api/finance/candidates',member)
 assert.equal(blocked.status,403)
 const mutation=await financeRoute(makeRequest('/api/finance/links','POST',
  {type:'trip',targetId:tripId,entryId:'77'}),env,'/api/finance/links',member)
 assert.equal(mutation.status,403)
})
test('private travel or different household never exposes an aggregate to another member',async()=>{
 const {env,requests}=setup(false)
 for(const path of ['/api/finance/links?type=trip&targetId='+tripId,
  '/api/finance/settings?type=trip&targetId='+tripId]){
  const r=await financeRoute(makeRequest(path),env,new URL('https://homeflow.invalid'+path).pathname,member)
  assert.ok([403,404].includes(r.status))
 }
 assert.equal(requests.length,0)
})
