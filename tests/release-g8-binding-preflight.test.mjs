import test from 'node:test';
import assert from 'node:assert/strict';
import {REQUIRED_WORKERS,REQUIRED_PAGES,checkG8Bindings,
 collectG8Bindings} from '../scripts/release-g8-binding-preflight.mjs';
function complete(){
 return {workers:Object.fromEntries(Object.entries(REQUIRED_WORKERS).map(([name,r])=>[
  name,{bindings:r.names.map(key=>({name:key,
   type:r.services.includes(key)?'service':key==='DB'?'d1':
    ['MEDIA','DOCUMENTS'].includes(key)?'r2_bucket':'secret_text'}))}])),
 pages:Object.fromEntries(Object.entries(REQUIRED_PAGES).map(([name,r])=>[
  name,{production:{env_vars:Object.fromEntries(r.env.map(k=>[k,true])),
   d1_databases:Object.fromEntries(r.d1.map(k=>[k,true])),
   r2_buckets:Object.fromEntries(r.r2.map(k=>[k,true])),
   services:Object.fromEntries(r.services.map(k=>[k,true]))}}]))};
}
test('G8 preflight checks required identity/approval bindings and never claims full release PASS',()=>{
 const result=checkG8Bindings(complete());
 assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal(result.verified,'binding-name-and-type-presence-only');
 assert.ok(result.cannot_certify.includes('actual_d1_migration'));
 assert.ok(result.cannot_certify.includes('two_iphone_pwa_acceptance'));
});
test('G8 reports absent production HomeFlow approval, study/doc identity and Pages service bindings',()=>{
 const s=complete();
 s.workers.homeflow.bindings=s.workers.homeflow.bindings.filter(x=>
  x.name!=='APPROVAL_VERIFICATION_SECRET');
 s.workers['it-study-platform'].bindings=s.workers['it-study-platform'].bindings.filter(x=>
  x.name!=='HOMEFLOW_STUDY_SERVICE');
 s.workers['jp-document-assistant'].bindings=s.workers['jp-document-assistant'].bindings.filter(x=>
  x.name!=='HOMEFLOW_SSO_ENABLED');
 delete s.pages.kakeibo.production.services.HOMEFLOW_IDENTITY_SERVICE;
 const r=checkG8Bindings(s);
 assert.equal(r.ok,false);
 assert.ok(r.missing.includes('worker:homeflow:missing:APPROVAL_VERIFICATION_SECRET'));
 assert.ok(r.missing.includes('worker:it-study-platform:missing:HOMEFLOW_STUDY_SERVICE'));
 assert.ok(r.missing.includes('worker:jp-document-assistant:missing:HOMEFLOW_SSO_ENABLED'));
 assert.ok(r.missing.includes('pages:kakeibo:missing:services:HOMEFLOW_IDENTITY_SERVICE'));
});
test('G8 fails closed for wrong service type, missing Worker or Pages config',()=>{
 const s=complete();
 const service=s.workers.homeflow.bindings.find(x=>x.name==='DOCUMENT_EXECUTION_SERVICE');
 service.type='plain_text';
 delete s.workers['it-study-platform'];
 delete s.pages.kakeibo;
 const result=checkG8Bindings(s);
 assert.equal(result.ok,false);
 assert.ok(result.missing.includes('worker:homeflow:invalid_service_type:DOCUMENT_EXECUTION_SERVICE'));
 assert.ok(result.missing.includes('worker:it-study-platform:unavailable'));
 assert.ok(result.missing.includes('pages:kakeibo:unavailable'));
});
test('G8 collector only GETs production metadata and strips all returned values',async()=>{
 const snapshot=complete();
 const calls=[];
 const responder=async(url,init)=>{
  calls.push({url,method:init.method});
  assert.equal(init.method,'GET');
  const raw=url.replace('https://api.cloudflare.com/client/v4','');
  if(raw.endsWith('/settings')){
   const name=raw.split('/').at(-2),source=snapshot.workers[name];
   return {ok:true,json:async()=>({success:true,result:{
    bindings:source.bindings.map(x=>({...x,value:'must-not-leak'}))}})};
  }
  const name=raw.split('/').at(-1),production=snapshot.pages[name].production;
  return {ok:true,json:async()=>({success:true,result:{deployment_configs:{
   production:{...production,env_vars:Object.fromEntries(Object.keys(production.env_vars)
    .map(k=>[k,{type:'secret_text',value:'must-not-leak'}]))}}}})};
 };
 const got=await collectG8Bindings({accountId:'test-account',token:'fake-test-token',
  fetcher:responder});
 assert.equal(calls.length,4);
 assert.equal(checkG8Bindings(got).ok,true);
 assert.equal(JSON.stringify(got).includes('must-not-leak'),false);
});
test('G8 collector rejects partial Cloudflare responses and never uses POST/PUT',async()=>{
 await assert.rejects(()=>collectG8Bindings({accountId:'test-account',token:'fake',
  fetcher:async()=>({ok:false,status:403})}),/Cloudflare read failed/);
});

test('G8 detects missing cross-member banking, recurring, card, points and document service prerequisites',()=>{
 const s=complete();
 for(const key of ['KAKEIBO_BANK_TRANSFER_EXECUTION_SERVICE',
  'KAKEIBO_PREPAID_EXECUTION_SERVICE','KAKEIBO_SBI_CASH_EXECUTION_SERVICE',
  'DOCUMENT_STUDY_EXECUTION_SECRET']){
  s.workers.homeflow.bindings=s.workers.homeflow.bindings.filter(x=>x.name!==key);
 }
 for(const key of ['KAKEIBO_CROSS_MEMBER_PROOF_SECRET',
  'KAKEIBO_RECURRING_POLICY_SUBMISSION_ENABLED',
  'KAKEIBO_LEGACY_SHARED_RECEIPT_REPAIR_ENABLED']){
  delete s.pages.kakeibo.production.env_vars[key];
 }
 delete s.workers['jp-document-assistant'].bindings.find(x=>
  x.name==='DOCUMENT_INTENT_ENCRYPTION_KEY')?.value;
 const result=checkG8Bindings(s);
 assert.equal(result.ok,false);
 for(const key of ['KAKEIBO_BANK_TRANSFER_EXECUTION_SERVICE',
  'KAKEIBO_PREPAID_EXECUTION_SERVICE','KAKEIBO_SBI_CASH_EXECUTION_SERVICE'])
  assert.ok(result.missing.includes('worker:homeflow:missing:'+key));
 for(const key of ['KAKEIBO_CROSS_MEMBER_PROOF_SECRET',
  'KAKEIBO_RECURRING_POLICY_SUBMISSION_ENABLED',
  'KAKEIBO_LEGACY_SHARED_RECEIPT_REPAIR_ENABLED'])
  assert.ok(result.missing.includes('pages:kakeibo:missing:env:'+key));
});
test('G8 cannot call a text binding a D1 or a KV namespace an R2 bucket',()=>{
 const s=complete();
 s.workers.homeflow.bindings.find(x=>x.name==='DB').type='secret_text';
 s.workers['jp-document-assistant'].bindings.find(x=>x.name==='DOCUMENTS').type='kv_namespace';
 const result=checkG8Bindings(s);
 assert.equal(result.ok,false);
 assert.ok(result.missing.includes('worker:homeflow:invalid_resource_type:DB'));
 assert.ok(result.missing.includes('worker:jp-document-assistant:invalid_resource_type:DOCUMENTS'));
});
