// Two isolated real SQLite databases, genuine HomeFlow owner approval route,
// HMAC execution proof and Kakeibo member proposal/write handlers. NO production.
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {DatabaseSync} from 'node:sqlite'
import {webcrypto,createHash} from 'node:crypto'
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
 sql.exec('CREATE TABLE family_financial_accounts(account_id TEXT PRIMARY KEY,household_id TEXT,owner_user_id TEXT,is_archived INTEGER)')
 sql.exec('CREATE TABLE family_finance_legacy_entry_links(entry_id INTEGER PRIMARY KEY,household_id TEXT,actor_user_id TEXT,account_id TEXT,original_source TEXT,source_digest TEXT)')
 sql.exec('CREATE TABLE receipt_r2_state(entry_id INTEGER PRIMARY KEY,deleted INTEGER,size_bytes INTEGER)')
 sql.exec('CREATE TABLE entries(id INTEGER PRIMARY KEY,date TEXT,time TEXT,amount INTEGER,category TEXT,'+
  'merchant TEXT,note TEXT,raw TEXT,type TEXT,client_request_id TEXT UNIQUE,payment_source TEXT,'+
  'family_account_id TEXT,family_transfer_target_account_id TEXT)')
 for(const file of ['0051_shared_entry_lifecycle.sql','0052_shared_mutation_approved_execution.sql','0055_legacy_shared_entry_adoption.sql','0058_adopted_shared_mutation_approval.sql'])
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
  KAKEIBO_SHARED_MUTATION_APPROVAL_ENABLED:'true',KAKEIBO_LEGACY_SHARED_ADOPTION_ENABLED:'true',
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


function seedOriginalOwnerAdoptedEntry(f){
 const sql=f.k.sql,resource='a'.repeat(32),account='b'.repeat(32),oldId=7;
 const now=Date.now(),linkDigest='c'.repeat(64);
 put(sql,'INSERT INTO family_financial_accounts VALUES(?,?,?,0)',account,household,owner);
 put(sql,'INSERT INTO entries(id,date,time,amount,category,merchant,note,raw,type,client_request_id,payment_source,family_account_id,family_transfer_target_account_id) '+
  'VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',oldId,sample.date,sample.time,900,sample.category,'旧商店','原始OCR备注',
  '原始OCR票据','expense',null,'Bank',account,null);
 put(sql,'INSERT INTO family_finance_legacy_entry_links VALUES(?,?,?,?,?,?)',
  oldId,household,owner,account,'Bank',linkDigest);
 const original=get(sql,'SELECT * FROM entries WHERE id=?',oldId);
 put(sql,'INSERT INTO family_legacy_shared_adoptions(resource_id,entry_id,household_id,original_owner_user_id,account_id,'+
  'source_snapshot_sha256,original_link_digest,original_client_request_id,original_row_json,adopted_at) VALUES(?,?,?,?,?,?,?,?,?,?)',
  resource,oldId,household,owner,account,'d'.repeat(64),linkDigest,null,JSON.stringify(original),now);
 const snapshot=JSON.stringify({...sample,amount:900,merchant:'旧商店',note:'原始OCR备注'});
 const sha=createHash('sha256').update(snapshot).digest('hex');
 put(sql,'INSERT INTO family_shared_entry_write_context VALUES(?,?,?,?,?,?)',
  resource,oldId,owner,'create',0,now);
 put(sql,'INSERT INTO family_shared_entry_registry(resource_id,household_id,entry_id,creator_user_id,last_actor_user_id,'+
  'state,version,snapshot_json,payload_sha256,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
  resource,household,oldId,owner,owner,'active',1,snapshot,sha,now,now);
 put(sql,'DELETE FROM family_shared_entry_write_context WHERE resource_id=?',resource);
 return {resource,account,oldId,original};
}
test('two actual isolated D1s: HomeFlow member proposal, owner approval and signed target revise adopted original without duplicate accounting',async()=>{
 const f=await fixture();
 try{
  const original=seedOriginalOwnerAdoptedEntry(f);
  const initial=get(f.k.sql,'SELECT COUNT(*) n,SUM(amount) total FROM entries');
  const updateId=await f.prepare('update',original.resource,1,{...sample,amount:1550});
  assert.equal((await f.review(updateId)).status,200);
  assert.equal(count(f.k.sql,'entries'),1);
  const updated=await f.execute(updateId);
  assert.equal(updated.status,200,JSON.stringify(updated));
  assert.equal(updated.data.applied,true);
  let row=get(f.k.sql,'SELECT * FROM entries WHERE id=?',original.oldId);
  assert.equal(row.amount,1550);
  assert.equal(row.raw,original.original.raw);
  assert.equal(row.payment_source,original.original.payment_source);
  assert.equal(row.family_account_id,original.account);
  assert.equal(row.client_request_id,null);
  assert.equal(get(f.h.sql,'SELECT status FROM household_approval_requests WHERE request_id=?',updateId).status,'applied');
  assert.equal(get(f.k.sql,'SELECT COUNT(*) n FROM entries').n,initial.n);
  const deleteId=await f.prepare('delete',original.resource,2,null);
  assert.equal((await f.review(deleteId)).status,200);
  assert.equal((await f.execute(deleteId)).status,200);
  assert.equal(count(f.k.sql,'entries'),0);
  const restoreId=await f.prepare('restore',original.resource,3,null);
  assert.equal((await f.review(restoreId)).status,200);
  assert.equal((await f.execute(restoreId)).status,200);
  row=get(f.k.sql,'SELECT * FROM entries WHERE id=?',original.oldId);
  assert.equal(row.amount,1550);
  assert.equal(row.raw,original.original.raw);
  assert.equal(row.family_account_id,original.account);
  assert.equal(count(f.k.sql,'entries'),1);
  assert.equal(count(f.k.sql,'family_shared_mutation_applied'),3);
  assert.equal(count(f.k.sql,'family_shared_entry_audit'),4);
  assert.equal((await f.execute(restoreId)).status,200);
  assert.equal(count(f.k.sql,'family_shared_mutation_applied'),3);
  for(const id of [updateId,deleteId,restoreId])
   assert.equal(get(f.h.sql,'SELECT status FROM household_approval_requests WHERE request_id=?',id).status,'applied');
 }finally{f.close()}
});
test('adopted historical target commits once when HomeFlow response is lost and original request ID resumes',async()=>{
 const f=await fixture();
 try{
  const old=seedOriginalOwnerAdoptedEntry(f);
  const approval=await f.prepare('update',old.resource,1,{...sample,amount:1600});
  assert.equal((await f.review(approval)).status,200);
  const target=f.home.KAKEIBO_SHARED_ENTRY_EXECUTION_SERVICE;
  let loseOnce=true;
  f.home.KAKEIBO_SHARED_ENTRY_EXECUTION_SERVICE={async fetch(req){
   const response=await target.fetch(req);
   if(loseOnce){loseOnce=false;throw Error('LOST_ADOPTED_MUTATION_RECEIPT');}
   return response;
  }};
  const unknown=await f.execute(approval);
  assert.notEqual(unknown.status,200);
  assert.equal(get(f.k.sql,'SELECT amount FROM entries WHERE id=?',old.oldId).amount,1600);
  assert.equal(count(f.k.sql,'family_shared_mutation_applied'),1);
  const recovered=await f.execute(approval);
  assert.equal(recovered.status,200,JSON.stringify(recovered));
  assert.equal(get(f.h.sql,'SELECT status FROM household_approval_requests WHERE request_id=?',approval).status,'applied');
  assert.equal(count(f.k.sql,'entries'),1);
  assert.equal(count(f.k.sql,'family_shared_mutation_applied'),1);
  assert.equal(count(f.k.sql,'family_shared_entry_audit'),2);
 }finally{f.close()}
});
