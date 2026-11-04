import assert from 'node:assert/strict'
import test from 'node:test'
import {financeRoute,canUseLedger} from '../worker/finance.js'
const prod={APP_ENV:'production',KAKEBO_LEDGER_API_URL:'https://kakeibo-f17.pages.dev/api/homeflow-ledger',
  KAKEBO_LEDGER_READ_TOKEN:'example-secret-12345678901234567890'}
const owner={user_id:'owner',household_id:'primary',role:'owner'}
const member={user_id:'member',household_id:'primary',role:'member'}
function request(path,method='GET',data){
 const init={method}
 if(data!==undefined){init.headers={'content-type':'application/json'};init.body=JSON.stringify(data)}
 return new Request('https://homeflow.example'+path,init)
}
test('disabled secrets or preview never expose ledger',async()=>{
 const env={...prod}
 delete env.KAKEBO_LEDGER_READ_TOKEN
 assert.equal(canUseLedger(env,owner),false)
 const res=await financeRoute(request('/api/finance/status'),env,'/api/finance/status',owner)
 assert.deepEqual(await res.json(),{connected:false,readOnly:true,ownerOnly:true})
 assert.equal(canUseLedger({...prod,APP_ENV:'preview'},owner),false)
 assert.equal(canUseLedger({...prod,KAKEBO_LEDGER_API_URL:'http://127.0.0.1/api/homeflow-ledger'},owner),false)
})
test('second household login cannot see private real ledger',async()=>{
 const res=await financeRoute(request('/api/finance/status'),prod,'/api/finance/status',member)
 assert.equal(res.status,403)
})
test('invalid search date never makes outgoing call',async()=>{
 const res=await financeRoute(request('/api/finance/candidates?start=2026-01-01&end=2026-08-01'),prod,
 '/api/finance/candidates',owner)
 assert.equal(res.status,400)
})
test('search response returns only current upstream projection',async()=>{
 const original=globalThis.fetch
 let seen=''
 globalThis.fetch=async (url,options)=>{
   seen=String(url)
   assert.equal(options.method,'GET')
   assert.equal(options.headers.Authorization,'Bearer '+prod.KAKEBO_LEDGER_READ_TOKEN)
   return new Response(JSON.stringify({entries:[{id:3,date:'2026-11-03',amount:1000,merchant:'演示',type:'expense',category:'交通'}],nextCursor:null}),
    {status:200,headers:{'content-type':'application/json'}})
 }
 try{
   const res=await financeRoute(request('/api/finance/candidates?start=2026-11-01&end=2026-11-04'),prod,
     '/api/finance/candidates',owner)
   assert.equal(res.status,200)
   assert.match(seen,/kakeibo-f17\.pages\.dev/)
   const body=await res.json()
   assert.equal(body.entries[0].amount,1000)
   assert.equal(body.readOnly,true)
 }finally{globalThis.fetch=original}
})
