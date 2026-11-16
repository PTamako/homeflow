import test from 'node:test';
import assert from 'node:assert/strict';
import {buildReleaseSecrets,CONTRACT_PAIRS} from '../scripts/four-app-release-secrets.mjs';
import {withFourAppFinanceEnv,REQUIRED_FINANCE_SECRETS} from '../worker/four-app-release-env.js';
import {checkG8Bindings,REQUIRED_WORKERS,REQUIRED_PAGES,SERVICE_TARGETS} from '../scripts/release-g8-binding-preflight.mjs';
test('all required production secrets are mapped without rotating legacy keys',()=>{
 let n=0;const x=buildReleaseSecrets(()=>String((++n)%10).repeat(64));
 assert.equal(CONTRACT_PAIRS.length,n);
 assert.equal('SESSION_HMAC_KEY' in x.D,false);
 assert.equal('KAKEIBO_SSO_ENCRYPTION_KEY' in x.P,false);
 for(const pair of CONTRACT_PAIRS){
  const values=pair.map(item=>{const [group,name]=item.split('.');return x[group][name]});
  assert.ok(values.every(v=>v===values[0]));
  assert.match(values[0],/^[a-f0-9]{64}$/);
 }
 assert.notEqual(x.H.BANK_TRANSFER_EXECUTION_SECRET,x.H.BANK_TRANSFER_SUBMISSION_SECRET);
});
test('rejects weak release keys before attempting any Cloudflare changes',()=>{
 assert.throws(()=>buildReleaseSecrets(()=>'weak'),/CRYPTOGRAPHIC_KEY_INVALID/);
});

test('Cloudflare Free bundle hydrates every scoped HMAC without mutating old env',()=>{
 const keys=buildReleaseSecrets(()=> 'a'.repeat(64));
 assert.deepEqual(Object.keys(keys.H).sort(), [...REQUIRED_FINANCE_SECRETS].sort());
 const before={DB:{id:'stable'},HOMEFLOW_BOOTSTRAP_SECRET:'keep',
  APPROVAL_VERIFICATION_SECRET:'older',
  FOUR_APP_FINANCE_SECRET_BUNDLE:JSON.stringify(keys.H)};
 const after=withFourAppFinanceEnv(before);
 assert.equal(after.BANK_TRANSFER_EXECUTION_SECRET,keys.H.BANK_TRANSFER_EXECUTION_SECRET);
 assert.equal(after.APPROVAL_VERIFICATION_SECRET,keys.H.APPROVAL_VERIFICATION_SECRET);
 assert.equal(after.HOMEFLOW_BOOTSTRAP_SECRET,'keep');
 assert.equal(after.DB,before.DB);
 assert.equal(before.APPROVAL_VERIFICATION_SECRET,'older');
 const wrong=JSON.stringify({...keys.H,BANK_TRANSFER_EXECUTION_SECRET:'bad'});
 assert.throws(()=>withFourAppFinanceEnv({...before,FOUR_APP_FINANCE_SECRET_BUNDLE:wrong}),/INVALID/);
 assert.throws(()=>withFourAppFinanceEnv({...before,FOUR_APP_FINANCE_SECRET_BUNDLE:'{}'}),/INCOMPLETE/);
});
test('G8 accepts ONE sealed finance binding and rejects wrong type or missing bundle',()=>{
 const workerRows=Object.fromEntries(Object.entries(REQUIRED_WORKERS).map(([name,r])=>[
  name,{bindings:r.names.filter(k=>name!=='homeflow'||!REQUIRED_FINANCE_SECRETS.includes(k)).
   map(key=>({name:key,type:r.services.includes(key)?'service':
    key==='DB'?'d1':['MEDIA','DOCUMENTS'].includes(key)?'r2_bucket':'secret_text',
    ...(r.services.includes(key)?{service:SERVICE_TARGETS[name]?.[key]}:{})}))}]));
 const r=REQUIRED_PAGES.kakeibo;
 const pages={kakeibo:{production:{
  env_vars:Object.fromEntries(r.env.map(x=>[x,true])),
  d1_databases:Object.fromEntries(r.d1.map(x=>[x,true])),
  r2_buckets:Object.fromEntries(r.r2.map(x=>[x,true])),
  services:Object.fromEntries(r.services.map(x=>[x,{service:'homeflow'}]))
 }}};
 const snapshot={workers:workerRows,pages};
 workerRows.homeflow.bindings.push({name:'FOUR_APP_FINANCE_SECRET_BUNDLE',type:'secret_text'});
 assert.equal(checkG8Bindings(snapshot).ok,true,JSON.stringify(checkG8Bindings(snapshot).missing));
 workerRows.homeflow.bindings.at(-1).type='plain_text';
 assert.ok(checkG8Bindings(snapshot).missing.includes('worker:homeflow:invalid_finance_bundle_type'));
 workerRows.homeflow.bindings.pop();
 assert.ok(checkG8Bindings(snapshot).missing.includes('worker:homeflow:missing:BANK_TRANSFER_EXECUTION_SECRET'));
});

test('production household ID binding is mandatory for real Kakeibo finance activation',()=>{
 assert.ok(REQUIRED_PAGES.kakeibo.env.includes('KAKEIBO_FAMILY_HOUSEHOLD_ID'));
});
