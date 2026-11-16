import test from 'node:test';
import assert from 'node:assert/strict';
import {REQUIRED_WORKERS,REQUIRED_PAGES,SERVICE_TARGETS} from '../scripts/release-g8-binding-preflight.mjs';
import {parseStagedPlan,verifyStagedSnapshot} from '../scripts/release-g8-staged-preflight.mjs';

const names=Object.keys(REQUIRED_WORKERS).sort();
function fixture(){
 const plan={};const snapshot={workers:{},pages:{}};
 for(const [i,n] of names.entries()){
  const version_id='00000000-0000-4000-8000-'+String(i+1).padStart(12,'0');
  const commit_sha=String(i+1).repeat(40);
  plan[n]={version_id,commit_sha};
  const required=REQUIRED_WORKERS[n];
  const bindings=required.names.map(name=>({
   name,type:required.services.includes(name)?'service':
    name==='DB'?'d1':name==='MEDIA'||name==='DOCUMENTS'?'r2_bucket':'secret_text',
   ...(required.services.includes(name)?{service:SERVICE_TARGETS[n][name]}:{})
  }));
  snapshot.workers[n]={id:version_id,commit_sha,active:false,bindings};
 }
 const p=REQUIRED_PAGES.kakeibo;
 snapshot.pages.kakeibo={production:{
  env_vars:Object.fromEntries(p.env.map(k=>[k,true])),
  d1_databases:Object.fromEntries(p.d1.map(k=>[k,true])),
  r2_buckets:Object.fromEntries(p.r2.map(k=>[k,true])),
  services:Object.fromEntries(p.services.map(k=>[k,{service:'homeflow'}]))
 }};
 return {plan,snapshot};
}
test('staged G8 requires reviewed exact Worker identities and no active deployment',()=>{
 const {plan,snapshot}=fixture();
 assert.deepEqual(parseStagedPlan(JSON.stringify(plan)),plan);
 const res=verifyStagedSnapshot(snapshot,plan);
 assert.equal(res.staged_source_and_binding_presence_ok,true,JSON.stringify(res.errors));
 assert.equal(res.production_deployment_authorized,false);
 assert.equal(res.financial_signatures_paired_verified,false);
 snapshot.workers.homeflow.active=true;
 assert.ok(verifyStagedSnapshot(snapshot,plan).errors.includes('staged:homeflow:already_active'));
});
test('staged G8 rejects missing versions, stale commits and incorrect finance target',()=>{
 const {plan,snapshot}=fixture();
 snapshot.workers.homeflow.commit_sha='f'.repeat(40);
 snapshot.workers.homeflow.bindings.find(b=>b.name==='KAKEIBO_EXECUTION_SERVICE').service='wrong-worker';
 const failures=verifyStagedSnapshot(snapshot,plan).errors;
 assert.ok(failures.includes('staged:homeflow:reviewed_commit_mismatch'));
 assert.ok(failures.includes('worker:homeflow:invalid_service_target:KAKEIBO_EXECUTION_SERVICE'));
 delete snapshot.workers['it-study-platform'];
 assert.ok(verifyStagedSnapshot(snapshot,plan).errors.includes('staged:it-study-platform:unavailable'));
});
test('staged G8 rejects missing Pages finance secret and refuses incomplete plan',()=>{
 const {plan,snapshot}=fixture();
 delete snapshot.pages.kakeibo.production.env_vars.KAKEIBO_FAMILY_PENDING_KEY;
 assert.ok(verifyStagedSnapshot(snapshot,plan).errors.includes('pages:kakeibo:missing:env:KAKEIBO_FAMILY_PENDING_KEY'));
 delete plan.homeflow;
 assert.throws(()=>parseStagedPlan(JSON.stringify(plan)),/exactly the four/);
});
