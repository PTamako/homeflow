import test from 'node:test'
import assert from 'node:assert/strict'
import {webcrypto} from 'node:crypto'
import {previewVerifiedLedgerIntent,householdApprovalDetailRoute} from '../worker/approval-detail.js'
import {approvalRoute} from '../worker/approvals.js'
if(!globalThis.crypto)globalThis.crypto=webcrypto

const id='11111111-1111-4111-8111-111111111111',resource='a'.repeat(32)
const base={request_id:id,resource_id:resource,household_id:'home',
 requester_user_id:'member',payload_sha256:'b'.repeat(64),target_app:'kakebo'}
const entry={date:'2026-11-17',type:'expense',amount:1200,
 category:'食費',merchant:'コンビニ',note:'原始账务',payment_source:'現金'}
const types=[
 {source_app:'kakebo',resource_type:'shared_entry_mutation',
  operation:'finance.entry.create',path:'/api/internal/shared-entries/preview'},
 {source_app:'kakebo',resource_type:'finance_entry',
  operation:'finance.entry.create',path:'/api/internal/approval-preview'},
 {source_app:'kakebo',resource_type:'credit_card_purchase',
  operation:'finance.credit_card.purchase',path:'/api/internal/approval-preview'},
 {source_app:'kakebo',resource_type:'prepaid_action',
  operation:'finance.prepaid.spend',path:'/api/internal/approval-preview'},
 {source_app:'jp-document-assistant',resource_type:'document_sync_candidate',
  operation:'document.sync.finance',path:'/api/internal/document-actions/preview'}
]
const secret='c'.repeat(64)
for(const variant of types){
 test('HomeFlow verifies private '+variant.resource_type+' original intent before owner review',async()=>{
  const row={...base,...variant},calls=[]
  const fake={fetch:async req=>{
   calls.push({path:new URL(req.url).pathname,payload:await req.clone().json(),
    sig:req.headers.get('x-approval-signature')})
   return Response.json({ok:true,approval_id:id,proposal_id:resource,
    operation:variant.operation,entry,before:null})
  }}
  const env={SHARED_ENTRY_EXECUTION_SECRET:secret,DOCUMENT_EXECUTION_SECRET:secret,
   KAKEIBO_SHARED_ENTRY_EXECUTION_SERVICE:fake,DOCUMENT_EXECUTION_SERVICE:fake}
  const preview=await previewVerifiedLedgerIntent(env,row,'owner')
  assert.deepEqual(preview,{entry,before:null})
  assert.equal(calls.length,1)
  assert.equal(calls[0].path,variant.path)
  assert.equal(calls[0].payload.request_id,id)
  assert.equal(calls[0].payload.approver_user_id,variant.source_app==='kakebo'?'owner':undefined)
  assert.match(calls[0].sig,/^[a-f0-9]{64}$/)
  assert.ok(!JSON.stringify(calls[0].payload).includes('原始账务'))
  assert.equal(await previewVerifiedLedgerIntent(env,row,'member'),null)
  const bad={...env,KAKEIBO_SHARED_ENTRY_EXECUTION_SERVICE:{
   fetch:async()=>Response.json({ok:true,approval_id:id,proposal_id:resource,
    operation:variant.operation,entry:{...entry,amount:0}})}}
  if(variant.source_app==='kakebo')
   assert.equal(await previewVerifiedLedgerIntent(bad,row,'owner'),null)
 })
}
test('all personal non-ledger asset operations are denied before a Service Binding request',async()=>{
 const seen=[]
 const env={KAKEIBO_SHARED_ENTRY_EXECUTION_SERVICE:{fetch:async x=>seen.push(x)},
  SHARED_ENTRY_EXECUTION_SECRET:secret}
 for(const item of [
  {resource_type:'sbi_cash_action',operation:'finance.sbi_cash.tsumitate'},
  {resource_type:'prepaid_action',operation:'finance.prepaid.topup'},
  {resource_type:'points_action',operation:'finance.points.transfer_prepaid'},
  {resource_type:'bank_transfer_posted',operation:'finance.asset_transfer.bank_to_bank'}
 ]){
  assert.equal(await previewVerifiedLedgerIntent(env,
   {...base,...item,source_app:'kakebo'},'owner'),null)
 }
 assert.equal(seen.length,0)
})
test('a direct owner POST cannot bypass source preview, and rejection can still proceed',async()=>{
 const row={...base,...types[1],status:'pending',expires_at:Date.now()+60000}
 let wrote=false
 const env={APPROVALS_ENABLED:'true',OWNER_REVIEW_SCOPE_MODE:'household_ledger_only',
  DB:{prepare(sql){return {bind(){return{
   first:async()=>sql.includes('household_members')?{role:'owner'}:row
   }}}},
   async batch(){wrote=true;throw Error('unexpected write')}
  }}
 const path='/api/approvals/'+id+'/review'
 const req=new Request('https://homeflow.example.test'+path,{
  method:'POST',headers:{origin:'https://homeflow.example.test',
   'content-type':'application/json'},body:JSON.stringify({decision:'approve'})})
 const res=await approvalRoute(req,env,path,{user_id:'owner',household_id:'home',role:'owner'})
 assert.equal(res.status,503)
 assert.equal((await res.json()).error,'approval_detail_unavailable')
 assert.equal(wrote,false)
})
