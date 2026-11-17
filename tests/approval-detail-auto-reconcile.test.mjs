import test from 'node:test'
import assert from 'node:assert/strict'
import {householdApprovalDetailRoute} from '../worker/approval-detail.js'
import {reconcileApprovedSharedEntries} from '../worker/approval-auto-reconcile.js'

const requestId='c5d19260-ccac-4138-9cc5-68cf2487a9f7'
const proposalId='a4458e4fc1a30bd9cdf2e8ce3e0ba463'
const secret='a'.repeat(64)
const owner={user_id:'owner',household_id:'house',role:'owner'}
const request=new Request('https://homeflow.test/api/approvals/'+requestId+'/detail')
const entry={date:'2026-11-17',time:'13:20',amount:1200,type:'expense',
 category:'食費',merchant:'コンビニ',note:'確認する内容'}
function detailsEnv(bridge){
 const approval={request_id:requestId,resource_id:proposalId,
  household_id:'house',requester_user_id:'member',
  payload_sha256:'b'.repeat(64),operation:'finance.entry.create',
  resource_type:'shared_entry_mutation',source_app:'kakebo',target_app:'kakebo'}
 const seen=[]
 return {seen,env:{APPROVALS_ENABLED:'true',DB:{
  prepare(sql){return {bind(...params){seen.push({sql,params})
   return {first:async()=>sql.includes('household_members')?{one:1}:approval}}}}
 },SHARED_ENTRY_EXECUTION_SECRET:secret,
 KAKEIBO_SHARED_ENTRY_EXECUTION_SERVICE:{fetch:bridge}}}
}
test('owner can inspect original sealed ledger details, never a private key',async()=>{
 let targetBody=null
 const {env}=detailsEnv(async target=>{
  targetBody=await target.json()
  assert.equal(target.headers.get('x-approval-client'),'homeflow')
  assert.match(target.headers.get('x-approval-signature'),/^[a-f0-9]{64}$/)
  return Response.json({ok:true,approval_id:requestId,proposal_id:proposalId,
   operation:'finance.entry.create',entry,before:null})
 })
 const response=await householdApprovalDetailRoute(request,env,new URL(request.url).pathname,owner)
 assert.equal(response.status,200)
 const value=await response.json()
 assert.deepEqual(value.entry,entry)
 assert.equal(value.before,null)
 assert.equal(targetBody.approver_user_id,'owner')
 assert.equal(targetBody.request_id,requestId)
 assert.equal(JSON.stringify(value).includes(secret),false)
})
test('only current household owner may retrieve approval details',async()=>{
 const {env,seen}=detailsEnv(async()=>{throw Error('unexpected')})
 const denied=await householdApprovalDetailRoute(request,env,new URL(request.url).pathname,
  {...owner,role:'member'})
 assert.equal(denied.status,403)
 assert.equal(seen.length,0)
})
test('preview cannot report successful review if private target is unavailable',async()=>{
 const {env}=detailsEnv(async()=>Response.json({ok:false,code:'unavailable'},{status:503}))
 const response=await householdApprovalDetailRoute(request,env,new URL(request.url).pathname,owner)
 assert.equal(response.status,503)
})
test('approved shared ledger recovery is bounded, idempotent, and uses original IDs',async()=>{
 const requests=[],seenSql=[]
 const env={APPROVALS_ENABLED:'true',APPROVAL_EXECUTION_ENABLED:'true',
  SHARED_ENTRY_APPROVAL_EXECUTION_ENABLED:'true',
  KAKEIBO_SHARED_ENTRY_EXECUTION_SERVICE:{fetch:async()=>{}},
  DB:{prepare(sql){seenSql.push(sql);return {bind(...args){
    assert.equal(args.at(-1),4)
    return {all:async()=>({results:[{request_id:requestId,household_id:'house',approver_user_id:'owner'}]})}
  }}}}
 }
 const result=await reconcileApprovedSharedEntries(env,async(req,environment,path,session)=>{
  requests.push({url:req.url,path,session,body:await req.json(),environment})
  return Response.json({ok:true,applied:true,approval_id:requestId})
 })
 assert.equal(result.attempted,1)
 assert.equal(result.applied,1)
 assert.deepEqual(result.changedHouseholds,['house'])
 assert.equal(requests.length,1)
 assert.equal(requests[0].path,'/api/approvals/'+requestId+'/execute')
 assert.deepEqual(requests[0].body,{})
 assert.equal(requests[0].session.user_id,'owner')
 assert.match(seenSql[0],/shared_entry_mutation/)
 assert.match(seenSql[0],/execution_attempts</)
})
test('reconciler never claims applied if target result is uncertain',async()=>{
 const env={APPROVALS_ENABLED:'true',APPROVAL_EXECUTION_ENABLED:'true',
  SHARED_ENTRY_APPROVAL_EXECUTION_ENABLED:'true',
  KAKEIBO_SHARED_ENTRY_EXECUTION_SERVICE:{fetch:async()=>{}},
  DB:{prepare(){return {bind(){return {all:async()=>({results:[{
   request_id:requestId,household_id:'house',approver_user_id:'owner'}]})}}}}}
 }
 const result=await reconcileApprovedSharedEntries(env,async()=>Response.json({
  ok:false,code:'target_result_unknown'},{status:503}))
 assert.deepEqual(result.changedHouseholds,[])
 assert.equal(result.applied,0)
})
