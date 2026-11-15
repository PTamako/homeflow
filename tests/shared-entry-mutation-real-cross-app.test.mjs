// Two isolated real SQLite databases, genuine HomeFlow owner approval route,
// HMAC execution proof and Kakeibo member proposal/write handlers. NO production.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {webcrypto} from 'node:crypto'
import {approvalRoute} from '../worker/approvals.js'
import {approvalExecutionRoute} from '../worker/approval-execution.js'
import {approvalVerificationRoute} from '../worker/approval-verification.js'
import {sharedEntryApprovalSubmissionRoute} from '../worker/shared-entry-approval-submission.js'
import {familySharedMutationRequests} from '../.contract-kakeibo/functions/api/family-finance/shared-mutation-requests.js'
import {approvedSharedMutationRoute} from '../.contract-kakeibo/functions/api/internal/shared-entries/[[path]].js'
if(!globalThis.crypto)globalThis.crypto=webcrypto
const household='primary'
const owner='11111111-1111-4111-8111-111111111111'
const member='22222222-2222-4222-8222-222222222222'
const homeOrigin='https://homeflow.example.test'
const secrets={pending:'1'.repeat(64),submit:'2'.repeat(64),
 execution:'3'.repeat(64),proof:'4'.repeat(64),general:'5'.repeat(64)}
const sample={date:'2026-11-14',time:'12:00',amount:1250,type:'expense',
 category:'食費',merchant:'スーパー',note:'共同生活費'}
const get=(db,q,...params)=>db.prepare(q).get(...params)
const count=(sql,table)=>get(sql,'SELECT COUNT(*) n FROM '+table).n
const put=(sql,q,...params)=>sql.prepare(q).run(...params)
function database(){
 const sql=new DatabaseSync(':memory:')
 sql.exec('PRAGMA foreign_keys=ON')
 const db={prepare(q){return {bind(...values){return {
  first:async()=>sql.prepare(q).get(...values)||null,
  all:async()=>({results:sql.prepare(q).all(...values)}),
  run:async()=>({meta:{changes:sql.prepare(q).run(...values).changes}}),
  sync:()=>({meta:{changes:sql.prepare(q).run(...values).changes}})
 }}}},async batch(batch){
  sql.exec('BEGIN IMMEDIATE')
  try{const result=batch.map(x=>x.sync());sql.exec('COMMIT');return result}
  catch(e){sql.exec('ROLLBACK');throw e}
 }}
 return {sql,db}
}
function homeSchema(sql){
 const manifest=readFileSync(new URL('../scripts/check_migrations.py',import.meta.url),'utf8')
 const names=manifest.match(/MIGRATIONS=\[([\s\S]*?)\]/)[1].match(/"[^"]+\.sql"/g)
  .map(s=>s.slice(1,-1))
 for(const name of names)
  sql.exec(readFileSync(new URL('../migrations/'+name,import.meta.url),'utf8'))
 put(sql,'INSERT INTO households(id,display_name) VALUES(?,?)',household,'Family')
 for(const [u,role] of [[owner,'owner'],[member,'member']]){
  put(sql,'INSERT INTO users(id,login_name,password_salt,password_verifier) VALUES(?,?,?,?)',
   u,u,'s','v')
  put(sql,'INSERT INTO household_members(household_id,user_id,role) VALUES(?,?,?)',household,u,role)
 }
}
function kSchema(sql){
 sql.exec('CREATE TABLE schema_migrations(version TEXT PRIMARY KEY,description TEXT)')
 sql.exec('CREATE TABLE homeflow_identity_links(user_id TEXT PRIMARY KEY,household_id TEXT,role TEXT,state TEXT)')
 sql.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,time TEXT,amount INTEGER,category TEXT,'+
  'merchant TEXT,note TEXT,raw TEXT,type TEXT,client_request_id TEXT UNIQUE,payment_source TEXT,'+
  'family_account_id TEXT,family_transfer_target_account_id TEXT)')
 for(const file of ['0051_shared_entry_lifecycle.sql','0052_shared_mutation_approved_execution.sql'])
  sql.exec(readFileSync(new URL('../.contract-kakeibo/migrations/'+file,import.meta.url),'utf8'))
 for(const [u,role] of [[owner,'owner'],[member,'member']])
  put(sql,"INSERT INTO homeflow_identity_links VALUES(?,?,?,'active')",u,household,role)
}
async function fixture(){
 const h=database(),k=database();homeSchema(h.sql);kSchema(k.sql)
 const home={APP_ENV:'production',DB:h.db,APPROVALS_ENABLED:'true',
  APPROVAL_EXECUTION_ENABLED:'true',APPROVAL_VERIFICATION_ENABLED:'true',
  APPROVAL_VERIFICATION_SECRET:secrets.general,
  SHARED_ENTRY_APPROVAL_SUBMISSION_ENABLED:'true',
  SHARED_ENTRY_SUBMISSION_SECRET:secrets.submit,
  SHARED_ENTRY_APPROVAL_EXECUTION_ENABLED:'true',
  SHARED_ENTRY_EXECUTION_SECRET:secrets.execution,
  SHARED_ENTRY_APPROVAL_PROOF_SECRET:secrets.proof}
 const finance={APP_ENV:'production',DB:k.db,
  KAKEIBO_FAMILY_FINANCE_ENABLED:'true',KAKEIBO_SHARED_ENTRY_ENABLED:'true',
  KAKEIBO_SHARED_MUTATION_APPROVAL_ENABLED:'true',
  KAKEIBO_FAMILY_PENDING_KEY:secrets.pending,
  KAKEIBO_SHARED_MUTATION_SUBMISSION_SECRET:secrets.submit,
  KAKEIBO_SHARED_MUTATION_EXECUTION_SECRET:secrets.execution,
  KAKEIBO_SHARED_MUTATION_PROOF_SECRET:secrets.proof,
  HOMEFLOW_OAUTH_ORIGIN:homeOrigin}
 let proofCalls=0,targetCalls=0
 finance.HOMEFLOW_IDENTITY_SERVICE={async fetch(req){
  if(new URL(req.url).pathname.endsWith('/shared-entry-submit'))
   return sharedEntryApprovalSubmissionRoute(req,home)
  proofCalls++;return approvalVerificationRoute(req,home)
 }}
 home.KAKEIBO_SHARED_ENTRY_EXECUTION_SERVICE={async fetch(req){
  targetCalls++;return approvedSharedMutationRoute(req,finance,
   [new URL(req.url).pathname.split('/').at(-1)])
 }}
 const url=new URL('https://kakeibo.example.test/api/family-finance/shared-mutation-requests')
 const source=async(parts,data)=>{
  const res=await familySharedMutationRequests(new Request(url,{
   method:'POST',headers:{origin:url.origin,'content-type':'application/json'},
   body:JSON.stringify(data)}),finance,url,
   {user_id:member,household_id:household,role:'member'},parts)
  return {status:res.status,data:await res.json()}
 }
 async function prepare(operation,resource_id,expected_version,entry){
  const prep=await source(['shared-mutation-requests'],{
   expected_user_id:member,idempotency_key:'shared-actual-'+crypto.randomUUID(),
   operation,resource_id,expected_version,entry})
  assert.equal(prep.status,201,JSON.stringify(prep))
  const submit=await source(['shared-mutation-requests',prep.data.prepared.proposal_id,'submit'],
   {expected_user_id:member})
  assert.equal(submit.status,200,JSON.stringify(submit))
  return submit.data.approval_id
 }
 async function review(approval){
  const route='/api/approvals/'+approval+'/review'
  const res=await approvalRoute(new Request(homeOrigin+route,{
   method:'POST',headers:{origin:homeOrigin,'content-type':'application/json'},
   body:JSON.stringify({decision:'approve'})}),home,route,
   {user_id:owner,household_id:household,role:'owner'})
  return {status:res.status,data:await res.json()}
 }
 async function execute(approval){
  const route='/api/approvals/'+approval+'/execute'
  const response=await approvalExecutionRoute(new Request(homeOrigin+route,{
   method:'POST',headers:{origin:homeOrigin,'content-type':'application/json'},
   body:'{}'}),home,route,{user_id:owner,household_id:household,role:'owner'})
  return {status:response.status,data:await response.json()}
 }
 return {h,k,home,finance,prepare,review,execute,
  get proofCalls(){return proofCalls},get targetCalls(){return targetCalls},
  close(){h.sql.close();k.sql.close()}}
}
test('HomeFlow authentic member request + separate owner review executes one real Kakeibo shared ordinary entry',async()=>{
 const f=await fixture()
 try{
  const approval=await f.prepare('create',null,0,sample)
  assert.equal(count(f.k.sql,'entries'),0)
  assert.equal(get(f.h.sql,'SELECT status FROM household_approval_requests WHERE request_id=?',approval).status,'pending')
  const review=await f.review(approval)
  assert.equal(review.status,200,JSON.stringify(review))
  assert.equal(count(f.k.sql,'entries'),0)
  const posted=await f.execute(approval)
  assert.equal(posted.status,200,JSON.stringify(posted))
  assert.equal(posted.data.applied,true)
  assert.equal(get(f.h.sql,'SELECT status FROM household_approval_requests WHERE request_id=?',approval).status,'applied')
  assert.equal(count(f.k.sql,'entries'),1)
  assert.equal(count(f.k.sql,'family_shared_mutation_applied'),1)
  assert.equal(count(f.k.sql,'family_shared_entry_audit'),1)
  const row=get(f.k.sql,'SELECT * FROM family_shared_mutation_applied')
  assert.equal(row.requester_user_id,member)
  assert.equal(row.approver_user_id,owner)
  assert.equal(row.version_after,1)
  assert.equal((await f.execute(approval)).status,200)
  assert.equal(count(f.k.sql,'entries'),1)
  assert.equal(f.proofCalls,1)
  assert.equal(f.targetCalls,1)
 }finally{f.close()}
})
test('cross D1 target commits but HomeFlow reply lost; same approval ID reconciles without another entry',async()=>{
 const f=await fixture()
 try{
  const approval=await f.prepare('create',null,0,sample)
  assert.equal((await f.review(approval)).status,200)
  const target=f.home.KAKEIBO_SHARED_ENTRY_EXECUTION_SERVICE
  let lost=true
  f.home.KAKEIBO_SHARED_ENTRY_EXECUTION_SERVICE={async fetch(req){
   const result=await target.fetch(req)
   if(lost){lost=false;throw Error('LOST_SHARED_MUTATION_RECEIPT')}
   return result
  }}
  const unknown=await f.execute(approval)
  assert.notEqual(unknown.status,200)
  assert.equal(count(f.k.sql,'entries'),1)
  const reconciled=await f.execute(approval)
  assert.equal(reconciled.status,200,JSON.stringify(reconciled))
  assert.equal(count(f.k.sql,'entries'),1)
  assert.equal(count(f.k.sql,'family_shared_mutation_applied'),1)
  assert.equal(get(f.h.sql,'SELECT status FROM household_approval_requests WHERE request_id=?',approval).status,'applied')
 }finally{f.close()}
})
test('HomeFlow review revocation, changed role and Kakeibo audit failure never mark shared mutation applied',async()=>{
 for(const scenario of ['disabled_member','disabled_owner','audit_fault']){
  const f=await fixture()
  try{
   const approval=await f.prepare('create',null,0,sample)
   assert.equal((await f.review(approval)).status,200)
   if(scenario==='disabled_member'){
    put(f.h.sql,'UPDATE users SET disabled_at=? WHERE id=?',Date.now(),member)
    put(f.k.sql,"UPDATE homeflow_identity_links SET state='disabled' WHERE user_id=?",member)
   }
   if(scenario==='disabled_owner'){
    put(f.h.sql,'UPDATE users SET disabled_at=? WHERE id=?',Date.now(),owner)
    put(f.k.sql,"UPDATE homeflow_identity_links SET state='disabled' WHERE user_id=?",owner)
   }
   if(scenario==='audit_fault')
    f.k.sql.exec("CREATE TRIGGER fail_shared_immutable_audit BEFORE INSERT ON family_shared_entry_audit BEGIN SELECT RAISE(ABORT,'AUDIT_FAULT'); END;")
   const attempt=await f.execute(approval)
   assert.notEqual(attempt.status,200,scenario)
   assert.equal(count(f.k.sql,'entries'),0)
   assert.equal(count(f.k.sql,'family_shared_mutation_applied'),0)
   assert.notEqual(get(f.h.sql,'SELECT status FROM household_approval_requests WHERE request_id=?',approval).status,'applied')
  }finally{f.close()}
 }
})
