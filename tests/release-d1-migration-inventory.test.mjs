import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import {MIGRATION_PLANS,verifyMigrationInventory,collectMigrationInventory}
 from '../scripts/release-d1-migration-inventory.mjs';

test('Stage F migration inventory includes all four production apps and reviewed SQL filenames',()=>{
 const a=Object.fromEntries(MIGRATION_PLANS.map(x=>[x.db,x.files.length]));
 assert.deepEqual(a,{'homeflow':8,'kakebo':40,'it-study-platform':13,
  'jp-document-assistant':7});
 assert.equal(MIGRATION_PLANS.length,4);
 for(const p of MIGRATION_PLANS){
  assert.ok(p.files.every(f=>/^\d{4}_[a-z0-9_]+\.sql$/.test(f)),p.db);
  assert.deepEqual(p.files,[...p.files].sort(),p.db);
  assert.equal(new Set(p.files).size,p.files.length,p.db);
 }
});
test('G1 live marker snapshot checks exact count and SHA, not just last migration label',()=>{
 const rows=['0001_first.sql','0002_second.sql'];
 const digest=createHash('sha256').update(rows.join('\n')).digest('hex');
 const plan={...MIGRATION_PLANS[0],db:'test',baseline_count:2,
  baseline_sha256:digest,base_version:2,files:['0003_next.sql']};
 const ok=verifyMigrationInventory({test:{rows:rows.slice().reverse(),
  changed_db:false,rows_written:0}},[plan]);
 assert.equal(ok.ok,true,JSON.stringify(ok));
 assert.equal(ok.production_migration_authorized,false);
 assert.equal(ok.eligible_for_isolated_migration_rehearsal,true);
 assert.ok(ok.missing_release_evidence.includes('independent_restore'));
 const drift=verifyMigrationInventory({test:{rows:['0001_first.sql','0002_changed.sql'],
  changed_db:false,rows_written:0}},[plan]);
 assert.equal(drift.ok,false);
 assert.ok(drift.errors.includes('test:PRODUCTION_MIGRATION_BASELINE_DRIFT'));
});
test('G1 rejects missing proof, writes and invalid ordered migration manifest',()=>{
 const p={...MIGRATION_PLANS[0],db:'test',files:['0053_one.sql','0053_two.sql']};
 const bad=verifyMigrationInventory({test:{rows:[],
  changed_db:true,rows_written:1}},[p]);
 assert.equal(bad.ok,false);
 assert.ok(bad.errors.includes('test:READ_ONLY_PROOF_OR_ROWS_MISSING'));
 const ordered=verifyMigrationInventory({test:{rows:['0052_previous.sql'],
  changed_db:false,rows_written:0}},[p]);
 assert.ok(ordered.errors.includes('test:LOCAL_MIGRATION_ORDER_INVALID'));
});
const id=n=>'00000000-0000-0000-0000-'+String(n).padStart(12,'0');
test('G1 Cloudflare collector only GETs database metadata and POSTs literal SELECT marker queries',async()=>{
 const calls=[];
 const fetcher=async(url,opts)=>{
  calls.push({url,method:opts.method,body:opts.body||null});
  if(url.includes('/d1/database?'))return {ok:true,json:async()=>({
   success:true,result:MIGRATION_PLANS.map((p,i)=>({name:p.db,uuid:id(i+1)}))})};
  const sql=JSON.parse(opts.body).sql;
  assert.match(sql,/^SELECT (?:name|version) AS name FROM (?:d1_migrations|schema_migrations) ORDER BY name$/);
  return {ok:true,json:async()=>({success:true,result:[{
   success:true,results:[{name:'synthetic-migration-name'}],
   meta:{changed_db:false,rows_written:0}}]})};
 };
 const s=await collectMigrationInventory({accountId:'fake-account',token:'synthetic-token',fetcher});
 assert.equal(calls.length,5);
 assert.equal(calls.filter(c=>c.method==='GET').length,1);
 assert.equal(calls.filter(c=>c.method==='POST').length,4);
 assert.ok(Object.keys(s).length===4);
 assert.equal(JSON.stringify(s).includes('synthetic-token'),false);
 assert.equal(JSON.stringify(s).includes('fake-account'),false);
});
test('G1 refuses D1 query unexpected write metadata or ambiguous production database',async()=>{
 const fetcher=async(url,opts)=>{
  if(opts.method==='GET')return {ok:true,json:async()=>({
   success:true,result:MIGRATION_PLANS.map((p,i)=>({name:p.db,uuid:id(i+1)}))})};
  return {ok:true,json:async()=>({success:true,result:[{
   success:true,results:[],meta:{changed_db:true,rows_written:1}}]})};
 };
 await assert.rejects(collectMigrationInventory({
  accountId:'fake',token:'fake',fetcher}),/D1_QUERY_CHANGED_DATABASE/);
 const ambiguous=async()=>({ok:true,json:async()=>({
  success:true,result:[{name:'homeflow',uuid:id(1)},{name:'homeflow',uuid:id(2)}]})});
 await assert.rejects(collectMigrationInventory({
  accountId:'fake',token:'fake',fetcher:ambiguous}),/D1_NAME_MISSING_OR_AMBIGUOUS/);
});

test('G0 cross-app CI can locate every Stage F migration in its pinned checkout',()=>{
 if(process.env.GITHUB_ACTIONS!=='true')return;
 const roots={homeflow:'migrations',kakebo:'.contract-kakeibo/migrations',
  'it-study-platform':'.contract-study/migrations',
  'jp-document-assistant':'.contract-document/migrations'};
 for(const plan of MIGRATION_PLANS){
  const root=roots[plan.db];
  assert.ok(root,'unknown checkout for '+plan.db);
  for(const filename of plan.files){
   assert.equal(existsSync(resolve(process.cwd(),root,filename)),true,
    plan.db+' missing reviewed migration '+filename);
  }
 }
});
